/**
 * Torrent / magnet downloads via bundled aria2c (JSON-RPC over HTTP).
 *
 * Dev: place `aria2c.exe` under `binaries/` (see https://github.com/aria2/aria2/releases/latest ).
 * Packaged: CI copies `aria2c.exe` into `binaries/` before `electron-builder`.
 * Optional: run `.\build\add-firewall-rules.ps1` elevated so Windows Firewall allows aria2c.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { net } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { DownloadCompletedPush, DownloadProgressPush } from "../../shared/library-types.js";
import {
  getAllDownloads,
  getBookById,
  getDownloadById,
  getSetting,
  resetDownloadForRetry,
  updateDownloadBookId,
  updateDownloadCompletedAt,
  updateDownloadDisplayName,
  updateDownloadError,
  updateDownloadProgress,
  updateDownloadStatus,
  updateBookMetadata,
  type DownloadRow,
} from "./database.js";
import { fetchCoverArt, ingestPaths, reingestBookMetadata } from "./library.js";
import { broadcastLibraryUpdated } from "../broadcast-state.js";
import { getAria2Path, getLibraryDirectory, getStagingDirectoryRoot } from "../utils/paths.js";

const RPC_PORT = 6800;
const RPC_SECRET = randomBytes(16).toString("hex");
const RPC_URL = `http://127.0.0.1:${RPC_PORT}/jsonrpc`;

const BT_TRACKERS =
  "udp://tracker.opentrackr.org:1337/announce," +
  "udp://open.tracker.cl:1337/announce," +
  "udp://tracker.torrent.eu.org:451/announce," +
  "udp://open.stealth.si:80/announce," +
  "udp://tracker.tiny-vps.com:6969/announce";

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

function stagingDirForDownload(downloadId: number): string {
  return path.join(getStagingDirectoryRoot(), String(downloadId));
}

/** Remap absolute paths under `fromDir` to the same relative layout under `toDir` (post-rename ingest). */
function remapPathsUnderDir(files: string[], fromDir: string, toDir: string): string[] {
  const fromExact = path.normalize(fromDir);
  const fromPrefix = fromExact + path.sep;
  const out: string[] = [];
  for (const p of files) {
    const n = path.normalize(p);
    if (n === fromExact || n.startsWith(fromPrefix)) {
      out.push(path.join(toDir, path.relative(fromExact, n)));
    } else {
      out.push(n);
    }
  }
  return out;
}

function cleanTorrentTitleForBook(torrentName: string): string {
  return torrentName.replace(/\s*-\s*ch\s*\d+$/i, "").trim();
}

type TellItem = {
  gid: string;
  status: string;
  totalLength?: string;
  completedLength?: string;
  downloadSpeed?: string;
  numSeeders?: string;
  connections?: string;
  files?: { path?: string }[];
  errorMessage?: string;
  bittorrent?: { info?: { name?: string } };
  followedBy?: string[];
};

class Aria2Service {
  private process: ChildProcess | null = null;
  private ready = false;
  private disabled = false;

  private gidToDownloadId = new Map<string, number>();
  private downloadIdToGid = new Map<number, string>();

  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private mainWindowRef: BrowserWindow | null = null;

  /** GIDs for which we've already persisted `display_name` once (avoid DB writes every poll tick). */
  private readonly displayNamePersistedForGid = new Set<string>();

