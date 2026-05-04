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
    UPDATE_METADATA: "spire:library:update-metadata",
    FETCH_COVER_ART: "spire:library:fetch-cover-art",
    OPEN_COVER_DIALOG: "spire:library:open-cover-dialog",
    UPDATE_TAGS: "spire:library:update-tags",
    SET_STATUS: "spire:library:set-status",
    SET_WATCH_FOLDER: "spire:library:set-watch-folder",
    GET_WATCH_FOLDER: "spire:library:get-watch-folder",
    CLEAR_WATCH_FOLDER: "spire:library:clear-watch-folder",
  },
  downloads: {
    ADD_MAGNET: "spire:downloads:add-magnet",
    ADD_TORRENT_FILE: "spire:downloads:add-torrent-file",
    ADD_URL: "spire:downloads:add-url",
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
  rss: {
    FETCH_FEED: "spire:rss:fetch-feed",
    SAVE_FEED: "spire:rss:save-feed",
    GET_FEEDS: "spire:rss:get-feeds",
    DELETE_FEED: "spire:rss:delete-feed",
    DOWNLOAD_EPISODE: "spire:rss:download-episode",
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
  IPC_CHANNELS.library.UPDATE_METADATA,
  IPC_CHANNELS.library.FETCH_COVER_ART,
  IPC_CHANNELS.library.OPEN_COVER_DIALOG,
  IPC_CHANNELS.library.UPDATE_TAGS,
  IPC_CHANNELS.library.SET_STATUS,
  IPC_CHANNELS.library.SET_WATCH_FOLDER,
  IPC_CHANNELS.library.GET_WATCH_FOLDER,
  IPC_CHANNELS.library.CLEAR_WATCH_FOLDER,
  IPC_CHANNELS.downloads.ADD_MAGNET,
  IPC_CHANNELS.downloads.ADD_TORRENT_FILE,
  IPC_CHANNELS.downloads.ADD_URL,
  IPC_CHANNELS.downloads.PAUSE,
  IPC_CHANNELS.downloads.RESUME,
  IPC_CHANNELS.downloads.CANCEL,
  IPC_CHANNELS.downloads.RETRY,
  IPC_CHANNELS.downloads.GET_ALL,
  IPC_CHANNELS.rss.FETCH_FEED,
  IPC_CHANNELS.rss.SAVE_FEED,
  IPC_CHANNELS.rss.GET_FEEDS,
  IPC_CHANNELS.rss.DELETE_FEED,
  IPC_CHANNELS.rss.DOWNLOAD_EPISODE,
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
