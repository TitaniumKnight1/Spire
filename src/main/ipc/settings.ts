import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.settings.STUB, async () => {
    console.log("[IPC settings] stub invoked:", IPC_CHANNELS.settings.STUB);
    return { ok: true, domain: "settings" as const };
  });
}
