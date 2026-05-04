import { app, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";

autoUpdater.logger = null;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let listenersAttached = false;
let mainWindowRef: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    return mainWindowRef;
  }
  return null;
}

function attachAutoUpdaterListeners(): void {
  if (listenersAttached) {
    return;
  }
  listenersAttached = true;

  autoUpdater.on("update-available", (info) => {
    console.info("[spire] Update available:", info.version);
    const win = getMainWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.updates.UPDATE_AVAILABLE, { version: info.version });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.info("[spire] Update downloaded:", info.version);
    const win = getMainWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.updates.UPDATE_DOWNLOADED, { version: info.version });
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("[spire] Update error:", err);
  });
}

export function checkForUpdates(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    return;
  }

  mainWindowRef = mainWindow;
  attachAutoUpdaterListeners();

  void autoUpdater.checkForUpdates().catch((err) => {
    console.error("[spire] Update check failed:", err);
  });
}
