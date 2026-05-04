import { type ReactElement, useEffect, useMemo, useState } from "react";
import type { BookListItem } from "@shared/library-types";
import { useLibraryStore } from "../../store/libraryStore.js";

const btnStyle = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "#1e1e1e",
  color: "#e8e8e8",
  cursor: "pointer" as const,
  fontSize: 13,
};

export function FilterBar({ books }: { books: BookListItem[] }): ReactElement {
  const filters = useLibraryStore((s) => s.filters);
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

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid #2a2a2a",
        background: "#141414",
      }}
    >
      <input
        type="search"
        placeholder="Search title, author, narrator…"
        value={localQuery}
        onChange={(e) => setLocalQuery(e.target.value)}
        style={{
          minWidth: 200,
          flex: "1 1 200px",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid #333",
          background: "#0f0f0f",
          color: "#e8e8e8",
        }}
      />

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#aaa" }}>
        Status
        <select
          value={filters.status}
          onChange={(e) =>
            setFilters({
              status: e.target.value as (typeof filters)["status"],
            })
          }
          style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #333", background: "#1a1a1a", color: "#e8e8e8" }}
        >
          <option value="all">All</option>
          <option value="unstarted">Unstarted</option>
          <option value="in-progress">In Progress</option>
          <option value="finished">Finished</option>
        </select>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#aaa" }}>
        Tag
        <select
          value={filters.tag ?? ""}
          onChange={(e) => setFilters({ tag: e.target.value === "" ? null : e.target.value })}
          style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #333", background: "#1a1a1a", color: "#e8e8e8", minWidth: 120 }}
        >
          <option value="">All tags</option>
          {tagOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: seriesFilterDisabled ? "#555" : "#aaa",
        }}
      >
        Series
        <select
          disabled={seriesFilterDisabled}
          value={filters.series ?? ""}
          onChange={(e) => setFilters({ series: e.target.value === "" ? null : e.target.value })}
          style={{
            padding: "6px 8px",
            borderRadius: 8,
            border: "1px solid #333",
            background: seriesFilterDisabled ? "#111" : "#1a1a1a",
            color: seriesFilterDisabled ? "#666" : "#e8e8e8",
            minWidth: 120,
          }}
        >
          <option value="">All series</option>
          {seriesOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#aaa", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={filters.groupBySeries}
          onChange={(e) => setFilters({ groupBySeries: e.target.checked })}
        />
        Group by series
      </label>

      <button type="button" onClick={() => resetFilters()} style={btnStyle}>
        Clear filters
      </button>
    </div>
  );
}
