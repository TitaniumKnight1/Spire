import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { getSetting, setSetting } from "./database.js";
import { ingestPaths } from "./library.js";
import { SUPPORTED_AUDIO_EXTENSIONS } from "../utils/formats.js";

export const WATCH_FOLDER_SETTING_KEY = "watch_folder";

const AUDIO_EXT = new Set(SUPPORTED_AUDIO_EXTENSIONS.map((e) => e.toLowerCase()));

let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Set<string>();

function isAudio(filePath: string): boolean {
  return AUDIO_EXT.has(path.extname(filePath).toLowerCase());
}

function flushPending(): void {
  const paths = [...pending];
  pending.clear();
  if (paths.length === 0) {
    return;
  }
  void ingestPaths(paths).catch((e) => {
    console.error("[spire] watch folder ingest failed:", e);
  });
}

function scheduleFlush(): void {
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flushPending();
  }, 3000);
}

export function startWatching(folderPath: string): void {
  stopWatching();
  const w = chokidar.watch(folderPath, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
  });
  w.on("add", (filePath: string) => {
    if (!isAudio(filePath)) {
      return;
    }
    pending.add(filePath);
    scheduleFlush();
  });
  watcher = w;
}

export function stopWatching(): void {
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pending.clear();
  if (watcher) {
    void watcher.close();
    watcher = null;
  }
}

export function getWatchedFolderFromDb(): string | null {
  return getSetting(WATCH_FOLDER_SETTING_KEY);
}

export function persistWatchedFolder(folderPath: string | null): void {
  setSetting(WATCH_FOLDER_SETTING_KEY, folderPath);
}

export function restartWatcherFromSettings(): void {
  const folder = getWatchedFolderFromDb();
  if (!folder) {
    return;
  }
  const resolved = path.normalize(folder);
  try {
    startWatching(resolved);
  } catch (e) {
    console.error("[spire] failed to start watch folder:", e);
  }
}
