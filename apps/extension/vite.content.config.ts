import { resolve } from "node:path";
import { defineConfig } from "vite";
import { OUT_DIR, define } from "./vite.config";

export default defineConfig({
  define,
  build: {
    outDir: OUT_DIR,
    emptyOutDir: false,
    lib: { entry: resolve(import.meta.dirname, "src/content.ts"), formats: ["iife"], name: "Kismet", fileName: () => "content.js" },
  },
});
