import { useCallback, useEffect, useRef, type RefObject } from "react";
import { IPC_CHANNELS, type IpcInvokeChannel } from "@shared/ipc-channels";
import { usePlayerStore } from "../store/playerStore.js";

export type AudioElementEvent =
  | "play"
  | "pause"
  | "ended"
  | "timeupdate"
  | "error"
  | "canplay"
  | "loadedmetadata";

export interface UseAudioElementReturn {
  audioRef: RefObject<HTMLAudioElement>;
  load: (absoluteFilePath: string, startPositionSeconds?: number) => Promise<void>;
  loadPlaylist: (filePaths: string[], startFileIndex: number, startPositionSeconds: number) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  seek: (positionSeconds: number) => void;
  setSpeed: (rate: number) => void;
  setVolume: (level: number) => void;
  setSkipSilence: (enabled: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getAudioContext: () => AudioContext | null;
  on: (event: AudioElementEvent, handler: () => void) => () => void;
  hasMediaLoaded: () => boolean;
  isPaused: () => boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getIpcInvoke(): NonNullable<Window["electron"]>["ipc"] {
  const bridge = window.electron?.ipc;
  if (!bridge) {
    throw new Error("window.electron.ipc is not available (preload missing?)");
  }
  return bridge;
}

function invoke(channel: IpcInvokeChannel, ...args: unknown[]): Promise<unknown> {
  return getIpcInvoke().invoke(channel, ...args);
}

function sendMediaDebug(event: string, extra: Record<string, unknown> = {}): void {
  void window.electron?.ipc
    ?.invoke(IPC_CHANNELS.playback.MEDIA_DEBUG_LOG, {
      source: "useAudioElement",
      event,
      ...extra,
    })
    .catch(() => {});
}

export function useAudioElement(): UseAudioElementReturn {
  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const timeRef = useRef(0);
  const durationRef = useRef(0);
  const pausedRef = useRef(true);
  const hasLoadedRef = useRef(false);
  const listenersRef = useRef<Partial<Record<AudioElementEvent, Set<() => void>>>>({});

  const emit = useCallback((event: AudioElementEvent): void => {
    const set = listenersRef.current[event];
    if (!set) {
      return;
    }
    for (const fn of set) {
      fn();
    }
  }, []);

  useEffect(() => {
    const ipc = window.electron?.ipc;
    if (!ipc) {
      return;
    }

    const unsubs: Array<() => void> = [];

    unsubs.push(
      ipc.on(IPC_CHANNELS.playback.TIME_UPDATE, (...args: unknown[]) => {
        const secs = args[0];
        timeRef.current = typeof secs === "number" && Number.isFinite(secs) ? secs : 0;
        emit("timeupdate");
      }),
    );

    unsubs.push(
      ipc.on(IPC_CHANNELS.playback.DURATION, (...args: unknown[]) => {
        const d = args[0];
        durationRef.current = typeof d === "number" && Number.isFinite(d) && d > 0 ? d : 0;
        emit("loadedmetadata");
        emit("timeupdate");
      }),
    );

    unsubs.push(
      ipc.on(IPC_CHANNELS.playback.TRACK_ENDED, () => {
        hasLoadedRef.current = false;
        emit("ended");
      }),
    );

    unsubs.push(
      ipc.on(IPC_CHANNELS.playback.PAUSE_CHANGE, (...args: unknown[]) => {
        const paused = args[0] === true;
        pausedRef.current = paused;
        emit(paused ? "pause" : "play");
      }),
    );

    sendMediaDebug("hook.mount", { note: "useAudioElement IPC listeners attached" });

    return () => {
      for (const u of unsubs) {
        u();
      }
    };
  }, [emit]);

  const setSkipSilence = useCallback((enabled: boolean) => {
    void invoke(IPC_CHANNELS.playback.SET_SKIP_SILENCE, enabled).catch(() => {});
  }, []);

  const load = useCallback(async (absoluteFilePath: string, startPositionSeconds = 0): Promise<void> => {
    hasLoadedRef.current = false;
    sendMediaDebug("mpv.load.before", {
      absoluteFilePath,
      startPositionSeconds,
    });
    await invoke(IPC_CHANNELS.playback.LOAD, {
      filePath: absoluteFilePath,
      startPositionSeconds,
    });
    hasLoadedRef.current = true;
    pausedRef.current = true;
    sendMediaDebug("mpv.load.after", { absoluteFilePath });
    queueMicrotask(() => {
      emit("canplay");
      emit("loadedmetadata");
    });
    const currentSkipSilence = usePlayerStore.getState().skipSilenceEnabled;
    if (currentSkipSilence) {
      setSkipSilence(true);
    }
  }, [emit, setSkipSilence]);

  const loadPlaylist = useCallback(
    async (filePaths: string[], startFileIndex: number, startPositionSeconds: number): Promise<void> => {
      hasLoadedRef.current = false;
      await invoke(IPC_CHANNELS.playback.LOAD_PLAYLIST, {
        filePaths,
        startFileIndex,
        startPositionSeconds,
      });
      hasLoadedRef.current = true;
      pausedRef.current = true;
      queueMicrotask(() => {
        emit("canplay");
        emit("loadedmetadata");
      });
      const currentSkipSilence = usePlayerStore.getState().skipSilenceEnabled;
      if (currentSkipSilence) {
        setSkipSilence(true);
      }
    },
    [emit, setSkipSilence],
  );

  const play = useCallback(async (): Promise<void> => {
    sendMediaDebug("mpv.play.before", { paused: pausedRef.current });
    await invoke(IPC_CHANNELS.playback.PLAY);
    pausedRef.current = false;
    sendMediaDebug("mpv.play.after", {});
  }, []);

  const pause = useCallback(() => {
    void invoke(IPC_CHANNELS.playback.PAUSE).catch(() => {});
    pausedRef.current = true;
  }, []);

  const seek = useCallback((positionSeconds: number) => {
    if (!Number.isFinite(positionSeconds)) {
      return;
    }
    const t = Math.max(0, positionSeconds);
    timeRef.current = t;
    void invoke(IPC_CHANNELS.playback.SEEK, t).catch(() => {});
  }, []);

  const setSpeed = useCallback((rate: number) => {
    const clamped = clamp(rate, 0.5, 3.5);
    void invoke(IPC_CHANNELS.playback.SET_SPEED, clamped).catch(() => {});
  }, []);

  const setVolume = useCallback((level: number) => {
    void invoke(IPC_CHANNELS.playback.SET_VOLUME, level).catch(() => {});
  }, []);

  const getCurrentTime = useCallback(() => {
    return timeRef.current;
  }, []);

  const getDuration = useCallback(() => {
    return durationRef.current;
  }, []);

  const getAudioContext = useCallback(() => {
    return null;
  }, []);

  const hasMediaLoaded = useCallback(() => hasLoadedRef.current, []);

  const isPaused = useCallback(() => pausedRef.current, []);

  const on = useCallback((event: AudioElementEvent, handler: () => void) => {
    let set = listenersRef.current[event];
    if (!set) {
      set = new Set();
      listenersRef.current[event] = set;
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }, []);

  useEffect(() => {
    return () => {
      listenersRef.current = {};
      hasLoadedRef.current = false;
      void invoke(IPC_CHANNELS.playback.PAUSE).catch(() => {});
    };
  }, []);

  return {
    audioRef,
    load,
    loadPlaylist,
    play,
    pause,
    seek,
    setSpeed,
    setVolume,
    setSkipSilence,
    getCurrentTime,
    getDuration,
    getAudioContext,
    on,
    hasMediaLoaded,
    isPaused,
  };
}
