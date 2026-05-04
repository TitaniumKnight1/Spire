import { type ReactElement, useEffect, useState } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { ListeningStats, StatsSummary } from "@shared/library-types";
import { useIPC } from "../../hooks/useIPC.js";

function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) {
    return "0h 0m";
  }
  const totalMinutes = Math.floor((hours * 60) + 1e-6);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

function formatStreak(n: number): string {
  if (n === 1) {
    return "1 day";
  }
  return `${n} days`;
}

function isAllZero(s: ListeningStats): boolean {
  return (
    s.hoursThisWeek <= 0 &&
    s.hoursThisMonth <= 0 &&
    s.hoursAllTime <= 0 &&
    s.booksCompleted === 0 &&
    s.booksInProgress === 0 &&
    s.currentStreak === 0 &&
    s.longestStreak === 0 &&
    s.avgPlaybackSpeed <= 0
  );
}

function StatCard({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div
      style={{
        flex: "1 1 140px",
        minWidth: 120,
        padding: 14,
        borderRadius: 10,
        border: "1px solid #2a2a2a",
        background: "#141414",
      }}
    >
      <div style={{ fontSize: 11, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color: "#f2f2f2" }}>{value}</div>
    </div>
  );
}

export function StatsPanel(): ReactElement {
  const { invoke } = useIPC();
  const [stats, setStats] = useState<ListeningStats | null>(null);

  useEffect(() => {
    void invoke<StatsSummary>(IPC_CHANNELS.stats.GET_SUMMARY).then((r) => setStats(r.stats));
  }, [invoke]);

  if (stats == null) {
    return <div style={{ color: "#888", fontSize: 14 }}>Loading stats…</div>;
  }

  if (isAllZero(stats)) {
    return (
      <div
        style={{
          padding: 24,
          borderRadius: 12,
          border: "1px dashed #333",
          color: "#888",
          fontSize: 14,
          textAlign: "center",
        }}
      >
        Start listening to see your stats
      </div>
    );
  }

  const avg = stats.avgPlaybackSpeed > 0 ? `${stats.avgPlaybackSpeed.toFixed(1)}×` : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <StatCard label="Hours this week" value={formatHours(stats.hoursThisWeek)} />
        <StatCard label="Hours this month" value={formatHours(stats.hoursThisMonth)} />
        <StatCard label="All-time hours" value={formatHours(stats.hoursAllTime)} />
        <StatCard label="Books completed" value={String(stats.booksCompleted)} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <StatCard label="Current streak" value={formatStreak(stats.currentStreak)} />
        <StatCard label="Longest streak" value={formatStreak(stats.longestStreak)} />
        <StatCard label="Avg speed" value={avg} />
        <StatCard label="In progress" value={String(stats.booksInProgress)} />
      </div>
    </div>
  );
}
