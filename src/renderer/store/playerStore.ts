import { create } from "zustand";
import type { Bookmark, BookFileItem, BookListItem, Chapter, SleepTimerState } from "@shared/library-types";

export type PlayerStoreState = {
  currentBook: BookListItem | null;
  files: BookFileItem[];
  currentFileIndex: number;
  currentFileId: number | null;
  position: number;
  duration: number;
  isPlaying: boolean;
  speed: number;
  chapters: Chapter[];
  currentChapterIndex: number;
  bookmarks: Bookmark[];
  sleepTimer: SleepTimerState | null;
  showChapterPanel: boolean;
  showBookmarksPanel: boolean;
  setBook: (
    book: BookListItem,
    files: BookFileItem[],
    chapters: Chapter[],
    initialFileIndex: number,
    initialPosition: number,
    speed: number,
  ) => void;
  setPosition: (seconds: number) => void;
  setDuration: (seconds: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setChapters: (chapters: Chapter[]) => void;
  setBookmarks: (bookmarks: Bookmark[]) => void;
  setSleepTimer: (state: SleepTimerState | null) => void;
  setCurrentFileIndex: (index: number, fileId: number | null) => void;
  setCurrentChapterIndex: (index: number) => void;
  setShowChapterPanel: (show: boolean) => void;
  setShowBookmarksPanel: (show: boolean) => void;
  nextFile: () => void;
  prevFile: () => void;
};

export const usePlayerStore = create<PlayerStoreState>((set, get) => ({
  currentBook: null,
  files: [],
  currentFileIndex: 0,
  currentFileId: null,
  position: 0,
  duration: 0,
  isPlaying: false,
  speed: 1,
  chapters: [],
  currentChapterIndex: -1,
  bookmarks: [],
  sleepTimer: null,
  showChapterPanel: false,
  showBookmarksPanel: false,

  setBook: (book, files, chapters, initialFileIndex, initialPosition, speed) => {
    const safeIndex = Math.max(0, Math.min(initialFileIndex, Math.max(0, files.length - 1)));
    const fid = files[safeIndex]?.id ?? null;
    set({
      currentBook: book,
      files,
      chapters,
      currentFileIndex: safeIndex,
      currentFileId: fid,
      position: initialPosition,
      duration: 0,
      isPlaying: false,
      speed,
      currentChapterIndex: -1,
    });
  },

  setPosition: (seconds) => set({ position: seconds }),
  setDuration: (seconds) => set({ duration: seconds }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setSpeed: (speed) => set({ speed }),
  setChapters: (chapters) => set({ chapters }),
  setBookmarks: (bookmarks) => set({ bookmarks }),
  setSleepTimer: (state) => set({ sleepTimer: state }),
  setCurrentFileIndex: (index, fileId) => set({ currentFileIndex: index, currentFileId: fileId }),
  setCurrentChapterIndex: (index) => set({ currentChapterIndex: index }),
  setShowChapterPanel: (show) => set({ showChapterPanel: show }),
  setShowBookmarksPanel: (show) => set({ showBookmarksPanel: show }),

  nextFile: () => {
    const { currentFileIndex, files } = get();
    if (currentFileIndex >= files.length - 1) {
      return;
    }
    const next = currentFileIndex + 1;
    const fid = files[next]?.id ?? null;
    set({ currentFileIndex: next, currentFileId: fid, position: 0, currentChapterIndex: -1 });
  },

  prevFile: () => {
    const { currentFileIndex, files } = get();
    if (currentFileIndex <= 0) {
      return;
    }
    const prev = currentFileIndex - 1;
    const fid = files[prev]?.id ?? null;
    set({ currentFileIndex: prev, currentFileId: fid, position: 0, currentChapterIndex: -1 });
  },
}));
