import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type SqliteDatabase = InstanceType<typeof Database>;
import { app } from "electron";
import type { ListeningStats } from "../../shared/library-types.js";
import { getDatabasePath, getLibraryDirectory, getStagingDirectoryRoot } from "../utils/paths.js";

const SCHEMA_VERSION_KEY = "schema_version";
const CURRENT_SCHEMA_VERSION = "3";

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  narrator TEXT,
  series TEXT,
  series_order REAL,
  cover_art_path TEXT,
  description TEXT,
  status TEXT DEFAULT 'unstarted',
  date_added TEXT DEFAULT (datetime('now')),
  total_duration REAL,
  tags TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  track_order INTEGER,
  duration REAL
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
  title TEXT,
  start_time REAL,
  end_time REAL
);

CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER UNIQUE REFERENCES books(id) ON DELETE CASCADE,
  current_file_id INTEGER REFERENCES files(id),
  position_seconds REAL DEFAULT 0,
  playback_speed REAL DEFAULT 1.0,
  last_listened_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  file_id INTEGER REFERENCES files(id),
  position_seconds REAL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url TEXT,
  source_type TEXT,
  status TEXT DEFAULT 'queued',
  progress_pct REAL DEFAULT 0,
  book_id INTEGER REFERENCES books(id),
  started_at TEXT,
  completed_at TEXT,
  torrent_info_hash TEXT,
  display_name TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS podcast_feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  feed_url TEXT UNIQUE,
  last_fetched TEXT,
  cover_art_path TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

let dbInstance: SqliteDatabase | null = null;

function migrateDatabaseSchema(db: SqliteDatabase, fromVersion: string): void {
  if (fromVersion === "1") {
    const cols = db.prepare(`PRAGMA table_info(downloads)`).all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("torrent_info_hash")) {
      db.exec(`ALTER TABLE downloads ADD COLUMN torrent_info_hash TEXT`);
    }
    if (!names.has("display_name")) {
      db.exec(`ALTER TABLE downloads ADD COLUMN display_name TEXT`);
    }
  }
  {
    const cols = db.prepare(`PRAGMA table_info(downloads)`).all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("error_message")) {
      db.exec(`ALTER TABLE downloads ADD COLUMN error_message TEXT`);
    }
  }
}

export function getDatabase(): SqliteDatabase {
  if (!dbInstance) {
    throw new Error("Database not initialized");
  }
  return dbInstance;
}

export function initializeDatabase(): void {
  const dbPath = getDatabasePath();
  const libraryDir = getLibraryDirectory();

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(libraryDir, { recursive: true });
  fs.mkdirSync(getStagingDirectoryRoot(), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(MIGRATION_SQL);

  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(SCHEMA_VERSION_KEY) as { value: string } | undefined;

  if (!row) {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?)",
    ).run(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
  } else if (row.value !== CURRENT_SCHEMA_VERSION) {
    migrateDatabaseSchema(db, row.value);
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
  }

  dbInstance = db;

  app.on("quit", () => {
    dbInstance?.close();
    dbInstance = null;
  });
}

export type BookInsert = {
  id?: number;
  title: string;
  author?: string | null;
  narrator?: string | null;
  series?: string | null;
  series_order?: number | null;
  cover_art_path?: string | null;
  description?: string | null;
  status?: string;
  total_duration?: number | null;
};

export type FileInsert = {
  id?: number;
  book_id: number;
  file_path: string;
  track_order?: number | null;
  duration?: number | null;
};

export type ChapterInsert = {
  id?: number;
  book_id: number;
  file_id: number;
  title?: string | null;
  start_time?: number | null;
  end_time?: number | null;
};

export type ProgressUpsert = {
  book_id: number;
  current_file_id?: number | null;
  position_seconds?: number;
  playback_speed?: number;
  last_listened_at?: string | null;
  completed_at?: string | null;
};

export type BookRow = {
  id: number;
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_order: number | null;
  cover_art_path: string | null;
  description: string | null;
  status: string;
  date_added: string;
  total_duration: number | null;
  tags: string;
};

export type FileRow = {
  id: number;
  book_id: number;
  file_path: string;
  track_order: number | null;
  duration: number | null;
};

export type ChapterRow = {
  id: number;
  book_id: number;
  file_id: number;
  title: string | null;
  start_time: number | null;
  end_time: number | null;
};

export type ProgressRow = {
  id: number;
  book_id: number;
  current_file_id: number | null;
  position_seconds: number;
  playback_speed: number;
  last_listened_at: string | null;
  completed_at: string | null;
};

