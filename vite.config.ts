import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Bundle splitting. Without this, every npm dep our React tree touches
  // ends up in the single index-*.js chunk and the main bundle balloons past
  // 1 MB even though half of it is "stable across releases" vendor code that
  // could be cached forever. Splitting along these seams gives the WebView2
  // disk cache something to keep across upgrades, and lets the browser parse
  // the smaller main chunk quicker on cold start.
  build: {
    // Headroom over the largest legitimately-large chunk (mermaid.core ~580 kB).
    // We don't want Vite spamming warnings for chunks we know about.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          // React + react-dom + react/jsx-runtime — never split apart in
          // practice, so keep them together. ~150 kB minified.
          react: ["react", "react-dom", "react/jsx-runtime"],
          // Markdown rendering pipeline. Big (~250 kB combined) and rarely
          // changes per release. Loaded the moment a file is open, but at
          // least it isn't blocking the welcome screen anymore.
          markdown: [
            "react-markdown",
            "remark-gfm",
            "rehype-highlight",
          ],
        },
      },
    },
  },
}));
