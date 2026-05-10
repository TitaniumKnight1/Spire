import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import { broadcastLibraryUpdated, broadcastPlaybackChannel, broadcastPlayerState } from "../broadcast-state.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { Bookmark, PlayerStatePushPayload } from "../../shared/library-types.js";
import {
  deleteBookmarkById,
  getBookById,
  getBookmarksByBook,
  insertBookmark,
  markBookPlaybackComplete,
  savePlaybackProgress,
  updateBookStatus,
} from "../services/database.js";
import { libraryAudioHttpUrl } from "../services/audio-server.js";
import { appendMediaPlaybackDebugLine } from "../services/mediaPlaybackDebugLog.js";
import { MpvService, type MpvChapter } from "../services/mpv.js";
import { getLibraryDirectory } from "../utils/paths.js";

type SaveProgressPayload = {
  book_id: unknown;
  current_file_id: unknown;
  position_seconds: unknown;
  playback_speed: unknown;
};

/** Avoid hammering GET_ALL on progress ticks; always flush immediately when status changes. */
let lastProgressLibraryBroadcastAt = 0;
const PROGRESS_LIBRARY_BROADCAST_MIN_MS = 3500;

function notifyPlaybackLibraryRefresh(bookId: number, urgent: boolean): void {
  const now = Date.now();
  if (urgent || now - lastProgressLibraryBroadcastAt >= PROGRESS_LIBRARY_BROADCAST_MIN_MS) {
    lastProgressLibraryBroadcastAt = now;
    broadcastLibraryUpdated({ bookIds: [bookId] });
  }
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function validateLibraryMediaFilePath(
  absolutePath: unknown,
  supportedMediaExtensions: ReadonlySet<string>,
): Promise<string> {
  if (typeof absolutePath !== "string" || absolutePath.trim() === "") {
    throw new Error("media:resolve-path requires a non-empty absolute path string.");
  }
  const resolvedPath = path.resolve(absolutePath);
  const ext = path.extname(resolvedPath).toLowerCase();
  if (!supportedMediaExtensions.has(ext)) {
    throw new Error(`Unsupported media extension "${ext}" for path: ${resolvedPath}`);
  }
  await fs.promises.access(resolvedPath, fs.constants.R_OK);
  return resolvedPath;
}

export type PlaybackIpcDeps = {
  toggleMiniPlayer: () => { visible: boolean };
  routeMiniPlayerCommand: (command: "play-pause" | "next" | "prev" | "close") => void;
  mpvService: MpvService;
};

export function registerPlaybackIpc(deps: PlaybackIpcDeps): void {
  const { toggleMiniPlayer, routeMiniPlayerCommand, mpvService } = deps;

  ipcMain.handle(IPC_CHANNELS.playback.MEDIA_DEBUG_LOG, async (_event, payload: unknown): Promise<{ ok: boolean }> => {
    const body =
      payload != null && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : { value: payload };
    const ev = typeof body.event === "string" ? body.event : "";
    const mirrorConsole =
      body.severity === "error" || ev === "htmlaudio.error" || ev === "usePlayer.play_failed" || ev.endsWith(".error");
    appendMediaPlaybackDebugLine("renderer.ipc", body, { mirrorConsole });
    return { ok: true };
  });
  const supportedMediaExtensions = new Set([
    ".mp3",
    ".m4b",
    ".m4a",
    ".aac",
    ".ogg",
    ".flac",
    ".wav",
    ".opus",
    ".wma",
    ".aiff",
    ".mp4",
  ]);

  mpvService.on("timeUpdate", (seconds: unknown) => {
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      broadcastPlaybackChannel(IPC_CHANNELS.playback.TIME_UPDATE, seconds);
    }
  });
  mpvService.on("pauseChange", (paused: unknown) => {
    if (typeof paused === "boolean") {
      broadcastPlaybackChannel(IPC_CHANNELS.playback.PAUSE_CHANGE, paused);
    }
  });
  mpvService.on("chapterChange", (index: unknown) => {
    if (typeof index === "number" && Number.isFinite(index)) {
      broadcastPlaybackChannel(IPC_CHANNELS.playback.CHAPTER_CHANGE, index);
    }
  });
  mpvService.on("trackEnded", () => {
    broadcastPlaybackChannel(IPC_CHANNELS.playback.TRACK_ENDED);
  });
  mpvService.on("chapters", (chapters: unknown) => {
    broadcastPlaybackChannel(IPC_CHANNELS.playback.CHAPTERS_LOADED, chapters);
  });
  mpvService.on("duration", (durationSeconds: unknown) => {
    if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) {
      broadcastPlaybackChannel(IPC_CHANNELS.playback.DURATION, durationSeconds);
    }
  });

  ipcMain.handle(IPC_CHANNELS.playback.LOAD, async (_event, payload: unknown): Promise<void> => {
    const p = payload as { filePath?: unknown; startPositionSeconds?: unknown };
    const resolved = await validateLibraryMediaFilePath(p.filePath, supportedMediaExtensions);
    const start = asFiniteNumber(p.startPositionSeconds) ?? 0;
    await mpvService.load(resolved, start > 0 ? start : undefined);
  });

  ipcMain.handle(IPC_CHANNELS.playback.LOAD_PLAYLIST, async (_event, payload: unknown): Promise<void> => {
    const p = payload as { filePaths?: unknown; startFileIndex?: unknown; startPositionSeconds?: unknown };
    const raw = p.filePaths;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("load-playlist requires a non-empty filePaths array.");
    }
    const resolvedList: string[] = [];
    for (const item of raw) {
      resolvedList.push(await validateLibraryMediaFilePath(item, supportedMediaExtensions));
    }
    const startIdx = Math.trunc(asFiniteNumber(p.startFileIndex) ?? 0);
    const startPos = asFiniteNumber(p.startPositionSeconds) ?? 0;
    await mpvService.loadPlaylist(resolvedList, startIdx, startPos > 0 ? startPos : 0);
  });

  ipcMain.handle(IPC_CHANNELS.playback.PLAY, async (): Promise<void> => {
    await mpvService.play();
  });

  ipcMain.handle(IPC_CHANNELS.playback.PAUSE, async (): Promise<void> => {
    await mpvService.pause();
  });

  ipcMain.handle(IPC_CHANNELS.playback.SEEK, async (_event, seconds: unknown): Promise<void> => {
    const t = asFiniteNumber(seconds) ?? 0;
    await mpvService.seek(Math.max(0, t));
  });

  ipcMain.handle(IPC_CHANNELS.playback.SET_SPEED, async (_event, rate: unknown): Promise<void> => {
    const r = asFiniteNumber(rate) ?? 1;
    await mpvService.setSpeed(r);
  });

  ipcMain.handle(IPC_CHANNELS.playback.SET_VOLUME, async (_event, payload: unknown): Promise<void> => {
    const level = typeof payload === "number" ? payload : Number(payload);
    await mpvService.setVolume(level);
  });

  ipcMain.handle(IPC_CHANNELS.playback.SET_SKIP_SILENCE, async (_event, payload: unknown): Promise<void> => {
    const enabled = payload === true;
    await mpvService.setSkipSilence(enabled);
  });

  ipcMain.handle(IPC_CHANNELS.playback.GET_CHAPTERS, async (): Promise<MpvChapter[]> => {
    return mpvService.getChapters();
  });

  ipcMain.handle(IPC_CHANNELS.playback.GET_CURRENT_TIME, async (): Promise<number> => {
    return mpvService.getCurrentTime();
  });

  ipcMain.handle(IPC_CHANNELS.playback.RESOLVE_MEDIA_PATH, async (_event, absolutePath: unknown): Promise<string> => {
    let resolvedPath: string;
    try {
      resolvedPath = await validateLibraryMediaFilePath(absolutePath, supportedMediaExtensions);
    } catch (err) {
      if (typeof absolutePath !== "string" || absolutePath.trim() === "") {
        appendMediaPlaybackDebugLine("playback.resolve.reject", {
          reason: "empty_path",
          absolutePathType: typeof absolutePath,
        });
      } else {
        appendMediaPlaybackDebugLine(
          "playback.resolve.reject",
          {
            reason: "validation_failed",
            message: err instanceof Error ? err.message : String(err),
          },
          { mirrorConsole: true },
        );
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
    appendMediaPlaybackDebugLine("playback.resolve.input", {
      inputLength: typeof absolutePath === "string" ? absolutePath.length : 0,
      inputSample: typeof absolutePath === "string" ? absolutePath.slice(0, 240) : "",
      resolvedPath,
      libraryBasePath: path.resolve(getLibraryDirectory()),
    });
    let stat: fs.Stats | null = null;
    try {
      stat = await fs.promises.stat(resolvedPath);
    } catch (err) {
      appendMediaPlaybackDebugLine("playback.resolve.stat_failed", {
        resolvedPath,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    let mediaUrl: string;
    try {
      mediaUrl = libraryAudioHttpUrl(resolvedPath);
    } catch (err) {
      appendMediaPlaybackDebugLine(
        "playback.resolve.audio_server_not_ready",
        { resolvedPath, err: err instanceof Error ? err.message : String(err) },
        { mirrorConsole: true },
      );
      throw new Error("Local audio server is not ready yet; restart the app or try again in a second.");
    }
    appendMediaPlaybackDebugLine("playback.resolve.ok", {
      resolvedPath,
      mediaUrl,
      mediaUrlLength: mediaUrl.length,
      fileSize: stat?.isFile() ? stat.size : null,
      isFile: stat?.isFile() ?? null,
      transport: "http127",
    });
    return mediaUrl;
  });

  ipcMain.handle(IPC_CHANNELS.playback.TOGGLE_MINI_PLAYER, async (): Promise<{ visible: boolean }> => {
    return toggleMiniPlayer();
  });

  ipcMain.handle(IPC_CHANNELS.playback.MINI_PLAYER_COMMAND, async (_event, payload: unknown): Promise<{ ok: boolean }> => {
    const cmd = (payload as { command?: unknown }).command;
    if (cmd === "play-pause" || cmd === "next" || cmd === "prev" || cmd === "close") {
      routeMiniPlayerCommand(cmd);
      return { ok: true };
    }
    return { ok: false };
  });

  ipcMain.handle(IPC_CHANNELS.playback.REPORT_STATE, async (_event, payload: unknown): Promise<{ ok: boolean }> => {
    broadcastPlayerState(payload as PlayerStatePushPayload);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.playback.SAVE_PROGRESS, async (_event, payload: unknown): Promise<{ ok: boolean }> => {
    const p = payload as SaveProgressPayload;
    const bookId = asFiniteNumber(p.book_id);
    if (bookId == null || bookId <= 0) {
      return { ok: false };
    }
    const fileIdRaw = p.current_file_id;
    const currentFileId =
      fileIdRaw === null || fileIdRaw === undefined
        ? null
        : (() => {
            const n = asFiniteNumber(fileIdRaw);
            return n != null && n > 0 ? n : null;
          })();
    const position = asFiniteNumber(p.position_seconds) ?? 0;
    const speed = asFiniteNumber(p.playback_speed) ?? 1;
    const bookBefore = getBookById(bookId);
    savePlaybackProgress(bookId, currentFileId, Math.max(0, position), speed);
    let statusChanged = false;
    if (bookBefore?.status === "unstarted") {
      statusChanged = updateBookStatus(bookId, "in-progress");
    }
    notifyPlaybackLibraryRefresh(bookId, statusChanged);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.playback.MARK_COMPLETE, async (_event, bookId: unknown): Promise<{ ok: boolean }> => {
    const id = asFiniteNumber(bookId);
    if (id == null || id <= 0) {
      return { ok: false };
    }
    markBookPlaybackComplete(id);
    updateBookStatus(id, "finished");
    notifyPlaybackLibraryRefresh(id, true);
    return { ok: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.playback.GET_BOOKMARKS,
    async (_event, bookId: unknown): Promise<Bookmark[]> => {
      const id = asFiniteNumber(bookId);
      if (id == null || id <= 0) {
        return [];
      }
      const rows = getBookmarksByBook(id);
      return rows.map((r) => ({
        id: r.id,
        book_id: r.book_id,
        file_id: r.file_id,
        position_seconds: r.position_seconds ?? 0,
        note: r.note,
        created_at: r.created_at,
      }));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.playback.ADD_BOOKMARK,
    async (_event, payload: unknown): Promise<Bookmark | null> => {
      const p = payload as {
        book_id?: unknown;
        file_id?: unknown;
        position_seconds?: unknown;
        note?: unknown;
      };
      const bookId = asFiniteNumber(p.book_id);
      const position = asFiniteNumber(p.position_seconds) ?? 0;
      if (bookId == null || bookId <= 0) {
        return null;
      }
      const fileIdRaw = p.file_id;
      const fileId =
        fileIdRaw === null || fileIdRaw === undefined
          ? null
          : (() => {
              const n = asFiniteNumber(fileIdRaw);
              return n != null && n > 0 ? n : null;
            })();
      const note = typeof p.note === "string" ? p.note : null;
      const newId = insertBookmark({
        book_id: bookId,
        file_id: fileId,
        position_seconds: Math.max(0, position),
        note,
      });
      const rows = getBookmarksByBook(bookId);
      const row = rows.find((r) => r.id === newId);
      if (!row) {
        return {
          id: newId,
          book_id: bookId,
          file_id: fileId,
          position_seconds: Math.max(0, position),
          note,
          created_at: null,
        };
      }
      return {
        id: row.id,
        book_id: row.book_id,
        file_id: row.file_id,
        position_seconds: row.position_seconds ?? 0,
        note: row.note,
        created_at: row.created_at,
      };
    },
  );

  ipcMain.handle(IPC_CHANNELS.playback.DELETE_BOOKMARK, async (_event, id: unknown): Promise<{ ok: boolean }> => {
    const bookmarkId = asFiniteNumber(id);
    if (bookmarkId == null || bookmarkId <= 0) {
      return { ok: false };
    }
    return { ok: deleteBookmarkById(bookmarkId) };
  });
}
