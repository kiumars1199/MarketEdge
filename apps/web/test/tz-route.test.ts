// T-288: POST /api/tz keeps the browser's zone in an httpOnly cookie. Same origin, a real IANA zone, nothing else.
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/tz/route";
import { TZ_COOKIE } from "@/lib/zone";
import { signedOutAccess } from "@/lib/auth/public-paths";

const post = (body: unknown, origin: string | null = "http://t") =>
  POST(new Request("http://t/api/tz", { method: "POST", body: JSON.stringify(body), headers: origin ? { origin, "content-type": "application/json" } : {} }));

describe("POST /api/tz", () => {
  it("sets an httpOnly, lax, year-long cookie for a real zone", async () => {
    const res = await post({ tz: "Asia/Tokyo" });
    expect(res.status).toBe(204);
    const c = res.headers.get("set-cookie") ?? "";
    expect(c).toMatch(new RegExp(`^${TZ_COOKIE}=Asia%2FTokyo;`));
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toMatch(/Max-Age=31536000/);
  });
  it("refuses other origins, unknown zones and extra keys", async () => {
    expect((await post({ tz: "Asia/Tokyo" }, "https://evil.example")).status).toBe(403);
    expect((await post({ tz: "Asia/Tokyo" }, null)).status).toBe(403);
    for (const b of [{ tz: "Mars/Base" }, { tz: "../x" }, { tz: "Asia/Tokyo", x: 1 }, {}, "Asia/Tokyo"]) {
      const res = await post(b);
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
  it("is reachable signed out (the landing page sends it too)", () => {
    expect(signedOutAccess("/api/tz")).toBe("public");
  });
});
