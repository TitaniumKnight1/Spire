import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseFile, selectCover } from "music-metadata";
import type { IChapter, ICommonTagsResult } from "music-metadata";
import { getCoversDirectory } from "../utils/paths.js";

export type ParsedChapter = {
  title: string;
  startSeconds: number;
  endSeconds: number | null;
};

export type ParsedAudioMetadata = {
  title: string;
  author: string | null;
  narrator: string | null;
  albumTitle: string | null;
  trackNumber: number | null;
  durationSeconds: number | null;
  series: string | null;
  seriesOrder: number | null;
  description: string | null;
  cover: { data: Buffer; fileName: string } | null;
  chapters: ParsedChapter[];
};

function pickAuthor(common: ICommonTagsResult): string | null {
  if (common.artists && common.artists.length > 0) {
    return common.artists.join(", ");
  }
  if (common.artist) {
    return common.artist;
  }
  if (common.albumartist) {
    return common.albumartist;
  }
  if (common.albumartists && common.albumartists.length > 0) {
    return common.albumartists.join(", ");
  }
  return null;
}

function pickNarrator(): string | null {
  return null;
}

function pickDescription(common: ICommonTagsResult): string | null {
  if (common.longDescription) {
    return common.longDescription;
  }
  if (common.description && common.description.length > 0) {
    return common.description.join("\n");
  }
  return null;
}

function pickSeries(common: ICommonTagsResult): string | null {
  if (common.grouping) {
    return common.grouping;
  }
  if (common.movement) {
    return common.movement;
  }
  return null;
}

function pickSeriesOrder(common: ICommonTagsResult): number | null {
  const n = common.movementIndex?.no;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function mapChapters(chapters: IChapter[] | undefined): ParsedChapter[] {
  if (!chapters || chapters.length === 0) {
    return [];
  }
  return chapters.map((ch) => ({
    title: ch.title || "Chapter",
    startSeconds: typeof ch.start === "number" ? ch.start : 0,
    endSeconds: typeof ch.end === "number" ? ch.end : null,
  }));
}

function resolveCoverExtension(format: string): "jpg" | "png" | null {
  const f = format.toLowerCase();
  if (f === "image/jpeg" || f === "image/jpg") {
    return "jpg";
  }
  if (f === "image/png") {
    return "png";
  }
  return null;
}

/**
 * Writes embedded cover to userData/covers and returns absolute path, or null.
 * Creates covers directory on first write.
 */
export function persistCoverArt(bookId: number, cover: ParsedAudioMetadata["cover"]): string | null {
  if (!cover?.data.length) {
    return null;
  }
  const ext = cover.fileName === ".jpg" ? "jpg" : "png";
  const dir = getCoversDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const fileName = ext === "jpg" ? `${bookId}.jpg` : `${bookId}.png`;
  const outPath = path.join(dir, fileName);
  fs.writeFileSync(outPath, cover.data);
  return outPath;
}

export function coverFileUrl(absolutePath: string | null): string | null {
  if (!absolutePath) {
    return null;
  }
  try {
    return pathToFileURL(absolutePath).href;
  } catch {
    return null;
  }
}

export async function parseAudioFile(filePath: string): Promise<ParsedAudioMetadata> {
  const ext = path.extname(filePath).toLowerCase();
  const includeChapters = ext === ".m4b" || ext === ".m4a" || ext === ".mp4";
  const meta = await parseFile(filePath, {
    duration: true,
    skipCovers: false,
    includeChapters,
  });
  const common = meta.common;
  const durationSeconds =
    typeof meta.format.duration === "number" && Number.isFinite(meta.format.duration)
      ? meta.format.duration
      : null;
  const trackNo = common.track?.no;
  const trackNumber = typeof trackNo === "number" && Number.isFinite(trackNo) ? trackNo : null;

  const albumTitle = common.album ?? null;
  const trackTitle = common.title ?? null;
  const bookTitle = albumTitle || trackTitle || path.basename(filePath, path.extname(filePath));

  const picture = selectCover(common.picture);
  let cover: ParsedAudioMetadata["cover"] = null;
  if (picture?.data?.length) {
    const cext = resolveCoverExtension(picture.format);
    if (cext) {
      cover = { data: Buffer.from(picture.data), fileName: `.${cext}` };
    }
  }

  const chapters = mapChapters(meta.format.chapters);

  return {
    title: bookTitle,
    author: pickAuthor(common),
    narrator: pickNarrator(),
    albumTitle,
    trackNumber,
    durationSeconds,
    series: pickSeries(common),
    seriesOrder: pickSeriesOrder(common),
    description: pickDescription(common),
    cover,
    chapters,
  };
}
