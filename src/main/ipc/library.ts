import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type {
  BookDetailPayload,
  BookListItem,
  LibraryDeleteResult,
  LibraryIngestResult,
  LibraryOpenDialogResult,
} from "../../shared/library-types.js";
import { getBookDetail, getLibrary, ingestPaths, removeBook } from "../services/library.js";

export function registerLibraryIpc(): void {
  ipcMain.handle(IPC_CHANNELS.library.ADD_PATHS, async (_event, paths: unknown): Promise<LibraryIngestResult> => {
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : [];
    return ingestPaths(list);
  });

  ipcMain.handle(IPC_CHANNELS.library.GET_ALL, async (): Promise<BookListItem[]> => {
    return getLibrary();
  });

  ipcMain.handle(IPC_CHANNELS.library.GET_BOOK, async (_event, bookId: unknown): Promise<BookDetailPayload | null> => {
    const id = typeof bookId === "number" ? bookId : Number(bookId);
    if (!Number.isFinite(id)) {
      return null;
    }
    return getBookDetail(id);
  });

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
    const options: OpenDialogOptions = {
      properties: ["openFile", "openDirectory", "multiSelections"],
      filters: [{ name: "Audio", extensions: ["mp3", "m4a", "m4b", "aac", "flac", "ogg", "opus", "wav"] }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled) {
      return { canceled: true, paths: [] };
    }
    return { canceled: false, paths: result.filePaths };
  });
}