export function upsertBook(row: BookInsert): number {
  const db = getDatabase();
  if (row.id !== undefined) {
    db.prepare(
      `UPDATE books SET
        title = ?,
        author = ?,
        narrator = ?,
        series = ?,
        series_order = ?,
        cover_art_path = ?,
        description = ?,
        status = ?,
        total_duration = ?
      WHERE id = ?`,
    ).run(
      row.title,
      row.author ?? null,
      row.narrator ?? null,
      row.series ?? null,
      row.series_order ?? null,
      row.cover_art_path ?? null,
      row.description ?? null,
      row.status ?? "unstarted",
      row.total_duration ?? null,
      row.id,
    );
    return row.id;
  }
  const result = db
    .prepare(
      `INSERT INTO books (
        title, author, narrator, series, series_order, cover_art_path, description, status, total_duration
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.title,
      row.author ?? null,
      row.narrator ?? null,
      row.series ?? null,
      row.series_order ?? null,
      row.cover_art_path ?? null,
      row.description ?? null,
      row.status ?? "unstarted",
      row.total_duration ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function upsertFile(row: FileInsert): number {
  const db = getDatabase();
  if (row.id !== undefined) {
    db.prepare(
      `UPDATE files SET book_id = ?, file_path = ?, track_order = ?, duration = ? WHERE id = ?`,
    ).run(row.book_id, row.file_path, row.track_order ?? null, row.duration ?? null, row.id);
    return row.id;
  }
  const result = db
    .prepare(`INSERT INTO files (book_id, file_path, track_order, duration) VALUES (?, ?, ?, ?)`)
    .run(row.book_id, row.file_path, row.track_order ?? null, row.duration ?? null);
  return Number(result.lastInsertRowid);
}

export function upsertChapter(row: ChapterInsert): number {
  const db = getDatabase();
  if (row.id !== undefined) {
    db.prepare(
      `UPDATE chapters SET book_id = ?, file_id = ?, title = ?, start_time = ?, end_time = ? WHERE id = ?`,
    ).run(row.book_id, row.file_id, row.title ?? null, row.start_time ?? null, row.end_time ?? null, row.id);
    return row.id;
  }
  const result = db
    .prepare(
      `INSERT INTO chapters (book_id, file_id, title, start_time, end_time) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(row.book_id, row.file_id, row.title ?? null, row.start_time ?? null, row.end_time ?? null);
  return Number(result.lastInsertRowid);
}

export function upsertProgress(row: ProgressUpsert): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO progress (book_id, current_file_id, position_seconds, playback_speed, last_listened_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET
       current_file_id = excluded.current_file_id,
       position_seconds = excluded.position_seconds,
       playback_speed = excluded.playback_speed,
       last_listened_at = excluded.last_listened_at,
       completed_at = excluded.completed_at`,
  ).run(
    row.book_id,
    row.current_file_id ?? null,
    row.position_seconds ?? 0,
    row.playback_speed ?? 1,
    row.last_listened_at ?? null,
    row.completed_at ?? null,
  );
}

export function getAllBooksWithProgress(): (BookRow & {
  position_seconds: number | null;
  completed_at: string | null;
})[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT
        b.id,
        b.title,
        b.author,
        b.narrator,
        b.series,
        b.series_order,
        b.cover_art_path,
        b.description,
        b.status,
        b.date_added,
        b.total_duration,
        b.tags,
        p.position_seconds AS position_seconds,
        p.completed_at AS completed_at
      FROM books b
      LEFT JOIN progress p ON p.book_id = b.id
      ORDER BY datetime(b.date_added) DESC, b.id DESC`,
    )
    .all() as (BookRow & { position_seconds: number | null; completed_at: string | null })[];
}

export function getBookById(id: number): BookRow | undefined {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM books WHERE id = ?`).get(id) as BookRow | undefined;
}

export type BookMetadataColumnUpdate = {
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_order: number | null;
  description: string | null;
  cover_art_path: string | null;
};

export function updateBookMetadata(bookId: number, fields: BookMetadataColumnUpdate): boolean {
  const db = getDatabase();
  const info = db
    .prepare(
      `UPDATE books SET title = ?, author = ?, narrator = ?, series = ?, series_order = ?, description = ?, cover_art_path = ? WHERE id = ?`,
    )
    .run(
      fields.title,
      fields.author ?? null,
      fields.narrator ?? null,
      fields.series ?? null,
      fields.series_order ?? null,
      fields.description ?? null,
      fields.cover_art_path ?? null,
      bookId,
    );
  return info.changes > 0;
}

export function updateBookStatus(bookId: number, status: string): boolean {
  const db = getDatabase();
  const info = db.prepare(`UPDATE books SET status = ? WHERE id = ?`).run(status, bookId);
  return info.changes > 0;
}

export function updateBookTags(bookId: number, tags: string[]): boolean {
  const db = getDatabase();
  const info = db.prepare(`UPDATE books SET tags = ? WHERE id = ?`).run(JSON.stringify(tags), bookId);
  return info.changes > 0;
}

export function getSetting(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  const db = getDatabase();
  if (value === null || value === "") {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
    return;
  }
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
}

export function getFilesByBook(bookId: number): FileRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM files WHERE book_id = ? ORDER BY track_order IS NULL, track_order ASC, file_path ASC`,
    )
    .all(bookId) as FileRow[];
}

