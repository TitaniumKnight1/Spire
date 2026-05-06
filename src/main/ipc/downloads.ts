import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type {
  DownloadItem,
  DownloadProgressPush,
  RssFeedPayload,
  SavedPodcastFeed,
} from "../../shared/library-types.js";
import {
  deletePodcastFeed,
  getAllDownloads,
  getDownloadById,
  insertDownload,
  resetDownloadForRetry,
  updateDownloadCompletedAt,
  updateDownloadError,
  updateDownloadStatus,
  type DownloadRow,
} from "../services/database.js";
import { classifyDownloadUrl, getUrlDownloader } from "../services/downloader.js";
import {
  fetchFeed as rssFetchFeed,
  getFeeds as rssGetFeeds,
  saveFeedFromPayload,
} from "../services/rss.js";
import { getStagingDirectoryRoot } from "../utils/paths.js";

let downloadsBrowserWindow: BrowserWindow | null = null;

function sendDownloadProgressPush(payload: DownloadProgressPush): void {
  const win = downloadsBrowserWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.downloads.PROGRESS_UPDATE, payload);
  }
}

function stagingDirForDownload(downloadId: number): string {
  return path.join(getStagingDirectoryRoot(), String(downloadId));
}

function rowToDownloadItem(row: DownloadRow): DownloadItem {
  const raw = row.source_type ?? "magnet";
  const source_type: DownloadItem["source_type"] =
    raw === "torrent_file"
      ? "torrent_file"
      : raw === "http"
        ? "http"
        : raw === "ytdlp"
          ? "ytdlp"
          : raw === "rss"
            ? "rss"
            : "magnet";
  return {
    id: row.id,
    source_type,
    status: row.status as DownloadItem["status"],
    progress_pct: row.progress_pct,
    book_id: row.book_id,
    started_at: row.started_at,
    completed_at: row.completed_at,
    display_name: row.display_name,
    displayName: row.display_name,
    source_url: row.source_url,
    speed_bps: 0,
    eta_seconds: null,
    error_message: row.error_message ?? null,
  };
}

function isTorrentSource(row: DownloadRow | undefined): boolean {
  const st = row?.source_type ?? "";
  return st === "magnet" || st === "torrent_file";
}

const TORRENT_UNSUPPORTED =
  "Torrent downloads are not supported in this version. Use qBittorrent or another client, then point your download folder at your Spire library.";

export function setDownloadsBrowserWindow(win: BrowserWindow | null): void {
  downloadsBrowserWindow = win;
  getUrlDownloader().setMainWindow(win);
}

