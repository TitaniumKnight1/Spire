import { type ReactElement, useMemo, useState } from "react";
import type { SavedPodcastFeed } from "@shared/library-types";
import { Bookmarks, ChapterList, PlayerBar } from "./components/Player/index.js";
import { LibraryView } from "./components/Library/index.js";
import { DownloadHistory } from "./components/Downloads/DownloadHistory.js";
import { DownloadQueue } from "./components/Downloads/DownloadQueue.js";
import { EpisodeList, FeedList } from "./components/Podcasts/index.js";
import { SettingsView } from "./components/Settings/SettingsView.js";
import { useDownloads } from "./hooks/useDownloads.js";
import { useIPC } from "./hooks/useIPC.js";
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
    return <SettingsView />;
  }

  return null;
}
