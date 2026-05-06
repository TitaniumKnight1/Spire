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
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-surface)",
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
          background: "var(--bg-elevated)",
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
          <span style={{ fontSize: 36, fontWeight: 700, color: "var(--text-muted)" }}>{initials(book.title, book.author)}</span>
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
            background:
              badge === "Finished"
                ? "rgba(74, 222, 128, 0.12)"
                : badge === "In Progress"
                  ? "rgba(251, 191, 36, 0.12)"
                  : "var(--bg-hover)",
            color:
              badge === "Finished"
                ? "var(--color-success)"
                : badge === "In Progress"
                  ? "var(--color-warning)"
                  : "var(--text-secondary)",
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
            color: "var(--text-secondary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {book.author ?? "Unknown author"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{formatDuration(book.total_duration)}</div>
        <div style={{ marginTop: "auto", paddingTop: 8 }}>
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: "var(--border-default)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: "var(--accent)",
                borderRadius: 2,
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{pct.toFixed(0)}% complete</div>
        </div>
      </div>
    </button>
  );
}
