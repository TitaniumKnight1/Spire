import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, Tray, app, globalShortcut, nativeImage, screen } from "electron";
import { setMainWindowRef, setMiniPlayerWindowRef, setTrayTooltipFromStateHandler } from "./broadcast-state.js";
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
import { loadShortcutMapFromDatabase, registerSettingsIpc } from "./ipc/settings.js";
import { initializeDatabase } from "./services/database.js";
import { resumeUrlDownloadsAfterBoot } from "./services/downloader.js";
import { restartWatcherFromSettings } from "./services/watcher.js";
import { getTorrentManager } from "./services/torrent.js";
import { checkForUpdates } from "./services/updater.js";
import { IPC_CHANNELS } from "../shared/ipc-channels.js";

void checkForUpdates; // keep import for Milestone 9; do not invoke yet

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let miniPlayerWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

type MediaPlaybackAction = "play-pause" | "next" | "prev" | "seek-forward-30" | "seek-back-30";

let configAccelRegistered: { seekFwd: string; seekBack: string; mini: string } | null = null;

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
    restartWatcherFromSettings();
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
    setMainWindowRef(mainWindow);
    setDownloadsBrowserWindow(mainWindow);
    await flushPendingDownloadQueues();
    await getTorrentManager().resumeDownloadsAfterBoot();
    resumeUrlDownloadsAfterBoot();

    createTray();
    registerMediaKeyShortcuts();
    registerConfigurableGlobalShortcuts();
  });
}

function sendMediaPlayback(action: MediaPlaybackAction): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.playback.MEDIA_KEY, action);
  }
}

function unregisterConfigurableGlobalShortcuts(): void {
  if (!configAccelRegistered) {
    return;
  }
  for (const acc of [configAccelRegistered.seekFwd, configAccelRegistered.seekBack, configAccelRegistered.mini]) {
    try {
      globalShortcut.unregister(acc);
    } catch {
      /* ignore */
    }
  }
  configAccelRegistered = null;
}

function registerConfigurableGlobalShortcuts(): void {
  unregisterConfigurableGlobalShortcuts();
  const map = loadShortcutMapFromDatabase();
  const { seekForward30, seekBack30, toggleMiniPlayer: miniAcc } = map;

  const tryRegister = (accelerator: string, handler: () => void): void => {
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
  };

  tryRegister(seekForward30, () => sendMediaPlayback("seek-forward-30"));
  tryRegister(seekBack30, () => sendMediaPlayback("seek-back-30"));
  tryRegister(miniAcc, () => {
    void toggleMiniPlayer();
  });

  configAccelRegistered = { seekFwd: seekForward30, seekBack: seekBack30, mini: miniAcc };
}

function positionMiniPlayerBottomRight(win: BrowserWindow): void {
  const display = screen.getPrimaryDisplay();
  const { width: dw, height: dh, x: dx, y: dy } = display.workArea;
  const [w, h] = win.getSize();
  const margin = 16;
  win.setPosition(dx + dw - w - margin, dy + dh - h - margin);
}

function createMiniPlayerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 80,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#121212",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devServerUrl = process.env.SPIRE_VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const u = new URL(devServerUrl);
    u.searchParams.set("miniPlayer", "true");
    void win.loadURL(u.toString());
  } else {
    const indexHtml = path.join(__dirname, "..", "renderer", "index.html");
    void win.loadFile(indexHtml, { query: { miniPlayer: "true" } });
  }

  miniPlayerWindow = win;
  setMiniPlayerWindowRef(win);

  win.on("closed", () => {
    miniPlayerWindow = null;
    setMiniPlayerWindowRef(null);
  });

  positionMiniPlayerBottomRight(win);
  return win;
}

function hideMiniPlayer(): void {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed() && miniPlayerWindow.isVisible()) {
    miniPlayerWindow.hide();
  }
}

function toggleMiniPlayer(): { visible: boolean } {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) {
    createMiniPlayerWindow();
  }
  const w = miniPlayerWindow!;
  if (w.isVisible()) {
    w.hide();
  } else {
    positionMiniPlayerBottomRight(w);
    w.show();
  }
  return { visible: w.isVisible() };
}

function routeMiniPlayerCommand(command: "play-pause" | "next" | "prev" | "close"): void {
  if (command === "close") {
    hideMiniPlayer();
    return;
  }
  sendMediaPlayback(command);
}

function registerAllIpc(): void {
  registerLibraryIpc();
  registerDownloadsIpc();
  registerSettingsIpc({ onKeyboardShortcutsChanged: registerConfigurableGlobalShortcuts });
  registerPlaybackIpc({
    toggleMiniPlayer,
    routeMiniPlayerCommand,
  });
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
      hideMiniPlayer();
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
    { type: "separator" },
    {
      label: "⏮ Previous",
      click: () => sendMediaPlayback("prev"),
    },
    {
      label: "⏯ Play / Pause",
      click: () => sendMediaPlayback("play-pause"),
    },
    {
      label: "⏭ Next",
      click: () => sendMediaPlayback("next"),
    },
    { type: "separator" },
    {
      label: "Mini Player",
      click: () => {
        void toggleMiniPlayer();
      },
    },
    { type: "separator" },
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

  setTrayTooltipFromStateHandler((playing, title) => {
    if (!tray || tray.isDestroyed()) {
      return;
    }
    if (playing && title && title.trim() !== "") {
      const t = title.length > 60 ? `${title.slice(0, 57)}…` : title;
      tray.setToolTip(`Spire — ${t}`);
    } else {
      tray.setToolTip("Spire");
    }
  });

  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function registerMediaKeyShortcuts(): void {
  const registrations: { accelerator: string; handler: () => void }[] = [
    { accelerator: "MediaPlayPause", handler: () => sendMediaPlayback("play-pause") },
    { accelerator: "MediaNextTrack", handler: () => sendMediaPlayback("next") },
    { accelerator: "MediaPreviousTrack", handler: () => sendMediaPlayback("prev") },
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
