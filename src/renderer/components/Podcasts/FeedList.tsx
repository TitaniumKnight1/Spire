import { type FormEvent, type ReactElement, useCallback, useEffect, useState } from "react";
import type { RssFeedPayload, SavedPodcastFeed } from "@shared/library-types";

export type FeedListProps = {
  fetchFeed: (url: string) => Promise<RssFeedPayload>;
  getSavedFeeds: () => Promise<SavedPodcastFeed[]>;
  saveFeed: (args: { feedUrl: string; title: string; coverUrl: string | null }) => Promise<SavedPodcastFeed>;
  deleteFeed: (id: number) => Promise<void>;
  onOpenFeed: (feed: SavedPodcastFeed) => void;
};

export function FeedList(props: FeedListProps): ReactElement {
  const [feeds, setFeeds] = useState<SavedPodcastFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedUrlInput, setFeedUrlInput] = useState("");
  const [preview, setPreview] = useState<RssFeedPayload | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await props.getSavedFeeds();
    setFeeds(list);
  }, [props.getSavedFeeds]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const list = await props.getSavedFeeds();
        if (!cancelled) {
          setFeeds(list);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load feeds");
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
  }, [props.getSavedFeeds]);

  const onPreview = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      const url = feedUrlInput.trim();
      if (!url) {
        setError("Paste an RSS or Atom feed URL");
        return;
      }
      setBusy(true);
      try {
        const p = await props.fetchFeed(url);
        setPreview(p);
        setPreviewUrl(url);
      } catch (err) {
        setPreview(null);
        setPreviewUrl(null);
        setError(err instanceof Error ? err.message : "Could not fetch feed");
      } finally {
        setBusy(false);
      }
    },
    [feedUrlInput, props.fetchFeed],
  );

  const onConfirmSave = useCallback(async () => {
    if (!preview || !previewUrl) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.saveFeed({
        feedUrl: previewUrl,
        title: preview.title,
        coverUrl: preview.coverUrl,
      });
      setFeedUrlInput("");
      setPreview(null);
      setPreviewUrl(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save feed");
    } finally {
      setBusy(false);
    }
  }, [preview, previewUrl, props.saveFeed, reload]);

  const onDelete = useCallback(
    async (id: number) => {
      setError(null);
      try {
        await props.deleteFeed(id);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete feed");
      }
    },
    [props.deleteFeed, reload],
  );

  return (
    <div>
      <form onSubmit={onPreview} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <input
          type="text"
          value={feedUrlInput}
          onChange={(e) => setFeedUrlInput(e.target.value)}
          placeholder="Paste RSS / Atom feed URL…"
          disabled={busy}
          className="input-base"
          style={{ flex: "1 1 280px" }}
        />
        <button type="submit" disabled={busy} className="btn-primary" style={{ cursor: busy ? "wait" : "pointer" }}>
          Preview
        </button>
      </form>

      {preview && previewUrl ? (
        <div
          style={{
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: 20,
            marginBottom: 20,
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ fontWeight: 600 }}>{preview.title}</div>
          {preview.description ? (
            <div style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6 }}>{preview.description.slice(0, 280)}</div>
          ) : null}
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
            {preview.episodes.length} episode{preview.episodes.length === 1 ? "" : "s"} detected
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirmSave()}
            className="btn-primary"
            style={{ marginTop: 12, cursor: busy ? "wait" : "pointer" }}
          >
            Save to Podcasts
          </button>
        </div>
      ) : null}

      {error ? (
        <p style={{ color: "var(--color-error)", marginTop: 0 }}>{error}</p>
      ) : null}

      {loading ? <p style={{ color: "var(--text-muted)" }}>Loading feeds…</p> : null}

      {!loading && feeds.length === 0 ? (
        <p style={{ color: "var(--text-muted)", paddingTop: 32, textAlign: "center" }}>
          No saved feeds yet. Preview a feed URL above to add one.
        </p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {feeds.map((f) => (
          <li
            key={f.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-elevated)",
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "var(--radius-md)",
                background: "var(--bg-surface)",
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              {f.cover_art_url ? (
                <img
                  src={f.cover_art_url}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => props.onOpenFeed(f)}
              style={{
                flex: 1,
                textAlign: "left",
                background: "transparent",
                border: "none",
                color: "var(--text-primary)",
                cursor: "pointer",
                padding: 0,
                fontWeight: 600,
                fontSize: 16,
              }}
            >
              {f.title?.trim() || f.feed_url}
            </button>
            <button
              type="button"
              onClick={() => void onDelete(f.id)}
              className="btn-danger"
              style={{ padding: "5px 12px" }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
