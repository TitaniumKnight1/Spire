import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import type { BrowserWindow, ClientRequest, IncomingMessage } from "electron";
import { net } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { DownloadCompletedPush, DownloadProgressPush } from "../../shared/library-types.js";
import {
  getDownloadById,
  getAllDownloads,
  updateDownloadBookId,
  updateDownloadCompletedAt,
  updateDownloadError,
  updateDownloadProgress,
  updateDownloadStatus,
} from "./database.js";
import { ingestPaths } from "./library.js";
import { SUPPORTED_AUDIO_EXTENSIONS } from "../utils/formats.js";
import { getStagingDirectoryRoot, getYtDlpPath } from "../utils/paths.js";

const AUDIO_EXT_SET = new Set<string>(SUPPORTED_AUDIO_EXTENSIONS);

/** Strip ANSI escape sequences (yt-dlp may colorize progress on some consoles). */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\u001b[@-_]/g, "");
}

export function classifyDownloadUrl(urlStr: string): "http" | "ytdlp" {
  try {
    const u = new URL(urlStr);
    const ext = path.extname(u.pathname.split("?")[0] ?? "").toLowerCase();
    if (AUDIO_EXT_SET.has(ext)) {
      return "http";
    }
  } catch {
    // invalid URL → yt-dlp may still handle it
  }
  return "ytdlp";
}

function stagingDirectory(downloadId: number): string {
  return path.join(getStagingDirectoryRoot(), `dl-${downloadId}`);
}

function cleanupStagingDir(dir: string): void {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    console.warn("[spire/downloader] cleanup staging failed:", e);
  }
}

function parseFilenameFromContentDisposition(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const m = /filename\*?=(?:UTF-8''|)([^;\r\n]+)/i.exec(header);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return m[1].trim().replace(/^"|"$/g, "");
    }
  }
  return null;
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "download.bin";
}

function parseYtDlpProgressPercent(line: string): number | null {
  const cleaned = stripAnsi(line);
  const idx = cleaned.indexOf("download:");
  const slice = idx >= 0 ? cleaned.slice(idx + "download:".length) : cleaned;
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(slice);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

function parseYtDlpSpeedBps(line: string): number {
  const cleaned = stripAnsi(line);
  const mib = /([\d.]+)\s*MiB\/s/i.exec(cleaned);
  if (mib) {
    return Number(mib[1]) * 1024 * 1024;
  }
  const kib = /([\d.]+)\s*KiB\/s/i.exec(cleaned);
  if (kib) {
    return Number(kib[1]) * 1024;
  }
  const gib = /([\d.]+)\s*GiB\/s/i.exec(cleaned);
  if (gib) {
    return Number(gib[1]) * 1024 * 1024 * 1024;
  }
  const bps = /([\d.]+)\s*B\/s/i.exec(cleaned);
  if (bps) {
    return Number(bps[1]);
  }
  return 0;
}

function parseYtDlpEtaSeconds(line: string): number | null {
  const cleaned = stripAnsi(line);
  const m = /ETA\s+(\d+):(\d{2}):(\d{2})/i.exec(cleaned);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    const s = Number(m[3]);
    return h * 3600 + min * 60 + s;
  }
  const m2 = /ETA\s+(\d+):(\d{2})(?!:)/i.exec(cleaned);
  if (m2) {
    return Number(m2[1]) * 60 + Number(m2[2]);
  }
  return null;
}

let downloaderInstance: UrlDownloader | null = null;

export function getUrlDownloader(): UrlDownloader {
  if (!downloaderInstance) {
    downloaderInstance = new UrlDownloader();
  }
  return downloaderInstance;
}

/** Restart HTTP / yt-dlp / RSS downloads that were left queued or downloading (e.g. after app restart). */
export function resumeUrlDownloadsAfterBoot(): void {
  const rows = getAllDownloads();
  for (const row of rows) {
    if (row.status !== "queued" && row.status !== "downloading") {
      continue;
    }
    const st = row.source_type ?? "";
    if (st !== "http" && st !== "ytdlp" && st !== "rss") {
      continue;
    }
    const url = row.source_url;
    if (!url) {
      continue;
    }
    void getUrlDownloader()
      .startDownload(row.id, url)
      .catch((e) => {
        console.error(`[spire/downloader] resume ${row.id} failed:`, e);
      });
  }
}

