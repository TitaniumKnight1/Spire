import { useDownloadStore } from "../store/downloadStore.js";

/**
 * Stub hook for future download wiring (renderer-only).
 */
export function useDownloads(): ReturnType<typeof useDownloadStore> {
  return useDownloadStore();
}
