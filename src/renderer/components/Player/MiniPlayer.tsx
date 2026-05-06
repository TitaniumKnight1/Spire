import { type CSSProperties, type ReactElement, useCallback, useEffect, useState } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { PlayerStatePushPayload } from "@shared/library-types";
import { useIPC } from "../../hooks/useIPC.js";

type DragRegionStyle = CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };

function electronDragStyle(props: DragRegionStyle): CSSProperties {
  return props;
}

export function MiniPlayer(): ReactElement {
  const { invoke, subscribe } = useIPC();
  const [state, setState] = useState<PlayerStatePushPayload | null>(null);

  useEffect(() => {
    return subscribe(IPC_CHANNELS.playback.STATE_PUSH, (...args: unknown[]) => {
      const payload = args[0] as PlayerStatePushPayload;
      setState(payload);
    });
  }, [subscribe]);

  const send = useCallback(
    async (command: "play-pause" | "next" | "prev" | "close") => {
      await invoke(IPC_CHANNELS.playback.MINI_PLAYER_COMMAND, { command });
    },
    [invoke],
  );

  const title = state?.title?.trim() ? state.title : "Nothing playing";
  const author = state?.author?.trim() ? state.author : "";
  const cover = state?.coverArtUrl ?? null;
  const playing = state?.isPlaying ?? false;

  return (
    <div
      style={electronDragStyle({
          height: "100vh",
          width: "100vw",
          margin: 0,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-subtle)",
          WebkitAppRegion: "drag",
          userSelect: "none",
      })}
    >
      <div
        style={electronDragStyle({
            width: 52,
            height: 52,
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
            background: "var(--bg-elevated)",
            flexShrink: 0,
            WebkitAppRegion: "no-drag",
        })}
      >
        {cover ? (
          <img src={cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 700,
              color: "var(--text-muted)",
            }}
          >
            {(title || "?").slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>

      <div style={electronDragStyle({ flex: 1, minWidth: 0, WebkitAppRegion: "drag" })}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "var(--text-primary)",
          }}
        >
          {title}
        </div>
        {author ? (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginTop: 2,
            }}
          >
            {author}
          </div>
        ) : null}
      </div>

      <div
        style={electronDragStyle({
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            WebkitAppRegion: "no-drag",
        })}
      >
        <button type="button" style={btn} onClick={() => void send("prev")} title="Previous file">
          ⏮
        </button>
        <button type="button" style={{ ...btn, minWidth: 44 }} onClick={() => void send("play-pause")} title="Play / Pause">
          {playing ? "⏸" : "▶"}
        </button>
        <button type="button" style={btn} onClick={() => void send("next")} title="Next file">
          ⏭
        </button>
        <button type="button" style={{ ...btn, color: "var(--color-error)" }} onClick={() => void send("close")} title="Close mini player">
          ✕
        </button>
      </div>
    </div>
  );
}

const btn: CSSProperties = {
  padding: "6px 10px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-default)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
};
