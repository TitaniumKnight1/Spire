import { usePlayerStore } from "../store/playerStore.js";

/**
 * Stub hook for future playback wiring (renderer-only; no Node/Electron imports).
 */
export function usePlayer(): ReturnType<typeof usePlayerStore> {
  return usePlayerStore();
}