export function getChaptersByBook(bookId: number): ChapterRow[] {
  const db = getDatabase();
  return db
    .prepare(`SELECT * FROM chapters WHERE book_id = ? ORDER BY start_time IS NULL, start_time ASC, id ASC`)
    .all(bookId) as ChapterRow[];
}

export function getProgressByBook(bookId: number): ProgressRow | undefined {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM progress WHERE book_id = ?`).get(bookId) as ProgressRow | undefined;
}

export function deleteBook(id: number): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM downloads WHERE book_id = ?`).run(id);
  db.prepare(`DELETE FROM books WHERE id = ?`).run(id);
}

export function filePathExists(filePath: string): boolean {
  const db = getDatabase();
  const row = db.prepare(`SELECT 1 AS ok FROM files WHERE file_path = ? LIMIT 1`).get(filePath) as
    | { ok: number }
    | undefined;
  return row !== undefined;
}

export function listFilePathsWithBookIds(): { book_id: number; file_path: string }[] {
  const db = getDatabase();
  return db.prepare(`SELECT book_id, file_path FROM files`).all() as { book_id: number; file_path: string }[];
}

export type BookmarkRow = {
  id: number;
  book_id: number;
  file_id: number | null;
  position_seconds: number | null;
  note: string | null;
  created_at: string | null;
};

export function getBookmarksByBook(bookId: number): BookmarkRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM bookmarks WHERE book_id = ? ORDER BY datetime(created_at) DESC, id DESC`,
    )
    .all(bookId) as BookmarkRow[];
}

export type BookmarkInsert = {
  book_id: number;
  file_id: number | null;
  position_seconds: number;
  note?: string | null;
};

export function insertBookmark(row: BookmarkInsert): number {
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO bookmarks (book_id, file_id, position_seconds, note) VALUES (?, ?, ?, ?)`,
    )
    .run(row.book_id, row.file_id, row.position_seconds, row.note ?? null);
  return Number(result.lastInsertRowid);
}

export function deleteBookmarkById(id: number): boolean {
  const db = getDatabase();
  const info = db.prepare(`DELETE FROM bookmarks WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function savePlaybackProgress(
  bookId: number,
  currentFileId: number | null,
  positionSeconds: number,
  playbackSpeed: number,
): void {
  const existing = getProgressByBook(bookId);
  const now = new Date().toISOString();
  upsertProgress({
    book_id: bookId,
    current_file_id: currentFileId,
    position_seconds: positionSeconds,
    playback_speed: playbackSpeed,
    last_listened_at: now,
    completed_at: existing?.completed_at ?? null,
  });
}

export function markBookPlaybackComplete(bookId: number): void {
  const existing = getProgressByBook(bookId);
  const now = new Date().toISOString();
  upsertProgress({
    book_id: bookId,
    current_file_id: existing?.current_file_id ?? null,
    position_seconds: existing?.position_seconds ?? 0,
    playback_speed: existing?.playback_speed ?? 1,
    last_listened_at: now,
    completed_at: now,
  });
}

// --- Downloads (torrent queue) ---

export type DownloadInsert = {
  source_url: string | null;
  source_type: string;
  status?: string;
  progress_pct?: number;
  display_name?: string | null;
  torrent_info_hash?: string | null;
};

export type DownloadRow = {
  id: number;
  source_url: string | null;
  source_type: string | null;
  status: string;
  progress_pct: number;
  book_id: number | null;
  started_at: string | null;
  completed_at: string | null;
  torrent_info_hash: string | null;
  display_name: string | null;
  error_message: string | null;
};

export function insertDownload(row: DownloadInsert): number {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO downloads (
        source_url, source_type, status, progress_pct, started_at, display_name, torrent_info_hash, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.source_url,
      row.source_type,
      row.status ?? "queued",
      row.progress_pct ?? 0,
      now,
      row.display_name ?? null,
      row.torrent_info_hash ?? null,
      null,
    );
  return Number(result.lastInsertRowid);
}

export function updateDownloadStatus(id: number, status: string): void {
  const db = getDatabase();
  db.prepare(`UPDATE downloads SET status = ? WHERE id = ?`).run(status, id);
}

export function updateDownloadProgress(id: number, progress_pct: number): void {
  const db = getDatabase();
  db.prepare(`UPDATE downloads SET progress_pct = ? WHERE id = ?`).run(progress_pct, id);
}

export function updateDownloadBookId(id: number, bookId: number | null): void {
  const db = getDatabase();
  db.prepare(`UPDATE downloads SET book_id = ? WHERE id = ?`).run(bookId, id);
}

export function updateDownloadTorrentMeta(
  id: number,
  partial: { display_name?: string | null; torrent_info_hash?: string | null },
): void {
  const db = getDatabase();
  if (partial.display_name !== undefined && partial.torrent_info_hash !== undefined) {
    db.prepare(`UPDATE downloads SET display_name = ?, torrent_info_hash = ? WHERE id = ?`).run(
      partial.display_name,
      partial.torrent_info_hash,
      id,
    );
    return;
  }
  if (partial.display_name !== undefined) {
    db.prepare(`UPDATE downloads SET display_name = ? WHERE id = ?`).run(partial.display_name, id);
  }
  if (partial.torrent_info_hash !== undefined) {
    db.prepare(`UPDATE downloads SET torrent_info_hash = ? WHERE id = ?`).run(partial.torrent_info_hash, id);
  }
}

export function updateDownloadCompletedAt(id: number, completedAt: string | null): void {
  const db = getDatabase();
  db.prepare(`UPDATE downloads SET completed_at = ? WHERE id = ?`).run(completedAt, id);
}

export function resetDownloadForRetry(id: number): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE downloads SET status = 'queued', progress_pct = 0, completed_at = NULL, book_id = NULL,
      torrent_info_hash = NULL, display_name = NULL, error_message = NULL WHERE id = ?`,
  ).run(id);
}

