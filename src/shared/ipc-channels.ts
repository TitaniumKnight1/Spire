/**
 * Single source of truth for IPC channel names (main, preload, renderer).
 */

export const IPC_CHANNELS = {
  library: {
    ADD_PATHS: "spire:library:add-paths",
    GET_ALL: "spire:library:get-all",
    GET_BOOK: "spire:library:get-book",
    DELETE_BOOK: "spire:library:delete-book",
    OPEN_FILE_DIALOG: "spire:library:open-file-dialog",
  },
  downloads: {
    STUB: "spire:downloads:stub",
  },
  playback: {
    STUB: "spire:playback:stub",
  },
  settings: {
    STUB: "spire:settings:stub",
  },
} as const;

export const IPC_INVOKE_CHANNELS = [
  IPC_CHANNELS.library.ADD_PATHS,
  IPC_CHANNELS.library.GET_ALL,
  IPC_CHANNELS.library.GET_BOOK,
  IPC_CHANNELS.library.DELETE_BOOK,
  IPC_CHANNELS.library.OPEN_FILE_DIALOG,
  IPC_CHANNELS.downloads.STUB,
  IPC_CHANNELS.playback.STUB,
  IPC_CHANNELS.settings.STUB,
] as const;

export type IpcInvokeChannel = (typeof IPC_INVOKE_CHANNELS)[number];

export function isIpcInvokeChannel(channel: string): channel is IpcInvokeChannel {
  return (IPC_INVOKE_CHANNELS as readonly string[]).includes(channel);
}
