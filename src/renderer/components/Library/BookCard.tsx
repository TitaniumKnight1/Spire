import { type ReactElement } from "react";
import type { BookListItem } from "@shared/library-types";
import { formatDuration } from "../../utils/formatDuration.js";

function statusLabel(book: BookListItem): "Unstarted" | "In Progress" | "Finished" {
  const s = book.status;
  if (s === "finished") {
    return "Finished";
  }
  if (s === "in-progress") {
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

export function BookCard({
  book,
  onClick,
}: {
  book: BookListItem;
  onClick: () => void;
}): ReactElement {
  const pct = book.progress_percent;
  const badge = statusLabel(book);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        border: "1px solid #2a2a2a",
        background: "#161616",
        padding: 0,
        cursor: "pointer",
        textAlign: "left",
        overflow: "hidden",
        color: "inherit",
        minHeight: 280,
      }}
    >
      <div
        style={{
          aspectRatio: "1",
          width: "100%",
          background: "#222",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {book.cover_art_url ? (
          <img
            src={book.cover_art_url}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ fontSize: 36, fontWeight: 700, color: "#666" }}>{initials(book.title, book.author)}</span>
        )}
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 6,
            background: badge === "Finished" ? "#1e3a1e" : badge === "In Progress" ? "#2a2510" : "#252525",
            color: "#ccc",
          }}
        >
          {badge}
        </span>
      </div>
      <div style={{ padding: "12px 12px 10px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {book.title}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#9a9a9a",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {book.author ?? "Unknown author"}
        </div>
        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{formatDuration(book.total_duration)}</div>
        <div style={{ marginTop: "auto", paddingTop: 8 }}>
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: "#2a2a2a",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: "#4a8fd4",
                borderRadius: 2,
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: "#777", marginTop: 4 }}>{pct.toFixed(0)}% complete</div>
        </div>
      </div>
    </button>
  );
}
