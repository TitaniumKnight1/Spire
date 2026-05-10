import { create } from "zustand";
import type {
  Bookmark,
  BookFileItem,
  BookListItem,
  Chapter,
  EqPreset,
  SleepTimerState,
} from "@shared/library-types";

export type PlayerStoreState = {
  currentBook: BookListItem | null;
  files: BookFileItem[];
  currentFileIndex: number;
  currentFileId: number | null;
  position: number;
  duration: number;
  isPlaying: boolean;
  speed: number;
  /** mpv volume 0–100 (persisted in app settings). */
  volume: number;
  chapters: Chapter[];
  currentChapterIndex: number;
  bookmarks: Bookmark[];
  sleepTimer: SleepTimerState | null;
  showChapterPanel: boolean;
  showBookmarksPanel: boolean;
  skipSilenceEnabled: boolean;
  eqPreset: EqPreset;
  /** Main-process file resolution / missing-file message for the current track. */
  playbackError: string | null;
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
  setVolume: (level: number) => void;
  setChapters: (chapters: Chapter[]) => void;
  setBookmarks: (bookmarks: Bookmark[]) => void;
  setSleepTimer: (state: SleepTimerState | null) => void;
  setCurrentFileIndex: (index: number, fileId: number | null) => void;
  setCurrentChapterIndex: (index: number) => void;
  setShowChapterPanel: (show: boolean) => void;
  setShowBookmarksPanel: (show: boolean) => void;
  setSkipSilenceEnabled: (enabled: boolean) => void;
  toggleSkipSilence: () => void;
  setEqPreset: (preset: EqPreset) => void;
  setPlaybackError: (message: string | null) => void;
  /** Sync list/metadata fields when the library row for the active book changes (keep live playback position). */
  mergeCurrentBookFromLibrary: (book: BookListItem) => void;
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
  volume: 100,
  chapters: [],
  currentChapterIndex: -1,
  bookmarks: [],
  sleepTimer: null,
  showChapterPanel: false,
  showBookmarksPanel: false,
  skipSilenceEnabled: false,
  eqPreset: "flat",
  playbackError: null,

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
      playbackError: null,
    });
  },

  setPosition: (seconds) => set({ position: seconds }),
  setDuration: (seconds) => set({ duration: seconds }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setSpeed: (speed) => set({ speed }),
  setVolume: (level) => {
    const n = Number.isFinite(level) ? level : 100;
    set({ volume: Math.min(100, Math.max(0, Math.round(n))) });
  },
  setChapters: (chapters) => set({ chapters }),
  setBookmarks: (bookmarks) => set({ bookmarks }),
  setSleepTimer: (state) => set({ sleepTimer: state }),
  setCurrentFileIndex: (index, fileId) => set({ currentFileIndex: index, currentFileId: fileId }),
  setCurrentChapterIndex: (index) => set({ currentChapterIndex: index }),
  setShowChapterPanel: (show) => set({ showChapterPanel: show }),
  setShowBookmarksPanel: (show) => set({ showBookmarksPanel: show }),
  setSkipSilenceEnabled: (enabled) => set({ skipSilenceEnabled: enabled }),
  toggleSkipSilence: () => set((s) => ({ skipSilenceEnabled: !s.skipSilenceEnabled })),
  setEqPreset: (preset) => set({ eqPreset: preset }),
  setPlaybackError: (message) => set({ playbackError: message }),

  mergeCurrentBookFromLibrary: (book) =>
    set((s) => {
      if (!s.currentBook || s.currentBook.id !== book.id) {
        return {};
      }
      return {
        currentBook: {
          ...s.currentBook,
          title: book.title,
          author: book.author,
          narrator: book.narrator,
          series: book.series,
          series_order: book.series_order,
          cover_art_url: book.cover_art_url,
          description: book.description,
          status: book.status,
          tags: book.tags,
          date_added: book.date_added,
          total_duration: book.total_duration,
          completed_at: book.completed_at,
          progress_percent: book.progress_percent,
        },
      };
    }),

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