export function updateDownloadError(id: number, message: string): void {
  const db = getDatabase();
  db.prepare(`UPDATE downloads SET status = 'failed', error_message = ?, progress_pct = ? WHERE id = ?`).run(
    message,
    0,
    id,
  );
}

export type PodcastFeedRow = {
  id: number;
  title: string | null;
  feed_url: string;
  last_fetched: string | null;
  cover_art_path: string | null;
};

export function upsertPodcastFeed(input: {
  feed_url: string;
  title?: string | null;
  cover_art_path?: string | null;
}): PodcastFeedRow {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = db.prepare(`SELECT * FROM podcast_feeds WHERE feed_url = ?`).get(input.feed_url) as
    | PodcastFeedRow
    | undefined;
  if (existing) {
    db.prepare(
      `UPDATE podcast_feeds SET title = ?, last_fetched = ?, cover_art_path = COALESCE(?, cover_art_path) WHERE id = ?`,
    ).run(input.title ?? existing.title, now, input.cover_art_path ?? null, existing.id);
    return db.prepare(`SELECT * FROM podcast_feeds WHERE id = ?`).get(existing.id) as PodcastFeedRow;
  }
  const result = db
    .prepare(`INSERT INTO podcast_feeds (title, feed_url, last_fetched, cover_art_path) VALUES (?, ?, ?, ?)`)
    .run(input.title ?? null, input.feed_url, now, input.cover_art_path ?? null);
  const id = Number(result.lastInsertRowid);
  return db.prepare(`SELECT * FROM podcast_feeds WHERE id = ?`).get(id) as PodcastFeedRow;
}

export function getAllPodcastFeeds(): PodcastFeedRow[] {
  const db = getDatabase();
  return db
    .prepare(`SELECT * FROM podcast_feeds ORDER BY title COLLATE NOCASE ASC, id DESC`)
    .all() as PodcastFeedRow[];
}

export function deletePodcastFeed(id: number): boolean {
  const db = getDatabase();
  const info = db.prepare(`DELETE FROM podcast_feeds WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function getAllDownloads(): DownloadRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM downloads ORDER BY datetime(started_at) DESC, id DESC`,
    )
    .all() as DownloadRow[];
}

export function getDownloadById(id: number): DownloadRow | undefined {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM downloads WHERE id = ?`).get(id) as DownloadRow | undefined;
}

export function getAppSetting(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppSetting(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export type ListeningStatsRow = {
  hoursThisWeek: number;
  hoursThisMonth: number;
  hoursAllTime: number;
  booksCompleted: number;
  booksInProgress: number;
  avgPlaybackSpeed: number;
};

/** ISO timestamps for streak computation (local calendar dates derived in TS). */
export function getAllLastListenedAtTimestamps(): string[] {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT last_listened_at AS t FROM progress WHERE last_listened_at IS NOT NULL`)
    .all() as { t: string }[];
  return rows.map((r) => r.t);
}

