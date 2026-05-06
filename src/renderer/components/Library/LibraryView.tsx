import { type DragEvent, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeFilteredBooks } from "../../store/libraryStore.js";
import { useLibrary } from "../../hooks/useLibrary.js";
import { BookDetail } from "./BookDetail.js";
import { FilterBar } from "./FilterBar.js";
import { LibraryGrid } from "./LibraryGrid.js";
import { LibraryList } from "./LibraryList.js";

function collectPathsFromDrop(e: DragEvent): string[] {
  const bridge = window.electron?.getPathForFile;
  if (!bridge || !e.dataTransfer?.files?.length) {
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < e.dataTransfer.files.length; i++) {
    try {
      out.push(bridge(e.dataTransfer.files[i]!));
    } catch {
      // ignore invalid file handle
    }
  }
  return out;
}

export function LibraryView(): ReactElement {
  const {
    books,
    isLoading,
    viewMode,
    selectedBookId,
    filters,
    setSelectedBook,
    addPaths,
    refreshLibrary,
    openFileDialog,
  } = useLibrary();

  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  const filteredBooks = useMemo(() => computeFilteredBooks(books, filters), [books, filters]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const onBrowse = useCallback(async () => {
    const paths = await openFileDialog();
    if (paths.length > 0) {
      await addPaths(paths);
    }
  }, [addPaths, openFileDialog]);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    dragDepth.current += 1;
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragActive(false);
      const paths = collectPathsFromDrop(e);
      if (paths.length > 0) {
        void addPaths(paths);
      }
    },
    [addPaths],
  );

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%", minHeight: 0 }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 28,
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <h1 className="page-title">Library</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <button type="button" onClick={() => void onBrowse()} className="btn-primary">
            Add Files
          </button>
        </div>
      </div>

      <FilterBar books={books} />

      {isLoading && books.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>Loading library…</p>
      ) : null}

      <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "auto" }}>
        {dragActive ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              border: "2px dashed var(--accent)",
              borderRadius: "var(--radius-lg)",
              background: "var(--accent-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              color: "var(--accent)",
              fontSize: 14,
              fontWeight: 500,
              transition: "all 150ms ease",
            }}
          >
            Drop to add
          </div>
        ) : null}

        {viewMode === "grid" ? (
          <LibraryGrid
            books={filteredBooks}
            groupBySeries={filters.groupBySeries}
            dragActive={dragActive}
            onBrowse={() => void onBrowse()}
            onBookClick={(id) => setSelectedBook(id)}
          />
        ) : (
          <LibraryList
            books={filteredBooks}
            groupBySeries={filters.groupBySeries}
            dragActive={dragActive}
            onBrowse={() => void onBrowse()}
            onBookClick={(id) => setSelectedBook(id)}
          />
        )}
      </div>

      {selectedBookId != null ? (
        <BookDetail bookId={selectedBookId} onClose={() => setSelectedBook(null)} />
      ) : null}
    </div>
  );
}

