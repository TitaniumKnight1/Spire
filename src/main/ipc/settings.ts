import { app, ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { StatsSummary } from "../../shared/library-types.js";
import {
  DEFAULT_SHORTCUT_MAP,
  type EqPreset,
  type ShortcutMap,
} from "../../shared/library-types.js";
import { getAppSetting, getListeningStats, setAppSetting } from "../services/database.js";

export const SETTINGS_KEY_KEYBOARD_SHORTCUTS = "keyboard_shortcuts";
export const SETTINGS_KEY_SKIP_SILENCE = "skip_silence";
export const SETTINGS_KEY_EQ_PRESET = "eq_preset";
export const SETTINGS_KEY_DEFAULT_SPEED = "default_speed";
export const SETTINGS_KEY_DEFAULT_SLEEP_TIMER = "default_sleep_timer";
export const SETTINGS_KEY_AUTO_FETCH_COVERS = "auto_fetch_covers";
/** Stored JSON: `{"host":"127.0.0.1","port":1080}` — used when constructing WebTorrent (one-shot at startup). */
export const SETTINGS_KEY_TORRENT_PROXY = "torrent_proxy";

export type TorrentProxySetting = { host: string; port: number };

export function parseTorrentProxySetting(raw: string | null): TorrentProxySetting | null {
  if (!raw || raw.trim() === "") {
    return null;
  }
  try {
    const o = JSON.parse(raw) as { host?: unknown; port?: unknown };
    if (!o || typeof o !== "object") {
      return null;
    }
    const host = typeof o.host === "string" ? o.host.trim() : "";
    const portNum =
      typeof o.port === "number" ? o.port : typeof o.port === "string" ? Number(o.port) : Number.NaN;
    if (!host || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return null;
    }
    return { host, port: portNum };
  } catch {
    return null;
  }
}

const EQ_PRESET_SET = new Set<string>(["flat", "voice-clarity", "bass-boost"]);

const SLEEP_TIMER_VALUES = new Set<string>([
  "off",
  "15",
  "30",
  "45",
  "60",
  "end-chapter",
  "end-book",
]);

function parseShortcutMap(raw: string | null): ShortcutMap {
  if (!raw || raw.trim() === "") {
    return { ...DEFAULT_SHORTCUT_MAP };
  }
  try {
    const v = JSON.parse(raw) as Partial<ShortcutMap>;
    return {
      ...DEFAULT_SHORTCUT_MAP,
      ...v,
    };
  } catch {
    return { ...DEFAULT_SHORTCUT_MAP };
  }
}

/** Main process: read merged shortcut map from DB (for globalShortcut registration). */
export function loadShortcutMapFromDatabase(): ShortcutMap {
  const raw = getAppSetting(SETTINGS_KEY_KEYBOARD_SHORTCUTS);
  return parseShortcutMap(raw);
}

function isEqPreset(v: string): v is EqPreset {
  return EQ_PRESET_SET.has(v);
}

function clampDefaultSpeed(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) {
    return 1;
  }
  const clamped = Math.min(3.5, Math.max(0.5, n));
  return Math.round(clamped * 4) / 4;
}

export type SettingsIpcDeps = {
  onKeyboardShortcutsChanged: () => void;
};