/**
 * Aggregates listening stats from `progress` + `books` (no new tables).
 * Streak fields are merged in {@link getListeningStats}.
 */
export function getListeningStatsAggregates(): ListeningStatsRow {
  const db = getDatabase();

  const weekRow = db
    .prepare(
      `SELECT COALESCE(SUM(position_seconds), 0) AS v
       FROM progress
       WHERE last_listened_at IS NOT NULL
         AND datetime(last_listened_at) >= datetime('now', '-7 days')`,
    )
    .get() as { v: number };

  const monthRow = db
    .prepare(
      `SELECT COALESCE(SUM(position_seconds), 0) AS v
       FROM progress
       WHERE last_listened_at IS NOT NULL
         AND datetime(last_listened_at) >= datetime('now', '-30 days')`,
    )
    .get() as { v: number };

  const allTimeRow = db
    .prepare(
      `SELECT COALESCE(SUM(
         CASE
           WHEN b.total_duration IS NOT NULL AND b.total_duration > 0
           THEN b.total_duration * MIN(1.0, MAX(0.0, p.position_seconds / b.total_duration))
           ELSE 0
         END
       ), 0) AS v
       FROM progress p
       JOIN books b ON b.id = p.book_id`,
    )
    .get() as { v: number };

  const completedRow = db
    .prepare(`SELECT COUNT(*) AS c FROM progress WHERE completed_at IS NOT NULL`)
    .get() as { c: number };

  const inProgressRow = db.prepare(`SELECT COUNT(*) AS c FROM books WHERE status = 'in-progress'`).get() as { c: number };

  const avgRow = db
    .prepare(`SELECT AVG(playback_speed) AS a FROM progress WHERE playback_speed > 0`)
    .get() as { a: number | null };

  return {
    hoursThisWeek: Number(weekRow.v) / 3600,
    hoursThisMonth: Number(monthRow.v) / 3600,
    hoursAllTime: Number(allTimeRow.v) / 3600,
    booksCompleted: Number(completedRow.c),
    booksInProgress: Number(inProgressRow.c),
    avgPlaybackSpeed: avgRow.a != null && Number.isFinite(avgRow.a) ? Number(avgRow.a) : 0,
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar YYYY-MM-DD (for streaks). */
function toLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, mo, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) {
    return null;
  }
  return d;
}

function addDaysYmd(ymd: string, delta: number): string {
  const d = parseYmd(ymd);
  if (!d) {
    return ymd;
  }
  d.setDate(d.getDate() + delta);
  return toLocalYmd(d);
}

function daysBetweenYmd(a: string, b: string): number {
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da || !db) {
    return NaN;
  }
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

export function computeStreaksFromListenTimestamps(isoStrings: string[]): { currentStreak: number; longestStreak: number } {
  const days = new Set<string>();
  for (const iso of isoStrings) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) {
      continue;
    }
    days.add(toLocalYmd(new Date(t)));
  }
  if (days.size === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const sortedAsc = [...days].sort((x, y) => x.localeCompare(y));
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedAsc.length; i++) {
    const prev = sortedAsc[i - 1]!;
    const cur = sortedAsc[i]!;
    if (daysBetweenYmd(prev, cur) === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  const today = toLocalYmd(new Date());
  const yesterday = addDaysYmd(today, -1);
  let currentStreak = 0;
  if (days.has(today)) {
    let cursor = today;
    while (days.has(cursor)) {
      currentStreak += 1;
      cursor = addDaysYmd(cursor, -1);
    }
  } else if (days.has(yesterday)) {
    let cursor = yesterday;
    while (days.has(cursor)) {
      currentStreak += 1;
      cursor = addDaysYmd(cursor, -1);
    }
  }

  return { currentStreak, longestStreak: longest };
}

export function getListeningStats(): ListeningStats {
  const agg = getListeningStatsAggregates();
  const stamps = getAllLastListenedAtTimestamps();
  const { currentStreak, longestStreak } = computeStreaksFromListenTimestamps(stamps);
  return {
    hoursThisWeek: agg.hoursThisWeek,
    hoursThisMonth: agg.hoursThisMonth,
    hoursAllTime: agg.hoursAllTime,
    booksCompleted: agg.booksCompleted,
    booksInProgress: agg.booksInProgress,
    avgPlaybackSpeed: agg.avgPlaybackSpeed,
    currentStreak,
    longestStreak,
  };
}
