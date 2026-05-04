import { type ReactElement, useMemo } from "react";
import type { DownloadItem } from "@shared/library-types";
import { useDownloadStore } from "../../store/downloadStore.js";
import { useLibraryStore } from "../../store/libraryStore.js";

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
      <h2 style={{ marginTop: 0, fontSize: 18 }}>History</h2>
      {rows.length === 0 ? (
        <p style={{ color: "#9a9a9a" }}>No download history yet.</p>
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

  const sourceLabel = item.source_type === "torrent_file" ? "Torrent file" : "Magnet";
  const when = item.completed_at ?? item.started_at ?? "";
  const title = item.display_name?.trim() || "Unknown torrent";

  return (
    <li
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
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "#9a9a9a", marginTop: 4 }}>
          {when ? new Date(when).toLocaleString() : "—"} · {sourceLabel} ·{" "}
          <span
            style={{
              color: item.status === "cancelled" ? "#c061cb" : "#2ec27e",
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
          style={{
            background: "transparent",
            border: "none",
            color: "#62a0ea",
            cursor: "pointer",
            textDecoration: "underline",
            fontSize: 14,
            padding: 0,
          }}
        >
          Go to book
        </button>
      ) : null}
    </li>
  );
}
