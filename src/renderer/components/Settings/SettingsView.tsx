import { type ReactElement, useCallback, useEffect, useState } from "react";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { EqPreset } from "@shared/library-types";
import { useIPC } from "../../hooks/useIPC.js";
import { useLibrary } from "../../hooks/useLibrary.js";
import { ShortcutConfigurator } from "./ShortcutConfigurator.js";
import { StatsPanel } from "./StatsPanel.js";

const SIDEBAR_W = 180;

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
  const [torrentProxyHost, setTorrentProxyHost] = useState("");
  const [torrentProxyPort, setTorrentProxyPort] = useState("");
  const [watchPath, setWatchPath] = useState<string | null | undefined>(undefined);
  const [appInfo, setAppInfo] = useState<{ version: string; platform: string } | null>(null);
  const [libBusy, setLibBusy] = useState(false);
  const [activeSection, setActiveSection] = useState("section-stats");

  const loadAll = useCallback(async () => {
    const [ss, eq, spd, sleep, covers, proxy, wf, info] = await Promise.all([
      invoke<boolean>(IPC_CHANNELS.settings.GET_SKIP_SILENCE),
      invoke<EqPreset>(IPC_CHANNELS.settings.GET_EQ_PRESET),
      invoke<number>(IPC_CHANNELS.settings.GET_DEFAULT_SPEED),
      invoke<string>(IPC_CHANNELS.settings.GET_SLEEP_TIMER_DEFAULT),
      invoke<boolean>(IPC_CHANNELS.settings.GET_AUTO_FETCH_COVERS),
      invoke<{ host: string; port: number } | null>(IPC_CHANNELS.settings.SETTINGS_GET_TORRENT_PROXY),
      getWatchFolder(),
      invoke<{ version: string; platform: string }>(IPC_CHANNELS.settings.GET_APP_INFO),
    ]);
    setSkipSilence(ss);
    setEqPreset(eq);
    setDefaultSpeed(spd);
    setSleepDefault(sleep);
    setAutoFetchCovers(covers);
    if (proxy) {
      setTorrentProxyHost(proxy.host);
      setTorrentProxyPort(String(proxy.port));
    } else {
      setTorrentProxyHost("");
      setTorrentProxyPort("");
    }
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
      onClick={() => {
        setActiveSection(id);
        scrollToId(id);
      }}
      style={{
        textAlign: "left",
        padding: "7px 16px",
        borderRadius: "var(--radius-md)",
        border: "1px solid transparent",
        background: activeSection === id ? "var(--accent-soft)" : "transparent",
        color: activeSection === id ? "var(--accent)" : "var(--text-secondary)",
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", gap: 0, minHeight: "70vh", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <nav
        style={{
          width: SIDEBAR_W,
          flexShrink: 0,
          background: "var(--bg-sidebar)",
          borderRight: "1px solid var(--border-subtle)",
          padding: "12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div className="section-label">Settings</div>
        {navBtn("section-stats", "Stats")}
        {navBtn("section-playback", "Playback")}
        {navBtn("section-library", "Library")}
        {navBtn("section-shortcuts", "Shortcuts")}
        {navBtn("section-about", "About")}
      </nav>
      <div style={{ flex: 1, minWidth: 0, padding: "36px 40px", maxWidth: 700, overflowY: "auto", background: "var(--bg-base)" }}>
        <h1 className="page-title" style={{ marginBottom: 24 }}>
          Preferences
        </h1>

        <section id="section-stats" style={{ marginBottom: 32 }}>
          <h2 style={sectionHeader}>Stats</h2>
          <StatsPanel />
        </section>

        <section id="section-playback" style={{ marginBottom: 32 }}>
          <h2 style={sectionHeader}>Playback</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}>
            <label className="checkbox-control">
              <input
                type="checkbox"
                checked={skipSilence === true}
                disabled={skipSilence == null}
                onChange={(e) => {
                  const v = e.target.checked;
                  setSkipSilence(v);
                  void invoke(IPC_CHANNELS.settings.SAVE_SKIP_SILENCE, v);
                }}
                className="checkbox-input"
              />
              <span className="checkbox-box" />
              Skip silence
            </label>

            <label style={{ fontSize: 14, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 6 }}>
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
                className="select-base"
                style={{ maxWidth: 280 }}
              >
                {EQ_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 14, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 6 }}>
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
                className="input-base"
                style={{ maxWidth: 280 }}
              />
            </label>

            <label style={{ fontSize: 14, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 6 }}>
              Sleep timer default
              <select
                value={sleepDefault}
                onChange={(e) => {
                  const v = e.target.value;
                  setSleepDefault(v);
                  void invoke(IPC_CHANNELS.settings.SAVE_SLEEP_TIMER_DEFAULT, v);
                }}
                className="select-base"
                style={{ maxWidth: 280 }}
              >
                {SLEEP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="section-label">Torrent Proxy</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
                SOCKS5 Proxy (for VPN/firewall bypass)
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                Use with a VPN&apos;s SOCKS5 proxy to bypass ISP port blocking.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <label style={{ fontSize: 14, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 6, flex: "1 1 140px" }}>
                  Host
                  <input
                    type="text"
                    placeholder="127.0.0.1"
                    value={torrentProxyHost}
                    onChange={(e) => setTorrentProxyHost(e.target.value)}
                    className="input-base"
                    autoComplete="off"
                  />
                </label>
                <label style={{ fontSize: 14, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 6, width: 120 }}>
                  Port
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="1080"
                    value={torrentProxyPort}
                    onChange={(e) => setTorrentProxyPort(e.target.value)}
                    className="input-base"
                    autoComplete="off"
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    const port = Number(torrentProxyPort);
                    const res = await invoke<{ ok: boolean }>(IPC_CHANNELS.settings.SETTINGS_SAVE_TORRENT_PROXY, {
                      host: torrentProxyHost.trim(),
                      port,
                    });
                    if (!res.ok) {
                      const cur = await invoke<{ host: string; port: number } | null>(
                        IPC_CHANNELS.settings.SETTINGS_GET_TORRENT_PROXY,
                      );
                      if (cur) {
                        setTorrentProxyHost(cur.host);
                        setTorrentProxyPort(String(cur.port));
                      }
                    }
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={async () => {
                    await invoke(IPC_CHANNELS.settings.SETTINGS_SAVE_TORRENT_PROXY, null);
                    setTorrentProxyHost("");
                    setTorrentProxyPort("");
                  }}
                >
                  Clear
                </button>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                Restart Spire after changing proxy settings.
              </p>
            </div>
          </div>
        </section>

        <section id="section-library" style={{ marginBottom: 32 }}>
          <h2 style={sectionHeader}>Library</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
            <div className="card-panel">
              <div className="section-label">Watch folder</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", wordBreak: "break-all", marginBottom: 12 }}>
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
                  className="btn-secondary"
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
                  className="btn-danger"
                >
                  Clear
                </button>
              </div>
            </div>

            <label className="checkbox-control" style={{ fontSize: 14 }}>
              <input
                type="checkbox"
                checked={autoFetchCovers}
                onChange={(e) => {
                  const v = e.target.checked;
                  setAutoFetchCovers(v);
                  void invoke(IPC_CHANNELS.settings.SAVE_AUTO_FETCH_COVERS, v);
                }}
                className="checkbox-input"
              />
              <span className="checkbox-box" />
              Automatically fetch missing cover art when adding books
            </label>

            <div
              style={{
                padding: 12,
                borderRadius: "var(--radius-md)",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                fontSize: 13,
                color: "var(--text-muted)",
                lineHeight: 1.5,
              }}
            >
              Downloads are organized into your Library folder automatically. This behavior is built in and cannot be
              disabled.
            </div>
          </div>
        </section>

        <section id="section-shortcuts" style={{ marginBottom: 32 }}>
          <h2 style={sectionHeader}>Shortcuts</h2>
          <ShortcutConfigurator />
        </section>

        <section id="section-about" style={{ marginBottom: 48 }}>
          <h2 style={sectionHeader}>About</h2>
          <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            <p style={{ marginTop: 0 }}>
              <strong style={{ color: "var(--text-primary)" }}>Spire</strong>
            </p>
            <p>
              Version {appInfo?.version ?? "…"} ({appInfo?.platform ?? "…"})
            </p>
            <p>License: MIT</p>
            <p>
              <a href="https://github.com/TitaniumKnight1/Spire" style={{ color: "var(--accent)" }}>
                GitHub
              </a>
            </p>
            <p>
              <a href="https://ko-fi.com" style={{ color: "var(--accent)" }}>
                Ko-fi (link coming soon)
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

const sectionHeader = {
  marginTop: 0,
  marginBottom: 20,
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  borderBottom: "1px solid var(--border-subtle)",
  paddingBottom: 12,
};
