// T-277: the bucket holds gzip objects (new ops/upload.py) and plain ones (before the rollout) under the same
// names; the loader sniffs the gzip magic bytes (1f 8b) and reads both.
import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBody, loadRaw, readSource, sourceChain } from "@/lib/data/store";

const fixture = (file: string) => {
  try { return readFileSync(path.join("test/fixtures", file)); } catch { return undefined; }
};

/** Supabase answers each file gzipped, plain or corrupt per `mode`; GitHub always plain. */
function stubFetch(mode: (file: string) => "gzip" | "plain" | "corrupt") {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    const file = url.split("/").pop()!.split("?")[0]!;
    const body = fixture(file);
    if (body === undefined) return new Response("", { status: url.includes("supabase.co") ? 400 : 404 });
    if (!url.includes("supabase.co")) return new Response(body);
    const m = mode(file);
    const out = m === "gzip" ? gzipSync(body) : m === "corrupt" ? gzipSync(body).subarray(0, 40) : body;
    return new Response(out, { headers: { "Content-Type": m === "plain" ? "application/json" : "application/gzip" } });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const supabaseEnv = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
  vi.stubEnv("GITHUB_DATA_REPO", "owner/repo");
};

describe("gzip or plain storage objects", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});

  it("decodeBody: gzip by magic bytes, plain text as is, BOM dropped", async () => {
    const json = '{"a":"é"}';
    expect(await decodeBody(gzipSync(json))).toBe(json);
    expect(await decodeBody(Buffer.from(json))).toBe(json);
    expect(await decodeBody(Buffer.from("﻿" + json))).toBe(json);
    expect(await decodeBody(new Uint8Array(0))).toBe("");
  });

  it("loads a fully gzipped bucket", async () => {
    supabaseEnv();
    stubFetch(() => "gzip");
    const raw = await loadRaw(sourceChain("supabase"));
    expect(raw.source).toBe("supabase");
    expect(raw.markets.markets).toHaveLength(501);
    expect(raw.flags.flags.length).toBeGreaterThan(0);
  });

  it("loads a plain bucket (before the rollout)", async () => {
    supabaseEnv();
    stubFetch(() => "plain");
    const raw = await loadRaw(sourceChain("supabase"));
    expect(raw.source).toBe("supabase");
    expect(raw.markets.markets).toHaveLength(501);
  });

  it("loads a mixed bucket (markets gzipped, flags plain) as one scan from Supabase", async () => {
    supabaseEnv();
    stubFetch((f) => (f === "markets.json" ? "gzip" : "plain"));
    const raw = await loadRaw(sourceChain("supabase"));
    expect(raw.source).toBe("supabase");
    expect(raw.markets.markets).toHaveLength(501);
    expect(raw.flags.meta.scanned_at).toBe(raw.markets.meta.scanned_at);
  });

  it("readSource (ledger.jsonl, kalshi.json, *-prev.json) reads gzip too", async () => {
    supabaseEnv();
    stubFetch(() => "gzip");
    expect(JSON.parse((await readSource("kalshi.json", sourceChain("supabase")))!)).toEqual(JSON.parse(fixture("kalshi.json")!.toString()));
  });

  it("a corrupt gzip object falls through to the GitHub live branch (while its scan is recent, #46)", async () => {
    supabaseEnv();
    const calls = stubFetch(() => "corrupt");
    const at = (JSON.parse(fixture("markets.json")!.toString()) as { meta: { scanned_at: number } }).meta.scanned_at;
    const raw = await loadRaw(sourceChain("supabase"), at + 600);
    expect(raw.source).toBe("github");
    expect(raw.markets.markets).toHaveLength(501);
    expect(calls.some((u) => u.startsWith("https://api.github.com/repos/owner/repo/contents/markets.json"))).toBe(true);
  });
});
