// Safe to import from client and server code (no Node builtins, no secret env names: those live in server-only files).

// Demo mode (docs/01 § Demo scope): no auth, no billing, tier forced to premium, LocalRepo.
// Fails safe (docs/15): on only with DEMO_MODE=true, or with DEMO_MODE unset outside a production build.
// A production deploy that forgets the variable runs with accounts and the Free tier, never as everyone-premium.
export const demoFlag = (v: string | undefined, nodeEnv = process.env.NODE_ENV): boolean =>
  v === "true" || (!v && nodeEnv !== "production");
export const DEMO_MODE = demoFlag(process.env.DEMO_MODE);

export type DataSource = "local" | "github" | "supabase";
const SOURCES: DataSource[] = ["local", "github", "supabase"];
/** local (dev, default) | github (`live` branch) | supabase (private Storage bucket `scan`, docs/14 §4). */
export const DATA_SOURCE: DataSource = SOURCES.find((s) => s === process.env.DATA_SOURCE) ?? "local";

/** Folder with markets.json etc. for DATA_SOURCE=local; relative paths resolve from cwd (apps/web). */
export const dataDirSetting = () => process.env.DATA_DIR || "../../output";
