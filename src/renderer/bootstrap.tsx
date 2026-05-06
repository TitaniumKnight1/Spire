/// <reference types="vite/client" />
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { MiniPlayer } from "./components/Player/MiniPlayer.js";
import { PlayerProvider } from "./hooks/usePlayer.js";
import "./styles/globals.css";

export function mount(): void {
  const container = document.getElementById("root");

  if (!container) {
    throw new Error("Root element #root not found");
  }

  const isMiniPlayer =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("miniPlayer") === "true";

  if (isMiniPlayer) {
    createRoot(container).render(<MiniPlayer />);
  } else {
    createRoot(container).render(
      <PlayerProvider>
        <App />
      </PlayerProvider>,
    );
  }
}
