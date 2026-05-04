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
}
