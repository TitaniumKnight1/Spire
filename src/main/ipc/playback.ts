import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { Bookmark } from "../../shared/library-types.js";
import {
  deleteBookmarkById,
  getBookmarksByBook,
  insertBookmark,
  markBookPlaybackComplete,
  savePlaybackProgress,
} from "../services/database.js";

type SaveProgressPayload = {
  book_id: unknown;
  current_file_id: unknown;
  position_seconds: unknown;
  playback_speed: unknown;
};

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

export function registerPlaybackIpc(): void {
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
    savePlaybackProgress(bookId, currentFileId, Math.max(0, position), speed);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.playback.MARK_COMPLETE, async (_event, bookId: unknown): Promise<{ ok: boolean }> => {
    const id = asFiniteNumber(bookId);
    if (id == null || id <= 0) {
      return { ok: false };
    }
    markBookPlaybackComplete(id);
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
