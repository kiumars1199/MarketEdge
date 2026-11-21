// Data source fallback order (docs/14 §4): supabase → GitHub `live` → last good copy in memory.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStore, loadRaw, sourceChain } from "@/lib/data/store";

const fixture = (file: string) => {
  try { return readFileSync(path.join("test/fixtures", file), "utf8"); } catch { return undefined; }
};

/** #46: a fallback is used only while its scan is recent; these tests run "now" 10 minutes after the fixture scan. */
const NOW = (JSON.parse(fixture("markets.json")!) as { meta: { scanned_at: number } }).meta.scanned_at + 600;

/** fetch stub: each host answers with `ok` (serve fixtures) or a status code. */
function stubFetch(hosts: { supabase: "ok" | number; github: "ok" | number }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    const which = url.includes("supabase.co") ? "supabase" : "github";
    const mode = hosts[which];
    if (which === "supabase") expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer svc-key");
    if (mode !== "ok") return new Response("down", { status: mode });
    const body = fixture(url.split("/").pop()!.split("?")[0]!);
    return body === undefined ? new Response("", { status: which === "supabase" ? 400 : 404 }) : new Response(body);
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("data source chain", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});

  it("orders sources: supabase → github; others stand alone", () => {
    expect(sourceChain("supabase")).toEqual(["supabase", "github"]);
    expect(sourceChain("github")).toEqual(["github"]);
    expect(sourceChain("local")).toEqual(["local"]);
  });

  it("reads every file from the private bucket with the service key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co/");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
    const calls = stubFetch({ supabase: "ok", github: "ok" });
    const raw = await loadRaw(sourceChain("supabase"));
    expect(raw.source).toBe("supabase");
    expect(raw.markets.markets).toHaveLength(501);
    expect(calls.every((u) => u.startsWith("https://abc.supabase.co/storage/v1/object/authenticated/scan/"))).toBe(true);
    expect(raw.events).toBeUndefined(); // optional file missing (400) is fine
  });

  it("falls back to the GitHub live branch when Supabase fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
    vi.stubEnv("VERCEL_GIT_REPO_OWNER", "owner");   // no GITHUB_DATA_REPO: the repo Vercel deployed from
    vi.stubEnv("VERCEL_GIT_REPO_SLUG", "repo");
    const calls = stubFetch({ supabase: 503, github: "ok" });
    const raw = await loadRaw(sourceChain("supabase"), NOW);
    expect(raw.source).toBe("github");
    expect(calls.some((u) => u.startsWith("https://api.github.com/repos/owner/repo/contents/markets.json?ref=live"))).toBe(true);
  });

  it("falls back to GitHub when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    stubFetch({ supabase: "ok", github: "ok" });
    expect((await loadRaw(sourceChain("supabase"), NOW)).source).toBe("github");
  });

  it("throws when every source fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
    stubFetch({ supabase: 500, github: 502 });
    await expect(loadRaw(sourceChain("supabase"))).rejects.toThrow(/no data source answered/);
  });

  it("serves the expired copy at once and reloads in the background (stale-while-revalidate)", async () => {
    const old = await getStore();
    const expired = Date.now() - 150_000;   // past the 120 s TTL, inside SWR_MAX_MS (QA-A #46: older copies wait)
    old.loadedAt = expired;
    expect(await getStore()).toBe(old);   // no request waits for the reload
    // same scan reloaded: the parsed copy is kept and marked current again
    await vi.waitFor(() => expect(old.loadedAt).toBeGreaterThan(expired));
  });

  it("keeps serving the last good copy when a refresh fails", async () => {
    const good = await getStore();
    good.loadedAt = 0; // expired
    vi.stubEnv("DATA_DIR", "/nonexistent-kismet-dir");
    expect(await getStore()).toBe(good);
    vi.unstubAllEnvs();
    // the retry back-off still serves the old copy without reloading
    expect(await getStore()).toBe(good);
  });
});
