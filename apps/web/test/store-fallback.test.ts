// #46 (Mark, Nov 20): an instance that fell back to the GitHub `live` branch served a day-old scan beside fresh ones.
// A fallback source is used only while its scan is recent; the first source in the chain is always accepted.
import { describe, expect, it } from "vitest";
import { FALLBACK_MAX_AGE_S, loadRaw } from "@/lib/data/store";

describe("loadRaw fallback age", async () => {
  // fixture data (DATA_SOURCE=local); "supabase" first fails here (no URL/key in tests), so "local" is the fallback
  const fresh = await loadRaw(["local"]);
  const at = fresh.markets.meta.scanned_at;

  it("first source: any age", async () => {
    expect((await loadRaw(["local"], at + 10 * 86400)).markets.meta.scanned_at).toBe(at);
  });
  it("fallback with a recent scan is used", async () => {
    expect((await loadRaw(["supabase", "local"], at + 600)).source).toBe("local");
  });
  it("fallback older than the limit is refused", async () => {
    await expect(loadRaw(["supabase", "local"], at + FALLBACK_MAX_AGE_S + 60)).rejects.toThrow(/no data source answered/);
  });
});
