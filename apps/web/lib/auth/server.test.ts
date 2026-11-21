import { describe, expect, it } from "vitest";
import { accountsOffNote, safeNext, sameOrigin } from "./server";

describe("safeNext (open redirects, docs/15)", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNext("/flags?topics=sports.nfl")).toBe("/flags?topics=sports.nfl");
    expect(safeNext("/account")).toBe("/account");
  });
  it("rejects anything that could leave the site", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "evil.com", "javascript:alert(1)", "/x\r\nSet-Cookie: a=b", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});

describe("sameOrigin (CSRF)", () => {
  const req = (origin?: string) => new Request("http://localhost:3130/api/x", { method: "POST", headers: origin ? { origin } : {} });
  it("accepts our origin only", () => {
    expect(sameOrigin(req("http://localhost:3130"))).toBe(true);
    expect(sameOrigin(req("https://evil.com"))).toBe(false);
    expect(sameOrigin(req())).toBe(false);
  });
});

describe("accountsOffNote (audit fail 1)", () => {
  it("says everything is unlocked only in demo mode", () => {
    expect(accountsOffNote(true)).toMatch(/Everything is unlocked/);
    expect(accountsOffNote(false)).not.toMatch(/unlocked/i);
    expect(accountsOffNote(false)).toMatch(/Free plan/);
  });
});
