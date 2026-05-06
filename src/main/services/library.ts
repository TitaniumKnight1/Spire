import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { net } from "electron";
import { SUPPORTED_AUDIO_EXTENSIONS } from "../utils/formats.js";
import { getCoversDirectory } from "../utils/paths.js";
import {
  deleteBook as dbDeleteBook,
  filePathExists,
  getAllBooksWithProgress,
  getAppSetting,
  getBookById,
  getChaptersByBook,
  getFilesByBook,
  getProgressByBook,
  listFilePathsWithBookIds,
  updateBookMetadata as dbUpdateBookMetadata,
  upsertBook,
  upsertChapter,
  upsertFile,
  upsertProgress,
} from "./database.js";
import { SETTINGS_KEY_DEFAULT_SPEED } from "../ipc/settings.js";
import { coverHttpUrl, getAudioServerPort } from "./audio-server.js";
import { parseAudioFile, persistCoverArt, type ParsedAudioMetadata } from "./metadata.js";
import type { BookDetailPayload, BookListItem } from "../../shared/library-types.js";

const AUDIO_EXT_SET = new Set<string>(SUPPORTED_AUDIO_EXTENSIONS);

function isSupportedAudio(filePath: string): boolean {
  return AUDIO_EXT_SET.has(path.extname(filePath).toLowerCase());
}

function walkDirForAudio(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      results.push(...walkDirForAudio(full));
    } else if (ent.isFile() && isSupportedAudio(full)) {
      results.push(full);
    }
  }
  return results;
}

function expandInputPaths(inputs: string[]): string[] {
  const out: string[] = [];
  for (const raw of inputs) {
    const abs = path.normalize(path.resolve(raw));
    if (!fs.existsSync(abs)) {
      continue;
    }
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      out.push(...walkDirForAudio(abs));
    } else if (st.isFile() && isSupportedAudio(abs)) {
      out.push(abs);
    }
  }
  return out;
}

function clusterByParentDir(filePaths: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const fp of filePaths) {
    const norm = path.normalize(fp);
    const parent = path.dirname(norm);
    const list = map.get(parent);
    if (list) {
      list.push(norm);
    } else {
      map.set(parent, [norm]);
    }
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
  return map;
}

function findBookIdForDirectory(
  parentDir: string,
  index: { book_id: number; file_path: string }[],
): number | null {
  const want = path.normalize(parentDir);
  for (const row of index) {
    if (path.normalize(path.dirname(row.file_path)) === want) {
      return row.book_id;
    }
  }
  return null;
}

type ParsedFile = { filePath: string; meta: ParsedAudioMetadata };

function sortParsedFiles(items: ParsedFile[]): ParsedFile[] {
  return [...items].sort((a, b) => {
    const ta = a.meta.trackNumber;
    const tb = b.meta.trackNumber;
    if (ta != null && tb != null && ta !== tb) {
      return ta - tb;
    }
    if (ta != null && tb == null) {
      return -1;
    }
    if (ta == null && tb != null) {
      return 1;
    }
    return a.filePath.localeCompare(b.filePath, undefined, { sensitivity: "base" });
  });
}

function aggregateBookFields(sorted: ParsedFile[]): {
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_order: number | null;
  description: string | null;
  totalDuration: number;
  coverSource: ParsedAudioMetadata["cover"];
} {
  const firstAlbum = sorted.find((x) => x.meta.albumTitle)?.meta.albumTitle;
  const title = firstAlbum ?? sorted[0]?.meta.title ?? "Untitled";
  let author: string | null = null;
  let narrator: string | null = null;
  let series: string | null = null;
  let series_order: number | null = null;
  let description: string | null = null;
  let coverSource: ParsedAudioMetadata["cover"] = null;
  let totalDuration = 0;

  for (const { meta } of sorted) {
    totalDuration += meta.durationSeconds ?? 0;
    if (!author && meta.author) {
      author = meta.author;
    }
    if (!narrator && meta.narrator) {
      narrator = meta.narrator;
    }
    if (!series && meta.series) {
      series = meta.series;
    }
    if (series_order == null && meta.seriesOrder != null) {
      series_order = meta.seriesOrder;
    }
    if (!description && meta.description) {
      description = meta.description;
    }
    if (!coverSource && meta.cover) {
      coverSource = meta.cover;
    }
  }

  return { title, author, narrator, series, series_order, description, totalDuration, coverSource };
}

