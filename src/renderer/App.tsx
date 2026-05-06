import { type ReactElement, useEffect, useMemo, useState } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
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

type UpdateBannerState =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  | { phase: "downloaded"; version: string };

export function App(): ReactElement {
  const [active, setActive] = useState<NavKey>("library");
  const [podcastDetail, setPodcastDetail] = useState<SavedPodcastFeed | null>(null);
  const [updateBanner, setUpdateBanner] = useState<UpdateBannerState>({ phase: "idle" });
  const [updateDismissed, setUpdateDismissed] = useState(false);
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

  useEffect(() => {
    const offAvailable = ipc.subscribe(IPC_CHANNELS.updates.UPDATE_AVAILABLE, (...payload) => {
      const first = payload[0] as { version?: string } | undefined;
      const version = typeof first?.version === "string" ? first.version : "";
      setUpdateBanner({ phase: "available", version });
      setUpdateDismissed(false);
    });
    const offDownloaded = ipc.subscribe(IPC_CHANNELS.updates.UPDATE_DOWNLOADED, (...payload) => {
      const first = payload[0] as { version?: string } | undefined;
      const version = typeof first?.version === "string" ? first.version : "";
      setUpdateBanner({ phase: "downloaded", version });
      setUpdateDismissed(false);
    });
    return () => {
      offAvailable();
      offDownloaded();
    };
  }, [ipc]);

  const showUpdateBanner = !updateDismissed && updateBanner.phase !== "idle";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {showUpdateBanner ? (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 14px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--bg-surface)",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            {updateBanner.phase === "available" ? (
              <>
                Update available{updateBanner.version ? ` (v${updateBanner.version})` : ""} — downloading…
              </>
            ) : (
              <>
                Update ready — will install on next restart
                {updateBanner.version ? ` (v${updateBanner.version})` : ""}
              </>
            )}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {updateBanner.phase === "downloaded" ? (
              <button
                type="button"
                onClick={() => {
                  void ipc.invoke(IPC_CHANNELS.settings.APP_RESTART_TO_UPDATE);
                }}
                className="btn-primary"
                style={{ padding: "6px 12px", fontSize: 12 }}
              >
                Restart Now
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss update notice"
              onClick={() => setUpdateDismissed(true)}
              className="btn-secondary"
              style={{ padding: "3px 10px", fontSize: 16, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          style={{
            position: "relative",
            width: 240,
            borderRight: "1px solid var(--border-subtle)",
            background: "var(--bg-sidebar)",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: "24px 20px 32px 20px",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 12 14" aria-hidden="true">
              <path d="M6 1L11 13H1L6 1Z" fill="var(--accent)" />
            </svg>
            <span
              style={{
                fontSize: 17,
                fontWeight: 700,
                letterSpacing: "-0.03em",
                color: "var(--text-primary)",
              }}
            >
              Spire
            </span>
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8, flex: 1, paddingBottom: 56 }}>
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.key;
              return (
                <button
                  key={item.key}
                  className={`main-nav-item${isActive ? " main-nav-item-active" : ""}`}
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
                    padding: isActive ? "10px 20px 10px 18px" : "10px 20px",
                    borderRadius: 0,
                    border: "1px solid transparent",
                    borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                    background: "transparent",
                    color: isActive ? "var(--accent)" : "var(--text-secondary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: 13.5,
                    fontWeight: isActive ? 600 : 450,
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
                        background: "var(--accent)",
                        color: "var(--text-inverse)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {activeDownloadBadge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              padding: "16px 20px",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            v0.1.1
          </div>
        </aside>
        <main
          style={{
            flex: 1,
            minWidth: 0,
            padding: "36px 44px",
            paddingRight: 44 + panelPad,
            overflow: "auto",
            position: "relative",
            background: "var(--bg-base)",
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
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, gap: 16 }}>
          <h1 className="page-title">Downloads</h1>
        </div>
        <DownloadQueue
          downloads={downloadsApi.downloads}
          isLoading={downloadsApi.isLoading}
          addUrl={downloadsApi.addUrl}
          onOpenPodcasts={onNavigatePodcasts}
          cancel={downloadsApi.cancel}
          retry={downloadsApi.retry}
        />
        <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "24px 0" }} />
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
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, gap: 16 }}>
          <h1 className="page-title">Podcasts</h1>
        </div>
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
