import { type ReactElement } from "react";
import { usePlayer } from "../../hooks/usePlayer.js";
import type { Bookmark } from "@shared/library-types";
import { usePlayerStore } from "../../store/playerStore.js";
import { formatHhMmSs } from "../../utils/formatDuration.js";

export function Bookmarks(): ReactElement | null {
  const { seekToBookmark, deleteBookmark } = usePlayer();
  const bookmarks = usePlayerStore((s) => s.bookmarks);
  const show = usePlayerStore((s) => s.showBookmarksPanel);

  if (!show) {
    return null;
  }

  return (
    <aside
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        right: 0,
        width: 280,
        background: "#161616",
        borderLeft: "1px solid #2a2a2a",
        zIndex: 34,
        display: "flex",
        flexDirection: "column",
        padding: "12px 0",
      }}
    >
      <div style={{ padding: "0 16px 8px", fontWeight: 600, fontSize: 13, color: "#aaa" }}>Bookmarks</div>
      {bookmarks.length === 0 ? (
        <p style={{ padding: "8px 16px", margin: 0, fontSize: 13, color: "#666", lineHeight: 1.5 }}>
          No bookmarks yet — press the bookmark button while listening.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, overflow: "auto", flex: 1 }}>
          {bookmarks.map((b: Bookmark) => (
            <li
              key={b.id}
              style={{
                display: "flex",
                alignItems: "stretch",
                borderBottom: "1px solid #222",
              }}
            >
              <button
                type="button"
                onClick={() => void seekToBookmark(b)}
                style={{
                  flex: 1,
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: "transparent",
                  color: "#e8e8e8",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#8ab4ff" }}>
                  {formatHhMmSs(b.position_seconds)}
                </div>
                {b.note ? <div style={{ marginTop: 4, color: "#bbb" }}>{b.note}</div> : null}
              </button>
              <button
                type="button"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteBookmark(b.id);
                }}
                style={{
                  width: 40,
                  flexShrink: 0,
                  border: "none",
                  background: "transparent",
                  color: "#c66",
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
