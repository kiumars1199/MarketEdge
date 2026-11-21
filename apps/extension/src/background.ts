// Service worker: Kismet API calls (60 s cache per slug), sign-in token, side panel, and Kalshi paper trading.
// Trading rules (docs/16 §3, docs/15): keys stay in the vault, orders only from our origin with a server nonce
// that we check with our server before signing, caps checked here, nothing is ever placed on a timer.
import * as K from "./kalshi/client";
import { importPrivateKey } from "./kalshi/sign";
import { DEFAULT_CAPS, capError, maxCostCents, orderView, parseIntent, scopeError, toQuote, today, type Caps, type Spend } from "./kalshi/trade";
import { deleteKey, loadKey, maskId, saveKey } from "./kalshi/vault";
import { API, type Auth, type EventResponse, type Msg, type Selection } from "./types";

const TTL = 60_000;
const REFRESH_BEFORE = 5 * 60_000;

// ---------- sign-in token (chrome.storage.session: memory only, cleared when the browser closes) ----------

const getAuth = async () => (await chrome.storage.session.get("auth")).auth as Auth | undefined;

function parseAuth(x: unknown): Auth | null {
  const a = x as Partial<Auth> | null;
  if (!a || typeof a.token !== "string" || a.token.length > 2048 || typeof a.exp !== "number") return null;
  if (a.tier !== "free" && a.tier !== "pro" && a.tier !== "premium") return null;
  return { token: a.token, exp: a.exp, tier: a.tier };
}

async function tokenCall(path: string, token?: string): Promise<Auth | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      credentials: token ? "omit" : "include",
    });
    return res.ok ? parseAuth(await res.json()) : null;
  } catch {
    return null;
  }
}

/** Current sign-in, refreshed when close to expiry. With no token, tries a silent sign-in (works when the site session allows it, e.g. demo). */
async function session(): Promise<Auth | null> {
  let a = await getAuth();
  if (a && a.exp - Date.now() < REFRESH_BEFORE) a = (await tokenCall("/api/ext/token/refresh", a.token)) ?? (a.exp > Date.now() ? a : undefined);
  if (!a) a = (await tokenCall("/api/ext/token")) ?? undefined;
  if (a) await chrome.storage.session.set({ auth: a });
  else await chrome.storage.session.remove("auth");
  return a ?? null;
}

