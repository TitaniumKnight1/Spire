import { execFile } from "node:child_process";
import path from "node:path";
import { BrowserWindow, Menu, Tray, app, globalShortcut, nativeImage, screen } from "electron";
import { setMainWindowRef, setMiniPlayerWindowRef, setTrayTooltipFromStateHandler } from "./broadcast-state.js";
import { registerDownloadsIpc, setDownloadsBrowserWindow } from "./ipc/downloads.js";
import { registerLibraryIpc } from "./ipc/library.js";
import { registerPlaybackIpc } from "./ipc/playback.js";
import { loadShortcutMapFromDatabase, registerSettingsIpc } from "./ipc/settings.js";
import { initializeDatabase } from "./services/database.js";
import { resumeUrlDownloadsAfterBoot } from "./services/downloader.js";
import { MpvService } from "./services/mpv.js";
import { restartWatcherFromSettings } from "./services/watcher.js";
import { startAudioServer } from "./services/audio-server.js";
import { checkForUpdates } from "./services/updater.js";
import { getCoversDirectory, getLibraryDirectory } from "./utils/paths.js";
import { IPC_CHANNELS } from "../shared/ipc-channels.js";

let mainWindow: BrowserWindow | null = null;
let miniPlayerWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const mpvService = new MpvService();

function toggleMainWindowDevTools(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const wc = mainWindow.webContents;
  if (wc.isDevToolsOpened()) {
    wc.closeDevTools();
  } else {
    wc.openDevTools({ mode: "detach" });
  }
}

function isDevToolsShortcut(input: Electron.Input): boolean {
  if (input.key === "F12") {
    return true;
  }
  const k = input.key.length === 1 ? input.key.toLowerCase() : input.key.toLowerCase();
  if (k !== "i") {
    return false;
  }
  if (input.control && input.shift) {
    return true;
  }
  if (process.platform === "darwin" && input.meta && input.alt) {
    return true;
  }
  return false;
}

type MediaPlaybackAction = "play-pause" | "next" | "prev" | "seek-forward-30" | "seek-back-30";

let configAccelRegistered: { mini: string } | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    const libraryDirectory = getLibraryDirectory();
    const coversDirectory = getCoversDirectory();
    const audioServer = await startAudioServer(libraryDirectory, coversDirectory);
    app.on("will-quit", () => {
      audioServer.close();
    });

    initializeDatabase();
    restartWatcherFromSettings();

    try {
      await mpvService.start();
    } catch (e) {
      console.warn("[mpv] start failed (install mpv.exe into binaries/):", e);
    }

    registerAllIpc();

    mainWindow = createMainWindow();
    mainWindow.webContents.on("before-input-event", (_event, input) => {
      if (isDevToolsShortcut(input)) {
        toggleMainWindowDevTools();
      }
    });
    setMainWindowRef(mainWindow);
    ensureFirewallRules();
    setDownloadsBrowserWindow(mainWindow);

    try {
      resumeUrlDownloadsAfterBoot();
    } catch (e) {
      console.error("[spire] downloads bootstrap failed:", e);
    }

    createTray();
    registerMediaKeyShortcuts();
    registerConfigurableGlobalShortcuts();
  });
}

/**
 * Best-effort Windows Firewall rules for BitTorrent traffic (6881–6889; used by aria2c + legacy).
 * Requires elevation to succeed; fails silently when not admin (typical in dev).
 * Rule names must be unique per entry (separate TCP/UDP rules).
 */
function ensureFirewallRules(): void {
  if (process.platform !== "win32") {
    return;
  }

  const exePath = process.execPath;
  const markerRule = "Spire Audiobook Player - App TCP";

  execFile("netsh", ["advfirewall", "firewall", "show", "rule", `name=${markerRule}`], (err, stdout) => {
    if (!err && stdout.includes(markerRule)) {
      return;
    }

    const run = (args: string[]) => {
      execFile("netsh", args, () => {
        /* ignore: often no admin in dev */
      });
    };

    run([
      "advfirewall",
      "firewall",
      "add",
      "rule",
      `name=${markerRule}`,
      "dir=in",
      "action=allow",
      `program="${exePath}"`,
      "protocol=TCP",
      "enable=yes",
      "profile=any",
    ]);

    run([
      "advfirewall",
      "firewall",
      "add",
      "rule",
      "name=Spire Audiobook Player - App UDP",
      "dir=in",
      "action=allow",
      `program="${exePath}"`,
      "protocol=UDP",
      "enable=yes",
      "profile=any",
    ]);

    run([
      "advfirewall",
      "firewall",
      "add",
      "rule",
      "name=Spire Audiobook Player - Ports TCP",
      "dir=in",
      "action=allow",
      "protocol=TCP",
      "localport=6881-6889",
      "enable=yes",
      "profile=any",
    ]);

    run([
      "advfirewall",
      "firewall",
      "add",
      "rule",
      "name=Spire Audiobook Player - Ports UDP",
      "dir=in",
      "action=allow",
      "protocol=UDP",
      "localport=6881-6889",
      "enable=yes",
      "profile=any",
    ]);
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
  for (const acc of [configAccelRegistered.mini]) {
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
  const { toggleMiniPlayer: miniAcc } = map;

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

  tryRegister(miniAcc, () => {
    void toggleMiniPlayer();
  });

  configAccelRegistered = { mini: miniAcc };
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
      /**
       * Dev loads the UI from `http://localhost:*` (Vite) while audio is served from
       * `http://127.0.0.1:*`. Chromium treats that as cross-origin; without this, the
       * media pipeline can reject MP3 loads with FFmpegDemuxer errors even when HEAD succeeds.
       * Packaged builds use `loadFile` (no dev URL) — keep full web security there.
       */
      webSecurity: !process.env.SPIRE_VITE_DEV_SERVER_URL,
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
    mpvService,
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
      /**
       * Dev loads the UI from `http://localhost:*` (Vite) while audio is served from
       * `http://127.0.0.1:*`. Chromium treats that as cross-origin; without this, the
       * media pipeline can reject MP3 loads with FFmpegDemuxer errors even when HEAD succeeds.
       * Packaged builds use `loadFile` (no dev URL) — keep full web security there.
       */
      webSecurity: !process.env.SPIRE_VITE_DEV_SERVER_URL,
    },
  });

  Menu.setApplicationMenu(null);

  win.once("ready-to-show", () => {
    win.show();
    if (process.env.SPIRE_VITE_DEV_SERVER_URL) {
      win.webContents.openDevTools({ mode: "detach" });
    }
  });

  const devServerUrl = process.env.SPIRE_VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    const indexHtml = path.join(__dirname, "..", "renderer", "index.html");
    void win.loadFile(indexHtml);
  }

  win.webContents.on("did-finish-load", () => {
    setTimeout(() => {
      checkForUpdates(win);
    }, 3000);
  });

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
    {
      label: "Toggle Developer Tools",
      accelerator: "F12",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
        toggleMainWindowDevTools();
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
  mpvService.quit();
});
