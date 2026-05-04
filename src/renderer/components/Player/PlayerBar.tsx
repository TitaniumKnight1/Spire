import { type ChangeEvent, type CSSProperties, type ReactElement, useCallback, useState } from "react";
import type { EqPreset } from "@shared/library-types";
import { usePlayer, SPEED_CYCLE_SEQUENCE } from "../../hooks/usePlayer.js";
import { usePlayerStore } from "../../store/playerStore.js";
import { formatDuration } from "../../utils/formatDuration.js";

export function PlayerBar(): ReactElement | null {
  const {
    togglePlay,
    seekBy,
    seekTo,
    nextChapter,
    prevChapter,
    cycleSpeed,
    addBookmark,
    setSleepTimer,
    clearSleepTimer,
    toggleSkipSilence,
    setEqPresetAndPersist,
  } = usePlayer();

  const currentBook = usePlayerStore((s) => s.currentBook);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const speed = usePlayerStore((s) => s.speed);
  const sleepTimer = usePlayerStore((s) => s.sleepTimer);
  const showChapterPanel = usePlayerStore((s) => s.showChapterPanel);
  const showBookmarksPanel = usePlayerStore((s) => s.showBookmarksPanel);
  const setShowChapterPanel = usePlayerStore((s) => s.setShowChapterPanel);
  const setShowBookmarksPanel = usePlayerStore((s) => s.setShowBookmarksPanel);

  const [sleepOpen, setSleepOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);

  const skipSilenceEnabled = usePlayerStore((s) => s.skipSilenceEnabled);
  const eqPreset = usePlayerStore((s) => s.eqPreset);

  const onSeekInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      seekTo(Number(e.target.value));
    },
    [seekTo],
  );

  const onSkipSilence = useCallback(() => {
    void toggleSkipSilence();
  }, [toggleSkipSilence]);

  const applyEq = useCallback(
    (p: EqPreset) => {
      void setEqPresetAndPersist(p);
      setEqOpen(false);
    },
    [setEqPresetAndPersist],
  );

  const onBookmark = useCallback(() => {
    const raw = window.prompt("Bookmark note (optional)", "");
    if (raw === null) {
      return;
    }
    const note = raw.trim() === "" ? undefined : raw.trim();
    void addBookmark(note);
  }, [addBookmark]);

  if (!currentBook) {
    return null;
  }

  const maxSeek = duration > 0 ? duration : Math.max(position, 1);
  const speedLabel = SPEED_CYCLE_SEQUENCE.some((s) => Math.abs(s - speed) < 0.02)
    ? `${speed}x`
    : `${speed.toFixed(2)}x`;

  return (
    <footer
      style={{
        flexShrink: 0,
        borderTop: "1px solid #2a2a2a",
        background: "#121212",
        padding: "10px 16px",
        display: "grid",
        gridTemplateColumns: "200px 1fr auto",
        alignItems: "center",
        gap: 16,
        zIndex: 45,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 8,
            overflow: "hidden",
            background: "#222",
            flexShrink: 0,
          }}
        >
          {currentBook.cover_art_url ? (
            <img src={currentBook.cover_art_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                fontWeight: 700,
                color: "#555",
              }}
            >
              {(currentBook.title || "?").slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentBook.title}
          </div>
          <div style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentBook.author ?? "Unknown author"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={() => seekBy(-30)} style={iconBtn}>
            −30s
          </button>
          <button type="button" onClick={() => prevChapter()} style={iconBtn} title="Previous chapter">
            Ch−
          </button>
          <button
            type="button"
            onClick={() => togglePlay()}
            style={{
              ...iconBtn,
              padding: "10px 20px",
              fontWeight: 700,
              background: "#2a6cff",
              borderColor: "#2a6cff",
            }}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => nextChapter()} style={iconBtn} title="Next chapter">
            Ch+
          </button>
          <button type="button" onClick={() => seekBy(30)} style={iconBtn}>
            +30s
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#888", width: 44, textAlign: "right" }}>{formatDuration(position)}</span>
          <input
            type="range"
            min={0}
            max={maxSeek}
            step={0.25}
            value={Math.min(position, maxSeek)}
            onChange={onSeekInput}
            style={{ flex: 1, accentColor: "#2a6cff" }}
            aria-label="Seek"
          />
          <span style={{ fontSize: 11, color: "#888", width: 44 }}>{formatDuration(duration)}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onSkipSilence}
          style={{
            ...iconBtn,
            borderColor: skipSilenceEnabled ? "#4a7a4a" : "#333",
            background: skipSilenceEnabled ? "#1a2a18" : "#1c1c1c",
          }}
          title="Skip silence"
        >
          Skip ∅
        </button>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setEqOpen((o) => !o)}
            style={{
              ...iconBtn,
              borderColor: eqPreset !== "flat" ? "#4a6a9a" : "#333",
              background: eqPreset !== "flat" ? "#1a1e2a" : "#1c1c1c",
            }}
            title="EQ preset"
          >
            EQ
          </button>
          {eqOpen ? (
            <div
              role="menu"
              style={{
                position: "absolute",
                bottom: "100%",
                right: 0,
                marginBottom: 8,
                background: "#1e1e1e",
                border: "1px solid #333",
                borderRadius: 8,
                padding: 8,
                minWidth: 160,
                boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
              }}
            >
              <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>EQ preset</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {(
                  [
                    ["flat", "Flat"],
                    ["voice-clarity", "Voice clarity"],
                    ["bass-boost", "Bass boost"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    style={{
                      ...menuBtn,
                      background: eqPreset === id ? "#2a3550" : "transparent",
                    }}
                    onClick={() => applyEq(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <button type="button" onClick={() => cycleSpeed()} style={iconBtn} title="Playback speed">
          {speedLabel}
        </button>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setSleepOpen((o) => !o)}
            style={{
              ...iconBtn,
              borderColor: sleepTimer ? "#4a6a3a" : "#333",
              background: sleepTimer ? "#1a2a18" : "#1c1c1c",
            }}
            title="Sleep timer"
          >
            Timer
          </button>
          {sleepOpen ? (
            <div
              role="menu"
              style={{
                position: "absolute",
                bottom: "100%",
                right: 0,
                marginBottom: 8,
                background: "#1e1e1e",
                border: "1px solid #333",
                borderRadius: 8,
                padding: 8,
                minWidth: 200,
                boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
              }}
            >
              <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Sleep timer</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button
                  type="button"
                  style={menuBtn}
                  onClick={() => {
                    clearSleepTimer();
                    setSleepOpen(false);
                  }}
                >
                  Off
                </button>
                <button
                  type="button"
                  style={menuBtn}
                  onClick={() => {
                    setSleepTimer({ mode: "minutes", minutes: 1 });
                    setSleepOpen(false);
                  }}
                >
                  1 minute
                </button>
                <button
                  type="button"
                  style={menuBtn}
                  onClick={() => {
                    setSleepTimer({ mode: "minutes", minutes: 15 });
                    setSleepOpen(false);
                  }}
                >
                  15 minutes
                </button>
                <button
                  type="button"
                  style={menuBtn}
                  onClick={() => {
                    setSleepTimer({ mode: "end-of-chapter" });
                    setSleepOpen(false);
                  }}
                >
                  End of chapter
                </button>
                <button
                  type="button"
                  style={menuBtn}
                  onClick={() => {
                    setSleepTimer({ mode: "end-of-book" });
                    setSleepOpen(false);
                  }}
                >
                  End of book
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <button type="button" onClick={() => void onBookmark()} style={iconBtn} title="Add bookmark">
          Mark
        </button>
        <button
          type="button"
          onClick={() => setShowChapterPanel(!showChapterPanel)}
          style={{
            ...iconBtn,
            background: showChapterPanel ? "#2a2a3a" : "#1c1c1c",
          }}
          title="Chapters"
        >
          Chapters
        </button>
        <button
          type="button"
          onClick={() => setShowBookmarksPanel(!showBookmarksPanel)}
          style={{
            ...iconBtn,
            background: showBookmarksPanel ? "#2a2a3a" : "#1c1c1c",
          }}
          title="Bookmarks"
        >
          Bmarks
        </button>
      </div>
    </footer>
  );
}

const iconBtn: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "#1c1c1c",
  color: "#e8e8e8",
  cursor: "pointer",
  fontSize: 12,
};

const menuBtn: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "transparent",
  color: "#e8e8e8",
  cursor: "pointer",
  fontSize: 13,
};
