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
    ADD_MAGNET: "spire:downloads:add-magnet",
    ADD_TORRENT_FILE: "spire:downloads:add-torrent-file",
    PAUSE: "spire:downloads:pause",
    RESUME: "spire:downloads:resume",
    CANCEL: "spire:downloads:cancel",
    RETRY: "spire:downloads:retry",
    GET_ALL: "spire:downloads:get-all",
    /** Main → renderer (not invoke). */
    PROGRESS_UPDATE: "spire:downloads:progress-update",
    /** Main → renderer (not invoke). */
    COMPLETED: "spire:downloads:completed",
  },
  playback: {
    SAVE_PROGRESS: "spire:playback:save-progress",
    MARK_COMPLETE: "spire:playback:mark-complete",
    GET_BOOKMARKS: "spire:playback:get-bookmarks",
    ADD_BOOKMARK: "spire:playback:add-bookmark",
    DELETE_BOOKMARK: "spire:playback:delete-bookmark",
    /** Main → renderer (not invoke). */
    MEDIA_KEY: "spire:playback:media-key",
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
  IPC_CHANNELS.downloads.ADD_MAGNET,
  IPC_CHANNELS.downloads.ADD_TORRENT_FILE,
  IPC_CHANNELS.downloads.PAUSE,
  IPC_CHANNELS.downloads.RESUME,
  IPC_CHANNELS.downloads.CANCEL,
  IPC_CHANNELS.downloads.RETRY,
  IPC_CHANNELS.downloads.GET_ALL,
  IPC_CHANNELS.playback.SAVE_PROGRESS,
  IPC_CHANNELS.playback.MARK_COMPLETE,
  IPC_CHANNELS.playback.GET_BOOKMARKS,
  IPC_CHANNELS.playback.ADD_BOOKMARK,
  IPC_CHANNELS.playback.DELETE_BOOKMARK,
  IPC_CHANNELS.settings.STUB,
] as const;

export type IpcInvokeChannel = (typeof IPC_INVOKE_CHANNELS)[number];

export function isIpcInvokeChannel(channel: string): channel is IpcInvokeChannel {
  return (IPC_INVOKE_CHANNELS as readonly string[]).includes(channel);
}
