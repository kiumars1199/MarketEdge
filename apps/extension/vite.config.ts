// Main build: popup + side panel pages and the service worker. Content script is a separate IIFE build
// (vite.content.config.ts) because MV3 content scripts cannot be ES modules.
// KISMET_ORIGIN = the web app origin (default http://localhost:3000); OUT_DIR = build folder (default dist).
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { manifest } from "./manifest.config";
import pkg from "./package.json" with { type: "json" };

export const ORIGIN = (process.env.KISMET_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
export const OUT_DIR = process.env.OUT_DIR || "dist";
export const define = { __KISMET_ORIGIN__: JSON.stringify(ORIGIN) };

export default defineConfig({
  base: "./",
  define,
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "popup.html"),
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        background: resolve(import.meta.dirname, "src/background.ts"),
      },
      output: { entryFileNames: "[name].js", chunkFileNames: "[name].js", assetFileNames: "[name].[ext]" },
    },
  },
  plugins: [
    {
      name: "manifest",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "manifest.json", source: JSON.stringify(manifest(ORIGIN, pkg.version, process.env.STORE === "1"), null, 2) });
      },
    },
  ],
  test: { include: ["test/**/*.test.ts"] },
});