async function parsePathsWithErrors(paths: string[], errorsOut: string[]): Promise<ParsedFile[]> {
  const results: ParsedFile[] = [];
  for (const filePath of paths) {
    try {
      const meta = await parseAudioFile(filePath);
      results.push({ filePath, meta });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errorsOut.push(`${filePath}: ${msg}`);
    }
  }
  return results;
}

function nextTrackOrders(sorted: ParsedFile[], startIndex: number): number[] {
  return sorted.map((item, i) => {
    const fromTag = item.meta.trackNumber;
    return fromTag != null ? fromTag : startIndex + i + 1;
  });
}

function readDefaultPlaybackSpeedFromSettings(): number {
  const raw = getAppSetting(SETTINGS_KEY_DEFAULT_SPEED);
  if (raw == null || raw.trim() === "") {
    return 1;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return 1;
  }
  const clamped = Math.min(3.5, Math.max(0.5, n));
  const stepped = Math.round(clamped * 4) / 4;
  return stepped;
}

async function createBookFromParsed(sorted: ParsedFile[]): Promise<number> {
  const agg = aggregateBookFields(sorted);
  const bookId = upsertBook({
    title: agg.title,
    author: agg.author,
    narrator: agg.narrator,
    series: agg.series,
    series_order: agg.series_order,
    description: agg.description,
    total_duration: agg.totalDuration > 0 ? agg.totalDuration : null,
  });

  const coverPath = persistCoverArt(bookId, agg.coverSource);
  if (coverPath) {
    upsertBook({
      id: bookId,
      title: agg.title,
      author: agg.author,
      narrator: agg.narrator,
      series: agg.series,
      series_order: agg.series_order,
      description: agg.description,
      cover_art_path: coverPath,
      total_duration: agg.totalDuration > 0 ? agg.totalDuration : null,
    });
  }

  upsertProgress({ book_id: bookId, playback_speed: readDefaultPlaybackSpeedFromSettings() });

  const orders = nextTrackOrders(sorted, 0);
  for (let i = 0; i < sorted.length; i++) {
    const { filePath, meta } = sorted[i];
    const fileId = upsertFile({
      book_id: bookId,
      file_path: filePath,
      track_order: orders[i] ?? i + 1,
      duration: meta.durationSeconds,
    });
    for (const ch of meta.chapters) {
      upsertChapter({
        book_id: bookId,
        file_id: fileId,
        title: ch.title,
        start_time: ch.startSeconds,
        end_time: ch.endSeconds,
      });
    }
  }

  return bookId;
}

async function appendFilesToBook(bookId: number, sorted: ParsedFile[]): Promise<void> {
  const existing = getFilesByBook(bookId);
  let maxOrder = 0;
  for (const f of existing) {
    if (f.track_order != null && f.track_order > maxOrder) {
      maxOrder = f.track_order;
    }
  }
  for (let i = 0; i < sorted.length; i++) {
    const { filePath, meta } = sorted[i];
    const track_order = maxOrder + i + 1;
    const fileId = upsertFile({
      book_id: bookId,
      file_path: filePath,
      track_order,
      duration: meta.durationSeconds,
    });
    for (const ch of meta.chapters) {
      upsertChapter({
        book_id: bookId,
        file_id: fileId,
        title: ch.title,
        start_time: ch.startSeconds,
        end_time: ch.endSeconds,
      });
    }
  }

  let sum = 0;
  for (const f of getFilesByBook(bookId)) {
    sum += f.duration ?? 0;
  }
  const book = getBookById(bookId);
  if (!book) {
    return;
  }

  const allRows = getFilesByBook(bookId);
  const allPaths = allRows.map((r) => r.file_path);
  const parseErrors: string[] = [];
  const parsedAll = await parsePathsWithErrors(allPaths, parseErrors);
  const agg =
    parsedAll.length > 0
      ? aggregateBookFields(sortParsedFiles(parsedAll))
      : aggregateBookFields(sorted);

  let coverPath = book.cover_art_path;
  if (!coverPath) {
    coverPath = persistCoverArt(bookId, agg.coverSource);
  }
  upsertBook({
    id: bookId,
    title: book.title,
    author: agg.author,
    narrator: agg.narrator,
    series: agg.series,
    series_order: agg.series_order,
    cover_art_path: coverPath ?? book.cover_art_path,
    description: agg.description ?? book.description,
    status: book.status,
    total_duration: sum > 0 ? sum : null,
  });
}

