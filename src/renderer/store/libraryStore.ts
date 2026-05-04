import { create } from "zustand";
import type { BookListItem, FilterState } from "@shared/library-types";

const defaultFilterState: FilterState = {
  query: "",
  status: "all",
  tag: null,
  series: null,
  groupBySeries: false,
};

export function computeFilteredBooks(books: BookListItem[], filters: FilterState): BookListItem[] {
  const q = filters.query.trim().toLowerCase();
  return books.filter((book) => {
    if (q) {
      const hay = `${book.title}\n${book.author ?? ""}\n${book.narrator ?? ""}`.toLowerCase();
      if (!hay.includes(q)) {
        return false;
      }
    }
    if (filters.status !== "all" && book.status !== filters.status) {
      return false;
    }
    if (filters.tag && !book.tags.includes(filters.tag)) {
      return false;
    }
    if (!filters.groupBySeries && filters.series) {
      if ((book.series ?? "") !== filters.series) {
        return false;
      }
    }
    return true;
  });
}

type LibraryState = {
  books: BookListItem[];
  isLoading: boolean;
  viewMode: "grid" | "list";
  selectedBookId: number | null;
  filters: FilterState;
  setBooks: (books: BookListItem[]) => void;
  setLoading: (v: boolean) => void;
  setViewMode: (mode: "grid" | "list") => void;
  setSelectedBook: (id: number | null) => void;
  setFilters: (partial: Partial<FilterState>) => void;
  resetFilters: () => void;
};

export const useLibraryStore = create<LibraryState>((set) => ({
  books: [],
  isLoading: false,
  viewMode: "grid",
  selectedBookId: null,
  filters: { ...defaultFilterState },
  setBooks: (books) => set({ books }),
  setLoading: (isLoading) => set({ isLoading }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSelectedBook: (selectedBookId) => set({ selectedBookId }),
  setFilters: (partial) =>
    set((s) => {
      const next: FilterState = { ...s.filters, ...partial };
      if (partial.groupBySeries === true) {
        next.series = null;
      }
      return { filters: next };
    }),
  resetFilters: () => set({ filters: { ...defaultFilterState } }),
}));
