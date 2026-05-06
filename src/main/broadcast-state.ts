import type { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../shared/ipc-channels.js";
import type { PlayerStatePushPayload } from "../shared/library-types.js";

let mainWindow: BrowserWindow | null = null;
let miniPlayerWindow: BrowserWindow | null = null;

type TrayTipHandler = (playing: boolean, title: string | null) => void;
let trayTipHandler: TrayTipHandler | null = null;

export function setMainWindowRef(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function setMiniPlayerWindowRef(win: BrowserWindow | null): void {
  miniPlayerWindow = win;
}

export function setTrayTooltipFromStateHandler(fn: TrayTipHandler | null): void {
  trayTipHandler = fn;
}

export function broadcastPlayerState(payload: PlayerStatePushPayload): void {
  for (const win of [mainWindow, miniPlayerWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.playback.STATE_PUSH, payload);
    }
  }
  trayTipHandler?.(payload.isPlaying, payload.title);
}

export function broadcastLibraryUpdated(payload: { bookIds: number[] }): void {
  for (const win of [mainWindow, miniPlayerWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.library.UPDATED, payload);
    }
  }
}

/** Fan-out main → renderer(s) for mpv-driven playback events. */
export function broadcastPlaybackChannel(channel: string, ...payload: unknown[]): void {
  for (const win of [mainWindow, miniPlayerWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...payload);
    }
  }
}
