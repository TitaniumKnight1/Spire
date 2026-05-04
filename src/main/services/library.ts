import fs from "node:fs";
import path from "node:path";
import { SUPPORTED_AUDIO_EXTENSIONS } from "../utils/formats.js";
import {
  deleteBook as dbDeleteBook,
  filePathExists,
  getAllBooksWithProgress,
  getBookById,
  getChaptersByBook,
  getFilesByBook,
  getProgressByBook,
  listFilePathsWithBookIds,
  upsertBook,
  upsertChapter,
  upsertFile,
  upsertProgress,
} from "./database.js";
import { coverFileUrl, parseAudioFile, persistCoverArt, type ParsedAudioMetadata } from "./metadata.js";
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

  upsertProgress({ book_id: bookId });

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
  let coverPath = book.cover_art_path;
  if (!coverPath) {
    const agg = aggregateBookFields(sorted);
    coverPath = persistCoverArt(bookId, agg.coverSource);
  }
  upsertBook({
    id: bookId,
    title: book.title,
    author: book.author,
    narrator: book.narrator,
    series: book.series,
    series_order: book.series_order,
    cover_art_path: coverPath ?? book.cover_art_path,
    description: book.description,
    status: book.status,
    total_duration: sum > 0 ? sum : null,
  });
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
    cover_art_url: coverFileUrl(row.cover_art_path),
    description: row.description,
    status: row.status,
    date_added: row.date_added,
    total_duration: row.total_duration,
    position_seconds: pos,
    completed_at: row.completed_at,
    progress_percent,
  };
}

export async function ingestPaths(paths: string[]): Promise<{
  success: boolean;
  booksAdded: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const expanded = expandInputPaths(paths);
  if (expanded.length === 0) {
    return { success: true, booksAdded: 0, errors };
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
    } else {
      await createBookFromParsed(sorted);
      booksAdded += 1;
    }
  }

  return { success: errors.length === 0, booksAdded, errors };
}

export function getLibrary(): BookListItem[] {
  return getAllBooksWithProgress().map(rowToListItem);
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
      cover_art_url: coverFileUrl(book.cover_art_path),
      description: book.description,
      status: book.status,
      date_added: book.date_added,
      total_duration: book.total_duration,
    },
    files: files.map((f) => ({
      id: f.id,
      file_path: f.file_path,
      track_order: f.track_order,
      duration: f.duration,
    })),
    chapters: chapters.map((c) => ({
      id: c.id,
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

export function removeBook(bookId: number): void {
  dbDeleteBook(bookId);
}
