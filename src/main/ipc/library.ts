import process from "node:process";
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type {
  BookDetailPayload,
  BookListItem,
  LibraryDeleteResult,
  LibraryIngestResult,
  LibraryOpenCoverDialogResult,
  LibraryOpenDialogResult,
  LibrarySetStatusPayload,
  LibraryUpdateTagsPayload,
  MetadataUpdate,
} from "../../shared/library-types.js";
import { broadcastLibraryUpdated } from "../broadcast-state.js";
import {
  copyUserCoverToLibrary,
  fetchCoverArt,
  getBookDetail,
  getBookListItemById,
  getLibrary,
  ingestPaths,
  reingestBookMetadata,
  removeBook,
} from "../services/library.js";
import {
  getBookById,
  getAppSetting,
  getLastListenedBookId,
  updateBookMetadata as dbUpdateBookMetadata,
  updateBookStatus,
  updateBookTags,
} from "../services/database.js";
import { SETTINGS_KEY_AUTO_FETCH_COVERS } from "./settings.js";
import {
  getWatchedFolderFromDb,
  persistWatchedFolder,
  startWatching,
  stopWatching,
} from "../services/watcher.js";

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

/** Tag normalization for persistence (trim, lowercase, dedupe, drop empties). */
function sanitizeTagListInput(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") {
      continue;
    }
    const s = item.trim().toLowerCase();
    if (s.length === 0) {
      continue;
    }
    if (seen.has(s)) {
      continue;
    }
    seen.add(s);
    out.push(s);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export function registerLibraryIpc(): void {
  ipcMain.handle(IPC_CHANNELS.library.ADD_PATHS, async (_event, paths: unknown): Promise<LibraryIngestResult> => {
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : [];
    const result = await ingestPaths(list);
    const rawAuto = getAppSetting(SETTINGS_KEY_AUTO_FETCH_COVERS);
    const autoFetchCovers = rawAuto == null || rawAuto.trim() === "" || rawAuto === "true";
    if (autoFetchCovers) {
      for (const bookId of result.newBookIds) {
        const book = getBookById(bookId);
        if (book && (book.cover_art_path == null || book.cover_art_path === "")) {
          void fetchCoverArt(bookId).catch((e) => {
            console.warn("[spire] auto fetch cover failed:", bookId, e);
          });
        }
      }
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.library.GET_ALL, async (): Promise<BookListItem[]> => {
    return getLibrary();
  });

  ipcMain.handle(IPC_CHANNELS.library.GET_LAST_LISTENED_BOOK_ID, async (): Promise<number | null> => {
    return getLastListenedBookId();
  });

  ipcMain.handle(IPC_CHANNELS.library.GET_BOOK, async (_event, bookId: unknown): Promise<BookDetailPayload | null> => {
    const id = typeof bookId === "number" ? bookId : Number(bookId);
    if (!Number.isFinite(id)) {
      return null;
    }
    return getBookDetail(id);
  });

  ipcMain.handle(
    IPC_CHANNELS.library.REINGEST_BOOK_METADATA,
    async (_event, bookId: unknown): Promise<BookDetailPayload | null> => {
      const id = asFiniteNumber(bookId);
      if (id == null || id <= 0) {
        return null;
      }
      if (!getBookById(id)) {
        return null;
      }
      await reingestBookMetadata(id);
      broadcastLibraryUpdated({ bookIds: [id] });
      return getBookDetail(id);
    },
  );

  ipcMain.handle(IPC_CHANNELS.library.DELETE_BOOK, async (_event, bookId: unknown): Promise<LibraryDeleteResult> => {
    const id = typeof bookId === "number" ? bookId : Number(bookId);
    if (!Number.isFinite(id)) {
      return { success: false };
    }
    removeBook(id);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.library.OPEN_FILE_DIALOG, async (event): Promise<LibraryOpenDialogResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    /**
     * Windows/Linux: `openFile` + `openDirectory` together breaks the shell picker (often folder-only
     * or inconsistent). macOS supports both in one sheet.
     */
    const fileDialogProperties =
      process.platform === "darwin"
        ? (["openFile", "openDirectory", "multiSelections"] as const)
        : (["openFile", "multiSelections"] as const);
    const options: OpenDialogOptions = {
      properties: [...fileDialogProperties],
      filters: [
        {
          name: "Audio Files",
          extensions: ["mp3", "m4a", "m4b", "aac", "flac", "ogg", "opus", "wav", "wma", "aiff"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled) {
      return { canceled: true, paths: [] };
    }
    return { canceled: false, paths: result.filePaths };
  });

  ipcMain.handle(IPC_CHANNELS.library.OPEN_FOLDER_DIALOG, async (event): Promise<LibraryOpenDialogResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const folderDialogProperties =
      process.platform === "darwin" ? (["openDirectory", "multiSelections"] as const) : (["openDirectory"] as const);
    const options: OpenDialogOptions = {
      properties: [...folderDialogProperties],
      title: "Choose folder to add",
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled) {
      return { canceled: true, paths: [] };
    }
    return { canceled: false, paths: result.filePaths };
  });

  ipcMain.handle(IPC_CHANNELS.library.OPEN_COVER_DIALOG, async (event): Promise<LibraryOpenCoverDialogResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      properties: ["openFile"],
      filters: [
        { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
        { name: "All files", extensions: ["*"] },
      ],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }
    return { canceled: false, path: result.filePaths[0] ?? null };
  });

  ipcMain.handle(IPC_CHANNELS.library.UPDATE_METADATA, async (_event, payload: unknown): Promise<BookListItem | null> => {
    const p = payload as MetadataUpdate;
    const bookId = asFiniteNumber(p.bookId);
    if (bookId == null || bookId <= 0) {
      return null;
    }
    const book = getBookById(bookId);
    if (!book) {
      return null;
    }
    let coverPath = book.cover_art_path;
    if (p.cover_art_path !== book.cover_art_path) {
      coverPath = copyUserCoverToLibrary(bookId, p.cover_art_path, book.cover_art_path);
    }
    dbUpdateBookMetadata(bookId, {
      title: p.title,
      author: p.author ?? null,
      narrator: p.narrator ?? null,
      series: p.series ?? null,
      series_order: p.series_order ?? null,
      description: p.description ?? null,
      cover_art_path: coverPath,
    });
    return getBookListItemById(bookId);
  });

  ipcMain.handle(IPC_CHANNELS.library.FETCH_COVER_ART, async (_event, bookId: unknown): Promise<string | null> => {
    const id = asFiniteNumber(bookId);
    if (id == null || id <= 0) {
      return null;
    }
    return fetchCoverArt(id);
  });

  ipcMain.handle(IPC_CHANNELS.library.UPDATE_TAGS, async (_event, payload: unknown): Promise<BookListItem | null> => {
    const p = payload as LibraryUpdateTagsPayload;
    const bookId = asFiniteNumber(p.bookId);
    if (bookId == null || bookId <= 0) {
      return null;
    }
    if (!getBookById(bookId)) {
      return null;
    }
    const tags = sanitizeTagListInput(p.tags);
    updateBookTags(bookId, tags);
    return getBookListItemById(bookId);
  });

  ipcMain.handle(IPC_CHANNELS.library.SET_STATUS, async (_event, payload: unknown): Promise<BookListItem | null> => {
    const p = payload as LibrarySetStatusPayload;
    const bookId = asFiniteNumber(p.bookId);
    if (bookId == null || bookId <= 0) {
      return null;
    }
    const allowed = new Set(["unstarted", "in-progress", "finished"]);
    if (!allowed.has(p.status)) {
      return null;
    }
    if (!getBookById(bookId)) {
      return null;
    }
    updateBookStatus(bookId, p.status);
    return getBookListItemById(bookId);
  });

  ipcMain.handle(IPC_CHANNELS.library.SET_WATCH_FOLDER, async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      properties: ["openDirectory"],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const folder = result.filePaths[0]!;
    persistWatchedFolder(folder);
    stopWatching();
    startWatching(folder);
    return folder;
  });

  ipcMain.handle(IPC_CHANNELS.library.GET_WATCH_FOLDER, async (): Promise<string | null> => {
    return getWatchedFolderFromDb();
  });

  ipcMain.handle(IPC_CHANNELS.library.CLEAR_WATCH_FOLDER, async (): Promise<null> => {
    stopWatching();
    persistWatchedFolder(null);
    return null;
  });
}
