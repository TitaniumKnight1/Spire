import { create } from "zustand";
import type { BookListItem } from "@shared/library-types";

type LibraryState = {
  books: BookListItem[];
  isLoading: boolean;
  viewMode: "grid" | "list";
  selectedBookId: number | null;
  setBooks: (books: BookListItem[]) => void;
  setLoading: (v: boolean) => void;
  setViewMode: (mode: "grid" | "list") => void;
  setSelectedBook: (id: number | null) => void;
};

export const useLibraryStore = create<LibraryState>((set) => ({
  books: [],
  isLoading: false,
  viewMode: "grid",
  selectedBookId: null,
  setBooks: (books) => set({ books }),
  setLoading: (isLoading) => set({ isLoading }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSelectedBook: (selectedBookId) => set({ selectedBookId }),
}));
