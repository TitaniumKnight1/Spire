import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseFile, selectCover } from "music-metadata";
import type { IAudioMetadata, IChapter, ICommonTagsResult } from "music-metadata";
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

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Buffer) {
    return `<Buffer len=${value.length}>`;
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  return value;
}

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

function pickTpe2FromNative(meta: IAudioMetadata): string | null {
  const native = meta.native as Record<string, { id?: string; value?: unknown }[] | undefined> | undefined;
  if (!native || typeof native !== "object") {
    return null;
  }
  for (const tags of Object.values(native)) {
    if (!Array.isArray(tags)) {
      continue;
    }
    for (const tag of tags) {
      const id = String(tag?.id ?? "").toUpperCase();
      if (id !== "TPE2") {
        continue;
      }
      const v = tag.value;
      if (typeof v === "string" && v.trim()) {
        return v.trim();
      }
      if (Array.isArray(v) && v.length > 0) {
        const s = String(v[0]).trim();
        return s.length > 0 ? s : null;
      }
    }
  }
  return null;
}

function pickComposerLine(common: ICommonTagsResult): string | null {
  const c = (common as ICommonTagsResult & { composer?: string | string[] }).composer;
  if (typeof c === "string" && c.trim()) {
    return c.trim();
  }
  if (Array.isArray(c) && c.length > 0) {
    const joined = c.map((x) => String(x).trim()).filter(Boolean).join(", ");
    return joined.length > 0 ? joined : null;
  }
  return null;
}

function pickNarratedByFromComments(common: ICommonTagsResult): string | null {
  const lines: string[] = [];
  const raw = common.comment;
  if (typeof raw === "string") {
    lines.push(raw);
  } else if (Array.isArray(raw)) {
    for (const c of raw) {
      lines.push(String(c));
    }
  }
  const joined = lines.join("\n");
  const m = /narrated\s+by\s*[:\-–]?\s*([^\n\r]+)/i.exec(joined);
  if (m?.[1]) {
    const s = m[1].trim();
    return s.length > 0 ? s : null;
  }
  return null;
}

