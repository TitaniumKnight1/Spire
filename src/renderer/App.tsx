import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import type { SavedPodcastFeed } from "@shared/library-types";
import { Bookmarks, ChapterList, PlayerBar } from "./components/Player/index.js";
import { LibraryView } from "./components/Library/index.js";
import { DownloadHistory } from "./components/Downloads/DownloadHistory.js";
import { DownloadQueue } from "./components/Downloads/DownloadQueue.js";
import { EpisodeList, FeedList } from "./components/Podcasts/index.js";
import { useDownloads } from "./hooks/useDownloads.js";
import { useIPC } from "./hooks/useIPC.js";
import { useLibrary } from "./hooks/useLibrary.js";
import { usePlayerStore } from "./store/playerStore.js";

type NavKey = "library" | "downloads" | "podcasts" | "settings";

const NAV_ITEMS: { key: NavKey; label: string }[] = [
  { key: "library", label: "Library" },
  { key: "downloads", label: "Downloads" },
  { key: "podcasts", label: "Podcasts" },
  { key: "settings", label: "Settings" },
];

export function App(): ReactElement {
  const [active, setActive] = useState<NavKey>("library");
  const [podcastDetail, setPodcastDetail] = useState<SavedPodcastFeed | null>(null);
  const ipc = useIPC();
  const downloadsApi = useDownloads();
  const showChapterPanel = usePlayerStore((s) => s.showChapterPanel);
  const showBookmarksPanel = usePlayerStore((s) => s.showBookmarksPanel);
  const panelPad = (showChapterPanel ? 280 : 0) + (showBookmarksPanel ? 280 : 0);

  const activeDownloadBadge = useMemo(() => {
    return downloadsApi.downloads.filter((d) =>
      ["queued", "downloading", "paused"].includes(d.status),
    ).length;
  }, [downloadsApi.downloads]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0f0f0f",
        color: "#e8e8e8",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          style={{
            width: 220,
            borderRight: "1px solid #222",
            padding: "16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 12, letterSpacing: 0.4 }}>Spire</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setActive(item.key);
                if (item.key === "podcasts") {
                  setPodcastDetail(null);
                }
                void ipc.pingDomain(item.key);
              }}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid transparent",
                background: active === item.key ? "#1c1c1c" : "transparent",
                color: "#e8e8e8",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>{item.label}</span>
              {item.key === "downloads" && activeDownloadBadge > 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    minWidth: 20,
                    height: 20,
                    padding: "0 6px",
                    borderRadius: 999,
                    background: "#3584e4",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {activeDownloadBadge}
                </span>
              ) : null}
            </button>
          ))}
        </aside>
        <main
          style={{
            flex: 1,
            minWidth: 0,
            padding: 24,
            paddingRight: 24 + panelPad,
            overflow: "auto",
            position: "relative",
          }}
        >
          <Outlet
            active={active}
            downloadsApi={downloadsApi}
            podcastDetail={podcastDetail}
            onPodcastDetailChange={setPodcastDetail}
            onNavigatePodcasts={() => {
              setPodcastDetail(null);
              setActive("podcasts");
            }}
            onSwitchToLibrary={() => setActive("library")}
          />
          <ChapterList />
          <Bookmarks />
        </main>
      </div>
      <PlayerBar />
    </div>
  );
}

function Outlet({
  active,
  downloadsApi,
  podcastDetail,
  onPodcastDetailChange,
  onNavigatePodcasts,
  onSwitchToLibrary,
}: {
  active: NavKey;
  downloadsApi: ReturnType<typeof useDownloads>;
  podcastDetail: SavedPodcastFeed | null;
  onPodcastDetailChange: (feed: SavedPodcastFeed | null) => void;
  onNavigatePodcasts: () => void;
  onSwitchToLibrary: () => void;
}): ReactElement | null {
  if (active === "library") {
    return <LibraryView />;
  }

  if (active === "downloads") {
    return (
      <div>
        <h1 style={{ marginTop: 0, fontSize: 22 }}>Downloads</h1>
        <DownloadQueue
          downloads={downloadsApi.downloads}
          isLoading={downloadsApi.isLoading}
          addMagnet={downloadsApi.addMagnet}
          addTorrentFile={downloadsApi.addTorrentFile}
          addUrl={downloadsApi.addUrl}
          onOpenPodcasts={onNavigatePodcasts}
          pause={downloadsApi.pause}
          resume={downloadsApi.resume}
          cancel={downloadsApi.cancel}
          retry={downloadsApi.retry}
        />
        <div style={{ borderTop: "1px solid #222", margin: "24px 0" }} />
        <DownloadHistory switchToLibrary={onSwitchToLibrary} />
      </div>
    );
  }

  if (active === "podcasts") {
    if (podcastDetail) {
      return (
        <EpisodeList
          feed={podcastDetail}
          fetchFeed={downloadsApi.fetchFeed}
          downloadEpisode={downloadsApi.downloadEpisode}
          onBack={() => onPodcastDetailChange(null)}
        />
      );
    }
    return (
      <div>
        <h1 style={{ marginTop: 0, fontSize: 22 }}>Podcasts</h1>
        <FeedList
          fetchFeed={downloadsApi.fetchFeed}
          getSavedFeeds={downloadsApi.getSavedFeeds}
          saveFeed={downloadsApi.saveFeed}
          deleteFeed={downloadsApi.deleteSavedFeed}
          onOpenFeed={(feed) => onPodcastDetailChange(feed)}
        />
      </div>
    );
  }

  if (active === "settings") {
    return (
      <div>
        <h1 style={{ marginTop: 0, fontSize: 22 }}>Settings</h1>
        <WatchFolderSettings />
        <p style={{ color: "#666", fontSize: 13, marginTop: 24 }}>More preferences arrive in Milestone 8.</p>
      </div>
    );
  }

  return null;
}

function WatchFolderSettings(): ReactElement {
  const { getWatchFolder, setWatchFolder, clearWatchFolder } = useLibrary();
  const [path, setPath] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const p = await getWatchFolder();
    setPath(p);
  }, [getWatchFolder]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div
      style={{
        marginTop: 16,
        padding: 16,
        border: "1px solid #2a2a2a",
        borderRadius: 12,
        maxWidth: 560,
        background: "#141414",
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Watch folder</h2>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 12 }}>
        New audio files dropped here are imported into the library automatically.
      </p>
      <div style={{ fontSize: 13, color: "#ccc", wordBreak: "break-all", marginBottom: 12 }}>
        {path === undefined ? "Loading…" : path ?? "None"}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void setWatchFolder()
              .then((p) => setPath(p))
              .finally(() => setBusy(false));
          }}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid #333",
            background: "#1e1e1e",
            color: "#e8e8e8",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          Set folder…
        </button>
        <button
          type="button"
          disabled={busy || !path}
          onClick={() => {
            setBusy(true);
            void clearWatchFolder()
              .then(() => setPath(null))
              .finally(() => setBusy(false));
          }}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid #522",
            background: "#301818",
            color: "#e88",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
