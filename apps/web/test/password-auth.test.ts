// T-275: email + password sign-in, sign-up and reset. Validation, per-address rate limits, no account enumeration,
// the "Confirm email" fail-closed check, and the reset marker the set-password route requires.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type Sb = { error: { status?: number; code?: string; message: string } | null; data?: unknown };
const h = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  accounts: new Map<string, string>(),   // email → password
  autoConfirm: false,
  deleted: [] as string[],
  updated: [] as string[],
  resets: [] as string[],
  jar: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (h.jar.has(n) ? { name: n, value: h.jar.get(n)! } : undefined),
    set: (n: string, v: string) => void h.jar.set(n, v),
    delete: (n: string) => void h.jar.delete(n),
    getAll: () => [...h.jar].map(([name, value]) => ({ name, value })),
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/auth/server", () => ({
  COOKIE_OPTIONS: {},
  authEnabled: () => true,
  sameOrigin: () => true,
  safeNext: (n?: string) => n ?? "/",
  getUser: async () => h.user,
  getMe: async () => ({ user: h.user, tier: "free" }),
  supabaseAdmin: () => ({ auth: { admin: { deleteUser: async (id: string) => { h.deleted.push(id); return { error: null }; } } } }),
  supabaseServer: async () => ({
    auth: {
      signUp: async ({ email }: { email: string }): Promise<Sb> => {
        const user = { id: `new-${email}`, email };
        return h.autoConfirm ? { data: { user, session: { access_token: "x" } }, error: null } : { data: { user, session: null }, error: null };
      },
      signInWithPassword: async ({ email, password }: { email: string; password: string }): Promise<Sb> =>
        h.accounts.get(email) === password
          ? { data: { user: { id: `id-${email}`, email }, session: {} }, error: null }
          : { data: { user: null, session: null }, error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" } },
      resetPasswordForEmail: async (email: string): Promise<Sb> => {
        if (!h.accounts.has(email)) return { error: { status: 404, message: "User not found" } };
        h.resets.push(email);
        return { error: null };
      },
      updateUser: async ({ password }: { password: string }): Promise<Sb> => { h.updated.push(password); return { data: {}, error: null }; },
      signOut: async () => ({ error: null }),
    },
  }),
}));
vi.mock("botid/server", () => ({ checkBotId: async () => ({ isBot: false }) }));
vi.mock("@/lib/auth/terms", () => ({ rememberTerms: async () => {}, takeTerms: async () => null }));
vi.mock("@/lib/auth/finish", () => ({ finishSignIn: async (_s: unknown, _u: unknown, next: string) => next }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ signups_open: true }) }));

vi.stubEnv("VERCEL", "1");   // per-IP keys from x-real-ip, so per-address limits are what's tested
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const abuse = await import("@/lib/abuse");
const pw = await import("@/lib/auth/password");
const { POST: password } = await import("@/app/api/auth/password/route");
const { POST: reset } = await import("@/app/api/auth/reset/route");
const { POST: update } = await import("@/app/api/auth/password/update/route");

let ip = 0;
const post = (path: string, body: unknown) => new Request(`http://t${path}`, {
  method: "POST", body: JSON.stringify(body),
  headers: { "content-type": "application/json", origin: "http://t", "x-real-ip": `10.0.${Math.floor(++ip / 250)}.${ip % 250}` },
});
const signin = (email: string, p: string) => password(post("/api/auth/password", { action: "signin", email, password: p, accept: true }));
const signup = (email: string, p = "correct horse") => password(post("/api/auth/password", { action: "signup", email, password: p, accept: true }));

beforeEach(() => {
  abuse.setLimiter(abuse.memoryLimiter());
  h.user = null; h.autoConfirm = false; h.deleted = []; h.updated = []; h.resets = []; h.jar.clear();
  h.accounts = new Map([["known@x.test", "correct horse"]]);
});
afterAll(() => { abuse.setLimiter(undefined); vi.unstubAllEnvs(); });

describe("password length (8–72)", () => {
  it("rejects 7 and 73 characters on sign-up and sign-in, accepts 8 and 72", async () => {
    for (const p of ["a".repeat(7), "a".repeat(73)]) {
      expect((await signup(`len-${p.length}@x.test`, p)).status).toBe(400);
      expect((await signin("known@x.test", p)).status).toBe(400);
    }
    expect((await signup("eight@x.test", "a".repeat(8))).status).toBe(200);
    expect((await signup("seventytwo@x.test", "a".repeat(72))).status).toBe(200);
    expect(pw.Password.safeParse("a".repeat(7)).success).toBe(false);
    expect(pw.Password.safeParse("a".repeat(73)).success).toBe(false);
  });
  it("the set-password route applies the same rule", async () => {
    h.user = { id: "u1", email: "known@x.test" };
    await pw.markResetProof("u1");
    expect((await update(post("/api/auth/password/update", { password: "a".repeat(7) }))).status).toBe(400);
    expect((await update(post("/api/auth/password/update", { password: "a".repeat(73) }))).status).toBe(400);
    expect(h.updated).toEqual([]);
  });
});