function parseTagsFromRow(tagsJson: string | null | undefined): string[] {
  if (!tagsJson) {
    return [];
  }
  try {
    const v = JSON.parse(tagsJson) as unknown;
    if (!Array.isArray(v)) {
      return [];
    }
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function rowToListItem(
  row: ReturnType<typeof getAllBooksWithProgress>[number],
): BookListItem {
  const total = row.total_duration ?? 0;
  const pos = row.position_seconds ?? 0;
  const progress_percent =
    total > 0 ? Math.min(100, Math.max(0, Math.round((pos / total) * 1000) / 10)) : 0;
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    narrator: row.narrator,
    series: row.series,
    series_order: row.series_order,
    cover_art_url: coverHttpUrl(row.cover_art_path),
    description: row.description,
    status: row.status,
    date_added: row.date_added,
    total_duration: row.total_duration,
    position_seconds: pos,
    completed_at: row.completed_at,
    progress_percent,
    tags: parseTagsFromRow(row.tags),
  };
}

export async function ingestPaths(paths: string[]): Promise<{
  success: boolean;
  booksAdded: number;
  errors: string[];
  bookIds: number[];
  newBookIds: number[];
}> {
  const errors: string[] = [];
  const bookIds: number[] = [];
  const newBookIds: number[] = [];
  const expanded = expandInputPaths(paths);
  if (expanded.length === 0) {
    return { success: true, booksAdded: 0, errors, bookIds, newBookIds };
  }

  const clusters = clusterByParentDir(expanded);
  let booksAdded = 0;

  for (const [parentDir, clusterPaths] of clusters) {
    const newPaths = clusterPaths.filter((p) => !filePathExists(p));
    if (newPaths.length === 0) {
      continue;
    }

    const fileIndex = listFilePathsWithBookIds();
    const existingBookId = findBookIdForDirectory(parentDir, fileIndex);

    const parsed = await parsePathsWithErrors(newPaths, errors);
    if (parsed.length === 0) {
      continue;
    }
    const sorted = sortParsedFiles(parsed);

    if (existingBookId != null) {
      await appendFilesToBook(existingBookId, sorted);
      bookIds.push(existingBookId);
    } else {
      const id = await createBookFromParsed(sorted);
      booksAdded += 1;
      bookIds.push(id);
      newBookIds.push(id);
    }
  }

  return { success: errors.length === 0, booksAdded, errors, bookIds, newBookIds };
}

export function getLibrary(): BookListItem[] {
  return getAllBooksWithProgress().map(rowToListItem);
}

export function getBookListItemById(bookId: number): BookListItem | null {
  for (const row of getAllBooksWithProgress()) {
    if (row.id === bookId) {
      return rowToListItem(row);
    }
  }
  return null;
}

function filePathKey(fp: string): string {
  return path.normalize(path.resolve(fp));
}

/**
 * Re-read ID3/metadata from all files on disk for this book and update `books` + per-file durations.
 * Used after torrent ingest (paths exist but tags were never aggregated) and for on-demand repair.
 */
export async function reingestBookMetadata(bookId: number): Promise<void> {
  const book = getBookById(bookId);
  if (!book) {
    return;
  }
  const rows = getFilesByBook(bookId);
  if (rows.length === 0) {
    return;
  }
  const errors: string[] = [];
  const parsed = await parsePathsWithErrors(
    rows.map((r) => r.file_path),
    errors,
  );
  if (errors.length > 0) {
    console.warn("[spire/library] reingestBookMetadata parse errors:", errors);
  }
  if (parsed.length === 0) {
    return;
  }
  const sorted = sortParsedFiles(parsed);
  const metaByKey = new Map(sorted.map((p) => [filePathKey(p.filePath), p.meta]));

  for (const row of rows) {
    const meta = metaByKey.get(filePathKey(row.file_path));
    if (!meta) {
      continue;
    }
    upsertFile({
      id: row.id,
      book_id: bookId,
      file_path: row.file_path,
      track_order: row.track_order,
      duration: meta.durationSeconds,
    });
  }

  let sum = 0;
  for (const f of getFilesByBook(bookId)) {
    sum += f.duration ?? 0;
  }

  const refreshed = getBookById(bookId);
  if (!refreshed) {
    return;
  }
  const agg = aggregateBookFields(sorted);
  let coverPath = refreshed.cover_art_path;
  if (!coverPath && agg.coverSource) {
    coverPath = persistCoverArt(bookId, agg.coverSource);
  }
  upsertBook({
    id: bookId,
    title: refreshed.title,
    author: agg.author,
    narrator: agg.narrator,
    series: agg.series,
    series_order: agg.series_order,
    cover_art_path: coverPath ?? refreshed.cover_art_path,
    description: agg.description ?? refreshed.description,
    status: refreshed.status,
    total_duration: sum > 0 ? sum : refreshed.total_duration,
  });
}

function resolveFilePlaybackFields(filePath: string): { playback_url: string | null; file_error: string | null } {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { playback_url: null, file_error: `Audio file not found: ${resolved}` };
  }
  try {
    return { playback_url: pathToFileURL(resolved).href, file_error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { playback_url: null, file_error: `Could not build file URL: ${msg}` };
  }
}

export function getBookDetail(bookId: number): BookDetailPayload | null {
  const book = getBookById(bookId);
  if (!book) {
    return null;
  }
  const files = getFilesByBook(bookId);
  const chapters = getChaptersByBook(bookId);
  const progress = getProgressByBook(bookId);
  const total = book.total_duration ?? 0;
  const pos = progress?.position_seconds ?? 0;
  const progress_percent =
    total > 0 ? Math.min(100, Math.max(0, Math.round((pos / total) * 1000) / 10)) : 0;

  return {
    book: {
      id: book.id,
      title: book.title,
      author: book.author,
      narrator: book.narrator,
      series: book.series,
      series_order: book.series_order,
      cover_art_url: coverHttpUrl(book.cover_art_path),
      cover_art_path: book.cover_art_path,
      description: book.description,
      status: book.status,
      tags: parseTagsFromRow(book.tags),
      date_added: book.date_added,
      total_duration: book.total_duration,
    },
    files: files.map((f) => {
      const { playback_url: filePlaybackHref, file_error } = resolveFilePlaybackFields(f.file_path);
      const resolved = path.resolve(f.file_path);
      const port = getAudioServerPort();
      const playback_url =
        filePlaybackHref === null
          ? null
          : `http://127.0.0.1:${port}/audio?path=${encodeURIComponent(resolved)}`;
      return {
        id: f.id,
        file_path: f.file_path,
        track_order: f.track_order,
        duration: f.duration,
        playback_url,
        file_error,
      };
    }),
    chapters: chapters.map((c) => ({
      id: c.id,
      file_id: c.file_id,
      title: c.title,
      start_time: c.start_time,
      end_time: c.end_time,
    })),
    progress: progress
      ? {
          book_id: progress.book_id,
          position_seconds: progress.position_seconds,
          playback_speed: progress.playback_speed,
          current_file_id: progress.current_file_id,
          last_listened_at: progress.last_listened_at,
          completed_at: progress.completed_at,
        }
      : null,
    progress_percent,
  };
}

function fetchHttpBuffer(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      const req = net.request(url);
      req.on("response", (res) => {
        if (res.statusCode !== 200) {
          res.on("data", () => {});
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
        res.on("error", () => resolve(null));
      });
      req.on("error", () => resolve(null));
      req.end();
    } catch {
      resolve(null);
    }
  });
}

