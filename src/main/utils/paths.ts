import fs from "node:fs";
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

/**
 * Path to bundled yt-dlp (dev: `<appPath>/binaries/yt-dlp.exe`, packaged: `<resources>/binaries/yt-dlp.exe`).
 */
export function getYtDlpPath(): string {
  const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const resolved = path.join(base, "binaries", binaryName);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `yt-dlp binary not found at "${resolved}". Place "${binaryName}" under the app's binaries folder (dev: project binaries/, packaged: resources/binaries/).`,
    );
  }
  return resolved;
}
