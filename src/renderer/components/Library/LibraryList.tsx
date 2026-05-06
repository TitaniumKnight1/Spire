import { type ReactElement } from "react";
import type { BookListItem } from "@shared/library-types";
import { formatDuration } from "../../utils/formatDuration.js";
import { groupBooksForSeriesView } from "./seriesGrouping.js";

function statusBadge(book: BookListItem): "Unstarted" | "In Progress" | "Finished" {
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
        border: dragActive ? "2px dashed var(--accent)" : "2px dashed var(--border-default)",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: "80px 40px",
        textAlign: "center",
        cursor: "pointer",
        background: dragActive ? "var(--accent-soft)" : "transparent",
        transition: "all 150ms ease",
      }}
    >
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <path
          d="M16 44V36C16 22.7 26.7 12 40 12C53.3 12 64 22.7 64 36V44"
          stroke="var(--text-muted)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <rect
          x="10"
          y="42"
          width="14"
          height="20"
          rx="6"
          fill="var(--bg-elevated)"
          stroke="var(--border-strong)"
          strokeWidth="1.5"
        />
        <rect
          x="56"
          y="42"
          width="14"
          height="20"
          rx="6"
          fill="var(--bg-elevated)"
          stroke="var(--border-strong)"
          strokeWidth="1.5"
        />
        <circle cx="17" cy="52" r="3" fill="var(--accent)" opacity={0.8} />
        <circle cx="63" cy="52" r="3" fill="var(--accent)" opacity={0.8} />
      </svg>

      <div>
        <p
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: 8,
            letterSpacing: "-0.01em",
          }}
        >
          Your library is empty
        </p>
        <p style={{ fontSize: 14, color: "var(--text-muted)", maxWidth: 280, lineHeight: 1.6 }}>
          Drop audiobook files or folders here, or use the button above to browse your files
        </p>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void onBrowse();
        }}
        className="btn-primary"
        style={{ marginTop: 4 }}
      >
        Add your first book
      </button>
    </div>
  );
}

const headerRowStyle = {
  display: "grid",
  gridTemplateColumns: "44px 1.4fr 1fr 100px 120px 110px",
  gap: 8,
  padding: "8px 12px",
  fontSize: 12,
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border-subtle)",
};

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "44px 1.4fr 1fr 100px 120px 110px",
  gap: 8,
  alignItems: "center",
  padding: "8px 12px",
  border: "none",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-elevated)",
  color: "inherit",
  cursor: "pointer",
  textAlign: "left" as const,
};

export function LibraryList({
  books,
  groupBySeries,
  onBookClick,
  onBrowse,
  dragActive,
}: {
  books: BookListItem[];
  groupBySeries: boolean;
  onBookClick: (id: number) => void;
  onBrowse: () => void;
  dragActive: boolean;
}): ReactElement {
  if (books.length === 0) {
    return <EmptyLibrary onBrowse={onBrowse} dragActive={dragActive} />;
  }

  function renderRows(items: BookListItem[]): ReactElement {
    return (
      <>
        <div style={headerRowStyle}>
          <span />
          <span>Title</span>
          <span>Author</span>
          <span>Duration</span>
          <span>Progress</span>
          <span>Status</span>
        </div>
        {items.map((book) => {
          const badge = statusBadge(book);
          const pct = book.progress_percent;
          return (
            <button
              key={book.id}
              type="button"
              onClick={() => onBookClick(book.id)}
              style={rowStyle}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 6,
                  overflow: "hidden",
                  background: "var(--bg-surface)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--text-muted)",
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
              <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {book.author ?? "—"}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{formatDuration(book.total_duration)}</span>
              <div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--border-default)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)" }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{pct.toFixed(0)}%</div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color:
                    badge === "Finished"
                      ? "var(--color-success)"
                      : badge === "In Progress"
                        ? "var(--color-warning)"
                        : "var(--text-muted)",
                }}
              >
                {badge}
              </span>
            </button>
          );
        })}
      </>
    );
  }

  if (groupBySeries) {
    const groups = groupBooksForSeriesView(books);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {groups.map((g) => (
          <div key={g.label}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 12, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{g.label}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{renderRows(g.books)}</div>
          </div>
        ))}
      </div>
    );
  }

  return <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{renderRows(books)}</div>;
}
