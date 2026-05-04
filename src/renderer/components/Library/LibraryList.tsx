import { type ReactElement } from "react";
import type { BookListItem } from "@shared/library-types";
import { formatDuration } from "../../utils/formatDuration.js";

function statusLabel(book: BookListItem): "Unstarted" | "In Progress" | "Finished" {
  if (book.completed_at) {
    return "Finished";
  }
  if (book.position_seconds > 0) {
    return "In Progress";
  }
  return "Unstarted";
}

function initials(title: string, author: string | null): string {
  const a = (author || title).trim();
  const parts = a.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return a.slice(0, 2).toUpperCase() || "?";
}

function EmptyLibrary({
  onBrowse,
  dragActive,
}: {
  onBrowse: () => void;
  dragActive: boolean;
}): ReactElement {
  return (
    <div
      onClick={onBrowse}
      role="presentation"
      style={{
        flex: 1,
        minHeight: 360,
        border: dragActive ? "2px dashed #4a8fd4" : "2px dashed #333",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        color: "#888",
        cursor: "pointer",
        background: dragActive ? "#121820" : "#121212",
      }}
    >
      <div style={{ fontSize: 48, opacity: 0.35 }}>📚</div>
      <div style={{ fontSize: 16, color: "#bbb", textAlign: "center", maxWidth: 360, padding: "0 16px" }}>
        Drop audiobooks here or click to browse
      </div>
    </div>
  );
}

export function LibraryList({
  books,
  onBookClick,
  onBrowse,
  dragActive,
}: {
  books: BookListItem[];
  onBookClick: (id: number) => void;
  onBrowse: () => void;
  dragActive: boolean;
}): ReactElement {
  if (books.length === 0) {
    return <EmptyLibrary onBrowse={onBrowse} dragActive={dragActive} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "44px 1.4fr 1fr 100px 120px 110px",
          gap: 8,
          padding: "8px 12px",
          fontSize: 12,
          color: "#777",
          borderBottom: "1px solid #222",
        }}
      >
        <span />
        <span>Title</span>
        <span>Author</span>
        <span>Duration</span>
        <span>Progress</span>
        <span>Status</span>
      </div>
      {books.map((book) => {
        const badge = statusLabel(book);
        const pct = book.progress_percent;
        return (
          <button
            key={book.id}
            type="button"
            onClick={() => onBookClick(book.id)}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1.4fr 1fr 100px 120px 110px",
              gap: 8,
              alignItems: "center",
              padding: "8px 12px",
              border: "none",
              borderRadius: 8,
              background: "#161616",
              color: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 6,
                overflow: "hidden",
                background: "#2a2a2a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "#666",
              }}
            >
              {book.cover_art_url ? (
                <img src={book.cover_art_url} alt="" style={{ width: 40, height: 40, objectFit: "cover" }} />
              ) : (
                initials(book.title, book.author)
              )}
            </div>
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {book.title}
            </span>
            <span style={{ color: "#9a9a9a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {book.author ?? "—"}
            </span>
            <span style={{ color: "#888", fontSize: 13 }}>{formatDuration(book.total_duration)}</span>
            <div>
              <div style={{ height: 4, borderRadius: 2, background: "#2a2a2a", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: "#4a8fd4" }} />
              </div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{pct.toFixed(0)}%</div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: badge === "Finished" ? "#6abf69" : badge === "In Progress" ? "#d4a84a" : "#777",
              }}
            >
              {badge}
            </span>
          </button>
        );
      })}
    </div>
  );
}