  /** GIDs we already finalized from `tellStopped` (aria2 keeps stopped entries until purged). */
  private readonly finalizedStoppedGids = new Set<string>();

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindowRef = win;
  }

  isDisabled(): boolean {
    return this.disabled;
  }

  async start(): Promise<void> {
    if (this.process) {
      return;
    }
    let aria2Path: string;
    try {
      aria2Path = getAria2Path();
    } catch (e) {
      console.warn("[aria2] disabled — binary missing or path error:", e);
      this.disabled = true;
      return;
    }

    const stagingRoot = getStagingDirectoryRoot();
    fs.mkdirSync(stagingRoot, { recursive: true });

    const args = [
      "--enable-rpc",
      `--rpc-listen-port=${RPC_PORT}`,
      `--rpc-secret=${RPC_SECRET}`,
      "--rpc-listen-all=false",
      "--rpc-allow-origin-all=false",
      "--quiet=true",
      "--no-conf=true",
      "--check-certificate=false",
      "--bt-enable-lpd=true",
      "--enable-dht=true",
      "--enable-dht6=false",
      "--dht-listen-port=6882",
      "--listen-port=6881",
      "--bt-tracker-interval=60",
      `--bt-tracker=${BT_TRACKERS}`,
    ];

    try {
      this.process = spawn(aria2Path, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      this.process.stderr?.on("data", (d) => {
        console.error("[aria2]", d.toString().trim());
      });

      await this.waitForReady();
      this.ready = true;
      this.disabled = false;
      console.log("[aria2] RPC ready on port", RPC_PORT);
      this.startPolling();
    } catch (e) {
      console.warn("[aria2] disabled — failed to start:", e);
      this.disabled = true;
      this.ready = false;
      try {
        this.process?.kill();
      } catch {
        /* ignore */
      }
      this.process = null;
    }
  }

  private async waitForReady(): Promise<void> {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        await this.rpc("aria2.getVersion", []);
        return;
      } catch {
        /* not ready yet */
      }
    }
    throw new Error("aria2c failed to start within ~6 seconds");
  }

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now().toString(),
      method,
      params: [`token:${RPC_SECRET}`, ...params],
    });

    return new Promise((resolve, reject) => {
      const req = net.request({
        method: "POST",
        url: RPC_URL,
      });
      req.setHeader("Content-Type", "application/json");
      let data = "";
      req.on("response", (res) => {
        res.on("data", (chunk) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data) as { error?: { message?: string }; result?: unknown };
            if (parsed.error) {
              reject(new Error(parsed.error.message ?? "aria2 RPC error"));
            } else {
              resolve(parsed.result);
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  private pushProgress(payload: DownloadProgressPush): void {
    const win = this.mainWindowRef;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.downloads.PROGRESS_UPDATE, payload);
    }
  }

  private pushCompleted(payload: DownloadCompletedPush): void {
    const win = this.mainWindowRef;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.downloads.COMPLETED, payload);
    }
  }

  private progressPayloadForRow(
    downloadId: number,
    row: DownloadRow | undefined,
    overrides: Partial<
      Pick<DownloadProgressPush, "progress_pct" | "speed" | "status" | "eta" | "name" | "torrentName">
    >,
  ): DownloadProgressPush {
    const name =
      typeof overrides.name === "string"
        ? overrides.name
        : row?.display_name && row.display_name.length > 0
          ? row.display_name
          : row?.source_url ?? "Loading…";
    return {
      id: downloadId,
      name,
      torrentName: overrides.torrentName ?? null,
      progress_pct: overrides.progress_pct ?? row?.progress_pct ?? 0,
      speed: overrides.speed ?? 0,
      status: overrides.status ?? row?.status ?? "downloading",
      eta: overrides.eta ?? null,
    };
  }

  async addMagnet(downloadId: number, magnetUri: string, dir: string): Promise<string | null> {
    if (this.disabled || !this.ready) {
      return null;
    }
    fs.mkdirSync(dir, { recursive: true });
    try {
      const gid = (await this.rpc("aria2.addUri", [[magnetUri], { dir, "bt-save-metadata": "true" }])) as string;
      this.gidToDownloadId.set(gid, downloadId);
      this.downloadIdToGid.set(downloadId, gid);
      updateDownloadStatus(downloadId, "downloading");
      return gid;
    } catch (e) {
      console.error("[aria2] addMagnet failed:", e);
      return null;
    }
  }

  async addTorrentFile(downloadId: number, torrentPath: string, dir: string): Promise<string | null> {
    if (this.disabled || !this.ready) {
      return null;
    }
    fs.mkdirSync(dir, { recursive: true });
    try {
      const torrentBase64 = fs.readFileSync(torrentPath).toString("base64");
      const gid = (await this.rpc("aria2.addTorrent", [torrentBase64, [], { dir }])) as string;
      this.gidToDownloadId.set(gid, downloadId);
      this.downloadIdToGid.set(downloadId, gid);
      updateDownloadStatus(downloadId, "downloading");
      return gid;
    } catch (e) {
      console.error("[aria2] addTorrentFile failed:", e);
      return null;
    }
  }

  async pause(downloadId: number): Promise<void> {
    if (this.disabled || !this.ready) {
      return;
    }
    const gid = this.downloadIdToGid.get(downloadId);
    if (gid) {
      await this.rpc("aria2.pause", [gid]).catch(() => {});
    }
    updateDownloadStatus(downloadId, "paused");
    const row = getDownloadById(downloadId);
    this.pushProgress(this.progressPayloadForRow(downloadId, row, { status: "paused", speed: 0, eta: null }));
  }

  async resume(downloadId: number): Promise<void> {
    if (this.disabled || !this.ready) {
      return;
    }
    const row = getDownloadById(downloadId);
    if (!row) {
      return;
    }
    const gid = this.downloadIdToGid.get(downloadId);
    if (gid) {
      await this.rpc("aria2.unpause", [gid]).catch(() => {});
      updateDownloadStatus(downloadId, "downloading");
      this.pushProgress(this.progressPayloadForRow(downloadId, row, { status: "downloading", speed: 0, eta: null }));
      return;
    }
    await this.attachExistingRow(row);
    updateDownloadStatus(downloadId, "downloading");
    this.pushProgress(this.progressPayloadForRow(downloadId, getDownloadById(downloadId), { status: "downloading" }));
  }

  async cancel(downloadId: number): Promise<void> {
    if (this.disabled) {
      const row = getDownloadById(downloadId);
      const dir = stagingDirForDownload(downloadId);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      updateDownloadStatus(downloadId, "cancelled");
      updateDownloadCompletedAt(downloadId, new Date().toISOString());
      this.pushProgress(
        this.progressPayloadForRow(downloadId, row, {
          status: "cancelled",
          speed: 0,
          eta: null,
          progress_pct: row?.progress_pct ?? 0,
        }),
      );
      return;
    }
    const gid = this.downloadIdToGid.get(downloadId);
    if (gid) {
      await this.rpc("aria2.forceRemove", [gid]).catch(() => {});
      this.gidToDownloadId.delete(gid);
      this.downloadIdToGid.delete(downloadId);
      this.displayNamePersistedForGid.delete(gid);
    }
    const row = getDownloadById(downloadId);
    const dir = stagingDirForDownload(downloadId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    updateDownloadStatus(downloadId, "cancelled");
    updateDownloadCompletedAt(downloadId, new Date().toISOString());
    this.pushProgress(
      this.progressPayloadForRow(downloadId, row, {
        status: "cancelled",
        speed: 0,
        eta: null,
        progress_pct: row?.progress_pct ?? 0,
      }),
    );
  }

  async retry(downloadId: number): Promise<void> {
    if (this.disabled || !this.ready) {
      return;
    }
    const gid = this.downloadIdToGid.get(downloadId);
    if (gid) {
      await this.rpc("aria2.forceRemove", [gid]).catch(() => {});
      this.gidToDownloadId.delete(gid);
      this.downloadIdToGid.delete(downloadId);
      this.displayNamePersistedForGid.delete(gid);
    }
    const dir = stagingDirForDownload(downloadId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    resetDownloadForRetry(downloadId);
    const row = getDownloadById(downloadId);
    if (!row?.source_url) {
      return;
    }
    updateDownloadStatus(downloadId, "queued");
    await this.attachExistingRow(row);
    updateDownloadStatus(downloadId, "downloading");
    this.pushProgress(
      this.progressPayloadForRow(downloadId, getDownloadById(downloadId), { status: "downloading", speed: 0, eta: null }),
    );
  }

  async resumeDownloadsAfterBoot(): Promise<void> {
    if (this.disabled || !this.ready) {
      return;
    }
    const rows = getAllDownloads();
    for (const row of rows) {
      if (row.status !== "queued" && row.status !== "downloading") {
        continue;
      }
      const st = row.source_type ?? "";
      if (st !== "magnet" && st !== "torrent_file") {
        continue;
      }
      try {
        await this.attachExistingRow(row);
      } catch (e) {
        console.error(`[aria2] bootstrap failed for download ${row.id}:`, e);
        updateDownloadStatus(row.id, "failed");
      }
    }
  }

  private async attachExistingRow(row: DownloadRow): Promise<void> {
    const dir = stagingDirForDownload(row.id);
    const st = row.source_type ?? "";
    if (st === "magnet" && row.source_url?.startsWith("magnet:")) {
      await this.addMagnet(row.id, row.source_url, dir);
      return;
    }
    if (st === "torrent_file" && row.source_url && fs.existsSync(row.source_url)) {
      await this.addTorrentFile(row.id, row.source_url, dir);
      return;
    }
    if (st === "torrent_file") {
      throw new Error("torrent file path missing on disk");
    }
  }

  private startPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.pollInterval = setInterval(() => {
      void this.pollTick();
    }, 1000);
  }

  private async pollTick(): Promise<void> {
    if (!this.mainWindowRef || !this.ready || this.disabled) {
      return;
    }
    try {
      const active = (await this.rpc("aria2.tellActive", [
        [
          "gid",
          "status",
          "completedLength",
          "totalLength",
          "downloadSpeed",
          "numSeeders",
          "connections",
          "files",
          "bittorrent",
        ],
      ])) as TellItem[];

      for (const item of active) {
        const downloadId = this.gidToDownloadId.get(item.gid);
        if (downloadId === undefined) {
          continue;
        }

        const row = getDownloadById(downloadId);
        const torrentMetaName = item.bittorrent?.info?.name?.trim() ?? null;
        if (torrentMetaName && !this.displayNamePersistedForGid.has(item.gid)) {
          updateDownloadDisplayName(downloadId, torrentMetaName);
          this.displayNamePersistedForGid.add(item.gid);
        }

        const total = parseInt(item.totalLength ?? "0", 10) || 0;
        const completed = parseInt(item.completedLength ?? "0", 10) || 0;
        const progress = total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0;
        const rounded = Math.round(progress * 10) / 10;
        const speed = parseInt(item.downloadSpeed ?? "0", 10) || 0;
        const eta =
          speed > 0 && total > completed ? Math.ceil((total - completed) / speed) : null;

        const ariaPaused = item.status === "paused";
        const dbPaused = row?.status === "paused";
        if (!ariaPaused && !dbPaused) {
          updateDownloadProgress(downloadId, rounded);
        }

        const nextRow = getDownloadById(downloadId);
        const labelName =
          nextRow?.display_name && nextRow.display_name.length > 0
            ? nextRow.display_name
            : torrentMetaName ?? nextRow?.source_url ?? "Loading…";
        const uiStatus = ariaPaused || dbPaused ? "paused" : "downloading";
        this.pushProgress({
          id: downloadId,
          name: labelName,
          torrentName: torrentMetaName,
          progress_pct: rounded,
          speed: ariaPaused || dbPaused ? 0 : speed,
          status: uiStatus,
          eta: ariaPaused || dbPaused ? null : eta,
        });
      }

      const stopped = (await this.rpc("aria2.tellStopped", [
        0,
        100,
        ["gid", "status", "files", "errorMessage", "bittorrent", "followedBy"],
      ])) as TellItem[];

      for (const item of stopped) {
        if (this.finalizedStoppedGids.has(item.gid)) {
          continue;
        }
        const downloadId = this.gidToDownloadId.get(item.gid);
        if (downloadId === undefined) {
          continue;
        }

        if (item.status === "complete") {
          const followingGid = item.followedBy?.[0];
          if (followingGid) {
            this.finalizedStoppedGids.add(item.gid);
            this.gidToDownloadId.delete(item.gid);
            this.gidToDownloadId.set(followingGid, downloadId);
            this.downloadIdToGid.set(downloadId, followingGid);
            continue;
          }
          this.finalizedStoppedGids.add(item.gid);
          this.displayNamePersistedForGid.delete(item.gid);
          const paths = (item.files ?? []).map((f) => f.path).filter((p): p is string => Boolean(p));
          await this.handleCompleted(downloadId, item.gid, paths);
        } else if (item.status === "error") {
          this.finalizedStoppedGids.add(item.gid);
          this.displayNamePersistedForGid.delete(item.gid);
          this.gidToDownloadId.delete(item.gid);
          this.downloadIdToGid.delete(downloadId);
          const msg = item.errorMessage || "Unknown error";
          updateDownloadError(downloadId, msg);
          const row = getDownloadById(downloadId);
          this.pushProgress(
            this.progressPayloadForRow(downloadId, row, {
              status: "failed",
              speed: 0,
              eta: null,
              progress_pct: row?.progress_pct ?? 0,
            }),
          );
          const dir = stagingDirForDownload(downloadId);
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        }
      }
    } catch {
      /* aria2 may be restarting — ignore */
    }
  }

  private applyTorrentDerivedBookTitle(bookId: number, torrentName: string | null): void {
    if (!torrentName?.trim()) {
      return;
    }
    const clean = cleanTorrentTitleForBook(torrentName);
    if (!clean) {
      return;
    }
    const book = getBookById(bookId);
    if (!book) {
      return;
    }
    if (clean === book.title.trim()) {
      return;
    }
    updateBookMetadata(bookId, {
      title: clean,
      author: book.author,
      narrator: book.narrator,
      series: book.series,
      series_order: book.series_order,
      description: book.description,
      cover_art_path: book.cover_art_path,
    });
  }

  private async handleCompleted(downloadId: number, gid: string, filePaths: string[]): Promise<void> {
    let completedStatus: TellItem | null = null;
    try {
      completedStatus = (await this.rpc("aria2.tellStatus", [
        gid,
        ["bittorrent", "files", "status"],
      ])) as TellItem;
    } catch {
      /* GID may already be removed from aria2. */
    }

    const torrentName = completedStatus?.bittorrent?.info?.name?.trim() ?? null;
    const completedFilesFromStatus = (completedStatus?.files ?? [])
      .map((f) => f.path)
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0);

    if (torrentName) {
      updateDownloadDisplayName(downloadId, torrentName);
    }

    this.gidToDownloadId.delete(gid);
    this.downloadIdToGid.delete(downloadId);
    this.displayNamePersistedForGid.delete(gid);

    const row = getDownloadById(downloadId);
    const refPath = filePaths[0] ?? completedFilesFromStatus[0];
    const title =
      row?.display_name?.trim() || torrentName || (refPath ? path.basename(refPath) : "") || "Audiobook";

    const srcDir = stagingDirForDownload(downloadId);
    if (!fs.existsSync(srcDir)) {
      updateDownloadError(downloadId, "Download folder missing after completion");
      this.pushProgress(this.progressPayloadForRow(downloadId, row, { status: "failed", speed: 0, eta: null }));
      return;
    }

    const destDir = uniqueLibraryFolder(sanitizeFolderName(title));
    try {
      fs.renameSync(srcDir, destDir);
    } catch {
      fs.cpSync(srcDir, destDir, { recursive: true });
      fs.rmSync(srcDir, { recursive: true, force: true });
    }

    const remapped = remapPathsUnderDir(completedFilesFromStatus, srcDir, destDir).filter((p) => fs.existsSync(p));
    const ingestTargets = remapped.length > 0 ? remapped : [destDir];

    try {
      const ingest = await ingestPaths(ingestTargets);
      const bookIds = [...new Set(ingest.bookIds.filter((id) => Number.isFinite(id) && id > 0))];
      const primaryBookId = bookIds[0];
      if (primaryBookId == null || !Number.isFinite(primaryBookId)) {
        updateDownloadStatus(downloadId, "failed");
        this.pushProgress(
          this.progressPayloadForRow(downloadId, getDownloadById(downloadId), {
            status: "failed",
            speed: 0,
            eta: null,
          }),
        );
        return;
      }

      updateDownloadProgress(downloadId, 100);
      updateDownloadBookId(downloadId, primaryBookId);
      updateDownloadStatus(downloadId, "completed");
      updateDownloadCompletedAt(downloadId, new Date().toISOString());

      for (const bid of bookIds) {
        this.applyTorrentDerivedBookTitle(bid, torrentName);
      }
      for (const bid of bookIds) {
        await reingestBookMetadata(bid);
      }

      const autoFetch = getSetting("auto_fetch_covers");
      const autoFetchCovers = autoFetch == null || autoFetch.trim() === "" || autoFetch === "true";
      if (autoFetchCovers) {
        for (const bid of bookIds) {
          const book = getBookById(bid);
          if (book && (book.cover_art_path == null || book.cover_art_path === "")) {
            void fetchCoverArt(bid).catch((e) => {
              console.warn("[spire] aria2 auto fetch cover failed:", bid, e);
            });
          }
        }
      }

      broadcastLibraryUpdated({ bookIds });

      const updated = getDownloadById(downloadId);
      const doneLabel = updated?.display_name?.trim() || torrentName || title;
      this.pushProgress({
        id: downloadId,
        name: doneLabel,
        torrentName: null,
        progress_pct: 100,
        speed: 0,
        status: "completed",
        eta: null,
      });
      this.pushCompleted({ downloadId, bookId: primaryBookId });
    } catch (e) {
      console.error("[aria2] ingestPaths failed:", e);
      updateDownloadError(downloadId, e instanceof Error ? e.message : String(e));
      this.pushProgress(this.progressPayloadForRow(downloadId, getDownloadById(downloadId), { status: "failed" }));
    }
  }

  async shutdown(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (!this.process) {
      return;
    }
    try {
      await this.rpc("aria2.shutdown", []);
    } catch {
      /* ignore */
    }
    try {
      this.process.kill();
    } catch {
      /* ignore */
    }
    this.process = null;
    this.ready = false;
    this.gidToDownloadId.clear();
    this.downloadIdToGid.clear();
    this.finalizedStoppedGids.clear();
    this.displayNamePersistedForGid.clear();
  }
}

export const aria2Service = new Aria2Service();
