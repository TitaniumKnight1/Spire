/** Audio file extensions Spire will support (ingestion in a later milestone). */
export const SUPPORTED_AUDIO_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".m4b",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
  ".wav",
] as const;

/** Container extensions that may hold audiobook tracks. */
export const SUPPORTED_CONTAINER_EXTENSIONS = [".mp4", ".mkv"] as const;
