import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
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
  clearDownloadHistory: (ids: number[]) => Promise<{ deleted: number }>;
};

export function DownloadHistory({ switchToLibrary, clearDownloadHistory }: DownloadHistoryProps): ReactElement {
  const downloads = useDownloadStore((s) => s.downloads);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  const rows = useMemo(
    () => downloads.filter((d) => d.status === "completed" || d.status === "cancelled"),
    [downloads],
  );

  useEffect(() => {
    const valid = new Set(rows.map((r) => r.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (valid.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed || next.size !== prev.size ? next : prev;
    });
  }, [rows]);

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const selectedCount = rows.filter((r) => selectedIds.has(r.id)).length;

  const toggleId = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(rows.map((r) => r.id)));
  }, [rows]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const removeSelected = useCallback(async () => {
    const ids = rows.filter((r) => selectedIds.has(r.id)).map((r) => r.id);
    if (ids.length === 0) {
      return;
    }
    const label = ids.length === 1 ? "this download" : `${ids.length} downloads`;
    if (!window.confirm(`Remove ${label} from history? This cannot be undone.`)) {
      return;
    }
    await clearDownloadHistory(ids);
    setSelectedIds(new Set());
  }, [rows, selectedIds, clearDownloadHistory]);

  const clearAllHistory = useCallback(async () => {
    if (rows.length === 0) {
      return;
    }
    if (!window.confirm(`Remove all ${rows.length} items from download history? This cannot be undone.`)) {
      return;
    }
    await clearDownloadHistory(rows.map((r) => r.id));
    setSelectedIds(new Set());
  }, [rows, clearDownloadHistory]);

  const removeOne = useCallback(
    async (id: number) => {
      if (!window.confirm("Remove this download from history?")) {
        return;
      }
      await clearDownloadHistory([id]);
    },
    [clearDownloadHistory],
  );

  return (
    <section>
      <div className="section-label">History</div>
      {rows.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13, padding: "20px 0" }}>No download history yet.</p>
      ) : (
        <>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 10px", lineHeight: 1.45 }}>
            Use the checkboxes and toolbar, Clear all history, or each row's Remove button. This only clears the list; library books
            are not removed.
          </p>
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 4,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
              padding: "10px 0 12px",
              background: "var(--bg-base)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <button type="button" className="btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={selectAll}>
              Select all
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: "5px 12px", fontSize: 12 }}
              onClick={clearSelection}
              disabled={selectedCount === 0}
            >
              Clear selection
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: "5px 12px", fontSize: 12 }}
              onClick={() => void removeSelected()}
              disabled={selectedCount === 0}
            >
              Remove selected{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
            <button type="button" className="btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => void clearAllHistory()}>
              Clear all history
            </button>
            <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
              {allSelected ? "All selected" : `${selectedCount} of ${rows.length} selected`}
            </span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((d) => (
              <HistoryRow
                key={d.id}
                item={d}
                selected={selectedIds.has(d.id)}
                onToggleSelect={() => toggleId(d.id)}
                switchToLibrary={switchToLibrary}
                onRemove={() => void removeOne(d.id)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function HistoryRow({
  item,
  selected,
  onToggleSelect,
  switchToLibrary,
  onRemove,
}: {
  item: DownloadItem;
  selected: boolean;
  onToggleSelect: () => void;
  switchToLibrary: () => void;
  onRemove: () => void;
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
        border: selected ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
        background: "var(--bg-elevated)",
        opacity: item.status === "completed" ? 0.7 : 1,
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${title}`}
          style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
        />
      </label>
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
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button type="button" className="btn-secondary" style={{ padding: "5px 12px" }} onClick={onRemove}>
          Remove
        </button>
        {item.book_id != null ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedBook(item.book_id);
              switchToLibrary();
            }}
            className="btn-secondary"
            style={{ padding: "5px 12px" }}
          >
            Go to book
          </button>
        ) : null}
      </div>
    </li>
  );
}
