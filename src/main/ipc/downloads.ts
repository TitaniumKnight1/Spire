import { BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { DownloadItem } from "../../shared/library-types.js";
import {
  getAllDownloads,
  insertDownload,
  type DownloadRow,
} from "../services/database.js";
import { getTorrentManager } from "../services/torrent.js";

const pendingMagnets: string[] = [];
const pendingTorrentPaths: string[] = [];

function rowToDownloadItem(row: DownloadRow): DownloadItem {
  const st: DownloadItem["source_type"] =
    row.source_type === "torrent_file" ? "torrent_file" : "magnet";
  return {
    id: row.id,
    source_type: st,
    status: row.status as DownloadItem["status"],
    progress_pct: row.progress_pct,
    book_id: row.book_id,
    started_at: row.started_at,
    completed_at: row.completed_at,
    display_name: row.display_name,
    speed_bps: 0,
    eta_seconds: null,
  };
}

export function queueMagnetForStartup(uri: string): void {
  pendingMagnets.push(uri);
}

export function queueTorrentFileForStartup(filePath: string): void {
  pendingTorrentPaths.push(filePath);
}

export async function enqueueMagnetDownload(uri: string): Promise<number | null> {
  const trimmed = uri.trim();
  if (!trimmed.startsWith("magnet:")) {
    return null;
  }
  const id = insertDownload({
    source_url: trimmed,
    source_type: "magnet",
    status: "queued",
  });
  await getTorrentManager().addMagnet(trimmed, id);
  return id;
}

export async function enqueueTorrentFilePath(filePath: string): Promise<number | null> {
  if (!filePath.toLowerCase().endsWith(".torrent")) {
    return null;
  }
  const id = insertDownload({
    source_url: filePath,
    source_type: "torrent_file",
    status: "queued",
  });
  await getTorrentManager().addTorrentFile(filePath, id);
  return id;
}

export async function flushPendingDownloadQueues(): Promise<void> {
  for (const m of pendingMagnets) {
    try {
      await enqueueMagnetDownload(m);
    } catch (e) {
      console.error("[spire] pending magnet failed:", e);
    }
  }
  pendingMagnets.length = 0;
  for (const p of pendingTorrentPaths) {
    try {
      await enqueueTorrentFilePath(p);
    } catch (e) {
      console.error("[spire] pending .torrent failed:", e);
    }
  }
  pendingTorrentPaths.length = 0;
}

export function setDownloadsBrowserWindow(win: BrowserWindow | null): void {
  getTorrentManager().setMainWindow(win);
}

export function registerDownloadsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.downloads.ADD_MAGNET, async (_event, magnetUri: unknown) => {
    const uri = typeof magnetUri === "string" ? magnetUri : "";
    const id = await enqueueMagnetDownload(uri);
    if (id == null) {
      throw new Error("Invalid magnet URI");
    }
    return { downloadId: id };
  });

  ipcMain.handle(IPC_CHANNELS.downloads.ADD_TORRENT_FILE, async (_event, filePath: unknown) => {
    const fp = typeof filePath === "string" ? filePath : "";
    const id = await enqueueTorrentFilePath(fp);
    if (id == null) {
      throw new Error("Invalid .torrent path");
    }
    return { downloadId: id };
  });

  ipcMain.handle(IPC_CHANNELS.downloads.PAUSE, async (_event, downloadId: unknown) => {
    const id = typeof downloadId === "number" ? downloadId : Number(downloadId);
    if (!Number.isFinite(id)) {
      throw new Error("Invalid download id");
    }
    getTorrentManager().pause(id);
  });

  ipcMain.handle(IPC_CHANNELS.downloads.RESUME, async (_event, downloadId: unknown) => {
    const id = typeof downloadId === "number" ? downloadId : Number(downloadId);
    if (!Number.isFinite(id)) {
      throw new Error("Invalid download id");
    }
    await getTorrentManager().resume(id);
  });

  ipcMain.handle(IPC_CHANNELS.downloads.CANCEL, async (_event, downloadId: unknown) => {
    const id = typeof downloadId === "number" ? downloadId : Number(downloadId);
    if (!Number.isFinite(id)) {
      throw new Error("Invalid download id");
    }
    await getTorrentManager().cancel(id);
  });

  ipcMain.handle(IPC_CHANNELS.downloads.RETRY, async (_event, downloadId: unknown) => {
    const id = typeof downloadId === "number" ? downloadId : Number(downloadId);
    if (!Number.isFinite(id)) {
      throw new Error("Invalid download id");
    }
    await getTorrentManager().retry(id);
  });

  ipcMain.handle(IPC_CHANNELS.downloads.GET_ALL, async (): Promise<DownloadItem[]> => {
    return getAllDownloads().map(rowToDownloadItem);
  });
}
