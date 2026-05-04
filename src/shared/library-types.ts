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
  date_added: string;
  total_duration: number | null;
  position_seconds: number;
  completed_at: string | null;
  progress_percent: number;
};

export type BookFileItem = {
  id: number;
  file_path: string;
  track_order: number | null;
  duration: number | null;
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
    description: string | null;
    status: string;
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
};

export type LibraryDeleteResult = {
  success: boolean;
};

export type LibraryOpenDialogResult = {
  canceled: boolean;
  paths: string[];
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
  display_name: string | null;
  speed_bps: number;
  eta_seconds: number | null;
  /** Present when status is failed after URL / yt-dlp errors */
  error_message: string | null;
};

/** Main → renderer pushed payload (no filesystem paths). */
export type TorrentProgress = {
  id: number;
  name: string;
  progress_pct: number;
  speed: number;
  status: string;
  eta: number | null;
};

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
