/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Standalone test config so Vitest's options/types never leak into the Tauri +
// Vite production build (vite.config.ts). Vitest uses this file in preference to
// vite.config.ts when present. QUALITY-01.
export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"],
        include: ["src/**/*.{test,spec}.{ts,tsx}"],
        css: false,
        clearMocks: true,
        restoreMocks: true,
    },
});
