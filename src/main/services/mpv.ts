// SETUP REQUIRED: Download mpv for Windows from https://mpv.io/installation/
// Extract mpv.exe into the /binaries/ directory alongside yt-dlp.exe
// Recommended build: shinchiro's Windows builds at https://github.com/shinchiro/mpv-winbuild-cmake/releases
// Minimum version: 0.35.0 (for stable named pipe IPC on Windows)

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { EventEmitter } from "node:events";
import { app } from "electron";
import { appendMediaPlaybackDebugLine } from "./mediaPlaybackDebugLog.js";

const MPV_PIPE_ARG = "\\\\.\\pipe\\spire-mpv";
const MPV_PIPE_CONNECT_PATH = "\\\\.\\pipe\\spire-mpv";

const CONNECT_INITIAL_DELAY_MS = 250;
const CONNECT_RETRY_DELAY_MS = 300;
const CONNECT_MAX_ATTEMPTS = 5;

const OBSERVE_TIME_POS = 1;
const OBSERVE_PAUSE = 2;
const OBSERVE_CHAPTER = 3;
const OBSERVE_DURATION = 4;

/** mpv JSON `property-change` may omit `name` on some builds; map reply id → property. */
const OBSERVE_ID_TO_PROPERTY: Record<number, "time-pos" | "pause" | "chapter" | "duration"> = {
  [OBSERVE_TIME_POS]: "time-pos",
  [OBSERVE_PAUSE]: "pause",
  [OBSERVE_CHAPTER]: "chapter",
  [OBSERVE_DURATION]: "duration",
};

const TIME_POS_POLL_MS = 350;

const REQUEST_ID_START = 10_000;

