import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": import.meta.dirname, "server-only": `${import.meta.dirname}/test/server-only.ts` } },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    env: { DATA_DIR: "test/fixtures", DATA_SOURCE: "local", DATA_CLOCK: "scan" },
  },
});
