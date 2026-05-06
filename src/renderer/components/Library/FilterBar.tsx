import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from "react";
import type { BookListItem } from "@shared/library-types";
import { useLibraryStore } from "../../store/libraryStore.js";

const controlH: CSSProperties = { height: 34, boxSizing: "border-box" };

export function FilterBar({ books }: { books: BookListItem[] }): ReactElement {
  const filters = useLibraryStore((s) => s.filters);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const setViewMode = useLibraryStore((s) => s.setViewMode);
  const setFilters = useLibraryStore((s) => s.setFilters);
  const resetFilters = useLibraryStore((s) => s.resetFilters);

  const [localQuery, setLocalQuery] = useState(filters.query);

  useEffect(() => {
    setLocalQuery(filters.query);
  }, [filters.query]);

  useEffect(() => {
    const id = setTimeout(() => {
      setFilters({ query: localQuery });
    }, 200);
    return () => clearTimeout(id);
  }, [localQuery, setFilters]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of books) {
      for (const t of b.tags) {
        set.add(t);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [books]);

  const seriesOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of books) {
      const s = b.series?.trim();
      if (s) {
        set.add(s);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [books]);

  const seriesFilterDisabled = filters.groupBySeries;
  const hasActiveFilters =
    filters.query.trim().length > 0 ||
    filters.status !== "all" ||
    filters.tag != null ||
    filters.series != null ||
    filters.groupBySeries;

  return (
    <div
      style={{
        marginBottom: 20,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 10,
        padding: "10px 14px",
      }}
    >
      <div className="filter-toolbar-inner">
        <input
          type="search"
          placeholder="Search title, author, narrator…"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          className="filter-search-inside"
          style={{ ...controlH, paddingLeft: 4, paddingRight: 8 }}
          aria-label="Search library"
        />
        <div className="toolbar-divider" role="separator" aria-hidden="true" />
        <select
          value={filters.status}
          onChange={(e) =>
            setFilters({
              status: e.target.value as (typeof filters)["status"],
            })
          }
          className="select-base"
          style={{ ...controlH, minWidth: 130 }}
          aria-label="Status filter"
        >
          <option value="all">Status: All</option>
          <option value="unstarted">Status: Unstarted</option>
          <option value="in-progress">Status: In Progress</option>
          <option value="finished">Status: Finished</option>
        </select>
        <select
          value={filters.tag ?? ""}
          onChange={(e) => setFilters({ tag: e.target.value === "" ? null : e.target.value })}
          className="select-base"
          style={{ ...controlH, minWidth: 130 }}
          aria-label="Tag filter"
        >
          <option value="">Tag: All</option>
          {tagOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          disabled={seriesFilterDisabled}
          value={filters.series ?? ""}
          onChange={(e) => setFilters({ series: e.target.value === "" ? null : e.target.value })}
          className="select-base"
          style={{
            ...controlH,
            minWidth: 130,
            opacity: seriesFilterDisabled ? 0.6 : 1,
            cursor: seriesFilterDisabled ? "not-allowed" : "pointer",
          }}
          aria-label="Series filter"
        >
          <option value="">Series: All</option>
          {seriesOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="toolbar-divider" role="separator" aria-hidden="true" />
        <button
          type="button"
          onClick={() => setFilters({ groupBySeries: !filters.groupBySeries })}
          className="btn-secondary"
          style={{
            ...controlH,
            borderRadius: 20,
            padding: "0 14px",
            display: "inline-flex",
            alignItems: "center",
            background: filters.groupBySeries ? "var(--accent-soft)" : "transparent",
            color: filters.groupBySeries ? "var(--accent)" : "var(--text-secondary)",
            borderColor: filters.groupBySeries ? "var(--accent)" : "var(--border-default)",
          }}
        >
          Group by series
        </button>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => resetFilters()}
            className="btn-secondary"
            style={{ ...controlH, padding: "0 14px", display: "inline-flex", alignItems: "center" }}
          >
            Clear filters
          </button>
        ) : null}
        <div className="toolbar-divider" role="separator" aria-hidden="true" />
        <div
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
            height: 34,
          }}
        >
          <button
            type="button"
            aria-label="Grid view"
            onClick={() => setViewMode("grid")}
            style={{
              width: 34,
              height: 34,
              border: "none",
              borderRight: "1px solid var(--border-default)",
              background: viewMode === "grid" ? "var(--bg-hover)" : "transparent",
              color: viewMode === "grid" ? "var(--text-primary)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M1 1h5v5H1zM8 1h5v5H8zM1 8h5v5H1zM8 8h5v5H8z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="List view"
            onClick={() => setViewMode("list")}
            style={{
              width: 34,
              height: 34,
              border: "none",
              background: viewMode === "list" ? "var(--bg-hover)" : "transparent",
              color: viewMode === "list" ? "var(--text-primary)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M1 2h12v2H1zM1 6h12v2H1zM1 10h12v2H1z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