/** Copies a user-selected image into `{userData}/covers/` when needed and returns the stored absolute path. */
export function copyUserCoverToLibrary(
  bookId: number,
  sourcePath: string | null,
  previousStoredPath: string | null,
): string | null {
  if (sourcePath === null) {
    return null;
  }
  const normalized = path.normalize(sourcePath);
  const normalizedPrev = previousStoredPath ? path.normalize(previousStoredPath) : null;
  if (normalizedPrev && normalized === normalizedPrev) {
    return normalizedPrev;
  }
  const coversDirNorm = path.normalize(getCoversDirectory());
  if (normalized.startsWith(coversDirNorm)) {
    return normalized;
  }
  if (!fs.existsSync(normalized)) {
    return normalizedPrev;
  }
  const ext = path.extname(normalized).toLowerCase();
  const destBase =
    ext === ".png" ? `${bookId}.png` : ext === ".gif" ? `${bookId}.gif` : ext === ".webp" ? `${bookId}.webp` : `${bookId}.jpg`;
  const dir = getCoversDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, destBase);
  fs.copyFileSync(normalized, dest);
  return dest;
}

function coverSearchTitle(raw: string): string {
  return raw.replace(/\s*[-–]\s*(ch|chapter|part|vol|volume)\s*\d+.*/i, "").trim();
}

