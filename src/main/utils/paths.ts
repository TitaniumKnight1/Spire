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

/** Alias for staging root (torrent + HTTP staging live under here). */
export const getStagingDirectory = getStagingDirectoryRoot;

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

/**
 * Bundled aria2c (dev: `<appPath>/binaries/aria2c.exe`, packaged: `<resources>/binaries/aria2c.exe`).
 * Windows-only binary name in this repo; place `aria2c` without extension on non-Windows if you extend builds.
 */
export function getAria2Path(): string {
  const binaryName = process.platform === "win32" ? "aria2c.exe" : "aria2c";
  const p = app.isPackaged
    ? path.join(process.resourcesPath, "binaries", binaryName)
    : path.join(app.getAppPath(), "binaries", binaryName);
  if (!fs.existsSync(p)) {
    throw new Error(
      `aria2c binary not found at: ${p}. Download it to binaries/${process.platform === "win32" ? "aria2c.exe" : "aria2c"}`,
    );
  }
  return p;
}
