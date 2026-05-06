import { type ReactElement, useMemo } from "react";
import type { DownloadItem } from "@shared/library-types";
import { isMagnetLikeString, parseMagnetDisplayName } from "@shared/magnet-display";
import { useDownloadStore } from "../../store/downloadStore.js";
import { useLibraryStore } from "../../store/libraryStore.js";

function truncateSource(url: string | null | undefined, max = 52): string {
  if (url == null || url.trim() === "") {
    return "";
  }
  const u = url.trim();
  return u.length > max ? `${u.slice(0, max - 1)}…` : u;
}

function historyDownloadTitle(item: DownloadItem): string {
  const dnFromSource = parseMagnetDisplayName(item.source_url ?? undefined);
  const persisted = item.display_name?.trim();
  if (persisted && !isMagnetLikeString(persisted)) {
    return persisted;
  }
  if (dnFromSource) {
    return dnFromSource;
  }
  if (item.source_type === "magnet") {
    return "Magnet download";
  }
  if (item.source_type === "torrent_file") {
    return "Torrent download";
  }
  return truncateSource(item.source_url) || "Download";
}

export type DownloadHistoryProps = {
  switchToLibrary: () => void;
};

export function DownloadHistory(props: DownloadHistoryProps): ReactElement {
  const downloads = useDownloadStore((s) => s.downloads);

  const rows = useMemo(
    () => downloads.filter((d) => d.status === "completed" || d.status === "cancelled"),
    [downloads],
  );

  return (
    <section>
      <div className="section-label">History</div>
      {rows.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13, padding: "20px 0" }}>No download history yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((d) => (
            <HistoryRow key={d.id} item={d} switchToLibrary={props.switchToLibrary} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({
  item,
  switchToLibrary,
}: {
  item: DownloadItem;
  switchToLibrary: () => void;
}): ReactElement {
  const setSelectedBook = useLibraryStore((s) => s.setSelectedBook);

  const sourceLabel =
    item.source_type === "torrent_file"
      ? "Torrent file"
      : item.source_type === "http"
        ? "HTTP"
        : item.source_type === "ytdlp"
          ? "yt-dlp"
          : item.source_type === "rss"
            ? "RSS"
            : "Magnet";
  const when = item.completed_at ?? item.started_at ?? "";
  const title = historyDownloadTitle(item);

  return (
    <li
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-elevated)",
        opacity: item.status === "completed" ? 0.7 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
          {when ? new Date(when).toLocaleString() : "—"} · {sourceLabel} ·{" "}
          <span
            style={{
              color: item.status === "cancelled" ? "var(--color-warning)" : "var(--color-success)",
            }}
          >
            {item.status === "cancelled" ? "Cancelled" : "Completed"}
          </span>
        </div>
      </div>
      {item.book_id != null ? (
        <button
          type="button"
          onClick={() => {
            setSelectedBook(item.book_id);
            switchToLibrary();
          }}
          className="btn-secondary"
          style={{ padding: "5px 12px" }}
        >
          Go to book
        </button>
      ) : null}
    </li>
  );
}
