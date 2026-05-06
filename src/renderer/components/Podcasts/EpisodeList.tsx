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
          className="btn-secondary"
        >
          ← Back
        </button>
        <h2 style={{ margin: 0, fontSize: 20, flex: 1, minWidth: 0 }}>{title}</h2>
        <button
          type="button"
          disabled={queueBusy || !payload?.episodes.length}
          onClick={() => void onDownloadAll()}
          className="btn-primary"
          style={{ cursor: queueBusy ? "wait" : "pointer", whiteSpace: "nowrap" }}
        >
          Download all
        </button>
      </div>

      {loading ? <p style={{ color: "var(--text-muted)" }}>Loading episodes…</p> : null}
      {error ? <p style={{ color: "var(--color-error)" }}>{error}</p> : null}

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
                padding: "12px 0",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{ep.title}</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                  {formatDuration(ep.duration)}
                  {ep.pubDate
                    ? ` · ${new Date(ep.pubDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onDownloadOne(ep)}
                className="btn-secondary"
                style={{ padding: "5px 12px" }}
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
