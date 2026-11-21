// Side panel "Paper trading" tab: connect a trade-only Kalshi DEMO key, see its scopes, set spending limits.
// The private key goes from this textarea straight into the background worker, which imports it as a
// non-extractable WebCrypto key. It is never sent to Kismet's servers, logged, or shown again.
import { money } from "./format";
import { API } from "./types";

interface Status {
  ok: boolean; error?: string; connected: boolean; keyId: string | null; keyType: string | null; scopes: string[];
  verifiedAt: number | null; caps: { maxOrderUsd: number; maxDayUsd: number }; spentTodayCents: number; balanceCents?: number;
}

const DEMO_KEYS_URL = "https://demo.kalshi.co/account/profile";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ask = (m: Record<string, unknown>) => chrome.runtime.sendMessage(m) as Promise<Status>;

export async function renderTrade(el: HTMLElement) {
  let enabled = false;
  try {
    const c = (await (await fetch(`${API}/api/trade/config`)).json()) as { enabled?: boolean };
    enabled = !!c.enabled;
  } catch { /* offline: show the vault anyway, orders still need the site */ }
  draw(el, await ask({ type: "vault.status" }), enabled);
}

function draw(el: HTMLElement, s: Status, enabled: boolean, note?: { error?: string; ok?: string }) {
  const off = enabled ? "" : `<section class="inner small" role="note">Paper trading is off on Kismet for this account right now. You can still connect a key; the Trade button appears in Kismet when it's on.</section>`;
  const msg = note?.error ? `<p class="error" role="alert">${esc(note.error)}</p>` : note?.ok ? `<p class="ok" role="status">${esc(note.ok)}</p>` : "";
  el.innerHTML = `
    <div class="row"><h2 style="font-size:20px">Kalshi paper trading</h2><span class="chip warn">Paper mode</span></div>
    <p class="small muted" style="margin-bottom:0">Orders go to Kalshi's <strong>demo exchange</strong> with fake money. You confirm every order on Kismet; nothing is ever placed on its own.</p>
    ${off}
    ${s.connected ? connected(s) : connectForm()}
    ${msg}
    ${limits(s)}`;
  wire(el, s, enabled);
}

function connected(s: Status) {
  return `<section class="inner stack" aria-label="Connected key">
    <div class="row"><strong>Demo key connected</strong><span class="dot" style="background:var(--accent);margin:0"></span></div>
    <div class="row small"><span class="muted">Key ID</span><span class="mono">${esc(s.keyId ?? "")}</span></div>
    <div class="row small"><span class="muted">Type</span><span>${s.keyType === "ed25519" ? "Ed25519" : "RSA"}</span></div>
    <div class="row small"><span class="muted">Permissions</span><span>${s.scopes.map(esc).join(" · ")}</span></div>
    ${s.balanceCents != null ? `<div class="row small"><span class="muted">Demo balance</span><span>${money(s.balanceCents / 100)}</span></div>` : ""}
    <p class="small muted" style="margin-bottom:0">Stored in this browser only, and it can't be exported.</p>
    <button class="btn" id="disconnect">Remove key</button>
  </section>`;
}

function connectForm() {
  return `<form id="connect" class="inner stack" aria-label="Connect a key">
    <strong>Connect a demo key</strong>
    <ol class="small muted steps">
      <li>Sign in at <a href="${DEMO_KEYS_URL}" target="_blank" rel="noopener">demo.kalshi.co</a> → Account → API keys.</li>
      <li>Create a key with only <span class="mono">read</span> and <span class="mono">write::trade</span>. Keys that can move money are refused.</li>
      <li>Paste the key ID and the private key file's contents below.</li>
    </ol>
    <label class="field">Key ID<input name="keyId" autocomplete="off" spellcheck="false" required class="mono" placeholder="a952bcbe-ec3b-4b5b-…" /></label>
    <label class="field">Private key<textarea name="pem" rows="5" autocomplete="off" spellcheck="false" required class="mono" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></label>
    <button class="btn primary" type="submit">Check and connect</button>
    <p class="small muted" style="margin-bottom:0">Your key never leaves this browser. Kismet's servers never see it.</p>
  </form>`;
}

function limits(s: Status) {
  return `<form id="limits" class="inner stack" aria-label="Spending limits">
    <strong>Spending limits</strong>
    <div class="split">
      <label class="field">Max per order<span class="money"><i>$</i><input name="maxOrderUsd" type="number" min="1" max="10000" step="1" value="${s.caps.maxOrderUsd}" required /></span></label>
      <label class="field">Max per day<span class="money"><i>$</i><input name="maxDayUsd" type="number" min="1" max="10000" step="1" value="${s.caps.maxDayUsd}" required /></span></label>
    </div>
    <p class="small muted" style="margin-bottom:0">Used today: ${money(s.spentTodayCents / 100)} of ${money(s.caps.maxDayUsd)} (each order counts at its max cost). Confirmation is always on.</p>
    <button class="btn" type="submit">Save limits</button>
  </form>`;
}

function wire(el: HTMLElement, s: Status, enabled: boolean) {
  const busy = (f: HTMLFormElement | HTMLButtonElement, on: boolean) =>
    (f instanceof HTMLFormElement ? f.querySelectorAll("button") : [f]).forEach((b) => ((b as HTMLButtonElement).disabled = on));

  el.querySelector<HTMLFormElement>("#connect")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const d = new FormData(f);
    busy(f, true);
    const r = await ask({ type: "vault.connect", keyId: String(d.get("keyId") ?? ""), pem: String(d.get("pem") ?? "") });
    (f.elements.namedItem("pem") as HTMLTextAreaElement).value = ""; // don't keep the key in the page
    if (r.ok) draw(el, r, enabled, { ok: "Connected. Kalshi confirmed this is a trade-only key." });
    else { draw(el, s, enabled, { error: r.error }); }
  });
  el.querySelector<HTMLButtonElement>("#disconnect")?.addEventListener("click", async (e) => {
    busy(e.currentTarget as HTMLButtonElement, true);
    const r = await ask({ type: "vault.disconnect" });
    draw(el, r.ok ? r : s, enabled, r.ok ? { ok: "Key removed from this browser." } : { error: r.error });
  });
  el.querySelector<HTMLFormElement>("#limits")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget as HTMLFormElement);
    const r = await ask({ type: "caps.set", maxOrderUsd: Number(d.get("maxOrderUsd")), maxDayUsd: Number(d.get("maxDayUsd")) });
    draw(el, r.ok ? { ...s, ...r } : s, enabled, r.ok ? { ok: "Limits saved." } : { error: r.error });
  });
}
