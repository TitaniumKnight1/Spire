import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";

export function registerDownloadsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.downloads.STUB, async () => {
    console.log("[IPC downloads] stub invoked:", IPC_CHANNELS.downloads.STUB);
    return { ok: true, domain: "downloads" as const };
  });
}