async function apiGet<T>(path: string): Promise<T | null> {
  const a = await session();
  const res = await fetch(`${API}${path}`, { headers: a ? { authorization: `Bearer ${a.token}` } : {} });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function eventBySlug(slug: string): Promise<EventResponse | null> {
  const key = `ev:${slug}`;
  const hit = (await chrome.storage.session.get(key))[key] as { at: number; data: EventResponse | null } | undefined;
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  let data: EventResponse | null;
  try {
    data = await apiGet<EventResponse>(`/api/events/by-slug/${encodeURIComponent(slug)}`);
  } catch (e) {
    console.warn("[Kismet] API unreachable", slug, String(e));
    return null; // not cached: retry on next navigation
  }
  await chrome.storage.session.set({ [key]: { at: Date.now(), data } });
  return data;
}

// ---------- trading ----------

const getCaps = async () => ({ ...DEFAULT_CAPS, ...((await chrome.storage.local.get("caps")).caps as Caps | undefined) });
const getSpend = async () => (await chrome.storage.local.get("spend")).spend as Spend | undefined;
const spentToday = (s?: Spend) => (s?.day === today() ? s.cents : 0);
/** Tail of the `place` queue (RT-06): orders run one after another, never interleaved. */
let placing: Promise<unknown> = Promise.resolve();

async function signer(): Promise<K.Signer> {
  const k = await loadKey();
  if (!k) throw new Error("Connect a Kalshi demo key in the Kismet side panel first.");
  return { keyId: k.keyId, key: k.key };
}

/** Ask our server whether this nonce was issued for exactly this action + payload, and consume it. */
async function checkNonce(nonce: unknown, action: "place" | "cancel", payload: unknown) {
  if (typeof nonce !== "string" || nonce.length > 1024) throw new Error("This order has no valid confirmation. Confirm it again on Kismet.");
  let ok = false;
  try {
    const res = await fetch(`${API}/api/trade/nonce/verify`, {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "omit",
      body: JSON.stringify({ nonce, action, payload }),
    });
    ok = res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch { /* unreachable = not verified */ }
  if (!ok) throw new Error("This order's confirmation expired or was already used. Confirm it again on Kismet.");
}

async function vaultStatus() {
  const k = await loadKey();
  return {
    connected: !!k, keyId: k ? maskId(k.keyId) : null, keyType: k?.type ?? null, scopes: k?.scopes ?? [],
    verifiedAt: k?.verifiedAt ?? null, caps: await getCaps(), spentTodayCents: spentToday(await getSpend()),
  };
}

async function connect(keyId: unknown, pem: unknown) {
  if (typeof keyId !== "string" || !/^[\w-]{8,100}$/.test(keyId.trim())) throw new Error("Paste the key ID Kalshi showed you (letters, numbers and dashes).");
  if (typeof pem !== "string" || pem.length > 10_000) throw new Error("Paste the private key file's contents.");
  const id = keyId.trim();
  const { key, type } = await importPrivateKey(pem); // non-extractable from here on
  const s = { keyId: id, key };
  const keys = await K.getApiKeys(s);
  const mine = keys.api_keys?.find((k) => k.api_key_id === id);
  if (!mine) throw new Error("Kalshi doesn't list this key ID for this account.");
  const bad = scopeError(mine.scopes ?? []);
  if (bad) throw new Error(bad);
  const bal = await K.getBalance(s);
  await saveKey({ keyId: id, key, type, scopes: mine.scopes, verifiedAt: Date.now() });
  return { ...(await vaultStatus()), balanceCents: bal.balance };
}

type Handler = (m: Record<string, unknown>) => Promise<unknown>;

/** Messages from our web app (externally_connectable). Every order intent is user-confirmed there and carries a server nonce. */
const external: Record<string, Handler> = {
  ping: async () => ({ version: chrome.runtime.getManifest().version, ...(await vaultStatus()) }),
  token: async (m) => {
    const a = parseAuth(m.auth);
    if (!a) throw new Error("Bad sign-in token.");
    await chrome.storage.session.set({ auth: a });
    return { tier: a.tier };
  },
  quote: async (m) => {
    const t = String(m.ticker ?? "");
    if (!/^[A-Z0-9][A-Z0-9._-]{1,99}$/i.test(t)) throw new Error("Bad market ticker.");
    const [{ market }, book] = await Promise.all([K.getMarket(t), K.getOrderbook(t).catch(() => null)]);
    return { quote: toQuote(market, book) };
  },
  // RT-06: one order at a time, and its full possible cost is reserved before any await that could fail.
  // Cancelled or not, a placed order stays counted (caps stay conservative). The reservation is released only
  // when the order surely never reached Kalshi: a failure before sending, or a 4xx from Kalshi. A timeout or
  // 5xx may still have created it, so it stays counted.
  place: async (m) => (placing = placing.catch(() => {}).then(async () => {
    const o = parseIntent(m.order);
    if (typeof o === "string") throw new Error(o);
    const err = capError(o, await getCaps(), await getSpend());
    if (err) throw new Error(err);
    const cost = maxCostCents(o);
    const day = today();
    await chrome.storage.local.set({ spend: { day, cents: spentToday(await getSpend()) + cost } satisfies Spend });
    let sent = false;
    try {
      const s = await signer();
      await checkNonce(m.nonce, "place", o);
      sent = true;
      const res = await K.placeOrder(s, o);
      return { order_id: res.order_id, client_order_id: o.client_order_id };
    } catch (e) {
      const neverPlaced = !sent || (e instanceof K.KalshiError && e.status >= 400 && e.status < 500);
      const now = await getSpend();
      if (neverPlaced && now?.day === day) await chrome.storage.local.set({ spend: { day, cents: Math.max(0, now.cents - cost) } satisfies Spend });
      throw e;
    }
  })),
  order: async (m) => {
    const id = String(m.order_id ?? "");
    if (!id) throw new Error("Missing order id.");
    try {
      return { order: orderView((await K.getOrder(await signer(), id)).order) };
    } catch (e) {
      if (e instanceof K.KalshiError && e.status === 404) return { order: null }; // Kalshi reads lag a moment after create
      throw e;
    }
  },
  cancel: async (m) => {
    const payload = { order_id: String(m.order_id ?? ""), ticker: String(m.ticker ?? "") };
    if (!payload.order_id || !payload.ticker) throw new Error("Missing order.");
    const s = await signer();
    await checkNonce(m.nonce, "cancel", payload);
    await K.cancelOrder(s, payload.order_id, payload.ticker);
    return {};
  },
  portfolio: async () => {
    const s = await signer();
    const [bal, resting, pos] = await Promise.all([K.getBalance(s), K.listResting(s), K.listPositions(s)]);
    return {
      balanceCents: bal.balance,
      resting: (resting.orders ?? []).map(orderView),
      positions: (pos.market_positions ?? [])
        .map((p) => ({ ticker: String(p.ticker), position: Number(p.position_fp ?? p.position ?? 0), pnl_cents: Math.round(Number(p.realized_pnl_dollars ?? 0) * 100) || Number(p.realized_pnl ?? 0) }))
        .filter((p) => p.position !== 0),
    };
  },
};

/** Messages from our own extension pages (popup, side panel). */
const internal: Record<string, Handler> = {
  "vault.status": () => vaultStatus(),
  "vault.connect": (m) => connect(m.keyId, m.pem),
  "vault.disconnect": async () => { await deleteKey(); return vaultStatus(); },
  "caps.set": async (m) => {
    const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 10_000;
    if (!ok(m.maxOrderUsd) || !ok(m.maxDayUsd)) throw new Error("Limits must be between $1 and $10,000.");
    if ((m.maxOrderUsd as number) > (m.maxDayUsd as number)) throw new Error("The per-order limit can't be above the daily limit.");
    await chrome.storage.local.set({ caps: { maxOrderUsd: m.maxOrderUsd as number, maxDayUsd: m.maxDayUsd as number } satisfies Caps });
    return vaultStatus();
  },
  "auth.signout": async () => { await chrome.storage.session.remove("auth"); return {}; },
};

/** {ok:true,...} or {ok:false,error}. Only our own messages go back: never key material, never raw exceptions. */
function run(h: Handler, m: Record<string, unknown>, reply: (r: unknown) => void) {
  h(m).then(
    (r) => reply({ ok: true, ...(r as object) }),
    (e) => reply({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." }),
  );
  return true;
}

chrome.runtime.onMessageExternal.addListener((msg: Record<string, unknown>, sender, reply) => {
  // externally_connectable already limits this to our origin; check again so a manifest slip can't open it up.
  if (sender.origin !== API || !msg || typeof msg.type !== "string" || !Object.hasOwn(external, msg.type)) {
    reply({ ok: false, error: "Not allowed." });
    return false;
  }
  return run(external[msg.type]!, msg, reply);
});

chrome.runtime.onMessage.addListener((msg: Msg | Record<string, unknown>, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  const m = msg as Msg;
  if (m.type === "open") {
    // Must run before any await, or Chrome drops the user gesture.
    const tabId = sender.tab?.id;
    if (tabId !== undefined) chrome.sidePanel.open({ tabId }).catch((e) => console.warn("[Kismet] side panel", String(e)));
    const sel: Selection = { slug: m.slug, marketId: m.marketId, at: Date.now() };
    chrome.storage.local.set({ selection: sel });
    return false;
  }
  if (m.type === "event") {
    eventBySlug(m.slug).then(reply);
    return true; // async reply
  }
  if (m.type === "telemetry") {
    fetch(`${API}/api/ext/telemetry`, {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "omit",
      body: JSON.stringify({ kind: "no_rows", slug: m.slug, markets: m.markets }),
    }).catch(() => {});
    return false;
  }
  if (m.type === "session") {
    session().then((a) => reply(a ? { signedIn: true, tier: a.tier } : { signedIn: false, tier: null }));
    return true;
  }
  // Vault and limits: extension pages only, never content scripts running inside polymarket.com.
  // A content script's sender.url is the web page's URL, so only our own chrome-extension:// pages pass
  // (the side panel, or sidepanel.html opened in a tab, which is how the e2e drives it).
  const t = (msg as Record<string, unknown>).type;
  const fromPage = sender.url?.startsWith(chrome.runtime.getURL(""));
  if (typeof t === "string" && Object.hasOwn(internal, t) && fromPage) return run(internal[t]!, msg as Record<string, unknown>, reply);
  return false;
});
