import { XMLParser } from "fast-xml-parser";
import type { IncomingMessage } from "electron";
import { net } from "electron";
import type { RssEpisode, RssFeedPayload, SavedPodcastFeed } from "../../shared/library-types.js";
import {
  getAllPodcastFeeds,
  upsertPodcastFeed,
  type PodcastFeedRow,
} from "./database.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function fetchTextUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    const chunks: Buffer[] = [];
    request.on("response", (response: IncomingMessage) => {
      const code = response.statusCode ?? 0;
      if (code < 200 || code >= 300) {
        let errBody = "";
        response.on("data", (c: Buffer) => {
          errBody += c.toString("utf8").slice(0, 300);
        });
        response.on("end", () => {
          reject(new Error(`HTTP ${code} fetching feed${errBody ? `: ${errBody}` : ""}`));
        });
        return;
      }
      response.on("data", (c: Buffer) => {
        chunks.push(c);
      });
      response.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}

function firstText(node: unknown): string {
  if (node == null) {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (typeof node === "object" && node !== null && "#text" in (node as object)) {
    return String((node as { "#text": string })["#text"]);
  }
  return "";
}

function parseDurationSec(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") {
    return null;
  }
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  const parts = s.split(":").map((p) => Number(p.trim()));
  if (parts.some((p) => !Number.isFinite(p))) {
    return null;
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

function pickEnclosureUrl(item: Record<string, unknown>): string | null {
  const enc = item.enclosure;
  if (enc && typeof enc === "object") {
    const url = (enc as { "@_url"?: string })["@_url"];
    const type = ((enc as { "@_type"?: string })["@_type"] ?? "").toLowerCase();
    if (url && (type.includes("audio") || type === "" || type.includes("video"))) {
      return url;
    }
    if (url) {
      return url;
    }
  }
  const media = item["media:content"] ?? item["media:Content"];
  for (const m of asArray(media)) {
    if (m && typeof m === "object") {
      const url = (m as { "@_url"?: string })["@_url"];
      if (url) {
        return url;
      }
    }
  }
  const linkArr = asArray(item.link as unknown);
  for (const L of linkArr) {
    if (L && typeof L === "object") {
      const href = (L as { "@_href"?: string })["@_href"];
      const rel = ((L as { "@_rel"?: string })["@_rel"] ?? "").toLowerCase();
      const type = ((L as { "@_type"?: string })["@_type"] ?? "").toLowerCase();
      if (href && (rel === "enclosure" || type.includes("audio"))) {
        return href;
      }
    }
  }
  return null;
}

function mapRss2(channel: Record<string, unknown>): RssFeedPayload {
  const title = firstText(channel.title) || "Untitled feed";
  const description = firstText(channel.description) || null;
  let coverUrl: string | null = null;
  const itunesImg = channel["itunes:image"];
  if (itunesImg && typeof itunesImg === "object") {
    const href = (itunesImg as { "@_href"?: string })["@_href"];
    if (href) {
      coverUrl = href;
    }
  }
  const image = channel.image as Record<string, unknown> | undefined;
  if (!coverUrl && image?.url) {
    coverUrl = firstText(image.url) || null;
  }

  const items = asArray(channel.item as unknown) as Record<string, unknown>[];
  const episodes: RssEpisode[] = [];
  for (const item of items) {
    const epTitle = firstText(item.title) || "Episode";
    const url = pickEnclosureUrl(item);
    if (!url) {
      continue;
    }
    const durRaw =
      firstText(item["itunes:duration"] as string) ||
      firstText((item["itunes:duration"] as { "#text"?: string } | undefined)?.["#text"]);
    const pub =
      firstText(item.pubDate as string) ||
      firstText(item.published as string) ||
      firstText(item.updated as string) ||
      null;
    const desc =
      firstText(item["itunes:summary"] as string) ||
      firstText(item.description as string) ||
      firstText(item.summary as string) ||
      null;

    episodes.push({
      title: epTitle,
      url,
      duration: parseDurationSec(durRaw),
      pubDate: pub || null,
      description: desc,
    });
  }

  return { title, description, coverUrl, episodes };
}

function mapAtom(feed: Record<string, unknown>): RssFeedPayload {
  const title = firstText(feed.title) || "Untitled feed";
  const subtitle = firstText(feed.subtitle) || null;
  let coverUrl: string | null = null;
  const icon = feed.icon ?? feed.logo;
  if (typeof icon === "string") {
    coverUrl = icon;
  }

  const entries = asArray(feed.entry as unknown) as Record<string, unknown>[];
  const episodes: RssEpisode[] = [];
  for (const entry of entries) {
    const epTitle = firstText(entry.title) || "Episode";
    let url: string | null = null;
    const links = asArray(entry.link as unknown);
    for (const L of links) {
      if (L && typeof L === "object") {
        const href = (L as { "@_href"?: string })["@_href"];
        const rel = ((L as { "@_rel"?: string })["@_rel"] ?? "").toLowerCase();
        const type = ((L as { "@_type"?: string })["@_type"] ?? "").toLowerCase();
        if (href && (rel === "enclosure" || type.includes("audio"))) {
          url = href;
          break;
        }
      }
    }
    if (!url) {
      for (const L of links) {
        if (L && typeof L === "object") {
          const href = (L as { "@_href"?: string })["@_href"];
          if (href) {
            url = href;
            break;
          }
        }
      }
    }
    if (!url) {
      continue;
    }
    const pub =
      firstText(entry.published as string) ||
      firstText(entry.updated as string) ||
      firstText(entry.pubDate as string) ||
      null;
    const summary =
      firstText(entry.summary as string) ||
      firstText(entry.content as string) ||
      firstText(entry.subtitle as string) ||
      null;

    episodes.push({
      title: epTitle,
      url,
      duration: null,
      pubDate: pub || null,
      description: summary,
    });
  }

  return { title, description: subtitle, coverUrl, episodes };
}

export async function fetchFeed(url: string): Promise<RssFeedPayload> {
  const xml = await fetchTextUrl(url.trim());
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = doc.rss as Record<string, unknown> | undefined;
  if (rss?.channel) {
    return mapRss2(rss.channel as Record<string, unknown>);
  }
  const atomFeed = doc.feed as Record<string, unknown> | undefined;
  if (atomFeed) {
    return mapAtom(atomFeed);
  }
  throw new Error("Unsupported feed format (expected RSS 2 or Atom)");
}

export async function saveFeedFromPayload(
  feedUrl: string,
  payload: Pick<RssFeedPayload, "title" | "coverUrl">,
): Promise<SavedPodcastFeed> {
  const title = (payload.title ?? "").trim() || "Untitled feed";
  const row = upsertPodcastFeed({
    feed_url: feedUrl.trim(),
    title,
    cover_art_path: payload.coverUrl ?? null,
  });
  return rowToSaved(row);
}

function rowToSaved(row: PodcastFeedRow): SavedPodcastFeed {
  return {
    id: row.id,
    title: row.title,
    feed_url: row.feed_url,
    last_fetched: row.last_fetched,
    cover_art_url: row.cover_art_path,
  };
}

export function getFeeds(): SavedPodcastFeed[] {
  return getAllPodcastFeeds().map(rowToSaved);
}