type ActiveHandle =
  | { kind: "http"; request: ClientRequest }
  | { kind: "ytdlp"; child: ChildProcess };

export class UrlDownloader {
  private mainWindow: BrowserWindow | null = null;
  private readonly active = new Map<number, ActiveHandle>();

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  private pushProgress(payload: DownloadProgressPush): void {
    const win = this.mainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.downloads.PROGRESS_UPDATE, payload);
    }
  }

  private pushCompleted(payload: DownloadCompletedPush): void {
    const win = this.mainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.downloads.COMPLETED, payload);
    }
  }

  /** Remove cancel handle after terminal states or explicit cancel (avoid leaking ChildProcess refs). */
  private clearActive(downloadId: number): void {
    this.active.delete(downloadId);
  }

  cancelDownload(downloadId: number): void {
    const h = this.active.get(downloadId);
    if (!h) {
      return;
    }
    if (h.kind === "http") {
      try {
        h.request.abort();
      } catch {
        // ignore
      }
    } else {
      try {
        h.child.kill("SIGTERM");
      } catch {
        // ignore
      }
      try {
        h.child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    this.clearActive(downloadId);
  }

  async startDownload(downloadId: number, url: string): Promise<void> {
    const row = getDownloadById(downloadId);
    if (!row) {
      return;
    }
    const strategy = classifyDownloadUrl(url);
    if (strategy === "http") {
      await this.runHttpDownload(downloadId, url);
    } else {
      await this.runYtDlpDownload(downloadId, url);
    }
  }

  private async runHttpDownload(downloadId: number, url: string): Promise<void> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      updateDownloadError(downloadId, "Invalid URL");
      this.pushProgress({
        id: downloadId,
        name: getDownloadById(downloadId)?.display_name ?? "Download",
        progress_pct: 0,
        speed: 0,
        status: "failed",
        eta: null,
      });
      return;
    }

    const stagingDir = stagingDirectory(downloadId);
    cleanupStagingDir(stagingDir);
    fs.mkdirSync(stagingDir, { recursive: true });

    const displayBase =
      getDownloadById(downloadId)?.display_name?.trim() || path.basename(parsedUrl.pathname) || "download";

    updateDownloadStatus(downloadId, "downloading");

    try {
      await new Promise<void>((resolve, reject) => {
        let request: ClientRequest;
        try {
          request = net.request(url);
        } catch (e) {
          reject(e);
          return;
        }

        this.active.set(downloadId, { kind: "http", request });

        request.on("response", (response) => {
          void this.pipeHttpResponse(downloadId, stagingDir, parsedUrl, displayBase, response)
            .then(resolve)
            .catch(reject);
        });

        request.on("error", reject);
        request.end();
      });

      const ingest = await ingestPaths([stagingDir]);
      const bookId = ingest.bookIds[0];
      if (bookId == null || !Number.isFinite(bookId)) {
        updateDownloadError(downloadId, ingest.errors.join("; ") || "No audio files ingested");
        cleanupStagingDir(stagingDir);
        const row = getDownloadById(downloadId);
        this.pushProgress({
          id: downloadId,
          name: row?.display_name ?? "Download",
          progress_pct: row?.progress_pct ?? 0,
          speed: 0,
          status: "failed",
          eta: null,
        });
        return;
      }
      updateDownloadProgress(downloadId, 100);
      updateDownloadBookId(downloadId, bookId);
      updateDownloadStatus(downloadId, "completed");
      updateDownloadCompletedAt(downloadId, new Date().toISOString());
      const row = getDownloadById(downloadId);
      this.pushProgress({
        id: downloadId,
        name: row?.display_name ?? "Download",
        progress_pct: 100,
        speed: 0,
        status: "completed",
        eta: null,
      });
      this.pushCompleted({ downloadId, bookId });
      cleanupStagingDir(stagingDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      updateDownloadError(downloadId, msg);
      cleanupStagingDir(stagingDir);
      const row = getDownloadById(downloadId);
      this.pushProgress({
        id: downloadId,
        name: row?.display_name ?? "Download",
        progress_pct: row?.progress_pct ?? 0,
        speed: 0,
        status: "failed",
        eta: null,
      });
    } finally {
      this.clearActive(downloadId);
    }
  }

  private async pipeHttpResponse(
    downloadId: number,
    stagingDir: string,
    parsedUrl: URL,
    displayBase: string,
    response: IncomingMessage,
  ): Promise<void> {
    const code = response.statusCode ?? 0;
    if (code < 200 || code >= 300) {
      let body = "";
      response.on("data", (c: Buffer) => {
        body += c.toString("utf8").slice(0, 500);
      });
      await new Promise<void>((resolve) => {
        response.on("end", () => resolve());
        response.on("error", () => resolve());
      });
      throw new Error(`HTTP ${code}${body ? `: ${body}` : ""}`);
    }

    const disp = parseFilenameFromContentDisposition(
      typeof response.headers["content-disposition"] === "string"
        ? response.headers["content-disposition"]
        : Array.isArray(response.headers["content-disposition"])
          ? response.headers["content-disposition"][0]
          : undefined,
    );
    let fileName = disp ?? safeFilename(path.basename(parsedUrl.pathname) || displayBase);
    if (!path.extname(fileName)) {
      const guess = path.extname(parsedUrl.pathname);
      if (guess) {
        fileName += guess;
      }
    }
    const destPath = path.join(stagingDir, safeFilename(fileName));

    const total =
      typeof response.headers["content-length"] === "string"
        ? Number(response.headers["content-length"])
        : Array.isArray(response.headers["content-length"])
          ? Number(response.headers["content-length"][0])
          : NaN;
    const totalBytes = Number.isFinite(total) && total > 0 ? total : null;

    const file = fs.createWriteStream(destPath);
    let received = 0;

    const rowName = getDownloadById(downloadId)?.display_name;
    const name = rowName?.trim() || safeFilename(fileName);

    response.on("data", (chunk: Buffer) => {
      received += chunk.length;
      file.write(chunk);
      if (totalBytes != null) {
        const pct = Math.min(100, Math.max(0, (received / totalBytes) * 100));
        const rounded = Math.round(pct * 10) / 10;
        updateDownloadProgress(downloadId, rounded);
        this.pushProgress({
          id: downloadId,
          name,
          progress_pct: rounded,
          speed: 0,
          status: "downloading",
          eta: null,
        });
      }
    });

    await new Promise<void>((resolve, reject) => {
      response.on("end", () => {
        file.end();
      });
      response.on("error", (e) => {
        file.destroy(e);
        reject(e);
      });
      file.on("error", reject);
      void finished(file).then(resolve).catch(reject);
    });
  }

  private async runYtDlpDownload(downloadId: number, url: string): Promise<void> {
    let ytdlpPath: string;
    try {
      ytdlpPath = getYtDlpPath();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateDownloadError(downloadId, msg);
      const row = getDownloadById(downloadId);
      this.pushProgress({
        id: downloadId,
        name: row?.display_name ?? "Download",
        progress_pct: 0,
        speed: 0,
        status: "failed",
        eta: null,
      });
      return;
    }

    const stagingDir = stagingDirectory(downloadId);
    cleanupStagingDir(stagingDir);
    fs.mkdirSync(stagingDir, { recursive: true });

    updateDownloadStatus(downloadId, "downloading");

    const outputTemplate = path.join(stagingDir, "%(title)s.%(ext)s");
    const args = [
      "--no-playlist",
      "--extract-audio",
      "--audio-format",
      "best",
      "--output",
      outputTemplate,
      "--newline",
      "--progress-template",
      "download:%(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s",
      "--print",
      "after_move:filepath",
      url,
    ];

    const child = spawn(ytdlpPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.active.set(downloadId, { kind: "ytdlp", child });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (c: Buffer) => {
      stderrChunks.push(c);
    });

    let stdoutBuf = "";
    const filepathLines: string[] = [];

    child.stdout?.on("data", (c: Buffer) => {
      stdoutBuf += c.toString("utf8");
      const parts = stdoutBuf.split(/\r?\n/);
      stdoutBuf = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const strippedPath = stripAnsi(trimmed);
        if (
          /^[A-Za-z]:\\/.test(strippedPath) ||
          strippedPath.startsWith("\\\\") ||
          strippedPath.startsWith("/")
        ) {
          filepathLines.push(strippedPath);
        }
        const pct = parseYtDlpProgressPercent(trimmed);
        if (pct != null) {
          updateDownloadProgress(downloadId, pct);
          const row = getDownloadById(downloadId);
          const speed = parseYtDlpSpeedBps(trimmed);
          const eta = parseYtDlpEtaSeconds(trimmed);
          this.pushProgress({
            id: downloadId,
            name: row?.display_name ?? "Download",
            progress_pct: pct,
            speed,
            status: "downloading",
            eta,
          });
        }
      }
    });

    await new Promise<void>((resolve) => {
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });

    if (stdoutBuf.trim()) {
      const trimmed = stdoutBuf.trim();
      const strippedPath = stripAnsi(trimmed);
      if (
        /^[A-Za-z]:\\/.test(strippedPath) ||
        strippedPath.startsWith("\\\\") ||
        strippedPath.startsWith("/")
      ) {
        filepathLines.push(strippedPath);
      }
    }

    const code = child.exitCode ?? -1;
    const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();

    try {
      if (code !== 0) {
        const detail = stderrText || `yt-dlp exited with code ${code}`;
        updateDownloadError(downloadId, detail.slice(0, 4000));
        const row = getDownloadById(downloadId);
        this.pushProgress({
          id: downloadId,
          name: row?.display_name ?? "Download",
          progress_pct: row?.progress_pct ?? 0,
          speed: 0,
          status: "failed",
          eta: null,
        });
        cleanupStagingDir(stagingDir);
        return;
      }

      let finalPath = filepathLines[filepathLines.length - 1];
      if (!finalPath || !fs.existsSync(finalPath)) {
        const files = walkAudioFiles(stagingDir);
        finalPath = files[0] ?? "";
      }

      const ingestTarget =
        finalPath && fs.existsSync(finalPath) ? path.dirname(finalPath) : stagingDir;
      const ingest = await ingestPaths([ingestTarget]);
      const bookId = ingest.bookIds[0];
      if (bookId == null || !Number.isFinite(bookId)) {
        updateDownloadError(downloadId, ingest.errors.join("; ") || "No audio ingested from yt-dlp output");
        const row = getDownloadById(downloadId);
        this.pushProgress({
          id: downloadId,
          name: row?.display_name ?? "Download",
          progress_pct: row?.progress_pct ?? 0,
          speed: 0,
          status: "failed",
          eta: null,
        });
        cleanupStagingDir(stagingDir);
        return;
      }

      updateDownloadProgress(downloadId, 100);
      updateDownloadBookId(downloadId, bookId);
      updateDownloadStatus(downloadId, "completed");
      updateDownloadCompletedAt(downloadId, new Date().toISOString());
      const row = getDownloadById(downloadId);
      this.pushProgress({
        id: downloadId,
        name: row?.display_name ?? "Download",
        progress_pct: 100,
        speed: 0,
        status: "completed",
        eta: null,
      });
      this.pushCompleted({ downloadId, bookId });
      cleanupStagingDir(stagingDir);
    } finally {
      this.clearActive(downloadId);
    }
  }
}

function walkAudioFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkAudioFiles(full));
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (AUDIO_EXT_SET.has(ext)) {
        out.push(full);
      }
    }
  }
  return out;
}