export function registerSettingsIpc(deps: SettingsIpcDeps): void {
  const { onKeyboardShortcutsChanged } = deps;

  ipcMain.handle(IPC_CHANNELS.stats.GET_SUMMARY, async (): Promise<StatsSummary> => {
    return { stats: getListeningStats() };
  });

  ipcMain.handle(IPC_CHANNELS.settings.GET_APP_INFO, async (): Promise<{ version: string; platform: string }> => {
    return { version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle(IPC_CHANNELS.settings.GET_SHORTCUTS, async (): Promise<ShortcutMap> => {
    return loadShortcutMapFromDatabase();
  });

  ipcMain.handle(IPC_CHANNELS.settings.SAVE_SHORTCUTS, async (_event, payload: unknown): Promise<{ ok: boolean }> => {
    const map = payload as ShortcutMap;
    if (!map || typeof map !== "object") {
      return { ok: false };
    }
    const merged = { ...DEFAULT_SHORTCUT_MAP, ...map };
    setAppSetting(SETTINGS_KEY_KEYBOARD_SHORTCUTS, JSON.stringify(merged));
    onKeyboardShortcutsChanged();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.settings.GET_SKIP_SILENCE, async (): Promise<boolean> => {
    const v = getAppSetting(SETTINGS_KEY_SKIP_SILENCE);
    return v === "true";
  });

  ipcMain.handle(IPC_CHANNELS.settings.SAVE_SKIP_SILENCE, async (_event, enabled: unknown): Promise<{ ok: boolean }> => {
    setAppSetting(SETTINGS_KEY_SKIP_SILENCE, enabled === true ? "true" : "false");
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.settings.GET_EQ_PRESET, async (): Promise<EqPreset> => {
    const v = getAppSetting(SETTINGS_KEY_EQ_PRESET);
    if (v && isEqPreset(v)) {
      return v;
    }
    return "flat";
  });

  ipcMain.handle(IPC_CHANNELS.settings.SET_EQ_PRESET, async (_event, preset: unknown): Promise<{ ok: boolean }> => {
    const s = typeof preset === "string" ? preset : "";
    if (!isEqPreset(s)) {
      return { ok: false };
    }
    setAppSetting(SETTINGS_KEY_EQ_PRESET, s);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.settings.GET_DEFAULT_SPEED, async (): Promise<number> => {
    const raw = getAppSetting(SETTINGS_KEY_DEFAULT_SPEED);
    if (raw == null || raw.trim() === "") {
      return 1;
    }
    return clampDefaultSpeed(raw);
  });

  ipcMain.handle(IPC_CHANNELS.settings.SAVE_DEFAULT_SPEED, async (_event, value: unknown): Promise<{ ok: boolean }> => {
    const n = clampDefaultSpeed(value);
    setAppSetting(SETTINGS_KEY_DEFAULT_SPEED, String(n));
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.settings.GET_SLEEP_TIMER_DEFAULT, async (): Promise<string> => {
    const v = getAppSetting(SETTINGS_KEY_DEFAULT_SLEEP_TIMER);
    if (v && SLEEP_TIMER_VALUES.has(v)) {
      return v;
    }
    return "off";
  });

  ipcMain.handle(IPC_CHANNELS.settings.SAVE_SLEEP_TIMER_DEFAULT, async (_event, value: unknown): Promise<{ ok: boolean }> => {
    const s = typeof value === "string" ? value : "";
    if (!SLEEP_TIMER_VALUES.has(s)) {
      return { ok: false };
    }
    setAppSetting(SETTINGS_KEY_DEFAULT_SLEEP_TIMER, s);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.settings.GET_AUTO_FETCH_COVERS, async (): Promise<boolean> => {
    const v = getAppSetting(SETTINGS_KEY_AUTO_FETCH_COVERS);
    if (v == null || v.trim() === "") {
      return true;
    }
    return v === "true";
  });

  ipcMain.handle(IPC_CHANNELS.settings.SAVE_AUTO_FETCH_COVERS, async (_event, enabled: unknown): Promise<{ ok: boolean }> => {
    setAppSetting(SETTINGS_KEY_AUTO_FETCH_COVERS, enabled === true ? "true" : "false");
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.settings.SETTINGS_GET_TORRENT_PROXY, async (): Promise<TorrentProxySetting | null> => {
    const raw = getAppSetting(SETTINGS_KEY_TORRENT_PROXY);
    return parseTorrentProxySetting(raw);
  });

  ipcMain.handle(
    IPC_CHANNELS.settings.SETTINGS_SAVE_TORRENT_PROXY,
    async (_event, payload: unknown): Promise<{ ok: boolean }> => {
      if (payload === null) {
        setAppSetting(SETTINGS_KEY_TORRENT_PROXY, "");
        return { ok: true };
      }
      if (!payload || typeof payload !== "object") {
        return { ok: false };
      }
      const p = payload as { host?: unknown; port?: unknown };
      const host = typeof p.host === "string" ? p.host.trim() : "";
      const portNum =
        typeof p.port === "number" ? p.port : typeof p.port === "string" ? Number(p.port) : Number.NaN;
      if (!host || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return { ok: false };
      }
      setAppSetting(SETTINGS_KEY_TORRENT_PROXY, JSON.stringify({ host, port: portNum }));
      return { ok: true };
    },
  );

  ipcMain.handle(IPC_CHANNELS.settings.APP_RESTART_TO_UPDATE, async (): Promise<{ ok: boolean }> => {
    if (!app.isPackaged) {
      return { ok: false };
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { autoUpdater } = require("electron-updater");
    setImmediate(() => {
      autoUpdater.quitAndInstall();
    });
    return { ok: true };
  });
}
