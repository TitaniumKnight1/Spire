import { useCallback, useMemo } from "react";
import { IPC_CHANNELS, type IpcInvokeChannel } from "@shared/ipc-channels";

type ElectronIpc = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, callback: (...payload: unknown[]) => void): () => void;
};

function getIpc(): ElectronIpc {
  const bridge = window.electron?.ipc;
  if (!bridge) {
    throw new Error("window.electron.ipc is not available (preload missing?)");
  }
  return bridge;
}

export type IpcStubResult = { ok: boolean; domain: "library" | "downloads" | "playback" | "settings" | "podcasts" };

export function useIPC(): {
  invoke: <T = unknown>(channel: IpcInvokeChannel, ...args: unknown[]) => Promise<T>;
  subscribe: (channel: string, handler: (...payload: unknown[]) => void) => () => void;
  pingDomain: (domain: "library" | "downloads" | "podcasts" | "settings") => Promise<IpcStubResult>;
} {
  const invoke = useCallback(
    <T = unknown,>(channel: IpcInvokeChannel, ...args: unknown[]) => {
      return getIpc().invoke(channel, ...args) as Promise<T>;
    },
    [],
  );

  const subscribe = useCallback((channel: string, handler: (...payload: unknown[]) => void) => {
    return getIpc().on(channel, handler);
  }, []);

  const pingDomain = useCallback(
    (domain: "library" | "downloads" | "podcasts" | "settings"): Promise<IpcStubResult> => {
      if (domain === "library") {
        return Promise.resolve({ ok: true, domain: "library" as const });
      }
      if (domain === "downloads") {
        return Promise.resolve({ ok: true, domain: "downloads" as const });
      }
      if (domain === "podcasts") {
        return Promise.resolve({ ok: true, domain: "podcasts" as const });
      }
      return invoke(IPC_CHANNELS.settings.GET_SHORTCUTS).then(() => ({
        ok: true,
        domain: "settings" as const,
      }));
    },
    [invoke],
  );

  return useMemo(
    () => ({
      invoke,
      subscribe,
      pingDomain,
    }),
    [invoke, subscribe, pingDomain],
  );
}

declare global {
  interface Window {
    electron?: {
      ipc: ElectronIpc;
      getPathForFile?: (file: File) => string;
    };
  }
}

export {};
