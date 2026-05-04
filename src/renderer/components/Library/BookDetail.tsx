import { type ReactElement, useCallback, useEffect, useState } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { BookDetailPayload } from "@shared/library-types";
import { useIPC } from "../../hooks/useIPC.js";
import { usePlayer } from "../../hooks/usePlayer.js";
import { useLibrary } from "../../hooks/useLibrary.js";
import { usePlayerStore } from "../../store/playerStore.js";
import { formatDuration } from "../../utils/formatDuration.js";

function initials(title: string, author: string | null): string {
  const a = (author || title).trim();
  const parts = a.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return a.slice(0, 2).toUpperCase() || "?";
}

export function BookDetail({
  bookId,
  onClose,
}: {
  bookId: number;
  onClose: () => void;
}): ReactElement {
  const { invoke } = useIPC();
  const { deleteBook } = useLibrary();
  const { loadBook, play, pause } = usePlayer();
  const currentBookId = usePlayerStore((s) => s.currentBook?.id ?? null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const [detail, setDetail] = useState<BookDetailPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await invoke<BookDetailPayload | null>(IPC_CHANNELS.library.GET_BOOK, bookId);
      setDetail(d);
      if (!d) {
        setLoadError("Book not found.");
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load book.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [invoke, bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDelete = useCallback(async () => {
    if (!window.confirm("Delete this book from the library? This cannot be undone.")) {
      return;
    }
    await deleteBook(bookId);
    onClose();
  }, [bookId, deleteBook, onClose]);

  const activeHere = currentBookId === bookId;
  const playingHere = activeHere && isPlaying;

  const onPlayClick = useCallback(async () => {
    if (playingHere) {
      pause();
      return;
    }
    if (activeHere && !isPlaying) {
      play();
      return;
    }
    await loadBook(bookId);
    play();
  }, [activeHere, bookId, isPlaying, loadBook, pause, play, playingHere]);

  if (loading) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 50,
        }}
        role="presentation"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          style={{
            background: "#1a1a1a",
            borderRadius: 12,
            padding: 24,
            minWidth: 280,
            border: "1px solid #333",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p style={{ margin: 0 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 50,
        }}
        role="presentation"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          style={{
            background: "#1a1a1a",
            borderRadius: 12,
            padding: 24,
            minWidth: 280,
            border: "1px solid #333",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p style={{ margin: 0 }}>{loadError ?? "Book not found."}</p>
          <button type="button" onClick={onClose} style={{ marginTop: 16 }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const { book, files, chapters, progress_percent } = detail;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 24,
      }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          background: "#141414",
          borderRadius: 16,
          maxWidth: 900,
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          border: "1px solid #2a2a2a",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px 0", gap: 8 }}>
          <button type="button" onClick={onClose} style={{ cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 24, padding: "0 24px 24px" }}>
          <div>
            <div
              style={{
                width: "100%",
                aspectRatio: "1",
                borderRadius: 12,
                overflow: "hidden",
                background: "#222",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {book.cover_art_url ? (
                <img src={book.cover_art_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 48, fontWeight: 700, color: "#555" }}>{initials(book.title, book.author)}</span>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "#777" }}>
              Progress: {progress_percent.toFixed(0)}%
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>{book.title}</h2>
            <div style={{ color: "#aaa", fontSize: 14 }}>
              <div>
                <strong style={{ color: "#888" }}>Author:</strong> {book.author ?? "—"}
              </div>
              <div>
                <strong style={{ color: "#888" }}>Narrator:</strong> {book.narrator ?? "—"}
              </div>
              {book.series ? (
                <div>
                  <strong style={{ color: "#888" }}>Series:</strong> {book.series}
                  {book.series_order != null ? ` (#${book.series_order})` : ""}
                </div>
              ) : null}
            </div>
            {book.description ? (
              <p style={{ margin: 0, color: "#bbb", fontSize: 14, lineHeight: 1.5 }}>{book.description}</p>
            ) : (
              <p style={{ margin: 0, color: "#555", fontSize: 13 }}>No description.</p>
            )}

            <div>
              <h3 style={{ fontSize: 15, margin: "16px 0 8px" }}>Files</h3>
              <ul style={{ margin: 0, paddingLeft: 18, color: "#ccc", fontSize: 13 }}>
                {files.map((f) => (
                  <li key={f.id} style={{ marginBottom: 4 }}>
                    <span style={{ color: "#888" }}>#{f.track_order ?? "?"}</span>{" "}
                    {f.file_path.split(/[/\\]/).pop() ?? f.file_path} — {formatDuration(f.duration)}
                  </li>
                ))}
              </ul>
            </div>

            {chapters.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 15, margin: "16px 0 8px" }}>Chapters</h3>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#ccc", fontSize: 13, maxHeight: 200, overflow: "auto" }}>
                  {chapters.map((c) => (
                    <li key={c.id} style={{ marginBottom: 4 }}>
                      {c.title ?? "Chapter"} — {formatDuration(c.start_time)}{" "}
                      {c.end_time != null ? `– ${formatDuration(c.end_time)}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 12, marginTop: "auto", paddingTop: 16 }}>
              <button
                type="button"
                onClick={() => void onPlayClick()}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: playingHere ? "#1a3a1a" : "#2a6cff22",
                  color: playingHere ? "#8d8" : "#e8e8e8",
                  cursor: "pointer",
                }}
              >
                {playingHere ? "Playing… (pause)" : activeHere && !isPlaying ? "Resume" : "Play"}
              </button>
              <button
                type="button"
                onClick={() => void onDelete()}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "1px solid #522",
                  background: "#301818",
                  color: "#e88",
                  cursor: "pointer",
                }}
              >
                Delete book
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
