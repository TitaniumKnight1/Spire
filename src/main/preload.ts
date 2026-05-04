import { contextBridge, ipcRenderer, webUtils } from "electron";
import { isIpcInvokeChannel, type IpcInvokeChannel } from "../shared/ipc-channels.js";

function assertInvokeChannel(channel: string): asserts channel is IpcInvokeChannel {
  if (!isIpcInvokeChannel(channel)) {
    throw new Error(`Disallowed IPC invoke channel: ${channel}`);
  }
}

contextBridge.exposeInMainWorld("electron", {
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  ipc: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      assertInvokeChannel(channel);
      return ipcRenderer.invoke(channel, ...args);
    },
    on(channel: string, callback: (...payload: unknown[]) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, ...payload: unknown[]) => {
        callback(...payload);
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
  },
});
