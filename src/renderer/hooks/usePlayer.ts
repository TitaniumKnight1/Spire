import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Howl } from "howler";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { BookDetailPayload, BookFileItem, Bookmark, BookListItem, Chapter } from "@shared/library-types";
import { useIPC } from "./useIPC.js";
import { pathToFileUrlHref } from "../utils/pathToFileUrl.js";
import { usePlayerStore } from "../store/playerStore.js";

const PROGRESS_DEBOUNCE_MS = 5000;
const POSITION_TICK_MS = 500;

export const SPEED_CYCLE_SEQUENCE = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 0.75, 0.5] as const;

function sortFiles(files: BookFileItem[]): BookFileItem[] {
  return [...files].sort((a, b) => {
    const ta = a.track_order;
    const tb = b.track_order;
    if (ta != null && tb != null && ta !== tb) {
      return ta - tb;
    }
    if (ta != null && tb == null) {
      return -1;
    }
    if (ta == null && tb != null) {
      return 1;
    }
    return a.file_path.localeCompare(b.file_path, undefined, { sensitivity: "base" });
  });
}

function sortChapters(chapters: Chapter[], files: BookFileItem[]): Chapter[] {
  const fileOrder = new Map<number, number>();
  files.forEach((f, i) => fileOrder.set(f.id, i));
  return [...chapters].sort((a, b) => {
    const oa = fileOrder.get(a.file_id) ?? 9999;
    const ob = fileOrder.get(b.file_id) ?? 9999;
    if (oa !== ob) {
      return oa - ob;
    }
    return (a.start_time ?? 0) - (b.start_time ?? 0);
  });
}

function chapterEndSeconds(
  ch: Chapter,
  sortedChapters: Chapter[],
  chGlobalIndex: number,
  fileDuration: number,
): number {
  const nextSameFile = sortedChapters.slice(chGlobalIndex + 1).find((c) => c.file_id === ch.file_id);
  if (nextSameFile?.start_time != null) {
    return nextSameFile.start_time;
  }
  if (ch.end_time != null && Number.isFinite(ch.end_time)) {
    return ch.end_time;
  }
  return fileDuration > 0 ? fileDuration : Number.POSITIVE_INFINITY;
}

function findCurrentChapterIndex(
  sortedChapters: Chapter[],
  currentFileId: number | null,
  position: number,
  fileDuration: number,
): number {
  if (currentFileId == null || sortedChapters.length === 0) {
    return -1;
  }
  let best = -1;
  for (let i = 0; i < sortedChapters.length; i++) {
    const ch = sortedChapters[i]!;
    if (ch.file_id !== currentFileId) {
      continue;
    }
    const start = ch.start_time ?? 0;
    const end = chapterEndSeconds(ch, sortedChapters, i, fileDuration);
    if (position >= start && position < end) {
      return i;
    }
    if (start <= position) {
      best = i;
    }
  }
  return best;
}

function formatsFromPath(filePath: string): string[] {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  return ext ? [ext] : [];
}

function toBookListItem(detail: BookDetailPayload): BookListItem {
  const { book, progress_percent } = detail;
  const prog = detail.progress;
  return {
    id: book.id,
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
    position_seconds: prog?.position_seconds ?? 0,
    completed_at: prog?.completed_at ?? null,
    progress_percent,
  };
}