export interface MpvChapter {
  title: string;
  startTime: number;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

type PendingFileLoad = {
  gen: number;
  resolve: () => void;
  reject: (e: Error) => void;
};

function toMpvFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function getMpvBinaryPath(): string {
  const binaryName = process.platform === "win32" ? "mpv.exe" : "mpv";
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(base, "binaries", binaryName);
}

function coerceFiniteNumber(data: unknown): number | null {
  if (typeof data === "number" && Number.isFinite(data)) {
    return data;
  }
  if (typeof data === "string" && data.trim() !== "") {
    const n = Number(data);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseChapterList(data: unknown): MpvChapter[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const out: MpvChapter[] = [];
  for (const entry of data) {
    if (entry == null || typeof entry !== "object") {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title : "";
    let startTime = 0;
    if (typeof rec.time === "number" && Number.isFinite(rec.time)) {
      startTime = rec.time;
    } else if (typeof rec.start === "number" && Number.isFinite(rec.start)) {
      startTime = rec.start;
    }
    out.push({ title, startTime });
  }
  return out;
}

export class MpvService extends EventEmitter {
  private child: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private receiveBuffer = "";
  private nextRequestId = REQUEST_ID_START;
  private readonly pendingByRequestId = new Map<number, PendingRequest>();
  private loadGeneration = 0;
  private pendingFileLoad: PendingFileLoad | null = null;
  private didRestartAfterCrash = false;
  private isQuitting = false;
  private started = false;
  private timePosPollTimer: ReturnType<typeof setInterval> | null = null;
  private timePosPollInFlight = false;

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    try {
      await this.spawnAndConnect();
    } catch (e) {
      this.started = false;
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  private attachChildExitHandler(): void {
    if (!this.child) {
      return;
    }
    this.child.once("exit", (code, signal) => {
      if (this.isQuitting) {
        return;
      }
      console.warn("[mpv] process exited", { code, signal });
      this.teardownSocket();
      this.child = null;
      if (!this.didRestartAfterCrash) {
        this.didRestartAfterCrash = true;
        console.info("[mpv] attempting one restart after crash");
        void this.spawnAndConnect().catch((e) => {
          console.error("[mpv] restart failed:", e);
          this.emit("error", e instanceof Error ? e : new Error(String(e)));
        });
        return;
      }
      this.emit("error", new Error(`mpv exited (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    });
  }

  private async spawnAndConnect(): Promise<void> {
    const exe = getMpvBinaryPath();
    if (!fs.existsSync(exe)) {
      const err = new Error(`mpv binary not found at "${exe}". See SETUP REQUIRED comment in mpv.ts.`);
      this.emit("error", err);
      throw err;
    }

    const args = [
      "--idle",
      "--no-video",
      "--no-config",
      `--input-ipc-server=${MPV_PIPE_ARG}`,
      "--demuxer-lavf-probescore=1",
    ];
    if (process.platform === "win32") {
      // Prefer WASAPI (Windows 10+); DirectSound is a fallback for older systems.
      args.push("--ao=wasapi,directsound");
    }
    const proc = spawn(exe, args, { windowsHide: true, stdio: "ignore" });
    this.child = proc;

    proc.on("error", (e) => {
      console.error("[mpv] child process error:", e);
      this.emit("error", e);
    });

    this.attachChildExitHandler();

    await this.connectPipe();
  }

  private async connectPipe(): Promise<void> {
    await new Promise<void>((resolveConnect, rejectConnect) => {
      let attempt = 0;

      const tryConnect = (): void => {
        attempt++;
        const sock = net.createConnection(MPV_PIPE_CONNECT_PATH);

        const onConnect = (): void => {
          sock.off("error", onError);
          this.socket = sock;
          this.receiveBuffer = "";
          sock.setEncoding("utf8");
          sock.on("data", (data: string) => {
            this.onSocketData(data);
          });
          sock.on("error", (e) => {
            console.error("[mpv] socket error after connect:", e);
            this.emit("error", e);
          });
          void this.afterConnected()
            .then(() => resolveConnect())
            .catch((e) => rejectConnect(e instanceof Error ? e : new Error(String(e))));
        };

        const onError = (err: NodeJS.ErrnoException): void => {
          sock.off("connect", onConnect);
          sock.destroy();
          if (attempt >= CONNECT_MAX_ATTEMPTS) {
            const e = new Error(
              `mpv IPC: could not connect to named pipe after ${CONNECT_MAX_ATTEMPTS} attempts: ${err.message}`,
            );
            this.emit("error", e);
            rejectConnect(e);
            return;
          }
          setTimeout(() => tryConnect(), CONNECT_RETRY_DELAY_MS);
        };

        sock.once("connect", onConnect);
        sock.once("error", onError);
      };

      setTimeout(() => tryConnect(), CONNECT_INITIAL_DELAY_MS);
    });
  }

  private teardownSocket(): void {
    this.stopTimePosPoll();
    this.pendingFileLoad?.reject(new Error("mpv IPC disconnected"));
    this.pendingFileLoad = null;
    for (const [, pending] of this.pendingByRequestId) {
      pending.reject(new Error("mpv IPC disconnected"));
    }
    this.pendingByRequestId.clear();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }

  /**
   * In `--idle` mode, mpv returns `property unavailable` for observe_property on
   * time-pos / chapter / duration until a file is loaded. Only pause is safe here;
   * playback observers are registered from `onFileLoadedEvent`.
   */
  private async afterConnected(): Promise<void> {
    try {
      await this.command(["observe_property", OBSERVE_PAUSE, "pause"]);
    } catch (e) {
      console.warn("[mpv] observe_property pause failed:", e);
    }
  }

  private async registerPlaybackPropertyObservers(): Promise<void> {
    const specs: [number, string][] = [
      [OBSERVE_TIME_POS, "time-pos"],
      [OBSERVE_CHAPTER, "chapter"],
      [OBSERVE_DURATION, "duration"],
    ];
    for (const [id, name] of specs) {
      try {
        await this.command(["unobserve_property", id]);
      } catch {
        /* ignore: id may not be registered yet */
      }
      try {
        await this.command(["observe_property", id, name]);
      } catch (e) {
        console.warn(`[mpv] observe_property ${name} failed:`, e);
      }
    }
  }

  private onSocketData(data: string): void {
    this.receiveBuffer += data;
    let idx: number;
    while ((idx = this.receiveBuffer.indexOf("\n")) >= 0) {
      const line = this.receiveBuffer.slice(0, idx).trim();
      this.receiveBuffer = this.receiveBuffer.slice(idx + 1);
      if (line.length === 0) {
        continue;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        console.warn("[mpv] non-json line:", line.slice(0, 200));
        continue;
      }
      this.handleMessage(msg);
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (typeof msg.request_id === "number") {
      const id = msg.request_id;
      const pending = this.pendingByRequestId.get(id);
      if (!pending) {
        return;
      }
      this.pendingByRequestId.delete(id);
      const err = msg.error;
      if (err === "success" || err === true) {
        pending.resolve(msg.data);
        return;
      }
      const errText = typeof err === "string" ? err : JSON.stringify(err);
      pending.reject(new Error(`mpv IPC error: ${errText}`));
      return;
    }

    if (msg.event === "property-change") {
      const id = typeof msg.id === "number" ? msg.id : null;
      const nameFromMsg = typeof msg.name === "string" && msg.name.length > 0 ? msg.name : null;
      const prop =
        (nameFromMsg as "time-pos" | "pause" | "chapter" | "duration" | null) ??
        (id != null ? OBSERVE_ID_TO_PROPERTY[id] : undefined) ??
        "";
      const data = msg.data;
      if (prop === "time-pos") {
        const n = coerceFiniteNumber(data);
        if (n != null) {
          this.emit("timeUpdate", n);
        }
        return;
      }
      if (prop === "pause") {
        const paused = data === true || data === 1 || data === "yes" || data === "true";
        const unpaused = data === false || data === 0 || data === "no" || data === "false";
        if (paused || unpaused) {
          this.emit("pauseChange", paused);
        }
        return;
      }
      if (prop === "chapter") {
        const n = coerceFiniteNumber(data);
        if (n != null) {
          this.emit("chapterChange", n);
        }
        return;
      }
      if (prop === "duration") {
        const n = coerceFiniteNumber(data);
        if (n != null) {
          this.emit("duration", n);
        }
        return;
      }
      return;
    }

    if (msg.event === "file-loaded") {
      const genAtEvent = this.loadGeneration;
      const p = this.pendingFileLoad;
      if (p && p.gen === genAtEvent) {
        p.resolve();
        this.pendingFileLoad = null;
      }
      void this.onFileLoadedEvent(genAtEvent);
      return;
    }

    if (msg.event === "end-file") {
      this.stopTimePosPoll();
      /**
       * mpv emits `end-file` for *every* file transition: natural EOF, `loadfile` replacing the
       * current file, playlist jumps, errors, etc. Only `"eof"` means the track actually played
       * to completion — forwarding other reasons caused spurious `MARK_COMPLETE` / wrong “finished”
       * status when switching books or reloading media.
       */
      const reason = typeof msg.reason === "string" ? msg.reason : "";
      if (reason === "eof") {
        this.emit("trackEnded");
      }
      return;
    }
  }

  private async onFileLoadedEvent(gen: number): Promise<void> {
    if (gen !== this.loadGeneration) {
      return;
    }
    await this.registerPlaybackPropertyObservers();
    if (gen !== this.loadGeneration) {
      return;
    }
    try {
      const list = await this.command(["get_property", "chapter-list"]);
      if (gen !== this.loadGeneration) {
        return;
      }
      const chapters = parseChapterList(list);
      this.emit("chapters", chapters);
    } catch (e) {
      console.warn("[mpv] get chapter-list failed:", e);
      if (gen === this.loadGeneration) {
        this.emit("chapters", []);
      }
    }

    try {
      const dur = await this.command(["get_property", "duration"]);
      if (gen !== this.loadGeneration) {
        return;
      }
      if (typeof dur === "number" && Number.isFinite(dur)) {
        this.emit("duration", dur);
      }
    } catch (e) {
      console.warn("[mpv] get duration after file-loaded failed:", e);
    }

    try {
      const pos = await this.command(["get_property", "time-pos"]);
      if (gen !== this.loadGeneration) {
        return;
      }
      const n = coerceFiniteNumber(pos);
      if (n != null) {
        this.emit("timeUpdate", n);
      }
    } catch (e) {
      console.warn("[mpv] get time-pos after file-loaded failed:", e);
    }

    this.startTimePosPoll(gen);
  }

  private stopTimePosPoll(): void {
    if (this.timePosPollTimer != null) {
      clearInterval(this.timePosPollTimer);
      this.timePosPollTimer = null;
    }
    this.timePosPollInFlight = false;
  }

  /**
   * Observing `time-pos` is unreliable for audio-only playback on some platforms
   * (infrequent or missing `property-change` events). Poll while a file is active.
   */
  private startTimePosPoll(gen: number): void {
    this.stopTimePosPoll();
    appendMediaPlaybackDebugLine(
      "mpv.time_pos_poll.start",
      { intervalMs: TIME_POS_POLL_MS, loadGeneration: gen },
      { mirrorConsole: true },
    );
    this.timePosPollTimer = setInterval(() => {
      if (!this.socket || this.socket.destroyed || gen !== this.loadGeneration) {
        this.stopTimePosPoll();
        return;
      }
      if (this.timePosPollInFlight) {
        return;
      }
      this.timePosPollInFlight = true;
      void this.command(["get_property", "time-pos"])
        .then((v) => {
          if (gen !== this.loadGeneration) {
            return;
          }
          const n = coerceFiniteNumber(v);
          if (n != null) {
            this.emit("timeUpdate", n);
          }
        })
        .catch(() => {
          /* between tracks or ipc hiccup */
        })
        .finally(() => {
          this.timePosPollInFlight = false;
        });
    }, TIME_POS_POLL_MS);
  }

  private sendRaw(obj: Record<string, unknown>): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("mpv IPC socket is not connected");
    }
    this.socket.write(`${JSON.stringify(obj)}\n`);
  }

  private assertLoadGeneration(gen: number): void {
    if (gen !== this.loadGeneration) {
      throw new Error("load superseded");
    }
  }

  private command(args: unknown[], requestId?: number): Promise<unknown> {
    const id = requestId ?? this.nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pendingByRequestId.set(id, { resolve, reject });
      try {
        this.sendRaw({ command: args, request_id: id });
      } catch (e) {
        this.pendingByRequestId.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async load(filePath: string, startPositionSeconds?: number): Promise<void> {
    const normalized = toMpvFilePath(path.resolve(filePath));

    this.stopTimePosPoll();
    this.pendingFileLoad?.reject(new Error("load superseded"));
    this.pendingFileLoad = null;

    const gen = ++this.loadGeneration;

    const loaded = new Promise<void>((resolve, reject) => {
      this.pendingFileLoad = { gen, resolve, reject };
    });

    const start = typeof startPositionSeconds === "number" && startPositionSeconds > 0 ? startPositionSeconds : 0;
    const timeoutMs = 30_000;
    try {
      await this.command(["loadfile", normalized, "replace"]);
      await Promise.race([
        loaded,
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error("mpv load timed out waiting for file-loaded")), timeoutMs);
        }),
      ]);
    } catch (e) {
      const pending = this.pendingFileLoad as PendingFileLoad | null;
      if (pending && pending.gen === gen) {
        pending.reject(e instanceof Error ? e : new Error(String(e)));
        this.pendingFileLoad = null;
      }
      throw e;
    }

    if (gen !== this.loadGeneration) {
      throw new Error("load superseded");
    }

    if (start > 0) {
      await this.seek(start);
    }
  }

  async loadPlaylist(filePaths: string[], startFileIndex: number, startPositionSeconds: number): Promise<void> {
    if (filePaths.length === 0) {
      throw new Error("loadPlaylist: filePaths must be non-empty");
    }

    this.stopTimePosPoll();
    this.pendingFileLoad?.reject(new Error("load superseded"));
    this.pendingFileLoad = null;

    const gen = ++this.loadGeneration;

    const normalized = filePaths.map((p) => toMpvFilePath(path.resolve(p)));
    const clampedStartIdx = Math.max(0, Math.min(Math.floor(startFileIndex), normalized.length - 1));

    const loaded = new Promise<void>((resolve, reject) => {
      this.pendingFileLoad = { gen, resolve, reject };
    });

    const timeoutMs = 30_000;
    const timeoutReject = (): Promise<never> =>
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("mpv load timed out waiting for file-loaded")), timeoutMs);
      });

    try {
      this.assertLoadGeneration(gen);
      await this.command(["loadfile", normalized[0]!, "append-play"]);
      this.assertLoadGeneration(gen);

      for (let i = 1; i < normalized.length; i++) {
        await this.command(["loadfile", normalized[i]!, "append"]);
        this.assertLoadGeneration(gen);
      }

      await Promise.race([loaded, timeoutReject()]);
      this.assertLoadGeneration(gen);

      if (clampedStartIdx > 0) {
        const loadedJump = new Promise<void>((resolve, reject) => {
          this.pendingFileLoad = { gen, resolve, reject };
        });
        await this.command(["playlist-play-index", clampedStartIdx]);
        this.assertLoadGeneration(gen);
        await Promise.race([loadedJump, timeoutReject()]);
      }
    } catch (e) {
      const pending = this.pendingFileLoad as PendingFileLoad | null;
      if (pending && pending.gen === gen) {
        pending.reject(e instanceof Error ? e : new Error(String(e)));
        this.pendingFileLoad = null;
      }
      throw e;
    }

    this.assertLoadGeneration(gen);

    const start =
      typeof startPositionSeconds === "number" && startPositionSeconds > 0 ? startPositionSeconds : 0;
    if (start > 0) {
      this.assertLoadGeneration(gen);
      await this.command(["seek", start, "absolute"]);
    }

    this.emit("playlistLoaded");
  }

  async play(): Promise<void> {
    await this.command(["set_property", "pause", false]);
    appendMediaPlaybackDebugLine("mpv.play.pause_false", {}, { mirrorConsole: true });
  }

  async pause(): Promise<void> {
    await this.command(["set_property", "pause", true]);
  }

  async seek(seconds: number): Promise<void> {
    const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    // Prefer the seek command: `set_property` on `time-pos` can return
    // `property unavailable` right after load on some builds/formats.
    await this.command(["seek", t, "absolute"]);
  }

  async setSpeed(rate: number): Promise<void> {
    const clamped = Math.min(3.5, Math.max(0.5, Number.isFinite(rate) ? rate : 1));
    await this.command(["set_property", "speed", clamped]);
  }

  async setVolume(level: number): Promise<void> {
    const n = Number.isFinite(level) ? level : 100;
    const clamped = Math.round(Math.min(100, Math.max(0, n)));
    await this.command(["set_property", "volume", clamped]);
  }

  async setSkipSilence(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.command([
        "set_property",
        "af",
        "lavfi=[silenceremove=stop_periods=-1:stop_duration=0.1:stop_threshold=-50dB]",
      ]);
      return;
    }
    await this.command(["set_property", "af", ""]);
  }

  async getChapters(): Promise<MpvChapter[]> {
    const list = await this.command(["get_property", "chapter-list"]);
    return parseChapterList(list);
  }

  async getCurrentTime(): Promise<number> {
    const v = await this.command(["get_property", "time-pos"]);
    return coerceFiniteNumber(v) ?? 0;
  }

  quit(): void {
    this.isQuitting = true;
    this.stopTimePosPoll();
    try {
      this.sendRaw({ command: ["quit"] });
    } catch {
      /* ignore */
    }
    this.teardownSocket();
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
  }
}
