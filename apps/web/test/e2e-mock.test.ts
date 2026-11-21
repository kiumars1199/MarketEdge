import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/e2e-mock/[...path]/route";

const call = () => GET(new Request("http://test/e2e-mock/supabase/_inbox?email=a@b.c"), { params: Promise.resolve({ path: ["supabase", "_inbox"] }) });

describe("e2e mock gate (security)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is a 404 unless E2E_MOCK=1", async () => {
    vi.stubEnv("E2E_MOCK", "");
    expect((await call()).status).toBe(404);
  });
  it("is a 404 in production even with E2E_MOCK=1", async () => {
    vi.stubEnv("E2E_MOCK", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect((await call()).status).toBe(404);
  });
  it("answers in dev/e2e with E2E_MOCK=1", async () => {
    vi.stubEnv("E2E_MOCK", "1");
    expect((await call()).status).toBe(200);
  });
});

// Audit run 4 fail 2: HEAD + count=exact (plan-quota fast path) used to fall into the insert branch and 500.
describe("e2e mock PostgREST count", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("answers HEAD with the row count, and an empty insert with 400", async () => {
    vi.stubEnv("E2E_MOCK", "1");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc");
    const { HEAD, POST } = await import("@/app/e2e-mock/[...path]/route");
    const ctx = { params: Promise.resolve({ path: ["supabase", "rest", "v1", "quota_probe"] }) };
    const url = "http://test/e2e-mock/supabase/rest/v1/quota_probe";
    const auth = { authorization: "Bearer svc" };
    for (const id of ["a", "b"]) await POST(new Request(url, { method: "POST", headers: auth, body: JSON.stringify({ id }) }), ctx);
    const head = await HEAD(new Request(`${url}?select=id`, { method: "HEAD", headers: { ...auth, prefer: "count=exact" } }), ctx);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-range")).toBe("*/2");
    expect((await POST(new Request(url, { method: "POST", headers: auth }), ctx)).status).toBe(400);
  });
});
