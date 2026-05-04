import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, Tray, app, nativeImage } from "electron";
import { registerDownloadsIpc } from "./ipc/downloads.js";
import { registerLibraryIpc } from "./ipc/library.js";
import { registerPlaybackIpc } from "./ipc/playback.js";
import { registerSettingsIpc } from "./ipc/settings.js";
import { initializeDatabase } from "./services/database.js";
import { checkForUpdates } from "./services/updater.js";

void checkForUpdates; // keep import for Milestone 9; do not invoke yet

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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

void app.whenReady().then(() => {
  initializeDatabase();
  registerAllIpc();
  mainWindow = createMainWindow();
  createTray();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Keep background behavior on Windows/Linux: app stays alive via tray.
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});
