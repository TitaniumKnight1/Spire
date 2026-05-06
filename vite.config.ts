import path from "node:path";
import { fileURLToPath } from "node:url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: "spire-b6",
            project: "spire",
            authToken: sentryAuthToken,
          }),
        ]
      : []),
  ],
  root: __dirname,
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    sourcemap: Boolean(sentryAuthToken),
    rollupOptions: {
      input: {
        main: path.resolve(root, "index.html"),
      },
    },
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
