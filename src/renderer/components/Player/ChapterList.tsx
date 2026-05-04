import { type ReactElement } from "react";
import { usePlayer } from "../../hooks/usePlayer.js";
import type { Chapter } from "@shared/library-types";
import { usePlayerStore } from "../../store/playerStore.js";
import { formatHhMmSs } from "../../utils/formatDuration.js";

export function ChapterList(): ReactElement | null {
  const { seekToChapter } = usePlayer();
  const chapters = usePlayerStore((s) => s.chapters);
  const currentChapterIndex = usePlayerStore((s) => s.currentChapterIndex);
  const show = usePlayerStore((s) => s.showChapterPanel);
  const bookmarksOpen = usePlayerStore((s) => s.showBookmarksPanel);

  if (!show || chapters.length === 0) {
    return null;
  }

  const rightOffset = bookmarksOpen ? 280 : 0;

  return (
    <aside
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        right: rightOffset,
        width: 280,
        background: "#161616",
        borderLeft: "1px solid #2a2a2a",
        zIndex: 35,
        display: "flex",
        flexDirection: "column",
        padding: "12px 0",
      }}
    >
      <div style={{ padding: "0 16px 8px", fontWeight: 600, fontSize: 13, color: "#aaa" }}>Chapters</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, overflow: "auto", flex: 1 }}>
        {chapters.map((ch: Chapter, idx: number) => {
          const active = idx === currentChapterIndex;
          return (
            <li key={ch.id}>
              <button
                type="button"
                onClick={() => seekToChapter(ch)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 16px",
                  border: "none",
                  borderLeft: active ? "3px solid #2a6cff" : "3px solid transparent",
                  background: active ? "#222a38" : "transparent",
                  color: "#e8e8e8",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: active ? 600 : 400 }}>{ch.title ?? "Chapter"}</div>
                <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>{formatHhMmSs(ch.start_time)}</div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