function pickNarrator(meta: IAudioMetadata): string | null {
  const common = meta.common;
  const fromTpe2 = pickTpe2FromNative(meta);
  if (fromTpe2) {
    return fromTpe2;
  }
  if (common.artists && common.artists.length >= 2) {
    const second = common.artists[1]?.trim();
    if (second) {
      return second;
    }
  }
  const fromComposer = pickComposerLine(common);
  if (fromComposer) {
    return fromComposer;
  }
  return pickNarratedByFromComments(common);
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

/** Map embedded picture MIME to a file extension for persisted cover art. */
function resolveCoverExtension(format: string | undefined): "jpg" | "png" | "webp" | "gif" {
  const f = (format ?? "").toLowerCase();
  if (f === "image/jpeg" || f === "image/jpg") {
    return "jpg";
  }
  if (f === "image/png") {
    return "png";
  }
  if (f === "image/webp") {
    return "webp";
  }
  if (f === "image/gif") {
    return "gif";
  }
  return "jpg";
}

/**
 * Writes embedded cover to userData/covers and returns absolute path, or null.
 * Creates covers directory on first write.
 */
export function persistCoverArt(bookId: number, cover: ParsedAudioMetadata["cover"]): string | null {
  if (!cover?.data.length) {
    return null;
  }
  const fromName = cover.fileName.replace(/^\./, "").toLowerCase();
  const safeExt =
    fromName === "png" || fromName === "webp" || fromName === "gif" || fromName === "jpg" ? fromName : "jpg";
  const dir = getCoversDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${bookId}.${safeExt}`;
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

/** Optional text/series fields gathered from sidecars (Tier 2). */
type SidecarMetadataPartial = {
  title?: string | null;
  author?: string | null;
  narrator?: string | null;
  series?: string | null;
  seriesOrder?: number | null;
  description?: string | null;
};

function pickNonEmpty(s: string | null | undefined): string | null {
  if (s == null) {
    return null;
  }
  const t = s.trim();
  return t.length > 0 ? t : null;
}

function coalesceString(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const p = pickNonEmpty(v);
    if (p) {
      return p;
    }
  }
  return null;
}

function coalesceNumber(...vals: (number | null | undefined)[]): number | null {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }
  return null;
}

function isStringFieldEmpty(v: string | null | undefined): boolean {
  return pickNonEmpty(v) === null;
}

function isSeriesOrderEmpty(v: number | null | undefined): boolean {
  return typeof v !== "number" || !Number.isFinite(v);
}

/** NFO wins any field it sets; later calls only fill keys still empty. */
function mergeNfoWinsInto(target: SidecarMetadataPartial, nfo: SidecarMetadataPartial): void {
  const assignStr = (key: "title" | "author" | "narrator" | "series" | "description", val: string | null | undefined) => {
    const p = pickNonEmpty(val);
    if (p) {
      target[key] = p;
    }
  };
  if (!isStringFieldEmpty(nfo.title)) {
    assignStr("title", nfo.title);
  }
  if (!isStringFieldEmpty(nfo.author)) {
    assignStr("author", nfo.author);
  }
  if (!isStringFieldEmpty(nfo.narrator)) {
    assignStr("narrator", nfo.narrator);
  }
  if (!isStringFieldEmpty(nfo.series)) {
    assignStr("series", nfo.series);
  }
  if (!isStringFieldEmpty(nfo.description)) {
    assignStr("description", nfo.description);
  }
  if (!isSeriesOrderEmpty(nfo.seriesOrder)) {
    target.seriesOrder = nfo.seriesOrder ?? null;
  }
}

function mergeSidecarFillGaps(target: SidecarMetadataPartial, incoming: SidecarMetadataPartial): void {
  if (!isStringFieldEmpty(incoming.title) && isStringFieldEmpty(target.title)) {
    target.title = pickNonEmpty(incoming.title);
  }
  if (!isStringFieldEmpty(incoming.author) && isStringFieldEmpty(target.author)) {
    target.author = pickNonEmpty(incoming.author);
  }
  if (!isStringFieldEmpty(incoming.narrator) && isStringFieldEmpty(target.narrator)) {
    target.narrator = pickNonEmpty(incoming.narrator);
  }
  if (!isStringFieldEmpty(incoming.series) && isStringFieldEmpty(target.series)) {
    target.series = pickNonEmpty(incoming.series);
  }
  if (!isStringFieldEmpty(incoming.description) && isStringFieldEmpty(target.description)) {
    target.description = pickNonEmpty(incoming.description);
  }
  if (!isSeriesOrderEmpty(incoming.seriesOrder) && isSeriesOrderEmpty(target.seriesOrder)) {
    target.seriesOrder = incoming.seriesOrder ?? null;
  }
}

function stripHtmlTags(html: string): string {
  try {
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return html;
  }
}

function findFirstFileWithExt(dir: string, extWithDot: string): string | null {
  try {
    const lowerExt = extWithDot.toLowerCase();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(lowerExt))
      .map((e) => e.name)
      .sort();
    return names.length > 0 ? path.join(dir, names[0]!) : null;
  } catch {
    return null;
  }
}

function parseSeriesOrderToken(raw: string | undefined): number | null {
  if (raw == null) {
    return null;
  }
  const n = parseFloat(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/** Tier 2: NFO plain-text patterns (first non-empty match per field wins within the file). */
function extractMetadataFromNfoText(content: string): SidecarMetadataPartial {
  const out: SidecarMetadataPartial = {};
  try {
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      let m: RegExpMatchArray | null;
      if (isStringFieldEmpty(out.title)) {
        m = line.match(/^title\s*[:=]\s*(.+)$/i);
        if (m?.[1]) {
          out.title = pickNonEmpty(m[1]);
        }
        if (isStringFieldEmpty(out.title)) {
          m = line.match(/^book\s*[:=]\s*(.+)$/i);
          if (m?.[1]) {
            out.title = pickNonEmpty(m[1]);
          }
        }
      }
      if (isStringFieldEmpty(out.author)) {
        m = line.match(/^author\s*[:=]\s*(.+)$/i);
        if (m?.[1]) {
          out.author = pickNonEmpty(m[1]);
        }
        if (isStringFieldEmpty(out.author)) {
          m = line.match(/^written\s+by\s*[:=]\s*(.+)$/i);
          if (m?.[1]) {
            out.author = pickNonEmpty(m[1]);
          }
        }
      }
      if (isStringFieldEmpty(out.narrator)) {
        m = line.match(/^narrator\s*[:=]\s*(.+)$/i);
        if (m?.[1]) {
          out.narrator = pickNonEmpty(m[1]);
        }
        if (isStringFieldEmpty(out.narrator)) {
          m = line.match(/^read\s+by\s*[:=]\s*(.+)$/i);
          if (m?.[1]) {
            out.narrator = pickNonEmpty(m[1]);
          }
        }
        if (isStringFieldEmpty(out.narrator)) {
          m = line.match(/^narrated\s+by\s*[:=]\s*(.+)$/i);
          if (m?.[1]) {
            out.narrator = pickNonEmpty(m[1]);
          }
        }
      }
      if (isStringFieldEmpty(out.series)) {
        m = line.match(/^series\s*[:=]\s*(.+)$/i);
        if (m?.[1]) {
          out.series = pickNonEmpty(m[1]);
        }
      }
      if (isSeriesOrderEmpty(out.seriesOrder)) {
        m = line.match(/^book\s*#?\s*(\d+\.?\d*)\s*$/i);
        if (m?.[1]) {
          out.seriesOrder = parseSeriesOrderToken(m[1]);
        }
        if (isSeriesOrderEmpty(out.seriesOrder)) {
          m = line.match(/^volume\s*[:=]\s*(\d+\.?\d*)\s*$/i);
          if (m?.[1]) {
            out.seriesOrder = parseSeriesOrderToken(m[1]);
          }
        }
      }
    }
  } catch {
    return {};
  }
  return out;
}

/** Tier 2: OPF (regex only, no XML parser). */
function extractMetadataFromOpfText(content: string): SidecarMetadataPartial {
  const out: SidecarMetadataPartial = {};
  try {
    let m = content.match(/<dc:title>(.+?)<\/dc:title>/is);
    if (m?.[1]) {
      out.title = pickNonEmpty(m[1]);
    }
    m = content.match(/<dc:creator[^>]*>(.+?)<\/dc:creator>/is);
    if (m?.[1]) {
      out.author = pickNonEmpty(m[1]);
    }
    m = content.match(/<meta\s+name="calibre:series"\s+content="(.+?)"/is);
    if (m?.[1]) {
      out.series = pickNonEmpty(m[1]);
    }
    m = content.match(/<meta\s+name="calibre:series_index"\s+content="(.+?)"/is);
    if (m?.[1]) {
      out.seriesOrder = parseSeriesOrderToken(m[1]);
    }
    m = content.match(/<dc:description>([\s\S]*?)<\/dc:description>/is);
    if (m?.[1]) {
      const stripped = stripHtmlTags(m[1]);
      out.description = pickNonEmpty(stripped);
    }
  } catch {
    return {};
  }
  return out;
}

/** Tier 2: JSON sidecar with case-insensitive keys. */
function extractMetadataFromSidecarJson(content: string): SidecarMetadataPartial {
  const out: SidecarMetadataPartial = {};
  try {
    const data = JSON.parse(content) as unknown;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return out;
    }
    const obj = data as Record<string, unknown>;
    const lower = new Map<string, unknown>();
    for (const [k, v] of Object.entries(obj)) {
      lower.set(k.toLowerCase(), v);
    }
    const str = (key: string): string | null => {
      const v = lower.get(key);
      return typeof v === "string" ? pickNonEmpty(v) : null;
    };
    out.title = str("title");
    out.author = str("author");
    out.narrator = str("narrator");
    out.series = str("series");
    out.description = str("description");
    const soRaw = lower.get("series_order");
    if (typeof soRaw === "number" && Number.isFinite(soRaw)) {
      out.seriesOrder = soRaw;
    } else if (typeof soRaw === "string") {
      out.seriesOrder = parseSeriesOrderToken(soRaw);
    }
  } catch {
    return {};
  }
  return out;
}

/**
 * Tier 2: first `.nfo` (wins per field it sets), then `.opf` fills gaps, then `.json` fills remaining gaps.
 */
function collectTier2FromDirectory(audioFilePath: string): SidecarMetadataPartial {
  const dir = path.dirname(audioFilePath);
  const tier2: SidecarMetadataPartial = {};

  const nfoPath = findFirstFileWithExt(dir, ".nfo");
  if (nfoPath) {
    try {
      const text = fs.readFileSync(nfoPath, "utf8");
      const nfo = extractMetadataFromNfoText(text);
      mergeNfoWinsInto(tier2, nfo);
    } catch {
      /* skip broken NFO */
    }
  }

  const opfPath = findFirstFileWithExt(dir, ".opf");
  if (opfPath) {
    try {
      const text = fs.readFileSync(opfPath, "utf8");
      const opf = extractMetadataFromOpfText(text);
      mergeSidecarFillGaps(tier2, opf);
    } catch {
      /* skip broken OPF */
    }
  }

  const jsonPath = findFirstFileWithExt(dir, ".json");
  if (jsonPath) {
    try {
      const text = fs.readFileSync(jsonPath, "utf8");
      const j = extractMetadataFromSidecarJson(text);
      mergeSidecarFillGaps(tier2, j);
    } catch {
      /* skip broken JSON */
    }
  }

  return tier2;
}

/** Tier 3: folder layout (torrent-style); never throws. */
function extractMetadataFromPath(filePath: string): { title?: string | null; author?: string | null } {
  try {
    const normalized = path.resolve(filePath);
    const parts = normalized.split(path.sep);
    const yearTitleFolder = parts[parts.length - 2] ?? "";
    const authorFolder = parts[parts.length - 3] ?? "";
    const titleMatch = yearTitleFolder.match(/^\d{4}\s*-\s*(.+)$/);
    const title = titleMatch ? titleMatch[1]!.trim() : yearTitleFolder.trim() || null;
    const author = /^\d{4}$/.test(authorFolder.trim()) ? null : authorFolder.trim() || null;
    return {
      title: title && title.length > 0 ? title : null,
      author: author && author.length > 0 ? author : null,
    };
  } catch {
    return {};
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

  if (process.env.NODE_ENV === "development") {
    try {
      console.debug("[spire/metadata] meta.common", JSON.stringify(common, jsonReplacer, 2));
    } catch {
      console.debug("[spire/metadata] meta.common (non-serializable)", common);
    }
  }

  const durationSeconds =
    typeof meta.format.duration === "number" && Number.isFinite(meta.format.duration)
      ? meta.format.duration
      : null;
  const trackNo = common.track?.no;
  const trackNumber = typeof trackNo === "number" && Number.isFinite(trackNo) ? trackNo : null;

  const albumTitle = common.album ?? null;
  const trackTitle = common.title ?? null;
  const tier1Title = coalesceString(albumTitle, trackTitle);
  const tier1Author = pickNonEmpty(pickAuthor(common));
  const tier1Narrator = pickNonEmpty(pickNarrator(meta));
  const tier1Series = pickNonEmpty(pickSeries(common));
  const tier1SeriesOrder = pickSeriesOrder(common);
  const tier1Description = pickNonEmpty(pickDescription(common));

  const tier2 = collectTier2FromDirectory(filePath);
  const tier3 = extractMetadataFromPath(filePath);

  const mergedTitle =
    coalesceString(tier1Title, tier2.title, tier3.title) ?? path.basename(filePath, path.extname(filePath));
  const mergedAuthor = coalesceString(tier1Author, tier2.author, tier3.author);
  const mergedNarrator = coalesceString(tier1Narrator, tier2.narrator);
  const mergedSeries = coalesceString(tier1Series, tier2.series);
  const mergedSeriesOrder = coalesceNumber(tier1SeriesOrder, tier2.seriesOrder);
  const mergedDescription = coalesceString(tier1Description, tier2.description);

  const picture = selectCover(common.picture);
  let cover: ParsedAudioMetadata["cover"] = null;
  if (picture?.data?.length) {
    const cext = resolveCoverExtension(picture.format);
    cover = { data: Buffer.from(picture.data), fileName: `.${cext}` };
  }

  const chapters = mapChapters(meta.format.chapters);

  return {
    title: mergedTitle,
    author: mergedAuthor,
    narrator: mergedNarrator,
    albumTitle,
    trackNumber,
    durationSeconds,
    series: mergedSeries,
    seriesOrder: mergedSeriesOrder,
    description: mergedDescription,
    cover,
    chapters,
  };
}
