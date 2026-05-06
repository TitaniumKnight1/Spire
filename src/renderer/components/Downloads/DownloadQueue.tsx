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

function truncateSource(url: string | null | undefined, max = 52): string {
  if (url == null || url.trim() === "") {
    return "";
  }
  const u = url.trim();
  return u.length > max ? `${u.slice(0, max - 1)}…` : u;
}

function queueDownloadTitle(d: DownloadItem): string {
  const live = d.displayName?.trim();
  if (live) {
    return live;
  }
  const url = d.source_url?.trim() ?? "";
  if (url) {
    return truncateSource(url) || d.display_name?.trim() || "Loading…";
  }
  return d.display_name?.trim() || "Loading…";
}

function sourceBadgeStyle(source: DownloadItem["source_type"]): { bg: string; label: string } {
  switch (source) {
    case "magnet":
      return { bg: "var(--bg-hover)", label: "Torrent" };
    case "torrent_file":
      return { bg: "var(--source-torrent-bg)", label: "Torrent" };
    case "http":
      return { bg: "var(--source-http-bg)", label: "HTTP" };
    case "ytdlp":
      return { bg: "var(--source-ytdlp-bg)", label: "yt-dlp" };
    case "rss":
      return { bg: "var(--source-rss-bg)", label: "RSS" };
    default:
      return { bg: "var(--bg-hover)", label: source };
  }
}

function statusBadgeStyle(status: DownloadStatus): { bg: string; label: string } {
  switch (status) {
    case "queued":
      return { bg: "var(--bg-hover)", label: "Queued" };
    case "downloading":
      return { bg: "var(--accent-soft)", label: "Downloading" };
    case "paused":
      return { bg: "var(--bg-surface)", label: "Paused" };
    case "failed":
      return { bg: "rgba(248, 113, 113, 0.16)", label: "Failed" };
    default:
      return { bg: "var(--bg-hover)", label: status };
  }
}

const queueStatuses: DownloadStatus[] = ["queued", "downloading", "paused", "failed"];

const MAGNET_NOT_SUPPORTED_MESSAGE =
  "Torrent downloads are not supported in this version. Use qBittorrent or another client, then point your download folder at your Spire library.";

export type DownloadQueueProps = {
  downloads: DownloadItem[];
  isLoading: boolean;
  addUrl: (url: string) => Promise<{ downloadId: number }>;
  /** Opens Podcasts flow (e.g. add saved RSS feed). */
  onOpenPodcasts?: () => void;
  cancel: (id: number) => Promise<void>;
  retry: (id: number) => Promise<void>;
};

export function DownloadQueue(props: DownloadQueueProps): ReactElement {
  const [urlInput, setUrlInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const queueRows = props.downloads.filter((d) => queueStatuses.includes(d.status));

  const onSubmitUrl = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      const raw = urlInput.trim();
      if (!raw) {
        setError("Paste a URL");
        return;
      }
      if (raw.toLowerCase().startsWith("magnet:")) {
        setError(MAGNET_NOT_SUPPORTED_MESSAGE);
        return;
      }
      try {
        await props.addUrl(raw);
        setUrlInput("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add URL");
      }
    },
    [urlInput, props],
  );

  return (
    <section
      style={{
        position: "relative",
        border: "1px solid var(--border-subtle)",
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        background: "var(--bg-surface)",
      }}
    >
      <div className="section-label">Download queue</div>
      <form
        onSubmit={onSubmitUrl}
        style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste audio or video URL (direct .mp3, YouTube, etc.)…"
          className="input-base"
          style={{ flex: "1 1 240px" }}
        />
        <button type="submit" className="btn-secondary">
          Download URL
        </button>
        {props.onOpenPodcasts ? (
          <button type="button" onClick={() => props.onOpenPodcasts?.()} className="btn-secondary">
            Add RSS feed
          </button>
        ) : null}
      </form>
      <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 8, marginBottom: 8 }}>
        Paste an HTTP URL for a direct audio file or a page yt-dlp can extract from. RSS feeds can be added from
        Podcasts.
      </p>
      {error ? (
        <p style={{ color: "var(--color-error)", marginTop: 0 }}>{error}</p>
      ) : null}

      {props.isLoading && queueRows.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>Loading downloads…</p>
      ) : null}

      {!props.isLoading && queueRows.length === 0 ? (
        <p style={{ color: "var(--text-muted)", marginBottom: 0 }}>No queued downloads.</p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {queueRows.map((d) => {
          const name = queueDownloadTitle(d);
          const badge = statusBadgeStyle(d.status);
          const srcBadge = sourceBadgeStyle(d.source_type);
          const showSpeed = d.status === "downloading" && d.speed_bps > 0;
          const etaStr = showSpeed ? formatEta(d.eta_seconds) : "";

          return (
            <li
              key={d.id}
              style={{
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                padding: "12px 16px",
                marginTop: 8,
                background: "var(--bg-elevated)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ fontWeight: 600, minWidth: 0, flex: 1 }}>{name}</div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 10,
                      background: srcBadge.bg,
                      color:
                        d.source_type === "http"
                          ? "var(--source-http-fg)"
                          : d.source_type === "ytdlp"
                            ? "var(--source-ytdlp-fg)"
                            : d.source_type === "rss"
                              ? "var(--source-rss-fg)"
                              : "var(--source-torrent-fg)",
                    }}
                  >
                    {srcBadge.label}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 10,
                      background: badge.bg,
                      color: d.status === "failed" ? "var(--color-error)" : "var(--text-secondary)",
                    }}
                  >
                    {badge.label}
                  </span>
                </div>
              </div>
              {d.status === "failed" && d.error_message ? (
                <div style={{ marginTop: 8, fontSize: 13, color: "var(--color-error)", whiteSpace: "pre-wrap" }}>
                  {d.error_message}
                </div>
              ) : null}
              <div
                style={{
                  marginTop: 8,
                  height: 8,
                  borderRadius: 4,
                  background: "var(--border-default)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Math.max(0, d.progress_pct))}%`,
                    height: "100%",
                    background: d.status === "failed" ? "var(--color-error)" : "var(--accent)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
              {showSpeed ? (
                <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-muted)" }}>
                  {formatSpeed(d.speed_bps)}
                  {etaStr ? ` · ${etaStr} remaining` : ""}
                </div>
              ) : null}
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
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
  padding: "7px 16px",
  borderRadius: 8,
  border: "1px solid var(--border-default)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 13,
};
