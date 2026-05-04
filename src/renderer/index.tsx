/// <reference types="vite/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { MiniPlayer } from "./components/Player/MiniPlayer.js";
import { PlayerProvider } from "./hooks/usePlayer.js";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element #root not found");
}

const isMiniPlayer =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("miniPlayer") === "true";

if (isMiniPlayer) {
  createRoot(container).render(
    <StrictMode>
      <MiniPlayer />
    </StrictMode>,
  );
} else {
  createRoot(container).render(
    <StrictMode>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </StrictMode>,
  );
}
