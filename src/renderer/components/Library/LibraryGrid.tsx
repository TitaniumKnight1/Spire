import { type ReactElement } from "react";
import type { BookListItem } from "@shared/library-types";
import { BookCard } from "./BookCard.js";

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

export function LibraryGrid({
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 16,
        alignContent: "start",
      }}
    >
      {books.map((book) => (
        <BookCard key={book.id} book={book} onClick={() => onBookClick(book.id)} />
      ))}
    </div>
  );
}
