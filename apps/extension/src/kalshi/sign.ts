// Kalshi request signing (docs/16 §1, docs.kalshi.com/getting_started/api_keys).
// Message = timestamp(ms) + METHOD + path from /trade-api/v2, query string stripped.
// Ed25519 signs the bytes directly; RSA uses RSA-PSS SHA-256, MGF1 SHA-256, salt = digest length (32).
// WebCrypto only, so the same code runs in the extension worker and in Node tests.

export type KeyType = "ed25519" | "rsa";
export const RSA_PSS = { name: "RSA-PSS", saltLength: 32 } as const;

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const c of u) s += String.fromCharCode(c);
  return btoa(s);
};

/** "/trade-api/v2/portfolio/orders?limit=5" or a full URL → "/trade-api/v2/portfolio/orders" */
export function signPath(pathOrUrl: string): string {
  const path = /^https?:\/\//.test(pathOrUrl) ? new URL(pathOrUrl).pathname : pathOrUrl;
  return path.split(/[?#]/)[0]!;
}

export const message = (ts: string, method: string, pathOrUrl: string) => `${ts}${method.toUpperCase()}${signPath(pathOrUrl)}`;

function pemBody(pem: string): { der: Uint8Array; pkcs1: boolean } {
  const m = pem.match(/-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/);
  if (!m) throw new Error("Paste the whole private key, including the BEGIN and END lines.");
  const bin = atob(m[2]!.replace(/\s+/g, ""));
  return { der: Uint8Array.from(bin, (c) => c.charCodeAt(0)), pkcs1: m[1] === "RSA PRIVATE KEY" };
}

// DER length bytes
const len = (n: number) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);

/** Wrap a PKCS#1 RSAPrivateKey in PKCS#8 (Kalshi hands out "RSA PRIVATE KEY" PEMs; WebCrypto wants PKCS#8). */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]; // rsaEncryption, NULL
  const octet = [0x04, ...len(pkcs1.length)];
  const inner = 3 + algId.length + octet.length + pkcs1.length; // version INTEGER 0 = 3 bytes
  return Uint8Array.from([0x30, ...len(inner), 0x02, 0x01, 0x00, ...algId, ...octet, ...pkcs1]);
}

/** Import a PEM private key as a NON-extractable signing key. Type comes from the key, not the PEM header. */
export async function importPrivateKey(pem: string): Promise<{ key: CryptoKey; type: KeyType }> {
  const { der, pkcs1 } = pemBody(pem.trim());
  const pkcs8 = pkcs1 ? pkcs1ToPkcs8(der) : der;
  const buf = pkcs8.slice().buffer as ArrayBuffer;
  if (!pkcs1) {
    try {
      return { key: await crypto.subtle.importKey("pkcs8", buf, { name: "Ed25519" }, false, ["sign"]), type: "ed25519" };
    } catch { /* not Ed25519: try RSA */ }
  }
  try {
    return { key: await crypto.subtle.importKey("pkcs8", buf, { name: "RSA-PSS", hash: "SHA-256" }, false, ["sign"]), type: "rsa" };
  } catch {
    throw new Error("This doesn't look like a Kalshi private key (Ed25519 or RSA).");
  }
}

export async function sign(key: CryptoKey, msg: string): Promise<string> {
  const data = new TextEncoder().encode(msg);
  const algo = key.algorithm.name === "Ed25519" ? { name: "Ed25519" } : RSA_PSS;
  return b64(await crypto.subtle.sign(algo, key, data));
}

/** The three Kalshi auth headers for one request. */
export async function authHeaders(keyId: string, key: CryptoKey, method: string, pathOrUrl: string, now = Date.now()) {
  const ts = String(now);
  return {
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": await sign(key, message(ts, method, pathOrUrl)),
  };
}
