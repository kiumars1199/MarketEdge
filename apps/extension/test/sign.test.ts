// Kalshi publishes no known-answer vector (checked docs.kalshi.com 2026-11-16), so we verify our
// signatures with the public key, the exact message format, and the RSA-PSS parameters.
import { constants, createPrivateKey, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authHeaders, importPrivateKey, message, pkcs1ToPkcs8, signPath } from "../src/kalshi/sign";

const PATH = "/trade-api/v2/portfolio/balance";

describe("message", () => {
  it("is timestamp + METHOD + path with no separators", () => {
    expect(message("1703123456789", "get", PATH)).toBe("1703123456789GET/trade-api/v2/portfolio/balance");
  });
  it("strips the query string and the host", () => {
    expect(signPath("/trade-api/v2/portfolio/orders?limit=5&status=resting")).toBe("/trade-api/v2/portfolio/orders");
    expect(signPath("https://external-api.demo.kalshi.co/trade-api/v2/portfolio/fills?order_id=x#y")).toBe("/trade-api/v2/portfolio/fills");
  });
});

describe("Ed25519", () => {
  it("imports non-extractable and signs a signature the public key verifies", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const { key, type } = await importPrivateKey(pem);
    expect(type).toBe("ed25519");
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", key)).rejects.toThrow();
    const h = await authHeaders("key-1", key, "GET", `${PATH}?x=1`, 1703123456789);
    expect(h["KALSHI-ACCESS-KEY"]).toBe("key-1");
    expect(h["KALSHI-ACCESS-TIMESTAMP"]).toBe("1703123456789");
    const sig = Buffer.from(h["KALSHI-ACCESS-SIGNATURE"], "base64");
    expect(sig.length).toBe(64);
    expect(verify(null, Buffer.from(`1703123456789GET${PATH}`), publicKey, sig)).toBe(true);
    // the query string was not signed
    expect(verify(null, Buffer.from(`1703123456789GET${PATH}?x=1`), publicKey, sig)).toBe(false);
  });
});

describe("RSA-PSS", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const check = (msg: string, sigB64: string, saltLength: number) =>
    verify("sha256", Buffer.from(msg), { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength }, Buffer.from(sigB64, "base64"));

  it.each([
    ["PKCS#1 (Kalshi's 'RSA PRIVATE KEY')", privateKey.export({ type: "pkcs1", format: "pem" }) as string],
    ["PKCS#8", privateKey.export({ type: "pkcs8", format: "pem" }) as string],
  ])("signs with SHA-256, MGF1 SHA-256, salt = digest length: %s", async (_n, pem) => {
    const { key, type } = await importPrivateKey(pem);
    expect(type).toBe("rsa");
    expect(key.extractable).toBe(false);
    const h = await authHeaders("k", key, "POST", "/trade-api/v2/portfolio/events/orders", 1700000000000);
    const msg = "1700000000000POST/trade-api/v2/portfolio/events/orders";
    expect(check(msg, h["KALSHI-ACCESS-SIGNATURE"], constants.RSA_PSS_SALTLEN_DIGEST)).toBe(true);
    expect(check(msg, h["KALSHI-ACCESS-SIGNATURE"], 32)).toBe(true);
    expect(check(msg, h["KALSHI-ACCESS-SIGNATURE"], 64)).toBe(false); // not max/other salt
  });

  it("PKCS#1 → PKCS#8 wrapper matches Node's own PKCS#8 encoding", () => {
    const p1 = privateKey.export({ type: "pkcs1", format: "der" });
    const p8 = privateKey.export({ type: "pkcs8", format: "der" });
    expect(Buffer.from(pkcs1ToPkcs8(new Uint8Array(p1))).equals(p8)).toBe(true);
    expect(createPublicKey(createPrivateKey({ key: Buffer.from(pkcs1ToPkcs8(new Uint8Array(p1))), format: "der", type: "pkcs8" })).asymmetricKeyType).toBe("rsa");
  });
});

describe("bad input", () => {
  it("rejects text that isn't a PEM key", async () => {
    await expect(importPrivateKey("hello")).rejects.toThrow(/BEGIN and END/);
    await expect(importPrivateKey("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----")).rejects.toThrow(/Kalshi private key/);
  });
});
