import { type ReactElement, useCallback, useEffect, useState } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { BookDetailPayload, LibrarySetStatusPayload, MetadataUpdate } from "@shared/library-types";
import { useIPC } from "../../hooks/useIPC.js";
import { useLibrary } from "../../hooks/useLibrary.js";
import { usePlayer } from "../../hooks/usePlayer.js";
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

type Draft = {
  title: string;
  author: string | null;
  narrator: string | null;
  series: string | null;
  series_order: number | null;
  description: string | null;
  cover_art_path: string | null;
};

export function BookDetail({
  bookId,
  onClose,
}: {
  bookId: number;
  onClose: () => void;
}): ReactElement {
  const { invoke } = useIPC();
  const {
    deleteBook,
    updateMetadata,
    updateTags,
    setBookStatus,
    fetchCoverArt,
    openCoverDialog,
  } = useLibrary();
  const { loadBook, play, pause } = usePlayer();
  const currentBookId = usePlayerStore((s) => s.currentBook?.id ?? null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const [detail, setDetail] = useState<BookDetailPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [fetchingCover, setFetchingCover] = useState(false);

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

  const beginEdit = useCallback(() => {
    if (!detail) {
      return;
    }
    const { book } = detail;
    setDraft({
      title: book.title,
      author: book.author,
      narrator: book.narrator,
      series: book.series,
      series_order: book.series_order,
      description: book.description,
      cover_art_path: book.cover_art_path,
    });
    setEditing(true);
  }, [detail]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(null);
  }, []);

  const saveMetadata = useCallback(async () => {
    if (!draft) {
      return;
    }
    setSavingMeta(true);
    try {
      const payload: MetadataUpdate = {
        bookId,
        title: draft.title.trim() || "Untitled",
        author: draft.author?.trim() ? draft.author.trim() : null,
        narrator: draft.narrator?.trim() ? draft.narrator.trim() : null,
        series: draft.series?.trim() ? draft.series.trim() : null,
        series_order:
          draft.series_order === null || draft.series_order === undefined || Number.isNaN(Number(draft.series_order))
            ? null
            : Number(draft.series_order),
        description: draft.description?.trim() ? draft.description.trim() : null,
        cover_art_path: draft.cover_art_path,
      };
      await updateMetadata(payload);
      await load();
      setEditing(false);
      setDraft(null);
    } finally {
      setSavingMeta(false);
    }
  }, [bookId, draft, load, updateMetadata]);

  const onPickCover = useCallback(async () => {
    const res = await openCoverDialog();
    if (res.canceled || !res.path) {
      return;
    }
    setDraft((d) => (d ? { ...d, cover_art_path: res.path } : d));
  }, [openCoverDialog]);

  const onFetchCover = useCallback(async () => {
    setFetchingCover(true);
    try {
      await fetchCoverArt(bookId);
      await load();
      if (draft) {
        const d = await invoke<BookDetailPayload | null>(IPC_CHANNELS.library.GET_BOOK, bookId);
        if (d?.book.cover_art_path) {
          setDraft((prev) =>
            prev ? { ...prev, cover_art_path: d.book.cover_art_path ?? prev.cover_art_path } : prev,
          );
        }
      }
    } finally {
      setFetchingCover(false);
    }
  }, [bookId, draft, fetchCoverArt, invoke, load]);

  const onStatusChange = useCallback(
    async (status: LibrarySetStatusPayload["status"]) => {
      await setBookStatus({ bookId, status });
      await load();
    },
    [bookId, load, setBookStatus],
  );

  const onRemoveTag = useCallback(
    async (tag: string) => {
      if (!detail) {
        return;
      }
      await updateTags({ bookId, tags: detail.book.tags.filter((t) => t !== tag) });
      await load();
    },
    [bookId, detail, load, updateTags],
  );

  const onAddTag = useCallback(async () => {
    const raw = tagInput.trim();
    if (!raw || !detail) {
      return;
    }
    await updateTags({ bookId, tags: [...detail.book.tags, raw] });
    setTagInput("");
    await load();
  }, [bookId, detail, load, tagInput, updateTags]);

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
  const displayDraft = editing && draft ? draft : null;
  const coverDisplayUrl = editing && draft && draft.cover_art_path !== book.cover_art_path ? null : book.cover_art_url;
  const coverHint =
    editing && draft && draft.cover_art_path && draft.cover_art_path !== book.cover_art_path
      ? "New cover selected — save to apply."
      : null;

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
            <button
              type="button"
              onClick={() => {
                if (editing) {
                  void onPickCover();
                }
              }}
              disabled={!editing}
              style={{
                width: "100%",
                aspectRatio: "1",
                borderRadius: 12,
                overflow: "hidden",
                background: "#222",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: editing ? "2px dashed #4a8fd4" : "none",
                padding: 0,
                cursor: editing ? "pointer" : "default",
              }}
            >
              {coverDisplayUrl ? (
                <img src={coverDisplayUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 48, fontWeight: 700, color: "#555" }}>{initials(book.title, book.author)}</span>
              )}
            </button>
            {coverHint ? (
              <p style={{ fontSize: 11, color: "#8ab4e6", marginTop: 8 }}>{coverHint}</p>
            ) : null}
            <div style={{ marginTop: 12, fontSize: 12, color: "#777" }}>
              Progress: {progress_percent.toFixed(0)}%
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, color: "#888" }}>
                Status
                <select
                  value={book.status}
                  onChange={(e) => void onStatusChange(e.target.value as LibrarySetStatusPayload["status"])}
                  style={{
                    display: "block",
                    marginTop: 4,
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #333",
                    background: "#1a1a1a",
                    color: "#e8e8e8",
                  }}
                >
                  <option value="unstarted">Unstarted</option>
                  <option value="in-progress">In Progress</option>
                  <option value="finished">Finished</option>
                </select>
              </label>
              <button
                type="button"
                disabled={fetchingCover}
                onClick={() => void onFetchCover()}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #335",
                  background: "#1e2838",
                  color: "#b8d4f0",
                  cursor: fetchingCover ? "wait" : "pointer",
                }}
              >
                {fetchingCover ? "Fetching…" : "Fetch Cover Art"}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 22 }}>
                {editing && displayDraft ? (
                  <input
                    value={displayDraft.title}
                    onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                    style={{
                      width: "100%",
                      fontSize: 22,
                      padding: "4px 8px",
                      borderRadius: 8,
                      border: "1px solid #333",
                      background: "#0f0f0f",
                      color: "#e8e8e8",
                    }}
                  />
                ) : (
                  book.title
                )}
              </h2>
              {!editing ? (
                <button type="button" onClick={beginEdit} style={{ padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}>
                  Edit
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    disabled={savingMeta}
                    onClick={() => void saveMetadata()}
                    style={{ padding: "8px 14px", borderRadius: 8, cursor: savingMeta ? "wait" : "pointer" }}
                  >
                    {savingMeta ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={cancelEdit} style={{ padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>

            <div style={{ color: "#aaa", fontSize: 14 }}>
              <div>
                <strong style={{ color: "#888" }}>Author:</strong>{" "}
                {editing && displayDraft ? (
                  <input
                    value={displayDraft.author ?? ""}
                    onChange={(e) => setDraft((d) => (d ? { ...d, author: e.target.value || null } : d))}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #333", background: "#0f0f0f", color: "#e8e8e8" }}
                  />
                ) : (
                  book.author ?? "—"
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <strong style={{ color: "#888" }}>Narrator:</strong>{" "}
                {editing && displayDraft ? (
                  <input
                    value={displayDraft.narrator ?? ""}
                    onChange={(e) => setDraft((d) => (d ? { ...d, narrator: e.target.value || null } : d))}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #333", background: "#0f0f0f", color: "#e8e8e8" }}
                  />
                ) : (
                  book.narrator ?? "—"
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <strong style={{ color: "#888" }}>Series:</strong>{" "}
                {editing && displayDraft ? (
                  <input
                    value={displayDraft.series ?? ""}
                    onChange={(e) => setDraft((d) => (d ? { ...d, series: e.target.value || null } : d))}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #333", background: "#0f0f0f", color: "#e8e8e8" }}
                  />
                ) : book.series ? (
                  book.series
                ) : (
                  "—"
                )}
                {editing && displayDraft ? (
                  <span style={{ marginLeft: 8 }}>
                    <strong style={{ color: "#888" }}>#</strong>
                    <input
                      type="number"
                      value={displayDraft.series_order ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                series_order: v === "" ? null : Number(v),
                              }
                            : d,
                        );
                      }}
                      style={{
                        width: 72,
                        marginLeft: 4,
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #333",
                        background: "#0f0f0f",
                        color: "#e8e8e8",
                      }}
                    />
                  </span>
                ) : book.series_order != null ? (
                  ` (#${book.series_order})`
                ) : null}
              </div>
            </div>

            <div>
              <strong style={{ color: "#888", fontSize: 13 }}>Tags</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
                {book.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "#252525",
                      fontSize: 13,
                      color: "#ccc",
                    }}
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => void onRemoveTag(t)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#888",
                        cursor: "pointer",
                        padding: 0,
                        lineHeight: 1,
                      }}
                      aria-label={`Remove tag ${t}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void onAddTag();
                    }
                  }}
                  placeholder="Add tag…"
                  style={{
                    minWidth: 120,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #333",
                    background: "#0f0f0f",
                    color: "#e8e8e8",
                  }}
                />
              </div>
            </div>

            {editing && displayDraft ? (
              <label style={{ fontSize: 13, color: "#bbb" }}>
                Description
                <textarea
                  value={displayDraft.description ?? ""}
                  onChange={(e) => setDraft((d) => (d ? { ...d, description: e.target.value || null } : d))}
                  rows={5}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 6,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #333",
                    background: "#0f0f0f",
                    color: "#e8e8e8",
                    resize: "vertical",
                  }}
                />
              </label>
            ) : book.description ? (
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
