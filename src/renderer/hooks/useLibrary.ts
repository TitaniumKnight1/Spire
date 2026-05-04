import { useCallback } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { BookListItem, LibraryDeleteResult, LibraryIngestResult } from "@shared/library-types";
import { useIPC } from "./useIPC.js";
import { useLibraryStore } from "../store/libraryStore.js";

export function useLibrary(): {
  books: BookListItem[];
  isLoading: boolean;
  viewMode: "grid" | "list";
  selectedBookId: number | null;
  setViewMode: (mode: "grid" | "list") => void;
  setSelectedBook: (id: number | null) => void;
  addPaths: (paths: string[]) => Promise<LibraryIngestResult>;
  deleteBook: (id: number) => Promise<LibraryDeleteResult>;
  refreshLibrary: () => Promise<void>;
  openFileDialog: () => Promise<string[]>;
} {
  const invoke = useIPC().invoke;
  const books = useLibraryStore((s) => s.books);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const selectedBookId = useLibraryStore((s) => s.selectedBookId);
  const setBooks = useLibraryStore((s) => s.setBooks);
  const setLoading = useLibraryStore((s) => s.setLoading);
  const setViewMode = useLibraryStore((s) => s.setViewMode);
  const setSelectedBook = useLibraryStore((s) => s.setSelectedBook);

  const refreshLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<BookListItem[]>(IPC_CHANNELS.library.GET_ALL);
      setBooks(list);
    } finally {
      setLoading(false);
    }
  }, [invoke, setBooks, setLoading]);

  const addPaths = useCallback(
    async (paths: string[]) => {
      const result = await invoke<LibraryIngestResult>(IPC_CHANNELS.library.ADD_PATHS, paths);
      await refreshLibrary();
      return result;
    },
    [invoke, refreshLibrary],
  );

  const deleteBook = useCallback(
    async (id: number) => {
      const result = await invoke<LibraryDeleteResult>(IPC_CHANNELS.library.DELETE_BOOK, id);
      await refreshLibrary();
      if (useLibraryStore.getState().selectedBookId === id) {
        setSelectedBook(null);
      }
      return result;
    },
    [invoke, refreshLibrary, setSelectedBook],
  );

  const openFileDialog = useCallback(async () => {
    const res = await invoke<{ canceled: boolean; paths: string[] }>(
      IPC_CHANNELS.library.OPEN_FILE_DIALOG,
    );
    if (res.canceled) {
      return [];
    }
    return res.paths;
  }, [invoke]);

  return {
    books,
    isLoading,
    viewMode,
    selectedBookId,
    setViewMode,
    setSelectedBook,
    addPaths,
    deleteBook,
    refreshLibrary,
    openFileDialog,
  };
}