export function registerDownloadsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.downloads.ADD_URL, async (_event, rawUrl: unknown) => {
    const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!trimmed) {
      throw new Error("Enter a URL");
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("Invalid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http(s) URLs are supported");
    }
    const kind = classifyDownloadUrl(trimmed);
    const source_type = kind === "http" ? "http" : "ytdlp";
    const id = insertDownload({
      source_url: trimmed,
      source_type,
      status: "queued",
    });
    void getUrlDownloader()
      .startDownload(id, trimmed)
      .catch((e) => {
        console.error(`[spire/downloads] URL download ${id} failed:`, e);
      });
    return { downloadId: id };
  });

  ipcMain.handle(IPC_CHANNELS.downloads.PAUSE, async (_event, downloadId: unknown) => {
    const id = typeof downloadId === "number" ? downloadId : Number(downloadId);
    if (!Number.isFinite(id)) {
      throw new Error("Invalid download id");
    }
    const row = getDownloadById(id);
    if (isTorrentSource(row)) {
      return;
    }
  });

  ipcMain.handle(IPC_CHANNELS.downloads.RESUME, async (_event, downloadId: unknown) => {
    const id = typeof downloadId === "number" ? downloadId : Number(downloadId);
    if (!Number.isFinite(id)) {
      throw new Error("Invalid download id");
    }
    const row = getDownloadById(id);
    if (isTorrentSource(row)) {
      return;
    }
  });

  ipcMain.handle(IPC_CHANNELS.downloads.CANCEL, async (_event, downloadId: unknown) => {
    const id = typeof downloadId === "number" ? downloadId : Number(downloadId);
    if (!Number.isFinite(id)) {
      throw new Error("Invalid download id");
    }
    const row = getDownloadById(id);
    if (isTorrentSource(row)) {
      const dir = stagingDirForDownload(id);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      updateDownloadStatus(id, "cancelled");
      updateDownloadCompletedAt(id, new Date().toISOString());
      const next = getDownloadById(id);
      sendDownloadProgressPush({
        id,
        name: next?.display_name ?? "Cancelled",
        torrentName: null,
        progress_pct: next?.progress_pct ?? 0,
        speed: 0,
        status: "cancelled",
        eta: null,
      });
      return;
    }
    getUrlDownloader().cancelDownload(id);
    updateDownloadStatus(id, "cancelled");
    updateDownloadCompletedAt(id, new Date().toISOString());
    const next = getDownloadById(id);
    sendDownloadProgressPush({
      id,
      name: next?.display_name ?? "Cancelled",
      progress_pct: next?.progress_pct ?? 0,
      speed: 0,
      status: "cancelled",
      eta: null,
    });
  });

  ipcMain.handle(IPC_CHANNELS.downloads.RETRY, async (_event, downloadId: unknown) => {
    const id = typeof downloadId === "number" ? downloadId : Number(downloadId);
    if (!Number.isFinite(id)) {
      throw new Error("Invalid download id");
    }
    const row = getDownloadById(id);
    if (!row?.source_url) {
      return;
    }
    if (isTorrentSource(row)) {
      updateDownloadError(id, TORRENT_UNSUPPORTED);
      const refreshed = getDownloadById(id);
      sendDownloadProgressPush({
        id,
        name: refreshed?.display_name?.trim() || refreshed?.source_url || "Download",
        torrentName: null,
        progress_pct: refreshed?.progress_pct ?? 0,
        speed: 0,
        status: "failed",
        eta: null,
      });
      return;
    }
    resetDownloadForRetry(id);
    const url = row.source_url;
    void getUrlDownloader()
      .startDownload(id, url)
      .catch((e) => {
        console.error(`[spire/downloads] retry ${id} failed:`, e);
      });
  });

  ipcMain.handle(IPC_CHANNELS.downloads.GET_ALL, async (): Promise<DownloadItem[]> => {
    return getAllDownloads().map(rowToDownloadItem);
  });

  ipcMain.handle(IPC_CHANNELS.rss.FETCH_FEED, async (_event, feedUrl: unknown) => {
    const url = typeof feedUrl === "string" ? feedUrl.trim() : "";
    if (!url) {
      throw new Error("Enter a feed URL");
    }
    return rssFetchFeed(url) as Promise<RssFeedPayload>;
  });

  ipcMain.handle(
    IPC_CHANNELS.rss.SAVE_FEED,
    async (_event, body: unknown): Promise<SavedPodcastFeed> => {
      const o = body as { feedUrl?: string; title?: string; coverUrl?: string | null };
      const feedUrl = typeof o?.feedUrl === "string" ? o.feedUrl.trim() : "";
      if (!feedUrl) {
        throw new Error("Missing feed URL");
      }
      return saveFeedFromPayload(feedUrl, {
        title: typeof o.title === "string" ? o.title : "",
        coverUrl: o.coverUrl ?? null,
      });
    },
  );

  ipcMain.handle(IPC_CHANNELS.rss.GET_FEEDS, async (): Promise<SavedPodcastFeed[]> => {
    return rssGetFeeds();
  });

  ipcMain.handle(IPC_CHANNELS.rss.DELETE_FEED, async (_event, feedId: unknown) => {
    const id = typeof feedId === "number" ? feedId : Number(feedId);
    if (!Number.isFinite(id)) {
      throw new Error("Invalid feed id");
    }
    const ok = deletePodcastFeed(id);
    if (!ok) {
      throw new Error("Feed not found");
    }
    return { ok: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.rss.DOWNLOAD_EPISODE,
    async (_event, body: unknown): Promise<{ downloadId: number }> => {
      const o = body as { url?: string; title?: string | null };
      const episodeUrl = typeof o?.url === "string" ? o.url.trim() : "";
      if (!episodeUrl) {
        throw new Error("Missing episode URL");
      }
      let parsed: URL;
      try {
        parsed = new URL(episodeUrl);
      } catch {
        throw new Error("Invalid episode URL");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http(s) episode URLs are supported");
      }
      const title = typeof o.title === "string" ? o.title.trim() : "";
      const id = insertDownload({
        source_url: episodeUrl,
        source_type: "rss",
        status: "queued",
        display_name: title.length > 0 ? title : null,
      });
      void getUrlDownloader()
        .startDownload(id, episodeUrl)
        .catch((e) => {
          console.error(`[spire/downloads] RSS episode ${id} failed:`, e);
        });
      return { downloadId: id };
    },
  );
}
