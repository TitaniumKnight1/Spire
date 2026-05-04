import { create } from "zustand";
import type { DownloadItem } from "@shared/library-types";

type DownloadState = {
  downloads: DownloadItem[];
  isLoading: boolean;
  setDownloads: (items: DownloadItem[]) => void;
  setLoading: (v: boolean) => void;
  upsertDownload: (item: Partial<DownloadItem> & { id: number }) => void;
  removeDownload: (id: number) => void;
};

export const useDownloadStore = create<DownloadState>((set) => ({
  downloads: [],
  isLoading: false,
  setDownloads: (items) => set({ downloads: items }),
  setLoading: (isLoading) => set({ isLoading }),
  upsertDownload: (item) =>
    set((state) => {
      const idx = state.downloads.findIndex((d) => d.id === item.id);
      if (idx === -1) {
        const base: DownloadItem = {
          id: item.id,
          source_type: item.source_type ?? "magnet",
          status: item.status ?? "queued",
          progress_pct: item.progress_pct ?? 0,
          book_id: item.book_id ?? null,
          started_at: item.started_at ?? null,
          completed_at: item.completed_at ?? null,
          display_name: item.display_name ?? null,
          speed_bps: item.speed_bps ?? 0,
          eta_seconds: item.eta_seconds ?? null,
        };
        return { downloads: [base, ...state.downloads] };
      }
      const next = [...state.downloads];
      next[idx] = { ...next[idx], ...item };
      return { downloads: next };
    }),
  removeDownload: (id) =>
    set((state) => ({
      downloads: state.downloads.filter((d) => d.id !== id),
    })),
}));
