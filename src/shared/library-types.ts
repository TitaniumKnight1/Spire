/** Serialized book row for library list (IPC-safe). */
export type BookListItem = {
  id: number;
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_order: number | null;
  cover_art_url: string | null;
  description: string | null;
  status: string;
  /** Parsed from `books.tags` JSON (lowercase tags in DB). */
  tags: string[];
  date_added: string;
  total_duration: number | null;
  position_seconds: number;
  completed_at: string | null;
  progress_percent: number;
};

/** Renderer-side library toolbar filters (not persisted). */
export type FilterState = {
  query: string;
  status: "all" | "unstarted" | "in-progress" | "finished";
  tag: string | null;
  series: string | null;
  groupBySeries: boolean;
};

/** IPC payload for updating editable book fields from BookDetail. */
export type MetadataUpdate = {
  bookId: number;
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_order: number | null;
  description: string | null;
  /** Absolute path chosen in main-process dialog, or final covers path after save. */
  cover_art_path: string | null;
};

export type BookFileItem = {
  id: number;
  file_path: string;
  track_order: number | null;
  duration: number | null;
  /** Main-resolved playback URL (renderer never builds this manually). */
  playback_url: string | null;
  /** Set when `file_path` does not exist on disk after canonical resolution. */
  file_error: string | null;
};

export type BookChapterItem = {
  id: number;
  file_id: number;
  title: string | null;
  start_time: number | null;
  end_time: number | null;
};

/** Chapter for playback UI (alias of persisted chapter row shape). */
export type Chapter = BookChapterItem;

export type Bookmark = {
  id: number;
  book_id: number;
  file_id: number | null;
  position_seconds: number;
  note: string | null;
  created_at: string | null;
};

export type SleepTimerMode = "minutes" | "end-of-chapter" | "end-of-book";

export type SleepTimerState = {
  mode: SleepTimerMode;
  minutes?: number;
  endsAt?: number;
};

/** Equalizer preset id (persisted in settings). */
export type EqPreset = "flat" | "voice-clarity" | "bass-boost";

/** Single biquad stage for EQ presets (Web Audio API). */
export type EqBand =
  | { type: "highpass"; frequency: number; gain?: number }
  | { type: "lowshelf"; frequency: number; gain: number }
  | { type: "peaking"; frequency: number; gain: number; Q: number };

/** Main → all renderers: compact playback UI state for mini-player + tray. */
export type PlayerStatePushPayload = {
  isPlaying: boolean;
  title: string | null;
  author: string | null;
  /** Library cover URL or file URL string for `<img src>` / hydration. */
  coverArtUrl: string | null;
  position: number;
  duration: number;
};

/** Keyboard shortcut map (Electron accelerator strings + Space/Arrow labels). */
export type ShortcutMap = {
  playPause: string;
  nextChapter: string;
  prevChapter: string;
  nextFile: string;
  prevFile: string;
  seekForward30: string;
  seekBack30: string;
  speedUp: string;
  speedDown: string;
  toggleMiniPlayer: string;
};

export const DEFAULT_SHORTCUT_MAP: ShortcutMap = {
  playPause: "Space",
  nextChapter: "Right",
  prevChapter: "Left",
  nextFile: "Shift+Right",
  prevFile: "Shift+Left",
  seekForward30: "F",
  seekBack30: "B",
  speedUp: "Shift+.",
  speedDown: "Shift+,",
  toggleMiniPlayer: "CommandOrControl+M",
};

/** Snapshot of playback for UI (subset of store). */
export type PlaybackState = {
  isPlaying: boolean;
  position: number;
  duration: number;
  speed: number;
  currentFileIndex: number;
  currentChapterIndex: number;
};

export type BookProgressItem = {
  book_id: number;
  position_seconds: number;
  playback_speed: number;
  current_file_id: number | null;
  last_listened_at: string | null;
  completed_at: string | null;
};

