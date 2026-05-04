import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";

export function registerPlaybackIpc(): void {
  ipcMain.handle(IPC_CHANNELS.playback.STUB, async () => {
    console.log("[IPC playback] stub invoked:", IPC_CHANNELS.playback.STUB);
    return { ok: true, domain: "playback" as const };
  });
}
