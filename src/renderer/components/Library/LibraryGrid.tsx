import { type ReactElement } from "react";
import type { BookListItem } from "@shared/library-types";
import { BookCard } from "./BookCard.js";
import { groupBooksForSeriesView } from "./seriesGrouping.js";

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

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: 16,
  alignContent: "start" as const,
};

export function LibraryGrid({
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

  if (groupBySeries) {
    const groups = groupBooksForSeriesView(books);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {groups.map((g) => (
          <div key={g.label}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 12, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {g.label}
            </div>
            <div style={gridStyle}>
              {g.books.map((book) => (
                <BookCard key={book.id} book={book} onClick={() => onBookClick(book.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={gridStyle}>
      {books.map((book) => (
        <BookCard key={book.id} book={book} onClick={() => onBookClick(book.id)} />
      ))}
    </div>
  );
}