export type BookDetailPayload = {
  book: {
    id: number;
    title: string;
    author: string | null;
    narrator: string | null;
    series: string | null;
    series_order: number | null;
    cover_art_url: string | null;
    /** Absolute path on disk for metadata saves and cover picker (same row as `cover_art_url`). */
    cover_art_path: string | null;
    description: string | null;
    status: string;
    tags: string[];
    date_added: string;
    total_duration: number | null;
  };
  files: BookFileItem[];
  chapters: BookChapterItem[];
  progress: BookProgressItem | null;
  progress_percent: number;
};

export type LibraryIngestResult = {
  success: boolean;
  booksAdded: number;
  errors: string[];
  /** Set when new books are created or updated during ingest (best-effort). */
  bookIds: number[];
  /** Book IDs created in this ingest (not appended-to-existing). */
  newBookIds: number[];
};

/** Aggregated listening metrics (computed from `progress` + `books`). */
export type ListeningStats = {
  hoursThisWeek: number;
  hoursThisMonth: number;
  hoursAllTime: number;
  booksCompleted: number;
  booksInProgress: number;
  avgPlaybackSpeed: number;
  currentStreak: number;
  longestStreak: number;
};

/** IPC payload for {@link IPC_CHANNELS.stats.GET_SUMMARY}. */
export type StatsSummary = {
  stats: ListeningStats;
};

export type LibraryDeleteResult = {
  success: boolean;
};

export type LibraryOpenDialogResult = {
  canceled: boolean;
  paths: string[];
};

export type LibraryOpenCoverDialogResult = {
  canceled: boolean;
  path: string | null;
};

export type LibraryUpdateTagsPayload = {
  bookId: number;
  tags: string[];
};

export type LibrarySetStatusPayload = {
  bookId: number;
  status: "unstarted" | "in-progress" | "finished";
};

export type DownloadSourceType = "magnet" | "torrent_file" | "http" | "ytdlp" | "rss";

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** Renderer-safe download row (hydrated from DB + pushed progress fields). */
export type DownloadItem = {
  id: number;
  source_type: DownloadSourceType;
  status: DownloadStatus;
  progress_pct: number;
  book_id: number | null;
  started_at: string | null;
  completed_at: string | null;
  /** Persisted label from main DB (`downloads.display_name`). */
  display_name: string | null;
  /** Live title from progress (e.g. aria2 `bittorrent.info.name`); prefer for queue chrome while downloading. */
  displayName: string | null;
  /** Original magnet / URL / file path for UI fallback when no name is known. */
  source_url: string | null;
  speed_bps: number;
  eta_seconds: number | null;
  /** Present when status is failed after URL / yt-dlp errors */
  error_message: string | null;
};

/** Main → renderer pushed payload (no filesystem paths). */
export type DownloadProgressPush = {
  id: number;
  /** Resolved row label for progress bar (DB display_name or torrent name or placeholder). */
  name: string;
  /** Torrent display name from metadata when known (aria2 `bittorrent.info.name`); omit for HTTP/yt-dlp. */
  torrentName?: string | null;
  progress_pct: number;
  speed: number;
  status: string;
  eta: number | null;
};

/** Main → renderer when a URL / torrent / HTTP download finishes successfully. */
export type DownloadCompletedPush = {
  downloadId: number;
  bookId: number;
};

/** @deprecated Use {@link DownloadProgressPush} — kept for renderer hook typing. */
export type TorrentProgress = DownloadProgressPush;

/** Parsed RSS/Atom episode for IPC (not persisted). */
export type RssEpisode = {
  title: string;
  url: string;
  duration: number | null;
  pubDate: string | null;
  description: string | null;
};

/** Feed preview / episode list payload from {@link IPC_CHANNELS.rss.FETCH_FEED}. */
export type RssFeedPayload = {
  title: string;
  description: string | null;
  coverUrl: string | null;
  episodes: RssEpisode[];
};

/** Saved podcast_feeds row (IPC-safe). */
export type SavedPodcastFeed = {
  id: number;
  title: string | null;
  feed_url: string;
  last_fetched: string | null;
  cover_art_url: string | null;
};
