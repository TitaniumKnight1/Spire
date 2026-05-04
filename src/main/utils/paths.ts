import path from "node:path";
import { app } from "electron";

export function getUserDataRoot(): string {
  return app.getPath("userData");
}

export function getDatabasePath(): string {
  return path.join(getUserDataRoot(), "spire.db");
}

export function getLibraryDirectory(): string {
  return path.join(getUserDataRoot(), "library");
}

/** Root for in-progress torrent payloads and saved `.torrent` metadata (`staging/<infoHash>/`). */
export function getStagingDirectoryRoot(): string {
  return path.join(getUserDataRoot(), "staging");
}

/** Directory for extracted cover art (`{bookId}.jpg` / `{bookId}.png`). */
export function getCoversDirectory(): string {
  return path.join(getUserDataRoot(), "covers");
}
