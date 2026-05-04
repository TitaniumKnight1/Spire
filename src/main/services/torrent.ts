import EventEmitter from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import WebTorrent from "webtorrent";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import {
  getAllDownloads,
  getDownloadById,
  resetDownloadForRetry,
  updateDownloadBookId,
  updateDownloadCompletedAt,
  updateDownloadProgress,
  updateDownloadStatus,
  updateDownloadTorrentMeta,
  type DownloadRow,
} from "./database.js";
import { ingestPaths } from "./library.js";
import { getLibraryDirectory, getStagingDirectoryRoot } from "../utils/paths.js";

export const TORRENT_METADATA_FILENAME = "spire.torrent";

/** Main → renderer via IPC (no file paths). */
export type DownloadProgressPush = {
  id: number;
  name: string;
  progress_pct: number;
  speed: number;
  status: string;
  eta: number | null;
};

export type DownloadCompletedPush = {
  downloadId: number;
  bookId: number;
};

/** Torrent API subset used by Spire (WebTorrent runtime shapes instances). */
type TorrentHandle = {
  name: string;
  infoHash: string;
  path: string;
  torrentFile: Uint8Array;
  downloaded: number;
  progress: number;
  downloadSpeed: number;
  timeRemaining: number;
  files: { name: string }[];
  done: boolean;
  paused: boolean;
  ready: boolean;
  pause: () => void;
  resume: () => void;
  on: (ev: string, fn: (...args: unknown[]) => void) => void;
  once: (ev: string, fn: (...args: unknown[]) => void) => void;
  removeListener: (ev: string, fn: (...args: unknown[]) => void) => void;
};

let managerInstance: TorrentManager | null = null;

export function getTorrentManager(): TorrentManager {
  if (!managerInstance) {
    managerInstance = new TorrentManager();
  }
  return managerInstance;
}

function sanitizeFolderName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "Audiobook";
}

function uniqueLibraryFolder(baseName: string): string {
  const lib = getLibraryDirectory();
  let candidate = path.join(lib, baseName);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(lib, `${baseName} (${i})`);
    i += 1;
  }
  return candidate;
}

function stagingTmpDir(downloadId: number): string {
  return path.join(getStagingDirectoryRoot(), `tmp-${downloadId}`);
}

function resolveStagingDir(row: DownloadRow): string {
  if (row.torrent_info_hash) {
    return path.join(getStagingDirectoryRoot(), row.torrent_info_hash);
  }
  return stagingTmpDir(row.id);
}

export class TorrentManager extends EventEmitter {
  readonly client: WebTorrent;
  readonly activeDownloads = new Map<number, TorrentHandle>();
  private mainWindow: BrowserWindow | null = null;
  private readonly progressThrottle = new Map<number, number>();
  private readonly metadataLocks = new Set<number>();

