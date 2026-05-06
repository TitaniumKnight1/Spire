import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import { DEFAULT_SHORTCUT_MAP, type ShortcutMap } from "@shared/library-types";
import { useIPC } from "../../hooks/useIPC.js";

type ShortcutKey = keyof ShortcutMap;

const ROWS: { id: ShortcutKey; label: string }[] = [
  { id: "playPause", label: "Play / Pause" },
  { id: "nextChapter", label: "Next Chapter" },
  { id: "prevChapter", label: "Previous Chapter" },
  { id: "nextFile", label: "Next File" },
  { id: "prevFile", label: "Previous File" },
  { id: "seekForward30", label: "Skip Forward 30s" },
  { id: "seekBack30", label: "Skip Back 30s" },
  { id: "speedUp", label: "Speed Up" },
  { id: "speedDown", label: "Speed Down" },
  { id: "toggleMiniPlayer", label: "Toggle Mini Player" },
];

function normalizeAccel(a: string): string {
  return a.trim().toLowerCase();
}

function accelConflict(map: ShortcutMap, action: ShortcutKey, candidate: string): ShortcutKey | null {
  const c = normalizeAccel(candidate);
  for (const row of ROWS) {
    if (row.id === action) {
      continue;
    }
    if (normalizeAccel(map[row.id]) === c) {
      return row.id;
    }
  }
  return null;
}

function eventToAccelerator(e: KeyboardEvent): "cancel" | "reject" | string {
  if (e.key === "Escape") {
    return "cancel";
  }
  if (e.code === "F5") {
    return "reject";
  }
  if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" || e.key === "Meta") {
    return "reject";
  }

  let main: string | null = null;
  if (e.code === "Space") {
    main = "Space";
  } else if (e.code === "ArrowLeft") {
    main = "Left";
  } else if (e.code === "ArrowRight") {
    main = "Right";
  } else if (e.code === "ArrowUp") {
    main = "Up";
  } else if (e.code === "ArrowDown") {
    main = "Down";
  } else if (e.code === "Period") {
    main = ".";
  } else if (e.code === "Comma") {
    main = ",";
  } else if (e.code === "Slash") {
    main = "/";
  } else if (e.code === "Backslash") {
    main = "\\";
  } else if (e.code === "BracketLeft") {
    main = "[";
  } else if (e.code === "BracketRight") {
    main = "]";
  } else if (e.code === "Equal") {
    main = "=";
  } else if (e.code === "Minus") {
    main = "-";
  } else if (e.code === "Semicolon") {
    main = ";";
  } else if (e.code === "Quote") {
    main = "'";
  } else if (/^F\d{1,2}$/.test(e.code)) {
    main = e.code;
  } else if (e.code.startsWith("Digit")) {
    main = e.code.slice(5);
  } else if (e.code.startsWith("Key")) {
    main = e.code.slice(3).toUpperCase();
  } else if (e.code === "Backquote") {
    main = "`";
  } else {
    return "reject";
  }

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) {
    parts.push("CommandOrControl");
  }
  if (e.altKey) {
    parts.push("Alt");
  }
  if (e.shiftKey) {
    parts.push("Shift");
  }

  if (!main) {
    return "reject";
  }

  return [...parts, main].join("+");
}

function displayAccelerator(accel: string): string {
  return accel.replaceAll("CommandOrControl", "Ctrl");
}

export function ShortcutConfigurator(): ReactElement {
  const { invoke } = useIPC();
  const [map, setMap] = useState<ShortcutMap | null>(null);
  const [editing, setEditing] = useState<ShortcutKey | null>(null);
  const [phase, setPhase] = useState<"capture" | "confirm" | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const m = await invoke<ShortcutMap>(IPC_CHANNELS.settings.GET_SHORTCUTS);
    setMap(m);
  }, [invoke]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (editing == null || phase !== "capture") {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      const built = eventToAccelerator(e);
      if (built === "cancel") {
        setEditing(null);
        setPhase(null);
        setPending(null);
        setError(null);
        return;
      }
      if (built === "reject") {
        setError("Invalid shortcut");
        return;
      }
      const conflict = map ? accelConflict(map, editing, built) : null;
      if (conflict) {
        const label = ROWS.find((r) => r.id === conflict)?.label ?? conflict;
        setError(`Already assigned to ${label}`);
        return;
      }
      setError(null);
      setPending(built);
      setPhase("confirm");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editing, phase, map]);

  const startEdit = (id: ShortcutKey) => {
    setEditing(id);
    setPhase("capture");
    setPending(null);
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setPhase(null);
    setPending(null);
    setError(null);
  };

  const savePending = async () => {
    if (!map || !editing || !pending) {
      return;
    }
    const conflict = accelConflict(map, editing, pending);
    if (conflict) {
      const label = ROWS.find((r) => r.id === conflict)?.label ?? conflict;
      setError(`Already assigned to ${label}`);
      return;
    }
    setBusy(true);
    try {
      const next = { ...map, [editing]: pending };
      await invoke<{ ok: boolean }>(IPC_CHANNELS.settings.SAVE_SHORTCUTS, next);
      setMap(next);
      cancelEdit();
    } finally {
      setBusy(false);
    }
  };

  const resetDefaults = async () => {
    setBusy(true);
    try {
      const next = { ...DEFAULT_SHORTCUT_MAP };
      await invoke<{ ok: boolean }>(IPC_CHANNELS.settings.SAVE_SHORTCUTS, next);
      setMap(next);
      cancelEdit();
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => ROWS, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {map == null ? (
        <div style={{ color: "var(--text-muted)" }}>Loading shortcuts…</div>
      ) : (
        rows.map((row) => {
          const isRow = editing === row.id;
          const showCapture = isRow && phase === "capture";
          const showConfirm = isRow && phase === "confirm" && pending;
          const accel = map[row.id];
          return (
            <div
              key={row.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                padding: "10px 0",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ flex: "1 1 160px", fontSize: 13, color: "var(--text-secondary)" }}>{row.label}</div>
              <div
                style={{
                  minWidth: 80,
                  padding: "5px 12px",
                  borderRadius: 6,
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-strong)",
                  color: showCapture ? "var(--text-muted)" : "var(--text-primary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  fontWeight: 500,
                  textAlign: "center",
                  animation: showCapture ? "capturePulse 1s ease-in-out infinite" : "none",
                }}
              >
                {showCapture ? "Press a key…" : showConfirm ? displayAccelerator(pending) : displayAccelerator(accel)}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {!isRow || phase == null ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startEdit(row.id)}
                    className="btn-secondary"
                    style={{ padding: "5px 12px", marginLeft: 12 }}
                  >
                    Edit
                  </button>
                ) : showConfirm ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => void savePending()} className="btn-secondary" style={{ padding: "5px 12px", marginLeft: 12 }}>
                      Save
                    </button>
                    <button type="button" disabled={busy} onClick={cancelEdit} className="btn-secondary" style={{ padding: "5px 12px" }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={busy} onClick={cancelEdit} className="btn-secondary" style={{ padding: "5px 12px" }}>
                    Cancel
                  </button>
                )}
              </div>
              {isRow && error ? (
                <div style={{ flexBasis: "100%", color: "var(--color-error)", fontSize: 12 }}>{error}</div>
              ) : null}
            </div>
          );
        })
      )}
      <div style={{ marginTop: 8 }}>
        <button type="button" disabled={busy || map == null} onClick={() => void resetDefaults()} className="btn-secondary" style={{ marginTop: 20 }}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
