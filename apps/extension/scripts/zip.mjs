// pnpm ext:zip → builds a store copy (no dev `key`) into dist-store/ and zips it to kismet-extension-<version>.zip.
// Set KISMET_ORIGIN to the production web origin first, e.g. KISMET_ORIGIN=https://kismetodds.example pnpm ext:zip
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const env = { ...process.env, STORE: "1", OUT_DIR: "dist-store" };
const origin = env.KISMET_ORIGIN || "http://localhost:3000";
if (origin.includes("localhost")) console.warn(`[ext:zip] KISMET_ORIGIN is ${origin}: fine for loading unpacked, not for the store.`);
const run = (args) => execFileSync("pnpm", args, { stdio: "inherit", env });
run(["exec", "vite", "build"]);
run(["exec", "vite", "build", "-c", "vite.content.config.ts"]);
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const out = `kismet-extension-${version}.zip`;
rmSync(out, { force: true });
execFileSync("zip", ["-qr", `../${out}`, "."], { cwd: "dist-store", stdio: "inherit" });
console.log(`[ext:zip] wrote apps/extension/${out}`);
