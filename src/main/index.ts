import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, Tray, app, globalShortcut, nativeImage } from "electron";
import { IPC_CHANNELS } from "../shared/ipc-channels.js";
import {
  enqueueMagnetDownload,
  flushPendingDownloadQueues,
  queueMagnetForStartup,
  queueTorrentFileForStartup,
  registerDownloadsIpc,
  setDownloadsBrowserWindow,
} from "./ipc/downloads.js";
import { registerLibraryIpc } from "./ipc/library.js";
import { registerPlaybackIpc } from "./ipc/playback.js";
import { registerSettingsIpc } from "./ipc/settings.js";
import { initializeDatabase } from "./services/database.js";
import { resumeUrlDownloadsAfterBoot } from "./services/downloader.js";
import { getTorrentManager } from "./services/torrent.js";
import { checkForUpdates } from "./services/updater.js";

void checkForUpdates; // keep import for Milestone 9; do not invoke yet

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const magnet = argv.find((a) => typeof a === "string" && a.startsWith("magnet:"));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    if (magnet) {
      void enqueueMagnetDownload(magnet).catch((e) => {
        console.error("[spire] second-instance magnet failed:", e);
      });
    }
  });

  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    if (filePath.toLowerCase().endsWith(".torrent")) {
      queueTorrentFileForStartup(filePath);
      if (app.isReady()) {
        void flushPendingDownloadQueues();
      }
    }
  });

  void app.whenReady().then(async () => {
    initializeDatabase();
    registerAllIpc();

    for (const arg of process.argv.slice(1)) {
      if (typeof arg === "string" && arg.startsWith("magnet:")) {
        queueMagnetForStartup(arg);
      }
    }

    try {
      app.setAsDefaultProtocolClient("magnet");
    } catch (e) {
      console.warn("[spire] setAsDefaultProtocolClient(magnet) failed:", e);
    }

    mainWindow = createMainWindow();
    setDownloadsBrowserWindow(mainWindow);
    await flushPendingDownloadQueues();
    await getTorrentManager().resumeDownloadsAfterBoot();
    resumeUrlDownloadsAfterBoot();

    createTray();
    registerMediaKeyShortcuts();
  });
}

function registerAllIpc(): void {
  registerLibraryIpc();
  registerDownloadsIpc();
  registerPlaybackIpc();
  registerSettingsIpc();
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0f0f0f",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  const devServerUrl = process.env.SPIRE_VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    const indexHtml = path.join(__dirname, "..", "renderer", "index.html");
    void win.loadFile(indexHtml);
  }

  win.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

function resolveTrayIconPath(): string {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), "assets", "tray-icon.png");
  }
  return path.join(process.cwd(), "assets", "tray-icon.png");
}

function createTray(): void {
  const iconPath = resolveTrayIconPath();
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Spire",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip("Spire");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function registerMediaKeyShortcuts(): void {
  const send = (action: "play-pause" | "next" | "prev") => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.playback.MEDIA_KEY, action);
    }
  };

  const registrations: { accelerator: string; handler: () => void }[] = [
    { accelerator: "MediaPlayPause", handler: () => send("play-pause") },
    { accelerator: "MediaNextTrack", handler: () => send("next") },
    { accelerator: "MediaPreviousTrack", handler: () => send("prev") },
  ];

  for (const { accelerator, handler } of registrations) {
    try {
      const ok = globalShortcut.register(accelerator, handler);
      if (!ok) {
        console.warn(
          `[spire] Global shortcut registration returned false for "${accelerator}" (another app may own this key).`,
        );
      }
    } catch (e) {
      console.warn(`[spire] Global shortcut registration failed for "${accelerator}":`, e);
    }
  }
}

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Keep background behavior on Windows/Linux: app stays alive via tray.
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});
