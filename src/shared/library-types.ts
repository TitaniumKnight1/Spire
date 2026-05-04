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
  title: string | null;
  start_time: number | null;
  end_time: number | null;
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
};

export type LibraryDeleteResult = {
  success: boolean;
};

export type LibraryOpenDialogResult = {
  canceled: boolean;
  paths: string[];
};
