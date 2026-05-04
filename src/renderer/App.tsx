import { type ReactElement, useState } from "react";
import { LibraryView } from "./components/Library/index.js";
import { useIPC } from "./hooks/useIPC.js";

type NavKey = "library" | "downloads" | "podcasts" | "settings";

const NAV_ITEMS: { key: NavKey; label: string }[] = [
  { key: "library", label: "Library" },
  { key: "downloads", label: "Downloads" },
  { key: "podcasts", label: "Podcasts" },
  { key: "settings", label: "Settings" },
];

export function App(): ReactElement {
  const [active, setActive] = useState<NavKey>("library");
  const ipc = useIPC();

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "#0f0f0f",
        color: "#e8e8e8",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <aside
        style={{
          width: 220,
          borderRight: "1px solid #222",
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 12, letterSpacing: 0.4 }}>Spire</div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setActive(item.key);
              void ipc.pingDomain(item.key);
            }}
            style={{
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid transparent",
              background: active === item.key ? "#1c1c1c" : "transparent",
              color: "#e8e8e8",
              cursor: "pointer",
            }}
          >
            {item.label}
          </button>
        ))}
      </aside>
      <main style={{ flex: 1, padding: 24 }}>
        <Outlet active={active} />
      </main>
    </div>
  );
}

function Outlet({ active }: { active: NavKey }): ReactElement {
  if (active === "library") {
    return <LibraryView />;
  }

  const titles: Record<Exclude<NavKey, "library">, string> = {
    downloads: "Downloads",
    podcasts: "Podcasts",
    settings: "Settings",
  };

  return (
    <div>
      <h1 style={{ marginTop: 0, fontSize: 22 }}>{titles[active]}</h1>
      <p style={{ color: "#9a9a9a", maxWidth: 560 }}>
        Milestone 1 shell — navigation is local state only. Playback, downloads, and library logic arrive in
        later milestones.
      </p>
    </div>
  );
}
