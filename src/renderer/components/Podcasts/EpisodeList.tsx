import { type ReactElement, useCallback, useEffect, useState } from "react";
import type { RssEpisode, RssFeedPayload, SavedPodcastFeed } from "@shared/library-types";
import { formatDuration } from "../../utils/formatDuration.js";

export type EpisodeListProps = {
  feed: SavedPodcastFeed;
  fetchFeed: (url: string) => Promise<RssFeedPayload>;
  downloadEpisode: (args: { url: string; title: string | null }) => Promise<{ downloadId: number }>;
  onBack: () => void;
};

export function EpisodeList(props: EpisodeListProps): ReactElement {
  const [payload, setPayload] = useState<RssFeedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const p = await props.fetchFeed(props.feed.feed_url);
        if (!cancelled) {
          setPayload(p);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load episodes");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.feed.feed_url, props.fetchFeed]);

  const onDownloadOne = useCallback(
    async (ep: RssEpisode) => {
      setError(null);
      try {
        await props.downloadEpisode({ url: ep.url, title: ep.title });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Download failed");
      }
    },
    [props.downloadEpisode],
  );

  const onDownloadAll = useCallback(async () => {
    if (!payload?.episodes.length) {
      return;
    }
    setQueueBusy(true);
    setError(null);
    try {
      for (const ep of payload.episodes) {
        await props.downloadEpisode({ url: ep.url, title: ep.title });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Queue failed");
    } finally {
      setQueueBusy(false);
    }
  }, [payload, props.downloadEpisode]);

  const title = props.feed.title?.trim() || payload?.title || props.feed.feed_url;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          onClick={props.onBack}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid #444",
            background: "#1a1a1a",
            color: "#e8e8e8",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>
        <h2 style={{ margin: 0, fontSize: 20, flex: 1, minWidth: 0 }}>{title}</h2>
        <button
          type="button"
          disabled={queueBusy || !payload?.episodes.length}
          onClick={() => void onDownloadAll()}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid #3584e4",
            background: "#1a2840",
            color: "#e8e8e8",
            cursor: queueBusy ? "wait" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Download all
        </button>
      </div>

      {loading ? <p style={{ color: "#9a9a9a" }}>Loading episodes…</p> : null}
      {error ? <p style={{ color: "#f66" }}>{error}</p> : null}

      {!loading && payload ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {payload.episodes.map((ep) => (
            <li
              key={`${ep.url}-${ep.title}`}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #2a2a2a",
                background: "#111",
              }}
            >
              <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{ep.title}</div>
                <div style={{ fontSize: 13, color: "#9a9a9a", marginTop: 4 }}>
                  {formatDuration(ep.duration)}
                  {ep.pubDate
                    ? ` · ${new Date(ep.pubDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onDownloadOne(ep)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #2ec27e",
                  background: "#102818",
                  color: "#e8e8e8",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
