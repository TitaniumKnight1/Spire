import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type {
  BookDetailPayload,
  BookFileItem,
  Bookmark,
  BookListItem,
  Chapter,
  EqPreset,
  PlayerStatePushPayload,
  ShortcutMap,
} from "@shared/library-types";
import { useIPC } from "./useIPC.js";
import { useAudioElement } from "./useAudioElement.js";
import { usePlayerStore } from "../store/playerStore.js";
import { acceleratorMatchesKeyboard } from "../utils/appShortcuts.js";

const PROGRESS_DEBOUNCE_MS = 5000;
const VOLUME_PERSIST_DEBOUNCE_MS = 400;

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

function chapterEndSeconds(ch: Chapter, sortedChapters: Chapter[], chapterIndex: number, fileDuration: number): number {
  const nextSameFile = sortedChapters.slice(chapterIndex + 1).find((c) => c.file_id === ch.file_id);
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type UsePlayerCoreApi = {
  currentBook: BookListItem | null;
  currentFile: BookFileItem | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  speed: number;
  error: MediaError | null;
  loadBook: (bookId: number) => Promise<void>;
  play: (book?: BookListItem, fileIndex?: number, startPosition?: number) => Promise<void>;
  pause: () => void;
  resume: () => void;
  togglePlay: () => void;
  seekTo: (seconds: number) => void;
  seek: (seconds: number) => void;
  seekToChapter: (chapter: Chapter) => void;
  skipToChapter: (chapter: Chapter) => void;
  seekToBookmark: (bookmark: Bookmark) => Promise<void>;
  seekBy: (deltaSeconds: number) => void;
  skipForward: (seconds?: number) => void;
  skipBack: (seconds?: number) => void;
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
  toggleSkipSilence: () => Promise<void>;
  setEqPresetAndPersist: (preset: EqPreset) => Promise<void>;
  /** Updates store, mpv volume, and persists (debounced) to app settings. */
  setVolumeLevel: (level: number) => void;
};

function usePlayerCore(): UsePlayerCoreApi {
  const { invoke, subscribe } = useIPC();
  const audio = useAudioElement();
  const [mediaError, setMediaError] = useState<MediaError | null>(null);

  const logMediaDebug = useCallback(
    (event: string, extra: Record<string, unknown> = {}) => {
      void invoke(IPC_CHANNELS.playback.MEDIA_DEBUG_LOG, {
        source: "usePlayer",
        event,
        ...extra,
      }).catch(() => {});
    },
    [invoke],
  );

  const currentBook = usePlayerStore((s) => s.currentBook);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const speed = usePlayerStore((s) => s.speed);
  const currentFileIndex = usePlayerStore((s) => s.currentFileIndex);
  const files = usePlayerStore((s) => s.files);

  const currentFile = files[currentFileIndex] ?? null;

  const sortedFilesRef = useRef<BookFileItem[]>([]);
  const sortedChaptersRef = useRef<Chapter[]>([]);
  const pendingSeekRef = useRef<number | null>(null);
  const playAfterCanPlayRef = useRef(false);
  const pendingMountRef = useRef(0);
  const lastProgressFlushRef = useRef(0);
  const shortcutsRef = useRef<ShortcutMap | null>(null);
  const volumePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportPlaybackState = useCallback(async () => {
    const st = usePlayerStore.getState();
    const book = st.currentBook;
    const payload: PlayerStatePushPayload = {
      isPlaying: st.isPlaying,
      title: book?.title ?? null,
      author: book?.author ?? null,
      coverArtUrl: book?.cover_art_url ?? null,
      position: st.position,
      duration: st.duration,
    };
    try {
      await invoke(IPC_CHANNELS.playback.REPORT_STATE, payload);
    } catch {
      // no-op
    }
  }, [invoke]);

  const flushProgress = useCallback(
    async (force: boolean) => {
      const st = usePlayerStore.getState();
      const book = st.currentBook;
      if (!book) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastProgressFlushRef.current < PROGRESS_DEBOUNCE_MS) {
        return;
      }
      lastProgressFlushRef.current = now;
      await invoke(IPC_CHANNELS.playback.SAVE_PROGRESS, {
        book_id: book.id,
        current_file_id: st.currentFileId,
        position_seconds: audio.getCurrentTime(),
        playback_speed: st.speed,
      });
    },
    [audio, invoke],
  );

  const audioRef = useRef(audio);
  const flushProgressRef = useRef(flushProgress);

  const mountFile = useCallback(
    async (fileIndex: number, seekSeconds: number, autoplay: boolean) => {
      const filesList = sortedFilesRef.current;
      const file = filesList[fileIndex];
      if (!file) {
        return;
      }
      const generation = ++pendingMountRef.current;
      usePlayerStore.getState().setCurrentFileIndex(fileIndex, file.id);
      usePlayerStore.getState().setPlaybackError(null);

      try {
        logMediaDebug("mountFile.resolve_start", {
          fileIndex,
          fileId: file.id,
          filePath: file.file_path,
          seekSeconds,
          autoplay,
          generation,
        });
        pendingSeekRef.current = null;
        playAfterCanPlayRef.current = autoplay;
        audio.setSpeed(usePlayerStore.getState().speed);
        logMediaDebug("mountFile.before_mpv_load", { filePath: file.file_path, generation });
        await audio.load(file.file_path, Math.max(0, seekSeconds));
        if (generation !== pendingMountRef.current) {
          logMediaDebug("mountFile.stale_generation_after_load", { generation, pending: pendingMountRef.current });
          return;
        }
        logMediaDebug("mountFile.after_mpv_load", { filePath: file.file_path, generation });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logMediaDebug("mountFile.error", {
          severity: "error",
          message,
          stack: error instanceof Error ? error.stack : null,
          fileIndex,
          filePath: file.file_path,
          generation,
        });
        usePlayerStore.getState().setPlaybackError(message);
      }
    },
    [audio, logMediaDebug],
  );

  const seekTo = useCallback(
    (seconds: number) => {
      const st = usePlayerStore.getState();
      const maxSeek = st.duration > 0 ? st.duration : Math.max(0, seconds);
      const clamped = clamp(seconds, 0, maxSeek > 0 ? maxSeek : Number.MAX_SAFE_INTEGER);
      audio.seek(clamped);
      st.setPosition(clamped);
      const chapterIndex = findCurrentChapterIndex(sortedChaptersRef.current, st.currentFileId, clamped, st.duration);
      st.setCurrentChapterIndex(chapterIndex);
      void flushProgress(true);
      void reportPlaybackState();
    },
    [audio, flushProgress, reportPlaybackState],
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      seekTo(audio.getCurrentTime() + deltaSeconds);
    },
    [audio, seekTo],
  );

  const setSpeed = useCallback(
    (rate: number) => {
      const clamped = clamp(rate, 0.5, 3.5);
      usePlayerStore.getState().setSpeed(clamped);
      audio.setSpeed(clamped);
      void flushProgress(true);
    },
    [audio, flushProgress],
  );

  const setSleepTimer = useCallback((config: { mode: "minutes" | "end-of-chapter" | "end-of-book"; minutes?: number }) => {
    if (config.mode === "minutes") {
      const minutes = config.minutes ?? 1;
      usePlayerStore.getState().setSleepTimer({
        mode: "minutes",
        minutes,
        endsAt: Date.now() + minutes * 60_000,
      });
      return;
    }
    usePlayerStore.getState().setSleepTimer({ mode: config.mode });
  }, []);

  const clearSleepTimer = useCallback(() => {
    usePlayerStore.getState().setSleepTimer(null);
  }, []);

  const loadBook = useCallback(
    async (bookId: number) => {
      await flushProgress(true);
      audio.pause();
      const detail = await invoke<BookDetailPayload | null>(IPC_CHANNELS.library.GET_BOOK, bookId);
      if (!detail) {
        return;
      }
      const bookmarks = await invoke<Bookmark[]>(IPC_CHANNELS.playback.GET_BOOKMARKS, bookId);
      const sortedFiles = sortFiles(detail.files);
      const sortedChapters = sortChapters(detail.chapters, sortedFiles);
      sortedFilesRef.current = sortedFiles;
      sortedChaptersRef.current = sortedChapters;

      let fileIndex = 0;
      if (detail.progress?.current_file_id) {
        const ix = sortedFiles.findIndex((f) => f.id === detail.progress?.current_file_id);
        if (ix >= 0) {
          fileIndex = ix;
        }
      }
      const current = sortedFiles[fileIndex];
      const initialSeek =
        detail.progress && current && detail.progress.current_file_id === current.id
          ? detail.progress.position_seconds ?? 0
          : 0;
      const initialSpeed = clamp(detail.progress?.playback_speed ?? 1, 0.5, 3.5);

      usePlayerStore
        .getState()
        .setBook(toBookListItem(detail), sortedFiles, sortedChapters, fileIndex, initialSeek, initialSpeed);
      usePlayerStore.getState().setBookmarks(bookmarks);
      usePlayerStore.getState().setPlaybackError(null);
      setMediaError(null);

      if (sortedFiles.length > 1) {
        try {
          await audio.loadPlaylist(
            sortedFiles.map((f) => f.file_path),
            fileIndex,
            initialSeek,
          );
          usePlayerStore.getState().setCurrentFileIndex(fileIndex, sortedFiles[fileIndex]?.id ?? null);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          usePlayerStore.getState().setPlaybackError(message);
        }
      } else {
        await mountFile(fileIndex, initialSeek, false);
      }
      void reportPlaybackState();
    },
    [audio, flushProgress, invoke, mountFile, reportPlaybackState],
  );

  const play = useCallback(
    async (book?: BookListItem, fileIndex = 0, startPosition = 0) => {
      if (book) {
        await loadBook(book.id);
        const ix = clamp(fileIndex, 0, Math.max(0, sortedFilesRef.current.length - 1));
        await mountFile(ix, Math.max(0, startPosition), true);
        return;
      }
      if (!audio.hasMediaLoaded()) {
        playAfterCanPlayRef.current = true;
        return;
      }
      try {
        await audio.play();
        usePlayerStore.getState().setIsPlaying(true);
        void reportPlaybackState();
      } catch (err) {
        logMediaDebug("usePlayer.play_failed", {
          severity: "error",
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : null,
          hasMediaLoaded: audio.hasMediaLoaded(),
          note: "mpv IPC play failed",
        });
        usePlayerStore.getState().setIsPlaying(false);
      }
    },
    [audio, loadBook, logMediaDebug, mountFile, reportPlaybackState],
  );

  const pause = useCallback(() => {
    audio.pause();
    usePlayerStore.getState().setIsPlaying(false);
    void flushProgress(true);
    void reportPlaybackState();
  }, [audio, flushProgress, reportPlaybackState]);

  const resume = useCallback(() => {
    void play();
  }, [play]);

  const togglePlay = useCallback(() => {
    if (audio.isPaused()) {
      void play();
      return;
    }
    pause();
  }, [audio, pause, play]);

  const seekToChapter = useCallback(
    (chapter: Chapter) => {
      const index = sortedFilesRef.current.findIndex((f) => f.id === chapter.file_id);
      if (index < 0) {
        return;
      }
      const start = chapter.start_time ?? 0;
      const st = usePlayerStore.getState();
      if (index !== st.currentFileIndex) {
        void flushProgress(true);
        void mountFile(index, start, st.isPlaying);
        return;
      }
      seekTo(start);
    },
    [flushProgress, mountFile, seekTo],
  );

  const seekToBookmark = useCallback(
    async (bookmark: Bookmark) => {
      if (bookmark.file_id == null) {
        seekTo(bookmark.position_seconds ?? 0);
        return;
      }
      const index = sortedFilesRef.current.findIndex((f) => f.id === bookmark.file_id);
      if (index < 0) {
        seekTo(bookmark.position_seconds ?? 0);
        return;
      }
      const st = usePlayerStore.getState();
      if (index !== st.currentFileIndex) {
        await mountFile(index, bookmark.position_seconds ?? 0, st.isPlaying);
      } else {
        seekTo(bookmark.position_seconds ?? 0);
      }
    },
    [mountFile, seekTo],
  );

  const nextFile = useCallback(() => {
    const st = usePlayerStore.getState();
    const next = st.currentFileIndex + 1;
    if (next >= sortedFilesRef.current.length) {
      return;
    }
    void flushProgress(true);
    void mountFile(next, 0, st.isPlaying);
  }, [flushProgress, mountFile]);

  const prevFile = useCallback(() => {
    const st = usePlayerStore.getState();
    const prev = st.currentFileIndex - 1;
    if (prev < 0) {
      return;
    }
    void flushProgress(true);
    void mountFile(prev, 0, st.isPlaying);
  }, [flushProgress, mountFile]);

  const nextChapter = useCallback(() => {
    const st = usePlayerStore.getState();
    const list = sortedChaptersRef.current;
    if (list.length === 0) {
      return;
    }
    const current = st.currentChapterIndex;
    if (current < 0) {
      const first = list[0];
      if (first) {
        seekToChapter(first);
      }
      return;
    }
    const next = list[current + 1];
    if (next) {
      seekToChapter(next);
    }
  }, [seekToChapter]);

  const prevChapter = useCallback(() => {
    const st = usePlayerStore.getState();
    const list = sortedChaptersRef.current;
    if (list.length === 0) {
      return;
    }
    const current = st.currentChapterIndex;
    if (current <= 0) {
      return;
    }
    const prev = list[current - 1];
    if (prev) {
      seekToChapter(prev);
    }
  }, [seekToChapter]);

  const cycleSpeed = useCallback(() => {
    const current = usePlayerStore.getState().speed;
    const idx = SPEED_CYCLE_SEQUENCE.findIndex((item) => Math.abs(item - current) < 0.02);
    const next = SPEED_CYCLE_SEQUENCE[(idx >= 0 ? idx + 1 : 0) % SPEED_CYCLE_SEQUENCE.length]!;
    setSpeed(next);
  }, [setSpeed]);

  const refreshBookmarks = useCallback(
    async (bookId: number) => {
      const list = await invoke<Bookmark[]>(IPC_CHANNELS.playback.GET_BOOKMARKS, bookId);
      usePlayerStore.getState().setBookmarks(list);
    },
    [invoke],
  );

  const addBookmark = useCallback(
    async (note?: string) => {
      const st = usePlayerStore.getState();
      const book = st.currentBook;
      const fileId = st.currentFileId;
      if (!book || fileId == null) {
        return;
      }
      await invoke(IPC_CHANNELS.playback.ADD_BOOKMARK, {
        book_id: book.id,
        file_id: fileId,
        position_seconds: audio.getCurrentTime(),
        note: note ?? null,
      });
      await refreshBookmarks(book.id);
      await flushProgress(true);
    },
    [audio, flushProgress, invoke, refreshBookmarks],
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

  const toggleSkipSilence = useCallback(async () => {
    usePlayerStore.getState().toggleSkipSilence();
    const enabled = usePlayerStore.getState().skipSilenceEnabled;
    await invoke(IPC_CHANNELS.settings.SAVE_SKIP_SILENCE, enabled);
    audio.setSkipSilence(enabled);
  }, [audio, invoke]);

  const setEqPresetAndPersist = useCallback(
    async (preset: EqPreset) => {
      usePlayerStore.getState().setEqPreset(preset);
      await invoke(IPC_CHANNELS.settings.SET_EQ_PRESET, preset);
    },
    [invoke],
  );

  const setVolumeLevel = useCallback(
    (level: number) => {
      usePlayerStore.getState().setVolume(level);
      audio.setVolume(usePlayerStore.getState().volume);
      if (volumePersistTimerRef.current != null) {
        clearTimeout(volumePersistTimerRef.current);
      }
      const v = usePlayerStore.getState().volume;
      volumePersistTimerRef.current = setTimeout(() => {
        volumePersistTimerRef.current = null;
        void invoke(IPC_CHANNELS.settings.SAVE_PLAYBACK_VOLUME, v);
      }, VOLUME_PERSIST_DEBOUNCE_MS);
    },
    [audio, invoke],
  );

  useEffect(() => {
    const offCanPlay = audio.on("canplay", () => {
      const st = usePlayerStore.getState();
      const seekTarget = pendingSeekRef.current;
      if (seekTarget != null) {
        audio.seek(seekTarget);
        st.setPosition(seekTarget);
        pendingSeekRef.current = null;
      }
      audio.setSpeed(st.speed);
      if (playAfterCanPlayRef.current) {
        playAfterCanPlayRef.current = false;
        void play();
      }
    });

    const offLoadedMetadata = audio.on("loadedmetadata", () => {
      const st = usePlayerStore.getState();
      const total = audio.getDuration();
      st.setDuration(total);
      const chapterIndex = findCurrentChapterIndex(
        sortedChaptersRef.current,
        st.currentFileId,
        audio.getCurrentTime(),
        total,
      );
      st.setCurrentChapterIndex(chapterIndex);
    });

    const offTimeUpdate = audio.on("timeupdate", () => {
      const st = usePlayerStore.getState();
      const current = audio.getCurrentTime();
      const total = audio.getDuration() || st.duration;
      st.setPosition(current);
      if (total > 0) {
        st.setDuration(total);
      }
      const chapterIndex = findCurrentChapterIndex(sortedChaptersRef.current, st.currentFileId, current, total);
      st.setCurrentChapterIndex(chapterIndex);

      const sleep = st.sleepTimer;
      if (sleep?.mode === "minutes" && sleep.endsAt != null && Date.now() >= sleep.endsAt) {
        pause();
        st.setSleepTimer(null);
      } else if (sleep?.mode === "end-of-chapter" && chapterIndex >= 0) {
        const chapter = sortedChaptersRef.current[chapterIndex];
        if (chapter) {
          const chapterEnd = chapterEndSeconds(chapter, sortedChaptersRef.current, chapterIndex, total);
          if (Number.isFinite(chapterEnd) && current >= chapterEnd - 0.05) {
            pause();
            st.setSleepTimer(null);
          }
        }
      } else if (sleep?.mode === "end-of-book") {
        const last = sortedFilesRef.current.length - 1;
        const atEnd = st.currentFileIndex >= last && last >= 0 && total > 0 && current >= total - 0.25;
        if (atEnd) {
          pause();
          st.setSleepTimer(null);
        }
      }

      void flushProgress(false);
      void reportPlaybackState();
    });

    const offEnded = audio.on("ended", () => {
      void flushProgress(true);
      const st = usePlayerStore.getState();
      const next = st.currentFileIndex + 1;
      if (next < sortedFilesRef.current.length) {
        void mountFile(next, 0, true);
        return;
      }
      const pos = audio.getCurrentTime();
      const reportedDur = audio.getDuration();
      const dur = reportedDur > 0 ? reportedDur : st.duration;
      const tol = Math.min(4, Math.max(0.75, dur * 0.02));
      const nearEnd = dur <= 0 || pos >= dur - tol;
      if (!nearEnd) {
        logMediaDebug("usePlayer.ended_ignored_not_near_end", {
          position: pos,
          duration: dur,
          reportedDuration: reportedDur,
          bookId: st.currentBook?.id ?? null,
          note: "eof forwarded but playback position not at end — skipping mark-complete",
        });
        void reportPlaybackState();
        return;
      }
      st.setIsPlaying(false);
      st.setSleepTimer(null);
      void invoke(IPC_CHANNELS.playback.MARK_COMPLETE, st.currentBook?.id);
      void reportPlaybackState();
    });

    return () => {
      offCanPlay();
      offLoadedMetadata();
      offTimeUpdate();
      offEnded();
    };
  }, [audio, flushProgress, invoke, logMediaDebug, mountFile, pause, play, reportPlaybackState]);

  useEffect(() => {
    void (async () => {
      const [skipSilence, eqPreset, shortcuts, volume] = await Promise.all([
        invoke<boolean>(IPC_CHANNELS.settings.GET_SKIP_SILENCE),
        invoke<EqPreset>(IPC_CHANNELS.settings.GET_EQ_PRESET),
        invoke<ShortcutMap>(IPC_CHANNELS.settings.GET_SHORTCUTS),
        invoke<number>(IPC_CHANNELS.settings.GET_PLAYBACK_VOLUME),
      ]);
      usePlayerStore.getState().setSkipSilenceEnabled(skipSilence);
      usePlayerStore.getState().setEqPreset(eqPreset);
      usePlayerStore.getState().setVolume(volume);
      shortcutsRef.current = shortcuts;
      const a = audioRef.current;
      if (a.hasMediaLoaded()) {
        a.setVolume(volume);
      }
    })();
  }, [invoke]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const lastId = await invoke<number | null>(IPC_CHANNELS.library.GET_LAST_LISTENED_BOOK_ID);
      if (cancelled || lastId == null || lastId <= 0) {
        return;
      }
      if (usePlayerStore.getState().currentBook != null) {
        return;
      }
      await loadBook(lastId);
    })();
    return () => {
      cancelled = true;
    };
  }, [invoke, loadBook]);

  useEffect(() => {
    const off = subscribe(IPC_CHANNELS.playback.CHAPTERS_LOADED, (...args: unknown[]) => {
      const raw = args[0];
      if (!Array.isArray(raw)) {
        return;
      }
      const st = usePlayerStore.getState();
      const fid = st.currentFileId;
      if (fid == null) {
        return;
      }
      const mapped: Chapter[] = raw
        .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
        .map((rec, i) => {
          const title = typeof rec.title === "string" ? rec.title : "";
          const stt = typeof rec.startTime === "number" && Number.isFinite(rec.startTime) ? rec.startTime : 0;
          return { id: -(i + 1), file_id: fid, title, start_time: stt, end_time: null };
        });
      const others = st.chapters.filter((c) => c.file_id !== fid);
      const merged = sortChapters([...others, ...mapped], st.files);
      sortedChaptersRef.current = merged;
      usePlayerStore.getState().setChapters(merged);
      const total = st.duration;
      const pos = st.position;
      const chapterIndex = findCurrentChapterIndex(merged, fid, pos, total);
      usePlayerStore.getState().setCurrentChapterIndex(chapterIndex);
    });
    return () => off();
  }, [subscribe]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const shortcuts = shortcutsRef.current;
      if (!shortcuts) {
        return;
      }
      if (acceleratorMatchesKeyboard(shortcuts.playPause, event)) {
        event.preventDefault();
        togglePlay();
      } else if (acceleratorMatchesKeyboard(shortcuts.nextChapter, event)) {
        event.preventDefault();
        nextChapter();
      } else if (acceleratorMatchesKeyboard(shortcuts.prevChapter, event)) {
        event.preventDefault();
        prevChapter();
      } else if (acceleratorMatchesKeyboard(shortcuts.nextFile, event)) {
        event.preventDefault();
        nextFile();
      } else if (acceleratorMatchesKeyboard(shortcuts.prevFile, event)) {
        event.preventDefault();
        prevFile();
      } else if (acceleratorMatchesKeyboard(shortcuts.seekForward30, event)) {
        event.preventDefault();
        seekBy(30);
      } else if (acceleratorMatchesKeyboard(shortcuts.seekBack30, event)) {
        event.preventDefault();
        seekBy(-30);
      } else if (acceleratorMatchesKeyboard(shortcuts.speedUp, event)) {
        event.preventDefault();
        cycleSpeed();
      } else if (acceleratorMatchesKeyboard(shortcuts.speedDown, event)) {
        event.preventDefault();
        const current = usePlayerStore.getState().speed;
        const idx = SPEED_CYCLE_SEQUENCE.findIndex((item) => Math.abs(item - current) < 0.02);
        const prevIdx = idx <= 0 ? SPEED_CYCLE_SEQUENCE.length - 1 : idx - 1;
        setSpeed(SPEED_CYCLE_SEQUENCE[prevIdx]!);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycleSpeed, nextChapter, nextFile, prevChapter, prevFile, seekBy, setSpeed, togglePlay]);

  useEffect(() => {
    const off = subscribe(IPC_CHANNELS.playback.MEDIA_KEY, (...args: unknown[]) => {
      const action = args[0];
      if (action === "play-pause") {
        togglePlay();
      } else if (action === "next") {
        nextFile();
      } else if (action === "prev") {
        prevFile();
      } else if (action === "seek-forward-30") {
        seekBy(30);
      } else if (action === "seek-back-30") {
        seekBy(-30);
      }
    });
    return () => off();
  }, [nextFile, prevFile, seekBy, subscribe, togglePlay]);

  useEffect(() => {
    audioRef.current = audio;
  }, [audio]);

  useEffect(() => {
    flushProgressRef.current = flushProgress;
  }, [flushProgress]);

  useEffect(() => {
    return () => {
      if (volumePersistTimerRef.current != null) {
        clearTimeout(volumePersistTimerRef.current);
        volumePersistTimerRef.current = null;
      }
      void flushProgressRef.current(true);
      audioRef.current.pause();
    };
  }, []);

  return {
    currentBook,
    currentFile,
    isPlaying,
    position,
    duration,
    speed,
    error: mediaError,
    loadBook,
    play,
    pause,
    resume,
    togglePlay,
    seekTo,
    seek: seekTo,
    seekToChapter,
    skipToChapter: seekToChapter,
    seekToBookmark,
    seekBy,
    skipForward: (seconds = 30) => seekBy(seconds),
    skipBack: (seconds = 15) => seekBy(-seconds),
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
    toggleSkipSilence,
    setEqPresetAndPersist,
    setVolumeLevel,
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
