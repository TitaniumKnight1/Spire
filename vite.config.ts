import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src", "shared"),
    },
  },
});
