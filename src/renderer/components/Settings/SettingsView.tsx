import { type CSSProperties, type ReactElement, useCallback, useEffect, useState } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { EqPreset } from "@shared/library-types";
import { useIPC } from "../../hooks/useIPC.js";
import { useLibrary } from "../../hooks/useLibrary.js";
import { ShortcutConfigurator } from "./ShortcutConfigurator.js";
import { StatsPanel } from "./StatsPanel.js";

const SIDEBAR_W = 200;

const EQ_OPTIONS: { value: EqPreset; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "voice-clarity", label: "Voice Clarity" },
  { value: "bass-boost", label: "Bass Boost" },
];

const SLEEP_OPTIONS: { value: string; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "60 min" },
  { value: "end-chapter", label: "End of chapter" },
  { value: "end-book", label: "End of book" },
];

function scrollToId(id: string): void {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clampDefaultSpeed(n: number): number {
  if (!Number.isFinite(n)) {
    return 1;
  }
  const c = Math.min(3.5, Math.max(0.5, n));
  return Math.round(c * 4) / 4;
}

export function SettingsView(): ReactElement {
  const { invoke } = useIPC();
  const { getWatchFolder, setWatchFolder, clearWatchFolder } = useLibrary();

  const [skipSilence, setSkipSilence] = useState<boolean | null>(null);
  const [eqPreset, setEqPreset] = useState<EqPreset | null>(null);
  const [defaultSpeed, setDefaultSpeed] = useState<number>(1);
  const [sleepDefault, setSleepDefault] = useState<string>("off");
  const [autoFetchCovers, setAutoFetchCovers] = useState<boolean>(true);
  const [watchPath, setWatchPath] = useState<string | null | undefined>(undefined);
  const [appInfo, setAppInfo] = useState<{ version: string; platform: string } | null>(null);
  const [libBusy, setLibBusy] = useState(false);

  const loadAll = useCallback(async () => {
    const [ss, eq, spd, sleep, covers, wf, info] = await Promise.all([
      invoke<boolean>(IPC_CHANNELS.settings.GET_SKIP_SILENCE),
      invoke<EqPreset>(IPC_CHANNELS.settings.GET_EQ_PRESET),
      invoke<number>(IPC_CHANNELS.settings.GET_DEFAULT_SPEED),
      invoke<string>(IPC_CHANNELS.settings.GET_SLEEP_TIMER_DEFAULT),
      invoke<boolean>(IPC_CHANNELS.settings.GET_AUTO_FETCH_COVERS),
      getWatchFolder(),
      invoke<{ version: string; platform: string }>(IPC_CHANNELS.settings.GET_APP_INFO),
    ]);
    setSkipSilence(ss);
    setEqPreset(eq);
    setDefaultSpeed(spd);
    setSleepDefault(sleep);
    setAutoFetchCovers(covers);
    setWatchPath(wf);
    setAppInfo(info);
  }, [getWatchFolder, invoke]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const navBtn = (id: string, label: string): ReactElement => (
    <button
      key={id}
      type="button"
      onClick={() => scrollToId(id)}
      style={{
        textAlign: "left",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid transparent",
        background: "transparent",
        color: "#ccc",
        cursor: "pointer",
        fontSize: 14,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", gap: 0, minHeight: "70vh" }}>
      <nav
        style={{
          width: SIDEBAR_W,
          flexShrink: 0,
          borderRight: "1px solid #222",
          padding: "12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8, color: "#fff" }}>Settings</div>
        {navBtn("section-stats", "Stats")}
        {navBtn("section-playback", "Playback")}
        {navBtn("section-library", "Library")}
        {navBtn("section-shortcuts", "Shortcuts")}
        {navBtn("section-about", "About")}
      </nav>
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 20, overflowY: "auto" }}>
        <h1 style={{ marginTop: 0, fontSize: 22 }}>Preferences</h1>

        <section id="section-stats" style={{ marginBottom: 32 }}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: "#f4f4f4" }}>Stats</h2>
          <StatsPanel />
        </section>

        <section id="section-playback" style={{ marginBottom: 32 }}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: "#f4f4f4" }}>Playback</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#ddd" }}>
              <input
                type="checkbox"
                checked={skipSilence === true}
                disabled={skipSilence == null}
                onChange={(e) => {
                  const v = e.target.checked;
                  setSkipSilence(v);
                  void invoke(IPC_CHANNELS.settings.SAVE_SKIP_SILENCE, v);
                }}
              />
              Skip silence
            </label>

            <label style={{ fontSize: 14, color: "#ddd", display: "flex", flexDirection: "column", gap: 6 }}>
              EQ preset
              <select
                value={eqPreset ?? "flat"}
                disabled={eqPreset == null}
                onChange={async (e) => {
                  const v = e.target.value as EqPreset;
                  setEqPreset(v);
                  const res = await invoke<{ ok: boolean }>(IPC_CHANNELS.settings.SET_EQ_PRESET, v);
                  if (!res.ok) {
                    const cur = await invoke<EqPreset>(IPC_CHANNELS.settings.GET_EQ_PRESET);
                    setEqPreset(cur);
                  }
                }}
                style={selectStyle}
              >
                {EQ_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 14, color: "#ddd", display: "flex", flexDirection: "column", gap: 6 }}>
              Default playback speed
              <input
                type="number"
                min={0.5}
                max={3.5}
                step={0.25}
                value={defaultSpeed}
                onChange={(e) => setDefaultSpeed(Number(e.target.value))}
                onBlur={() => {
                  const c = clampDefaultSpeed(defaultSpeed);
                  setDefaultSpeed(c);
                  void invoke(IPC_CHANNELS.settings.SAVE_DEFAULT_SPEED, c);
                }}
                style={selectStyle}
              />
            </label>

            <label style={{ fontSize: 14, color: "#ddd", display: "flex", flexDirection: "column", gap: 6 }}>
              Sleep timer default
              <select
                value={sleepDefault}
                onChange={(e) => {
                  const v = e.target.value;
                  setSleepDefault(v);
                  void invoke(IPC_CHANNELS.settings.SAVE_SLEEP_TIMER_DEFAULT, v);
                }}
                style={selectStyle}
              >
                {SLEEP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section id="section-library" style={{ marginBottom: 32 }}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: "#f4f4f4" }}>Library</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
            <div
              style={{
                padding: 14,
                borderRadius: 10,
                border: "1px solid #2a2a2a",
                background: "#141414",
              }}
            >
              <div style={{ fontSize: 13, color: "#888", marginBottom: 8 }}>Watch folder</div>
              <div style={{ fontSize: 13, color: "#ccc", wordBreak: "break-all", marginBottom: 12 }}>
                {watchPath === undefined ? "Loading…" : watchPath ?? "None"}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={libBusy}
                  onClick={() => {
                    setLibBusy(true);
                    void setWatchFolder()
                      .then((p) => setWatchPath(p))
                      .finally(() => setLibBusy(false));
                  }}
                  style={pillBtn(false)}
                >
                  Change…
                </button>
                <button
                  type="button"
                  disabled={libBusy || !watchPath}
                  onClick={() => {
                    setLibBusy(true);
                    void clearWatchFolder()
                      .then(() => setWatchPath(null))
                      .finally(() => setLibBusy(false));
                  }}
                  style={pillBtn(true)}
                >
                  Clear
                </button>
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#ddd" }}>
              <input
                type="checkbox"
                checked={autoFetchCovers}
                onChange={(e) => {
                  const v = e.target.checked;
                  setAutoFetchCovers(v);
                  void invoke(IPC_CHANNELS.settings.SAVE_AUTO_FETCH_COVERS, v);
                }}
              />
              Automatically fetch missing cover art when adding books
            </label>

            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: "#161616",
                border: "1px solid #262626",
                fontSize: 13,
                color: "#999",
                lineHeight: 1.5,
              }}
            >
              Downloads are organized into your Library folder automatically. This behavior is built in and cannot be
              disabled.
            </div>
          </div>
        </section>

        <section id="section-shortcuts" style={{ marginBottom: 32 }}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: "#f4f4f4" }}>Shortcuts</h2>
          <ShortcutConfigurator />
        </section>

        <section id="section-about" style={{ marginBottom: 48 }}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: "#f4f4f4" }}>About</h2>
          <div style={{ fontSize: 14, color: "#ccc", lineHeight: 1.6 }}>
            <p style={{ marginTop: 0 }}>
              <strong style={{ color: "#fff" }}>Spire</strong>
            </p>
            <p>
              Version {appInfo?.version ?? "…"} ({appInfo?.platform ?? "…"})
            </p>
            <p>License: MIT</p>
            <p>
              <a href="https://github.com/TitaniumKnight1/Spire" style={{ color: "#7eb8ff" }}>
                GitHub
              </a>
            </p>
            <p>
              <a href="https://ko-fi.com" style={{ color: "#7eb8ff" }}>
                Ko-fi (link coming soon)
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

const selectStyle: CSSProperties = {
  maxWidth: 280,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "#1a1a1a",
  color: "#eee",
};

function pillBtn(danger: boolean): CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 8,
    border: danger ? "1px solid #522" : "1px solid #333",
    background: danger ? "#301818" : "#1e1e1e",
    color: danger ? "#e88" : "#e8e8e8",
    cursor: "pointer",
    fontSize: 13,
  };
}
