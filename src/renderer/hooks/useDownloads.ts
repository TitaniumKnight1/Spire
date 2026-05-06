import { useCallback, useEffect } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { DownloadItem, DownloadProgressPush, RssFeedPayload, SavedPodcastFeed } from "@shared/library-types";
import { isMagnetLikeString } from "@shared/magnet-display";
import { useIPC } from "./useIPC.js";
import { useLibrary } from "./useLibrary.js";
import { useDownloadStore } from "../store/downloadStore.js";

function mapProgressToPartial(p: DownloadProgressPush): Partial<DownloadItem> & { id: number } {
  const torrentTitle = p.torrentName?.trim() ?? null;
  const rawName = typeof p.name === "string" ? p.name.trim() : "";
  const base: Partial<DownloadItem> & { id: number } = {
    id: p.id,
    progress_pct: p.progress_pct,
    speed_bps: p.speed,
    eta_seconds: p.eta,
    status: p.status as DownloadItem["status"],
  };

  if (rawName && !isMagnetLikeString(rawName)) {
    return {
      ...base,
      display_name: rawName,
      displayName: torrentTitle ?? rawName,
    };
  }

  if (isMagnetLikeString(rawName)) {
    return {
      ...base,
      display_name: null,
      displayName: torrentTitle ?? null,
    };
  }

  return torrentTitle ? { ...base, displayName: torrentTitle } : base;
}

export function useDownloads(): {
  downloads: DownloadItem[];
  isLoading: boolean;
  addUrl: (url: string) => Promise<{ downloadId: number }>;
  cancel: (id: number) => Promise<void>;
  retry: (id: number) => Promise<void>;
  /** RSS / podcast feeds (Milestone 5) */
  fetchFeed: (feedUrl: string) => Promise<RssFeedPayload>;
  saveFeed: (args: { feedUrl: string; title: string; coverUrl: string | null }) => Promise<SavedPodcastFeed>;
  getSavedFeeds: () => Promise<SavedPodcastFeed[]>;
  deleteSavedFeed: (id: number) => Promise<void>;
  downloadEpisode: (args: { url: string; title: string | null }) => Promise<{ downloadId: number }>;
  /** Permanently remove completed/cancelled history rows (by download id). */
  clearDownloadHistory: (ids: number[]) => Promise<{ deleted: number }>;
} {
  const invoke = useIPC().invoke;
  const subscribe = useIPC().subscribe;
  const { refreshLibrary } = useLibrary();
  const downloads = useDownloadStore((s) => s.downloads);
  const isLoading = useDownloadStore((s) => s.isLoading);
  const setDownloads = useDownloadStore((s) => s.setDownloads);
  const setLoading = useDownloadStore((s) => s.setLoading);
  const upsertDownload = useDownloadStore((s) => s.upsertDownload);

  const refreshDownloads = useCallback(async () => {
    const list = await invoke<DownloadItem[]>(IPC_CHANNELS.downloads.GET_ALL);
    setDownloads(list);
  }, [invoke, setDownloads]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const list = await invoke<DownloadItem[]>(IPC_CHANNELS.downloads.GET_ALL);
        if (!cancelled) {
          setDownloads(list);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [invoke, setDownloads, setLoading]);

  useEffect(() => {
    const unsubProgress = subscribe(IPC_CHANNELS.downloads.PROGRESS_UPDATE, (...payload: unknown[]) => {
      const p = payload[0] as DownloadProgressPush;
      upsertDownload(mapProgressToPartial(p));
    });
    const unsubDone = subscribe(IPC_CHANNELS.downloads.COMPLETED, () => {
      void (async () => {
        await Promise.all([refreshLibrary(), refreshDownloads()]);
      })();
    });
    return () => {
      unsubProgress();
      unsubDone();
    };
  }, [subscribe, upsertDownload, refreshLibrary, refreshDownloads]);

  const addUrl = useCallback(
    async (url: string) => {
      const res = await invoke<{ downloadId: number }>(IPC_CHANNELS.downloads.ADD_URL, url);
      await refreshDownloads();
      return res;
    },
    [invoke, refreshDownloads],
  );

  const cancel = useCallback(
    async (id: number) => {
      await invoke(IPC_CHANNELS.downloads.CANCEL, id);
      await refreshDownloads();
    },
    [invoke, refreshDownloads],
  );

  const retry = useCallback(
    async (id: number) => {
      await invoke(IPC_CHANNELS.downloads.RETRY, id);
      await refreshDownloads();
    },
    [invoke, refreshDownloads],
  );

  const fetchFeed = useCallback(
    async (feedUrl: string) => {
      return invoke<RssFeedPayload>(IPC_CHANNELS.rss.FETCH_FEED, feedUrl);
    },
    [invoke],
  );

  const saveFeed = useCallback(
    async (args: { feedUrl: string; title: string; coverUrl: string | null }) => {
      return invoke<SavedPodcastFeed>(IPC_CHANNELS.rss.SAVE_FEED, args);
    },
    [invoke],
  );

  const getSavedFeeds = useCallback(async () => {
    return invoke<SavedPodcastFeed[]>(IPC_CHANNELS.rss.GET_FEEDS);
  }, [invoke]);

  const deleteSavedFeed = useCallback(
    async (id: number) => {
      await invoke(IPC_CHANNELS.rss.DELETE_FEED, id);
    },
    [invoke],
  );

  const downloadEpisode = useCallback(
    async (args: { url: string; title: string | null }) => {
      const res = await invoke<{ downloadId: number }>(IPC_CHANNELS.rss.DOWNLOAD_EPISODE, args);
      await refreshDownloads();
      return res;
    },
    [invoke, refreshDownloads],
  );

  const clearDownloadHistory = useCallback(
    async (ids: number[]) => {
      const res = await invoke<{ deleted: number }>(IPC_CHANNELS.downloads.DELETE_HISTORY, ids);
      await refreshDownloads();
      return res;
    },
    [invoke, refreshDownloads],
  );

  return {
    downloads,
    isLoading,
    addUrl,
    cancel,
    retry,
    fetchFeed,
    saveFeed,
    getSavedFeeds,
    deleteSavedFeed,
    downloadEpisode,
    clearDownloadHistory,
  };
}
