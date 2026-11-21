import { demoFlag } from "@/lib/config";
import { LocalRepo } from "./local";
import type { Repo } from "./types";

export * from "./types";

/** Browser copy of DEMO_MODE: next.config always sets NEXT_PUBLIC_DEMO_MODE from the server flag (lib/config.ts). */
export const DEMO_MODE = demoFlag(process.env.NEXT_PUBLIC_DEMO_MODE);

// getRepo() returns one stable object; the backing store can switch (LocalRepo → SupabaseRepo after
// sign-in) without hooks re-subscribing: subscribers here are told when the store switches.
let impl: Repo | null = null;
let local: LocalRepo | null = null;
let wired: Repo | null = null;
let off = () => {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
function current(): Repo {
  const r = (impl ??= (local ??= new LocalRepo()));
  if (wired !== r) { off(); off = r.subscribe(emit); wired = r; }
  return r;
}

const proxy = new Proxy({} as Repo, {
  get(_, key) {
    if (key === "subscribe") {
      return (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
    }
    const r = current();
    const v = (r as unknown as Record<PropertyKey, unknown>)[key];
    return typeof v === "function" ? v.bind(r) : v;
  },
});

export function getRepo(): Repo {
  return proxy;
}

/** The browser's local data (demo mode and signed-out visitors); used for the first sign-in import. */
export const getLocalRepo = (): LocalRepo => (local ??= new LocalRepo());

let markReady = () => {};
let ready = false;
/** #22: has AuthBoot picked the store yet (so the profile is the account's, not the default)? Demo mode: always. */
export const isRepoReady = () => DEMO_MODE || ready;
/** Resolves once AuthBoot has picked the store (account or guest). Never resolves in demo mode: race it with a timeout. */
export const repoReady = new Promise<void>((r) => { markReady = r; });

/** Switch the backing store (AuthBoot does this after /api/me). */
export function setRepo(next: Repo) {
  impl = next;
  ready = true;
  current();
  emit();
  markReady();
}
