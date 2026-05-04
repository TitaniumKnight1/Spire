import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type SqliteDatabase = InstanceType<typeof Database>;
import { app } from "electron";
import { getDatabasePath, getLibraryDirectory } from "../utils/paths.js";

const SCHEMA_VERSION_KEY = "schema_version";
const CURRENT_SCHEMA_VERSION = "1";

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
  completed_at TEXT
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