  constructor() {
    super();
    this.client = new WebTorrent();
    this.client.on("error", (err: Error) => {
      console.error("[spire/torrent] WebTorrent client error:", err);
    });
  }

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  private pushProgress(payload: DownloadProgressPush): void {
    this.emit("progress", payload);
    const win = this.mainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.downloads.PROGRESS_UPDATE, payload);
    }
  }

  private pushCompleted(payload: DownloadCompletedPush): void {
    this.emit("completed", payload);
    const win = this.mainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.downloads.COMPLETED, payload);
    }
  }

  private shouldThrottleProgress(id: number): boolean {
    const now = Date.now();
    const last = this.progressThrottle.get(id) ?? 0;
    if (now - last < 200) {
      return true;
    }
    this.progressThrottle.set(id, now);
    return false;
  }

  private emitProgressForTorrent(
    downloadId: number,
    torrent: TorrentHandle,
    statusOverride?: string,
  ): void {
    if (this.shouldThrottleProgress(downloadId) && statusOverride === undefined) {
      return;
    }
    const row = getDownloadById(downloadId);
    const name =
      row?.display_name && row.display_name.length > 0 ? row.display_name : torrent.name || "Loading…";
    const pct = Math.min(100, Math.max(0, Math.round(torrent.progress * 1000) / 10));
    const speed = torrent.downloadSpeed;
    const etaMs = torrent.timeRemaining;
    const eta = Number.isFinite(etaMs) && etaMs > 0 ? Math.round(etaMs / 1000) : null;
    const status =
      statusOverride ??
      (torrent.paused ? "paused" : row?.status === "queued" ? "queued" : "downloading");
    this.pushProgress({
      id: downloadId,
      name,
      progress_pct: pct,
      speed,
      status,
      eta,
    });
  }

  async resumeDownloadsAfterBoot(): Promise<void> {
    const rows = getAllDownloads();
    for (const row of rows) {
      if (row.status !== "queued" && row.status !== "downloading") {
        continue;
      }
      const st = row.source_type ?? "";
      if (st !== "magnet" && st !== "torrent_file") {
        continue;
      }
      if (this.activeDownloads.has(row.id)) {
        continue;
      }
      try {
        await this.attachExistingRow(row);
      } catch (e) {
        console.error(`[spire/torrent] bootstrap failed for download ${row.id}:`, e);
        updateDownloadStatus(row.id, "failed");
      }
    }
  }

  private async attachExistingRow(row: DownloadRow): Promise<void> {
    const metaPath = path.join(resolveStagingDir(row), TORRENT_METADATA_FILENAME);
    if (fs.existsSync(metaPath)) {
      await this.addTorrentFileInternal(metaPath, row.id, true);
    } else if (row.source_url?.startsWith("magnet:")) {
      await this.addMagnetInternal(row.source_url, row.id, true);
    }
  }

  async addMagnet(magnetUri: string, downloadId: number): Promise<void> {
    await this.addMagnetInternal(magnetUri, downloadId, false);
  }

  private async addMagnetInternal(
    magnetUri: string,
    downloadId: number,
    fromRestore: boolean,
  ): Promise<void> {
    if (this.activeDownloads.has(downloadId)) {
      return;
    }
    const tmpDir = stagingTmpDir(downloadId);
    fs.mkdirSync(tmpDir, { recursive: true });

    const torrent = this.client.add(magnetUri, {
      path: tmpDir,
    }) as unknown as TorrentHandle;

    this.activeDownloads.set(downloadId, torrent);
    this.wireTorrent(downloadId, torrent, fromRestore);

    torrent.once("metadata", () => {
      void this.finalizeMetadataFolder(downloadId, torrent).catch((e) => {
        console.error(`[spire/torrent] metadata finalize failed (${downloadId}):`, e);
        updateDownloadStatus(downloadId, "failed");
        this.cleanupTorrent(downloadId, torrent, true).catch(() => undefined);
      });
    });
  }

  async addTorrentFile(sourcePath: string, downloadId: number): Promise<void> {
    await this.addTorrentFileInternal(sourcePath, downloadId, false);
  }

  private async addTorrentFileInternal(
    torrentPath: string,
    downloadId: number,
    fromRestore: boolean,
  ): Promise<void> {
    if (this.activeDownloads.has(downloadId)) {
      return;
    }
    const row = getDownloadById(downloadId);
    if (fromRestore && row?.torrent_info_hash) {
      const dir = path.join(getStagingDirectoryRoot(), row.torrent_info_hash);
      const meta = path.join(dir, TORRENT_METADATA_FILENAME);
      if (fs.existsSync(meta)) {
        const torrent = this.client.add(meta, {
          path: dir,
          skipVerify: true,
        }) as unknown as TorrentHandle;
        this.activeDownloads.set(downloadId, torrent);
        this.wireTorrent(downloadId, torrent, fromRestore);
        return;
      }
    }

    const tmpDir = stagingTmpDir(downloadId);
    fs.mkdirSync(tmpDir, { recursive: true });
    const destMeta = path.join(tmpDir, TORRENT_METADATA_FILENAME);
    if (path.resolve(torrentPath) !== path.resolve(destMeta)) {
      fs.copyFileSync(torrentPath, destMeta);
    }

    const torrent = this.client.add(destMeta, {
      path: tmpDir,
    }) as unknown as TorrentHandle;

    this.activeDownloads.set(downloadId, torrent);
    this.wireTorrent(downloadId, torrent, fromRestore);

    torrent.once("metadata", () => {
      void this.finalizeMetadataFolder(downloadId, torrent).catch((e) => {
        console.error(`[spire/torrent] metadata finalize failed (${downloadId}):`, e);
        updateDownloadStatus(downloadId, "failed");
        this.cleanupTorrent(downloadId, torrent, true).catch(() => undefined);
      });
    });
  }

  private async finalizeMetadataFolder(downloadId: number, torrent: TorrentHandle): Promise<void> {
    if (this.metadataLocks.has(downloadId)) {
      return;
    }
    const tmpDir = stagingTmpDir(downloadId);
    if (path.resolve(torrent.path) !== path.resolve(tmpDir)) {
      return;
    }

    this.metadataLocks.add(downloadId);
    try {
      const infoHash = torrent.infoHash.toLowerCase();
      const finalDir = path.join(getStagingDirectoryRoot(), infoHash);

      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, TORRENT_METADATA_FILENAME), Buffer.from(torrent.torrentFile));

      updateDownloadTorrentMeta(downloadId, {
        display_name: torrent.name,
        torrent_info_hash: infoHash,
      });
      updateDownloadStatus(downloadId, "downloading");

      torrent.pause();
      this.activeDownloads.delete(downloadId);
      await this.removeTorrentFromClient(torrent, false);

      if (fs.existsSync(tmpDir)) {
        if (!fs.existsSync(finalDir)) {
          fs.renameSync(tmpDir, finalDir);
        } else {
          const destTorrent = path.join(finalDir, TORRENT_METADATA_FILENAME);
          fs.copyFileSync(path.join(tmpDir, TORRENT_METADATA_FILENAME), destTorrent);
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }

      const metaPath = path.join(finalDir, TORRENT_METADATA_FILENAME);
      const next = this.client.add(metaPath, {
        path: finalDir,
        skipVerify: true,
      }) as unknown as TorrentHandle;

      this.activeDownloads.set(downloadId, next);
      this.wireTorrent(downloadId, next, false);
    } finally {
      this.metadataLocks.delete(downloadId);
    }
  }

  private wireTorrent(downloadId: number, torrent: TorrentHandle, fromRestore: boolean): void {
    torrent.on("download", () => {
      const row = getDownloadById(downloadId);
      if (!row || row.status === "paused") {
        return;
      }
      const pct = Math.min(100, Math.max(0, torrent.progress * 100));
      updateDownloadProgress(downloadId, pct);
      this.emitProgressForTorrent(downloadId, torrent);
    });

    torrent.on("done", () => {
      void this.handleTorrentDone(downloadId, torrent).catch((e) => {
        console.error(`[spire/torrent] completion failed (${downloadId}):`, e);
        updateDownloadStatus(downloadId, "failed");
      });
    });

    torrent.on("error", (err: unknown) => {
      console.error(`[spire/torrent] torrent error (${downloadId}):`, err);
      updateDownloadStatus(downloadId, "failed");
      const row = getDownloadById(downloadId);
      this.pushProgress({
        id: downloadId,
        name: row?.display_name ?? torrent.name ?? "Error",
        progress_pct: row?.progress_pct ?? 0,
        speed: 0,
        status: "failed",
        eta: null,
      });
    });

    if (!fromRestore) {
      torrent.on("ready", () => {
        updateDownloadTorrentMeta(downloadId, { display_name: torrent.name });
      });
    }
  }

  private async handleTorrentDone(downloadId: number, torrent: TorrentHandle): Promise<void> {
    const downloadRoot = torrent.path;
    const title = torrent.name;

    await this.removeTorrentFromClient(torrent, false);
    this.activeDownloads.delete(downloadId);

    const destDir = uniqueLibraryFolder(sanitizeFolderName(title));
    try {
      fs.renameSync(downloadRoot, destDir);
    } catch {
      fs.cpSync(downloadRoot, destDir, { recursive: true });
      fs.rmSync(downloadRoot, { recursive: true, force: true });
    }

    const ingest = await ingestPaths([destDir]);
    const bookId = ingest.bookIds[0];
    if (bookId == null || !Number.isFinite(bookId)) {
      updateDownloadStatus(downloadId, "failed");
      return;
    }

    updateDownloadProgress(downloadId, 100);
    updateDownloadBookId(downloadId, bookId);
    updateDownloadStatus(downloadId, "completed");
    updateDownloadCompletedAt(downloadId, new Date().toISOString());

    const row = getDownloadById(downloadId);
    this.pushProgress({
      id: downloadId,
      name: row?.display_name ?? title,
      progress_pct: 100,
      speed: 0,
      status: "completed",
      eta: null,
    });

    this.pushCompleted({ downloadId, bookId });

    const hash = row?.torrent_info_hash;
    if (hash) {
      const stagingLeft = path.join(getStagingDirectoryRoot(), hash);
      if (fs.existsSync(stagingLeft)) {
        fs.rmSync(stagingLeft, { recursive: true, force: true });
      }
    }
  }

  private async removeTorrentFromClient(
    torrent: TorrentHandle,
    destroyStore: boolean,
  ): Promise<void> {
    await this.client.remove(torrent as never, { destroyStore });
  }

  pause(downloadId: number): void {
    const torrent = this.activeDownloads.get(downloadId);
    const row = getDownloadById(downloadId);
    if (!torrent || !row) {
      return;
    }
    torrent.pause();
    updateDownloadStatus(downloadId, "paused");
    this.emitProgressForTorrent(downloadId, torrent, "paused");
  }

  async resume(downloadId: number): Promise<void> {
    const existing = this.activeDownloads.get(downloadId);
    if (existing) {
      existing.resume();
      updateDownloadStatus(downloadId, "downloading");
      this.emitProgressForTorrent(downloadId, existing, "downloading");
      return;
    }
    const row = getDownloadById(downloadId);
    if (!row || row.status !== "paused") {
      return;
    }
    await this.attachExistingRow(row);
    const t = this.activeDownloads.get(downloadId);
    if (t) {
      updateDownloadStatus(downloadId, "downloading");
      t.resume();
      this.emitProgressForTorrent(downloadId, t, "downloading");
    }
  }

  async cancel(downloadId: number): Promise<void> {
    const torrent = this.activeDownloads.get(downloadId);
    if (torrent) {
      this.activeDownloads.delete(downloadId);
      await this.removeTorrentFromClient(torrent, true).catch(() => undefined);
    }
    const row = getDownloadById(downloadId);
    const dir = row ? resolveStagingDir(row) : stagingTmpDir(downloadId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    updateDownloadStatus(downloadId, "cancelled");
    updateDownloadCompletedAt(downloadId, new Date().toISOString());
    const name = row?.display_name ?? "Cancelled";
    this.pushProgress({
      id: downloadId,
      name,
      progress_pct: row?.progress_pct ?? 0,
      speed: 0,
      status: "cancelled",
      eta: null,
    });
  }

  async retry(downloadId: number): Promise<void> {
    const existing = this.activeDownloads.get(downloadId);
    if (existing) {
      this.activeDownloads.delete(downloadId);
      await this.removeTorrentFromClient(existing, true).catch(() => undefined);
    }
    resetDownloadForRetry(downloadId);
    const row = getDownloadById(downloadId);
    if (!row) {
      return;
    }
    updateDownloadStatus(downloadId, "queued");
    await this.attachExistingRow(row);
    const t = this.activeDownloads.get(downloadId);
    if (t) {
      updateDownloadStatus(downloadId, "downloading");
      this.emitProgressForTorrent(downloadId, t, "downloading");
    }
  }

  private async cleanupTorrent(
    downloadId: number,
    torrent: TorrentHandle,
    destroyStore: boolean,
  ): Promise<void> {
    this.activeDownloads.delete(downloadId);
    await this.removeTorrentFromClient(torrent, destroyStore).catch(() => undefined);
  }
}
