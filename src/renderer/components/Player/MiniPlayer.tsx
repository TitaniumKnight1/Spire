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
          background: "#121212",
          borderBottom: "1px solid #2a2a2a",
          WebkitAppRegion: "drag",
          userSelect: "none",
      })}
    >
      <div
        style={electronDragStyle({
            width: 52,
            height: 52,
            borderRadius: 8,
            overflow: "hidden",
            background: "#222",
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
              color: "#555",
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
            color: "#e8e8e8",
          }}
        >
          {title}
        </div>
        {author ? (
          <div
            style={{
              fontSize: 11,
              color: "#888",
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
        <button type="button" style={{ ...btn, color: "#e88" }} onClick={() => void send("close")} title="Close mini player">
          ✕
        </button>
      </div>
    </div>
  );
}

const btn: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "#1c1c1c",
  color: "#e8e8e8",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
};
