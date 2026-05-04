import { type FormEvent, type ReactElement, useCallback, useState } from "react";
import type { CSSProperties } from "react";
import type { DownloadItem, DownloadStatus } from "@shared/library-types";

function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) {
    return "";
  }
  if (bps < 1024) {
    return `${bps.toFixed(0)} B/s`;
  }
  if (bps < 1024 * 1024) {
    return `${(bps / 1024).toFixed(1)} KB/s`;
  }
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h} hr ${rm} min`;
  }
  return `${m} min ${s} sec`;
}

function statusBadgeStyle(status: DownloadStatus): { bg: string; label: string } {
  switch (status) {
    case "queued":
      return { bg: "#333", label: "Queued" };
    case "downloading":
      return { bg: "#1a5fb4", label: "Downloading" };
    case "paused":
      return { bg: "#613583", label: "Paused" };
    case "failed":
      return { bg: "#a51d2d", label: "Failed" };
    default:
      return { bg: "#444", label: status };
  }
}

const queueStatuses: DownloadStatus[] = ["queued", "downloading", "paused", "failed"];

export type DownloadQueueProps = {
  downloads: DownloadItem[];
  isLoading: boolean;
  addMagnet: (uri: string) => Promise<{ downloadId: number }>;
  addTorrentFile: (filePath: string) => Promise<{ downloadId: number }>;
  pause: (id: number) => Promise<void>;
  resume: (id: number) => Promise<void>;
  cancel: (id: number) => Promise<void>;
  retry: (id: number) => Promise<void>;
};

export function DownloadQueue(props: DownloadQueueProps): ReactElement {
  const [magnetInput, setMagnetInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queueRows = props.downloads.filter((d) => queueStatuses.includes(d.status));

  const onSubmitMagnet = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      const uri = magnetInput.trim();
      if (!uri.startsWith("magnet:")) {
        setError("Enter a magnet link starting with magnet:");
        return;
      }
      try {
        await props.addMagnet(uri);
        setMagnetInput("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add magnet");
      }
    },
    [magnetInput, props],
  );

  const onDropTorrent = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (!file || !window.electron?.getPathForFile) {
        return;
      }
      const p = window.electron.getPathForFile(file);
      if (!p.toLowerCase().endsWith(".torrent")) {
        setError("Drop a .torrent file");
        return;
      }
      setError(null);
      try {
        await props.addTorrentFile(p);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add torrent");
      }
    },
    [props],
  );

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDropTorrent}
      style={{
        position: "relative",
        border: `1px solid ${dragOver ? "#4a90d9" : "#2a2a2a"}`,
        borderRadius: 12,
        padding: 16,
        marginBottom: 24,
        background: dragOver ? "#151920" : "#141414",
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Download queue</h2>
      <form onSubmit={onSubmitMagnet} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={magnetInput}
          onChange={(e) => setMagnetInput(e.target.value)}
          placeholder="Paste magnet link…"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #333",
            background: "#0f0f0f",
            color: "#e8e8e8",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: "1px solid #444",
            background: "#1c1c1c",
            color: "#e8e8e8",
            cursor: "pointer",
          }}
        >
          Add
        </button>
      </form>
      {error ? (
        <p style={{ color: "#f66", marginTop: 0 }}>{error}</p>
      ) : null}

      {props.isLoading && queueRows.length === 0 ? (
        <p style={{ color: "#9a9a9a" }}>Loading downloads…</p>
      ) : null}

      {!props.isLoading && queueRows.length === 0 ? (
        <p style={{ color: "#9a9a9a", marginBottom: 0 }}>
          Paste a magnet link or drop a .torrent file to start downloading.
        </p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {queueRows.map((d) => {
          const name = d.display_name?.trim() || "Loading…";
          const badge = statusBadgeStyle(d.status);
          const showSpeed = d.status === "downloading" && d.speed_bps > 0;
          const etaStr = showSpeed ? formatEta(d.eta_seconds) : "";

          return (
            <li
              key={d.id}
              style={{
                border: "1px solid #2a2a2a",
                borderRadius: 10,
                padding: 12,
                background: "#111",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ fontWeight: 600, minWidth: 0, flex: 1 }}>{name}</div>
                <span
                  style={{
                    fontSize: 12,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: badge.bg,
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  {badge.label}
                </span>
              </div>
              <div
                style={{
                  marginTop: 8,
                  height: 8,
                  borderRadius: 4,
                  background: "#222",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Math.max(0, d.progress_pct))}%`,
                    height: "100%",
                    background: d.status === "failed" ? "#a51d2d" : "#2ec27e",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
              {showSpeed ? (
                <div style={{ marginTop: 6, fontSize: 13, color: "#9a9a9a" }}>
                  {formatSpeed(d.speed_bps)}
                  {etaStr ? ` · ${etaStr} remaining` : ""}
                </div>
              ) : null}
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {d.status === "downloading" ? (
                  <button type="button" onClick={() => void props.pause(d.id)} style={smallBtn}>
                    Pause
                  </button>
                ) : null}
                {d.status === "paused" ? (
                  <button type="button" onClick={() => void props.resume(d.id)} style={smallBtn}>
                    Resume
                  </button>
                ) : null}
                {d.status !== "completed" ? (
                  <button type="button" onClick={() => void props.cancel(d.id)} style={smallBtn}>
                    Cancel
                  </button>
                ) : null}
                {d.status === "failed" ? (
                  <button type="button" onClick={() => void props.retry(d.id)} style={smallBtn}>
                    Retry
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const smallBtn: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #444",
  background: "#1a1a1a",
  color: "#e8e8e8",
  cursor: "pointer",
  fontSize: 13,
};
