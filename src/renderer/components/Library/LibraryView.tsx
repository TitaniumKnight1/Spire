import {
  type CSSProperties,
  type DragEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLibrary } from "../../hooks/useLibrary.js";
import { BookDetail } from "./BookDetail.js";
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
    setViewMode,
    setSelectedBook,
    addPaths,
    refreshLibrary,
    openFileDialog,
  } = useLibrary();

  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Library</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={() => void onBrowse()} style={btnStyle}>
            Add Files
          </button>
          <div style={{ display: "flex", border: "1px solid #333", borderRadius: 8, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              style={{
                ...toggleBtn,
                background: viewMode === "grid" ? "#2a2a2a" : "#161616",
              }}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              style={{
                ...toggleBtn,
                background: viewMode === "list" ? "#2a2a2a" : "#161616",
              }}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {isLoading && books.length === 0 ? (
        <p style={{ color: "#888" }}>Loading library…</p>
      ) : null}

      <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "auto" }}>
        {dragActive ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              border: "2px dashed #4a8fd4",
              borderRadius: 16,
              background: "rgba(20, 30, 45, 0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              color: "#b8d4f0",
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            Drop to add
          </div>
        ) : null}

        {viewMode === "grid" ? (
          <LibraryGrid
            books={books}
            dragActive={dragActive}
            onBrowse={() => void onBrowse()}
            onBookClick={(id) => setSelectedBook(id)}
          />
        ) : (
          <LibraryList
            books={books}
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

const btnStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "#1e1e1e",
  color: "#e8e8e8",
  cursor: "pointer",
};

const toggleBtn: CSSProperties = {
  padding: "8px 14px",
  border: "none",
  color: "#e8e8e8",
  cursor: "pointer",
  fontSize: 13,
};