export async function fetchCoverArt(bookId: number): Promise<string | null> {
  const book = getBookById(bookId);
  if (!book) {
    return null;
  }
  const queryTitle = coverSearchTitle(book.title);
  const author = book.author ?? "";

  let imageData: Buffer | null = null;

  try {
    const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(queryTitle)}&author=${encodeURIComponent(author)}&fields=cover_i&limit=1`;
    const searchBuf = await fetchHttpBuffer(searchUrl);
    if (searchBuf?.length) {
      try {
        const json = JSON.parse(searchBuf.toString("utf8")) as { docs?: { cover_i?: number }[] };
        const coverId = json.docs?.[0]?.cover_i;
        if (typeof coverId === "number") {
          const coverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
          const img = await fetchHttpBuffer(coverUrl);
          if (img?.length) {
            imageData = img;
          }
        }
      } catch {
        /* fall through */
      }
    }
  } catch {
    /* fall through */
  }

  if (!imageData?.length) {
    try {
      const q = `intitle:${queryTitle}+inauthor:${author}`;
      const volUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1`;
      const volBuf = await fetchHttpBuffer(volUrl);
      if (volBuf?.length) {
        try {
          const json = JSON.parse(volBuf.toString("utf8")) as {
            items?: { volumeInfo?: { imageLinks?: { thumbnail?: string } } }[];
          };
          let thumb = json.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
          if (thumb) {
            thumb = thumb.includes("zoom=") ? thumb.replace(/zoom=\d+/gi, "zoom=3") : thumb;
            const img = await fetchHttpBuffer(thumb);
            if (img?.length) {
              imageData = img;
            }
          }
        } catch {
          /* fall through */
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (!imageData?.length) {
    return null;
  }

  const dir = getCoversDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${bookId}.jpg`);
  fs.writeFileSync(outPath, imageData);

  dbUpdateBookMetadata(bookId, {
    title: book.title,
    author: book.author,
    narrator: book.narrator,
    series: book.series,
    series_order: book.series_order,
    description: book.description,
    cover_art_path: outPath,
  });

  return outPath;
}

export function removeBook(bookId: number): void {
  dbDeleteBook(bookId);
}
