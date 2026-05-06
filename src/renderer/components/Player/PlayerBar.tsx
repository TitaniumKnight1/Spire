import { type ChangeEvent, type CSSProperties, type ReactElement, useCallback, useState } from "react";
import type { EqPreset } from "@shared/library-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import { useIPC } from "../../hooks/useIPC.js";
import { usePlayer, SPEED_CYCLE_SEQUENCE } from "../../hooks/usePlayer.js";
import { usePlayerStore } from "../../store/playerStore.js";
import { formatDuration } from "../../utils/formatDuration.js";

export function PlayerBar(): ReactElement | null {
  const { invoke } = useIPC();
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
  const playbackError = usePlayerStore((s) => s.playbackError);
  const volume = usePlayerStore((s) => s.volume);

  const setVolume = useCallback(
    (level: number) => {
      void invoke(IPC_CHANNELS.playback.SET_VOLUME, level).catch(() => {});
      usePlayerStore.getState().setVolume(level);
    },
    [invoke],
  );

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
  const seekPct = `${(Math.min(position, maxSeek) / maxSeek) * 100}%`;
  const seekSliderStyle = { flex: 1, "--seek-pct": seekPct } as CSSProperties;
  const speedLabel = SPEED_CYCLE_SEQUENCE.some((s) => Math.abs(s - speed) < 0.02)
    ? `${speed}x`
    : `${speed.toFixed(2)}x`;

  return (
    <footer
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--bg-surface)",
        minHeight: 72,
        padding: "0 24px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 0,
        zIndex: 45,
      }}
    >
      {playbackError ? (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--color-warning, #c27803)",
            padding: "6px 0 4px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {playbackError}
        </div>
      ) : null}
      <div
        style={{
          height: 72,
          display: "grid",
          gridTemplateColumns: "200px 1fr auto",
          alignItems: "center",
          gap: 16,
        }}
      >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
            background: "var(--bg-elevated)",
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
                color: "var(--text-muted)",
              }}
            >
              {(currentBook.title || "?").slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentBook.title}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
              fontSize: 20,
              lineHeight: 1,
              padding: "4px 12px",
              border: "none",
              background: "transparent",
              color: "var(--text-primary)",
            }}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button type="button" onClick={() => nextChapter()} style={iconBtn} title="Next chapter">
            Ch+
          </button>
          <button type="button" onClick={() => seekBy(30)} style={iconBtn}>
            +30s
          </button>
        </div>
        <div className="seek-wrap">
          <span style={{ fontSize: 11, color: "var(--text-muted)", width: 44, textAlign: "right" }}>{formatDuration(position)}</span>
          <input
            type="range"
            min={0}
            max={maxSeek}
            step={0.25}
            value={Math.min(position, maxSeek)}
            onChange={onSeekInput}
            className="seek-slider"
            style={seekSliderStyle}
            aria-label="Seek"
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)", width: 44 }}>{formatDuration(duration)}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onSkipSilence}
          style={{
            ...iconBtn,
            borderColor: skipSilenceEnabled ? "var(--accent)" : "var(--border-default)",
            color: skipSilenceEnabled ? "var(--accent)" : "var(--text-muted)",
            background: skipSilenceEnabled ? "var(--accent-soft)" : "transparent",
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
              borderColor: eqPreset !== "flat" ? "var(--accent)" : "var(--border-default)",
              color: eqPreset !== "flat" ? "var(--accent)" : "var(--text-muted)",
              background: eqPreset !== "flat" ? "var(--accent-soft)" : "transparent",
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
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                padding: 8,
                minWidth: 160,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>EQ preset</div>
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
                      background: eqPreset === id ? "var(--bg-hover)" : "transparent",
                      color: eqPreset === id ? "var(--text-primary)" : "var(--text-secondary)",
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

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            verticalAlign: "middle",
            fontSize: 12,
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
          title="Volume"
        >
          <span aria-hidden="true">🔊</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{
              width: 80,
              verticalAlign: "middle",
              accentColor: "var(--accent)",
            }}
            aria-label="Volume"
          />
        </label>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setSleepOpen((o) => !o)}
            style={{
              ...iconBtn,
              borderColor: sleepTimer ? "var(--accent)" : "var(--border-default)",
              color: sleepTimer ? "var(--accent)" : "var(--text-muted)",
              background: sleepTimer ? "var(--accent-soft)" : "transparent",
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
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                padding: 8,
                minWidth: 200,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Sleep timer</div>
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
                    setSleepTimer({ mode: "minutes", minutes: 30 });
                    setSleepOpen(false);
                  }}
                >
                  30 minutes
                </button>
                <button
                  type="button"
                  style={menuBtn}
                  onClick={() => {
                    setSleepTimer({ mode: "minutes", minutes: 45 });
                    setSleepOpen(false);
                  }}
                >
                  45 minutes
                </button>
                <button
                  type="button"
                  style={menuBtn}
                  onClick={() => {
                    setSleepTimer({ mode: "minutes", minutes: 60 });
                    setSleepOpen(false);
                  }}
                >
                  60 minutes
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
            background: showChapterPanel ? "var(--bg-hover)" : "transparent",
            color: showChapterPanel ? "var(--text-primary)" : "var(--text-muted)",
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
            background: showBookmarksPanel ? "var(--bg-hover)" : "transparent",
            color: showBookmarksPanel ? "var(--text-primary)" : "var(--text-muted)",
          }}
          title="Bookmarks"
        >
          Bmarks
        </button>
      </div>
      </div>
    </footer>
  );
}

const iconBtn: CSSProperties = {
  padding: "6px 10px",
  borderRadius: "var(--radius-md)",
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 12,
  transition: "color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast)",
};

const menuBtn: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 13,
};