describe("rate limits", () => {
  it("sign-in: 5 tries per address per 15 min (auth_password), whatever the IP", async () => {
    for (let i = 0; i < 5; i++) expect((await signin("known@x.test", `wrong-pass-${i}`)).status).toBe(401);
    const res = await signin("KNOWN@x.test", "correct horse");   // right password, same address (any case): still waits
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await signin("other@x.test", "whatever-123")).status).toBe(401);   // another address is unaffected
  });
  it("sign-up and reset emails share the per-address email budget (auth_email)", async () => {
    for (let i = 0; i < 3; i++) expect((await signup("budget@x.test")).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await reset(post("/api/auth/reset", { email: "budget@x.test" }))).status).toBe(200);
    expect((await signup("budget@x.test")).status).toBe(429);
    expect((await reset(post("/api/auth/reset", { email: "Budget@x.test" }))).status).toBe(429);
  });
  it("password guesses don't use up the email budget", async () => {
    for (let i = 0; i < 5; i++) await signin("known@x.test", `wrong-pass-${i}`);
    expect((await reset(post("/api/auth/reset", { email: "known@x.test" }))).status).toBe(200);
  });
});

describe("no account enumeration", () => {
  it("reset: the same answer for a known and an unknown address", async () => {
    const a = await reset(post("/api/auth/reset", { email: "known@x.test" }));
    const b = await reset(post("/api/auth/reset", { email: "nobody@x.test" }));
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
    expect(h.resets).toEqual(["known@x.test"]);   // only the real account got an email
  });
  it("sign-up: the same answer for a known and an unknown address", async () => {
    const a = await signup("known@x.test");
    const b = await signup("fresh@x.test");
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
  });
  it("sign-in: wrong password and unknown address read the same", async () => {
    const a = await signin("known@x.test", "not the password");
    const b = await signin("nobody@x.test", "not the password");
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(await a.json()).toEqual({ error: "Wrong email or password." });
    expect(await b.json()).toEqual({ error: "Wrong email or password." });
  });
  it("sign-in with the right password returns where to go", async () => {
    const res = await password(post("/api/auth/password", { action: "signin", email: "known@x.test", password: "correct horse", next: "/markets" }));
    expect(await res.json()).toEqual({ ok: true, to: "/markets" });
  });
});

describe("sign-up needs Supabase 'Confirm email'", () => {
  it("a sign-up that comes back with a session is undone: user deleted, 503", async () => {
    h.autoConfirm = true;
    const res = await signup("claim@x.test");
    expect(res.status).toBe(503);
    expect(h.deleted).toEqual(["new-claim@x.test"]);
  });
  it("the 18+/Terms box is required", async () => {
    const res = await password(post("/api/auth/password", { action: "signup", email: "a@x.test", password: "correct horse" }));
    expect(res.status).toBe(400);
  });
});

describe("set a new password needs the reset marker", () => {
  const set = () => update(post("/api/auth/password/update", { password: "new password 1" }));
  beforeEach(() => { h.user = { id: "u1", email: "known@x.test" }; });

  it("signed in without a reset link: 401", async () => {
    expect((await set()).status).toBe(401);
    expect(h.updated).toEqual([]);
  });
  it("signed out: 401 even with a marker", async () => {
    await pw.markResetProof("u1");
    h.user = null;
    expect((await set()).status).toBe(401);
  });
  it("a hand-made or tampered marker: 401", async () => {
    h.jar.set(pw.RESET_COOKIE, String(Date.now()));   // the old unsigned format
    expect((await set()).status).toBe(401);
    await pw.markResetProof("u1");
    const [uid, , mac] = h.jar.get(pw.RESET_COOKIE)!.split(".");
    h.jar.set(pw.RESET_COOKIE, `${uid}.${Date.now() + 1000}.${mac}`);   // pushed the time forward
    expect((await set()).status).toBe(401);
  });
  it("another account's marker: 401", async () => {
    await pw.markResetProof("u2");
    expect((await set()).status).toBe(401);
  });
  it("an expired marker (over 15 min): 401", async () => {
    await pw.markResetProof("u1", Date.now() - 16 * 60_000);
    expect((await set()).status).toBe(401);
  });
  it("a fresh marker for this account: saved, then the marker is used up", async () => {
    await pw.markResetProof("u1");
    expect((await set()).status).toBe(200);
    expect(h.updated).toEqual(["new password 1"]);
    expect((await set()).status).toBe(401);
  });
});
