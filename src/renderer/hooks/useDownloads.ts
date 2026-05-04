import { useCallback, useEffect } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { DownloadItem, RssFeedPayload, SavedPodcastFeed, TorrentProgress } from "@shared/library-types";
import { useIPC } from "./useIPC.js";
import { useLibrary } from "./useLibrary.js";
import { useDownloadStore } from "../store/downloadStore.js";

function mapProgressToPartial(p: TorrentProgress): Partial<DownloadItem> & { id: number } {
  return {
    id: p.id,
    display_name: p.name,
    progress_pct: p.progress_pct,
    speed_bps: p.speed,
    eta_seconds: p.eta,
    status: p.status as DownloadItem["status"],
  };
}

export function useDownloads(): {
  downloads: DownloadItem[];
  isLoading: boolean;
  addMagnet: (uri: string) => Promise<{ downloadId: number }>;
  addTorrentFile: (filePath: string) => Promise<{ downloadId: number }>;
  addUrl: (url: string) => Promise<{ downloadId: number }>;
  pause: (id: number) => Promise<void>;
  resume: (id: number) => Promise<void>;
  cancel: (id: number) => Promise<void>;
  retry: (id: number) => Promise<void>;
  /** RSS / podcast feeds (Milestone 5) */
  fetchFeed: (feedUrl: string) => Promise<RssFeedPayload>;
  saveFeed: (args: { feedUrl: string; title: string; coverUrl: string | null }) => Promise<SavedPodcastFeed>;
  getSavedFeeds: () => Promise<SavedPodcastFeed[]>;
  deleteSavedFeed: (id: number) => Promise<void>;
  downloadEpisode: (args: { url: string; title: string | null }) => Promise<{ downloadId: number }>;
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
      const p = payload[0] as TorrentProgress;
      upsertDownload(mapProgressToPartial(p));
    });
    const unsubDone = subscribe(IPC_CHANNELS.downloads.COMPLETED, (...payload: unknown[]) => {
      const body = payload[0] as { downloadId: number; bookId: number };
      upsertDownload({
        id: body.downloadId,
        book_id: body.bookId,
        status: "completed",
        progress_pct: 100,
        speed_bps: 0,
        eta_seconds: null,
        error_message: null,
      });
      void refreshLibrary();
      void refreshDownloads();
    });
    return () => {
      unsubProgress();
      unsubDone();
    };
  }, [subscribe, upsertDownload, refreshLibrary, refreshDownloads]);

  const addMagnet = useCallback(
    async (uri: string) => {
      const res = await invoke<{ downloadId: number }>(IPC_CHANNELS.downloads.ADD_MAGNET, uri);
      await refreshDownloads();
      return res;
    },
    [invoke, refreshDownloads],
  );

  const addTorrentFile = useCallback(
    async (filePath: string) => {
      const res = await invoke<{ downloadId: number }>(IPC_CHANNELS.downloads.ADD_TORRENT_FILE, filePath);
      await refreshDownloads();
      return res;
    },
    [invoke, refreshDownloads],
  );

  const addUrl = useCallback(
    async (url: string) => {
      const res = await invoke<{ downloadId: number }>(IPC_CHANNELS.downloads.ADD_URL, url);
      await refreshDownloads();
      return res;
    },
    [invoke, refreshDownloads],
  );

  const pause = useCallback(
    async (id: number) => {
      await invoke(IPC_CHANNELS.downloads.PAUSE, id);
    },
    [invoke],
  );

  const resume = useCallback(
    async (id: number) => {
      await invoke(IPC_CHANNELS.downloads.RESUME, id);
    },
    [invoke],
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

  return {
    downloads,
    isLoading,
    addMagnet,
    addTorrentFile,
    addUrl,
    pause,
    resume,
    cancel,
    retry,
    fetchFeed,
    saveFeed,
    getSavedFeeds,
    deleteSavedFeed,
    downloadEpisode,
  };
}
