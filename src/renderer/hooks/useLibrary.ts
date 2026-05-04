import { useCallback } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type {
  BookListItem,
  FilterState,
  LibraryDeleteResult,
  LibraryIngestResult,
  LibraryOpenCoverDialogResult,
  LibrarySetStatusPayload,
  LibraryUpdateTagsPayload,
  MetadataUpdate,
} from "@shared/library-types";
import { useIPC } from "./useIPC.js";
import { useLibraryStore } from "../store/libraryStore.js";

export function useLibrary(): {
  books: BookListItem[];
  isLoading: boolean;
  viewMode: "grid" | "list";
  selectedBookId: number | null;
  filters: FilterState;
  setViewMode: (mode: "grid" | "list") => void;
  setSelectedBook: (id: number | null) => void;
  setFilters: (partial: Partial<FilterState>) => void;
  resetFilters: () => void;
  addPaths: (paths: string[]) => Promise<LibraryIngestResult>;
  deleteBook: (id: number) => Promise<LibraryDeleteResult>;
  refreshLibrary: () => Promise<void>;
  openFileDialog: () => Promise<string[]>;
  openCoverDialog: () => Promise<LibraryOpenCoverDialogResult>;
  updateMetadata: (payload: MetadataUpdate) => Promise<BookListItem | null>;
  updateTags: (payload: LibraryUpdateTagsPayload) => Promise<BookListItem | null>;
  setBookStatus: (payload: LibrarySetStatusPayload) => Promise<BookListItem | null>;
  fetchCoverArt: (bookId: number) => Promise<string | null>;
  getWatchFolder: () => Promise<string | null>;
  setWatchFolder: () => Promise<string | null>;
  clearWatchFolder: () => Promise<null>;
} {
  const invoke = useIPC().invoke;
  const books = useLibraryStore((s) => s.books);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const selectedBookId = useLibraryStore((s) => s.selectedBookId);
  const filters = useLibraryStore((s) => s.filters);
  const setBooks = useLibraryStore((s) => s.setBooks);
  const setLoading = useLibraryStore((s) => s.setLoading);
  const setViewMode = useLibraryStore((s) => s.setViewMode);
  const setSelectedBook = useLibraryStore((s) => s.setSelectedBook);
  const setFilters = useLibraryStore((s) => s.setFilters);
  const resetFilters = useLibraryStore((s) => s.resetFilters);

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
    const res = await invoke<{ canceled: boolean; paths: string[] }>(IPC_CHANNELS.library.OPEN_FILE_DIALOG);
    if (res.canceled) {
      return [];
    }
    return res.paths;
  }, [invoke]);

  const openCoverDialog = useCallback(async () => {
    return invoke<LibraryOpenCoverDialogResult>(IPC_CHANNELS.library.OPEN_COVER_DIALOG);
  }, [invoke]);

  const updateMetadata = useCallback(
    async (payload: MetadataUpdate) => {
      const updated = await invoke<BookListItem | null>(IPC_CHANNELS.library.UPDATE_METADATA, payload);
      await refreshLibrary();
      return updated;
    },
    [invoke, refreshLibrary],
  );

  const updateTags = useCallback(
    async (payload: LibraryUpdateTagsPayload) => {
      const updated = await invoke<BookListItem | null>(IPC_CHANNELS.library.UPDATE_TAGS, payload);
      await refreshLibrary();
      return updated;
    },
    [invoke, refreshLibrary],
  );

  const setBookStatus = useCallback(
    async (payload: LibrarySetStatusPayload) => {
      const updated = await invoke<BookListItem | null>(IPC_CHANNELS.library.SET_STATUS, payload);
      await refreshLibrary();
      return updated;
    },
    [invoke, refreshLibrary],
  );

  const fetchCoverArt = useCallback(
    async (bookId: number) => {
      const path = await invoke<string | null>(IPC_CHANNELS.library.FETCH_COVER_ART, bookId);
      await refreshLibrary();
      return path;
    },
    [invoke, refreshLibrary],
  );

  const getWatchFolder = useCallback(async () => {
    return invoke<string | null>(IPC_CHANNELS.library.GET_WATCH_FOLDER);
  }, [invoke]);

  const setWatchFolder = useCallback(async () => {
    return invoke<string | null>(IPC_CHANNELS.library.SET_WATCH_FOLDER);
  }, [invoke]);

  const clearWatchFolder = useCallback(async () => {
    return invoke<null>(IPC_CHANNELS.library.CLEAR_WATCH_FOLDER);
  }, [invoke]);

  return {
    books,
    isLoading,
    viewMode,
    selectedBookId,
    filters,
    setViewMode,
    setSelectedBook,
    setFilters,
    resetFilters,
    addPaths,
    deleteBook,
    refreshLibrary,
    openFileDialog,
    openCoverDialog,
    updateMetadata,
    updateTags,
    setBookStatus,
    fetchCoverArt,
    getWatchFolder,
    setWatchFolder,
    clearWatchFolder,
  };
}
