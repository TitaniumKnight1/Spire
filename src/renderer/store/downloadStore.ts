import { create } from "zustand";

type DownloadState = {
  ready: boolean;
};

export const useDownloadStore = create<DownloadState>(() => ({
  ready: false,
}));