function usePlayerCore(): {
  loadBook: (bookId: number) => Promise<void>;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seekTo: (seconds: number) => void;
  seekToChapter: (chapter: Chapter) => void;
  seekToBookmark: (bookmark: Bookmark) => Promise<void>;
  seekBy: (deltaSeconds: number) => void;
  nextFile: () => void;
  prevFile: () => void;
  nextChapter: () => void;
  prevChapter: () => void;
  setSpeed: (rate: number) => void;
  cycleSpeed: () => void;
  addBookmark: (note?: string) => Promise<void>;
  deleteBookmark: (id: number) => Promise<void>;
  setSleepTimer: (config: { mode: "minutes" | "end-of-chapter" | "end-of-book"; minutes?: number }) => void;
  clearSleepTimer: () => void;
} {
  const { invoke, subscribe } = useIPC();
  const howlRef = useRef<Howl | null>(null);
  const sortedFilesRef = useRef<BookFileItem[]>([]);
  const sortedChaptersRef = useRef<Chapter[]>([]);
  const positionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProgressFlushRef = useRef<number>(Date.now());
  const playAfterLoadRef = useRef(false);
  const mountHowlRef = useRef<(fileIndex: number, seekSeconds: number, rate: number, autoplay: boolean) => void>(() => {});

  const clearPositionInterval = useCallback(() => {
    if (positionIntervalRef.current != null) {
      clearInterval(positionIntervalRef.current);
      positionIntervalRef.current = null;
    }
  }, []);

  const stopHowl = useCallback(() => {
    const h = howlRef.current;
    if (h) {
      h.stop();
      h.unload();
      howlRef.current = null;
    }
  }, []);

  const flushProgress = useCallback(
    async (force: boolean) => {
      const store = usePlayerStore.getState();
      const book = store.currentBook;
      const fileId = store.currentFileId;
      if (!book) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastProgressFlushRef.current < PROGRESS_DEBOUNCE_MS) {
        return;
      }
      lastProgressFlushRef.current = now;
      const howl = howlRef.current;
      let pos = store.position;
      if (howl) {
        const s = howl.seek() as number;
        if (typeof s === "number" && Number.isFinite(s)) {
          pos = s;
        }
      }
      await invoke(IPC_CHANNELS.playback.SAVE_PROGRESS, {
        book_id: book.id,
        current_file_id: fileId,
        position_seconds: pos,
        playback_speed: store.speed,
      });
    },
    [invoke],
  );

  const startPositionTick = useCallback(() => {
    clearPositionInterval();
    positionIntervalRef.current = setInterval(() => {
      const howl = howlRef.current;
      const store = usePlayerStore.getState();
      if (!howl || !howl.playing()) {
        return;
      }
      const raw = howl.seek() as number;
      const pos = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      const durRaw = howl.duration();
      const dur = typeof durRaw === "number" && durRaw > 0 ? durRaw : store.duration;
      store.setPosition(pos);
      if (dur > 0) {
        store.setDuration(dur);
      }
      const chIdx = findCurrentChapterIndex(sortedChaptersRef.current, store.currentFileId, pos, dur);
      store.setCurrentChapterIndex(chIdx);

      void flushProgress(false);

      const sleep = store.sleepTimer;
      if (sleep?.mode === "minutes" && sleep.endsAt != null && Date.now() >= sleep.endsAt) {
        howl.pause();
        store.setIsPlaying(false);
        store.setSleepTimer(null);
        void flushProgress(true);
        clearPositionInterval();
        return;
      }

      if (sleep?.mode === "end-of-chapter" && chIdx >= 0) {
        const ch = sortedChaptersRef.current[chIdx];
        if (ch) {
          const end = chapterEndSeconds(ch, sortedChaptersRef.current, chIdx, dur);
          if (Number.isFinite(end) && pos >= end - 0.05) {
            howl.pause();
            store.setIsPlaying(false);
            store.setSleepTimer(null);
            void flushProgress(true);
            clearPositionInterval();
          }
        }
      }

      if (sleep?.mode === "end-of-book") {
        const lastIx = sortedFilesRef.current.length - 1;
        const isLast = store.currentFileIndex >= lastIx && lastIx >= 0 && dur > 0 && pos >= dur - 0.25;
        if (isLast) {
          howl.pause();
          store.setIsPlaying(false);
          store.setSleepTimer(null);
          void flushProgress(true);
          clearPositionInterval();
        }
      }
    }, POSITION_TICK_MS);
  }, [clearPositionInterval, flushProgress]);

  const mountHowl = useCallback(
    (fileIndex: number, seekSeconds: number, rate: number, autoplay: boolean) => {
      stopHowl();
      clearPositionInterval();
      const files = sortedFilesRef.current;
      const file = files[fileIndex];
      if (!file) {
        return;
      }
      const src = pathToFileUrlHref(file.file_path);
      const howl = new Howl({
        src: [src],
        html5: true,
        format: formatsFromPath(file.file_path),
      });
      howlRef.current = howl;
      usePlayerStore.getState().setCurrentFileIndex(fileIndex, file.id);

      howl.once("load", () => {
        const d = howl.duration();
        const dur = typeof d === "number" && d > 0 ? d : 0;
        if (dur > 0) {
          usePlayerStore.getState().setDuration(dur);
        }
        const maxSeek = dur > 0 ? dur : seekSeconds;
        const clamped = Math.max(0, Math.min(seekSeconds, maxSeek > 0 ? maxSeek : seekSeconds));
        howl.seek(clamped);
        usePlayerStore.getState().setPosition(clamped);
        howl.rate(rate);
        const chIdx = findCurrentChapterIndex(sortedChaptersRef.current, file.id, clamped, dur);
        usePlayerStore.getState().setCurrentChapterIndex(chIdx);
        const wantPlay = autoplay || playAfterLoadRef.current;
        playAfterLoadRef.current = false;
        if (wantPlay) {
          howl.play();
          usePlayerStore.getState().setIsPlaying(true);
          startPositionTick();
        }
      });

      howl.on("loaderror", (_id: unknown, err: unknown) => {
        console.warn("[spire] Howl loaderror:", file.file_path, err);
      });

      howl.on("end", () => {
        clearPositionInterval();
        void flushProgress(true);
        const st = usePlayerStore.getState();
        const endedIndex = fileIndex;
        const last = sortedFilesRef.current.length - 1;
        if (endedIndex < last) {
          const speed = st.speed;
          usePlayerStore.getState().nextFile();
          mountHowlRef.current(endedIndex + 1, 0, speed, true);
          return;
        }
        void invoke(IPC_CHANNELS.playback.MARK_COMPLETE, st.currentBook?.id);
        st.setSleepTimer(null);
        st.setIsPlaying(false);
        stopHowl();
      });
    },
    [clearPositionInterval, flushProgress, invoke, startPositionTick, stopHowl],
  );

  useLayoutEffect(() => {
    mountHowlRef.current = mountHowl;
  }, [mountHowl]);

  const refreshBookmarks = useCallback(
    async (bookId: number) => {
      const list = await invoke<Bookmark[]>(IPC_CHANNELS.playback.GET_BOOKMARKS, bookId);
      usePlayerStore.getState().setBookmarks(list);
    },
    [invoke],
  );

  const loadBook = useCallback(
    async (bookId: number) => {
      clearPositionInterval();
      await flushProgress(true);
      stopHowl();
      usePlayerStore.getState().setIsPlaying(false);
      const detail = await invoke<BookDetailPayload | null>(IPC_CHANNELS.library.GET_BOOK, bookId);
      if (!detail) {
        return;
      }
      const bookmarks = await invoke<Bookmark[]>(IPC_CHANNELS.playback.GET_BOOKMARKS, bookId);
      const sorted = sortFiles(detail.files);
      const chapters = sortChapters(detail.chapters, sorted);
      sortedFilesRef.current = sorted;
      sortedChaptersRef.current = chapters;

      let fileIndex = 0;
      const prog = detail.progress;
      if (prog?.current_file_id) {
        const ix = sorted.findIndex((f) => f.id === prog.current_file_id);
        if (ix >= 0) {
          fileIndex = ix;
        }
      }
      const file = sorted[fileIndex];
      let initialSeek = 0;
      if (prog && file && prog.current_file_id === file.id) {
        initialSeek = prog.position_seconds ?? 0;
      }
      const speed = Math.min(3.5, Math.max(0.5, prog?.playback_speed ?? 1));
      const bookItem = toBookListItem(detail);
      usePlayerStore.getState().setBook(bookItem, sorted, chapters, fileIndex, initialSeek, speed);
      usePlayerStore.getState().setBookmarks(bookmarks);
      playAfterLoadRef.current = false;
      mountHowl(fileIndex, initialSeek, speed, false);
    },
    [clearPositionInterval, flushProgress, invoke, mountHowl, stopHowl],
  );

  const play = useCallback(() => {
    const howl = howlRef.current;
    if (!howl) {
      playAfterLoadRef.current = true;
      return;
    }
    howl.play();
    usePlayerStore.getState().setIsPlaying(true);
    startPositionTick();
  }, [startPositionTick]);

  const pause = useCallback(() => {
    const howl = howlRef.current;
    if (howl) {
      howl.pause();
    }
    clearPositionInterval();
    usePlayerStore.getState().setIsPlaying(false);
    void flushProgress(true);
  }, [clearPositionInterval, flushProgress]);

  const togglePlay = useCallback(() => {
    const howl = howlRef.current;
    if (howl?.playing()) {
      pause();
    } else {
      play();
    }
  }, [pause, play]);

  const seekTo = useCallback(
    (seconds: number) => {
      const howl = howlRef.current;
      const store = usePlayerStore.getState();
      const dur = howl?.duration() || store.duration;
      const max = typeof dur === "number" && dur > 0 ? dur : seconds + 1;
      const clamped = Math.max(0, Math.min(seconds, max));
      if (howl) {
        howl.seek(clamped);
      }
      store.setPosition(clamped);
      const chIdx = findCurrentChapterIndex(
        sortedChaptersRef.current,
        store.currentFileId,
        clamped,
        typeof dur === "number" && dur > 0 ? dur : store.duration,
      );
      store.setCurrentChapterIndex(chIdx);
      void flushProgress(true);
    },
    [flushProgress],
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const howl = howlRef.current;
      const store = usePlayerStore.getState();
      const cur = (howl ? (howl.seek() as number) : store.position) || 0;
      seekTo(cur + deltaSeconds);
    },
    [seekTo],
  );

  const seekToChapter = useCallback(
    (chapter: Chapter) => {
      const files = sortedFilesRef.current;
      const ix = files.findIndex((f) => f.id === chapter.file_id);
      if (ix < 0) {
        return;
      }
      const store = usePlayerStore.getState();
      const wasPlaying = store.isPlaying;
      const speed = store.speed;
      const start = chapter.start_time ?? 0;
      if (ix !== store.currentFileIndex) {
        void flushProgress(true);
        mountHowlRef.current(ix, start, speed, wasPlaying);
      } else {
        seekTo(start);
      }
    },
    [flushProgress, seekTo],
  );

  const nextFile = useCallback(() => {
    const store = usePlayerStore.getState();
    const i = store.currentFileIndex;
    if (i >= sortedFilesRef.current.length - 1) {
      return;
    }
    void flushProgress(true);
    const playing = store.isPlaying;
    const speed = store.speed;
    store.nextFile();
    mountHowlRef.current(i + 1, 0, speed, playing);
  }, [flushProgress]);

  const prevFile = useCallback(() => {
    const store = usePlayerStore.getState();
    const i = store.currentFileIndex;
    if (i <= 0) {
      return;
    }
    void flushProgress(true);
    const playing = store.isPlaying;
    const speed = store.speed;
    store.prevFile();
    mountHowlRef.current(i - 1, 0, speed, playing);
  }, [flushProgress]);

  const nextChapter = useCallback(() => {
    const store = usePlayerStore.getState();
    const list = sortedChaptersRef.current;
    if (list.length === 0) {
      return;
    }
    const cur = store.currentChapterIndex;
    if (cur < 0) {
      const first = list[0];
      if (first) {
        seekToChapter(first);
      }
      return;
    }
    const next = list[cur + 1];
    if (next) {
      seekToChapter(next);
    }
  }, [seekToChapter]);

  const prevChapter = useCallback(() => {
    const store = usePlayerStore.getState();
    const list = sortedChaptersRef.current;
    if (list.length === 0) {
      return;
    }
    const cur = store.currentChapterIndex;
    if (cur <= 0) {
      return;
    }
    const target = list[cur - 1];
    if (target) {
      seekToChapter(target);
    }
  }, [seekToChapter]);

  const seekToBookmark = useCallback(
    async (bookmark: Bookmark) => {
      if (bookmark.file_id == null) {
        seekTo(bookmark.position_seconds ?? 0);
        return;
      }
      const files = sortedFilesRef.current;
      const ix = files.findIndex((f) => f.id === bookmark.file_id);
      if (ix < 0) {
        seekTo(bookmark.position_seconds ?? 0);
        return;
      }
      const store = usePlayerStore.getState();
      const wasPlaying = store.isPlaying;
      const speed = store.speed;
      const pos = bookmark.position_seconds ?? 0;
      if (ix !== store.currentFileIndex) {
        void flushProgress(true);
        mountHowlRef.current(ix, pos, speed, wasPlaying);
      } else {
        seekTo(pos);
      }
    },
    [flushProgress, seekTo],
  );

  const setSpeed = useCallback(
    (rate: number) => {
      const clamped = Math.min(3.5, Math.max(0.5, rate));
      howlRef.current?.rate(clamped);
      usePlayerStore.getState().setSpeed(clamped);
      void flushProgress(true);
    },
    [flushProgress],
  );

  const cycleSpeed = useCallback(() => {
    const cur = usePlayerStore.getState().speed;
    const idx = SPEED_CYCLE_SEQUENCE.findIndex((s) => Math.abs(s - cur) < 0.02);
    const next = SPEED_CYCLE_SEQUENCE[(idx >= 0 ? idx + 1 : 0) % SPEED_CYCLE_SEQUENCE.length]!;
    setSpeed(next);
  }, [setSpeed]);

  const addBookmark = useCallback(
    async (note?: string) => {
      const store = usePlayerStore.getState();
      const book = store.currentBook;
      const fid = store.currentFileId;
      if (!book || fid == null) {
        return;
      }
      const howl = howlRef.current;
      const raw = howl ? (howl.seek() as number) : store.position;
      const pos = typeof raw === "number" && Number.isFinite(raw) ? raw : store.position;
      await invoke(IPC_CHANNELS.playback.ADD_BOOKMARK, {
        book_id: book.id,
        file_id: fid,
        position_seconds: pos,
        note: note ?? null,
      });
      await refreshBookmarks(book.id);
      void flushProgress(true);
    },
    [flushProgress, invoke, refreshBookmarks],
  );

  const deleteBookmark = useCallback(
    async (id: number) => {
      await invoke(IPC_CHANNELS.playback.DELETE_BOOKMARK, id);
      const book = usePlayerStore.getState().currentBook;
      if (book) {
        await refreshBookmarks(book.id);
      }
    },
    [invoke, refreshBookmarks],
  );

  const setSleepTimer = useCallback((config: { mode: "minutes" | "end-of-chapter" | "end-of-book"; minutes?: number }) => {
    if (config.mode === "minutes") {
      const m = config.minutes ?? 1;
      const endsAt = Date.now() + m * 60_000;
      usePlayerStore.getState().setSleepTimer({ mode: "minutes", minutes: m, endsAt });
      return;
    }
    usePlayerStore.getState().setSleepTimer({ mode: config.mode });
  }, []);

  const clearSleepTimer = useCallback(() => {
    usePlayerStore.getState().setSleepTimer(null);
  }, []);

  useEffect(() => {
    const unsub = subscribe(IPC_CHANNELS.playback.MEDIA_KEY, (...args: unknown[]) => {
      const action = args[0];
      if (action === "play-pause") {
        togglePlay();
      } else if (action === "next") {
        nextFile();
      } else if (action === "prev") {
        prevFile();
      }
    });
    return () => unsub();
  }, [nextFile, prevFile, subscribe, togglePlay]);

  useEffect(
    () => () => {
      clearPositionInterval();
      void flushProgress(true);
      stopHowl();
    },
    [clearPositionInterval, flushProgress, stopHowl],
  );

  return {
    loadBook,
    play,
    pause,
    togglePlay,
    seekTo,
    seekToChapter,
    seekToBookmark,
    seekBy,
    nextFile,
    prevFile,
    nextChapter,
    prevChapter,
    setSpeed,
    cycleSpeed,
    addBookmark,
    deleteBookmark,
    setSleepTimer,
    clearSleepTimer,
  };
}

export type PlayerApi = ReturnType<typeof usePlayerCore>;

const PlayerApiContext = createContext<PlayerApi | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }): ReactElement {
  const api = usePlayerCore();
  return createElement(PlayerApiContext.Provider, { value: api }, children);
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerApiContext);
  if (!ctx) {
    throw new Error("usePlayer must be used within PlayerProvider");
  }
  return ctx;
}
