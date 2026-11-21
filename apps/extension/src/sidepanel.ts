// Side panel: one market (drawer content) or the page's list. Data comes from the background cache.
import { chance, edge, formatCount, money, odds, pct, price, ret, RETURN_HELP } from "./format";
import { renderTrade } from "./vault-ui";
import { API, type EventResponse, type Execution, type Market, type Msg, type Selection, type Side } from "./types";

const root = document.getElementById("root")!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function bars(s: Side) {
  return `<div class="stack small">
    <div><div class="row"><span class="muted">Market says</span><span>${pct(s.ask)}</span></div>
      <div class="bar"><i style="width:${s.ask * 100}%;background:var(--market-bar)"></i></div></div>
    <div><div class="row"><span class="muted">Won before</span><span style="color:var(--accent-soft)">${pct(s.win_prob)}</span></div>
      <div class="bar"><i style="width:${s.win_prob * 100}%;background:var(--accent)"></i></div></div>
  </div>`;
}

function sideCard(s: Side, isBest: boolean) {
  const pos = s.roi_pct > 0;
  const profit = (s.roi_pct / 100) * 100;
  return `<section class="inner stack ${isBest && pos ? "accent" : ""}">
    <div class="row"><strong>Bet ${esc(s.outcome)} · pays ${odds(s.ask)}</strong><span class="small" style="color:var(--accent-softer)">${chance(s.win_prob)}</span></div>
    ${pos
      ? `<div><div class="num" style="font-size:42px;font-weight:700;color:var(--accent)" title="${esc(RETURN_HELP)}">${ret(s.roi_pct)}</div>
         <div class="small muted" title="${esc(RETURN_HELP)}">estimated return · past results: ${money(profit, true)} per $100 bet</div></div>`
      : `<div class="muted">No edge at this price</div>`}
    ${bars(s)}
  </section>`;
}

function priceCheck(x?: Execution): string {
  if (!x) return `<span class="muted">Price check runs on best bets only.</span>`;
  const warn = (t: string) => `<span style="color:var(--warning)">● ${t}</span>`;
  const lines = [
    x.verdict === "worth it" ? `<span style="color:var(--accent-softer)">Price check ✓ fair fill</span>`
    : x.verdict === "thin" ? warn(`Spread eats most of this: after crossing it you keep ${Math.round(x.retention * 100)}% of the edge.`)
    : x.verdict === "not worth it" ? warn("Price too high right now")
    : warn("No sellers at this price right now"),
  ];
  if (x.capacity_usd < 100) lines.push(warn(`Only ~${money(x.capacity_usd)} available at this price`));
  if (x.warning) lines.push(warn("Unusually high — check details"));
  return lines.join("<br>");
}

function pros(m: Market, x?: Execution) {
  const b = m.best;
  const rows: [string, string][] = [
    ["Edge (per share)", edge(b.edge)], ["Ask", price(b.ask)], ["Mid", price(b.mid)], ["Fee", price(b.fee)],
    ["Spread", price(m.spread)], ["Model level", b.model_level], ["Effective samples", formatCount(b.model_neff)],
    ["Past events", formatCount(b.model_events)],
  ];
  if (x) rows.push(["Spread cost", price(x.spread_cost)], ["Edge kept after spread", `${Math.round(x.retention * 100)}%`], ["Capacity", money(x.capacity_usd)]);
  const stakes = x?.stakes?.length
    ? `<table class="small" style="width:100%;margin-top:8px"><tr class="muted"><td>Stake</td><td>Avg price</td><td>Est. return (past results)</td></tr>${x.stakes
        .map((s) => `<tr><td>${money(s.stake_usd)}</td><td>${price(s.avg_price)}</td><td>${money(s.expected_profit_usd, true)}</td></tr>`).join("")}</table>`
    : "";
  return `<details class="inner"><summary style="cursor:pointer">Details for pros</summary>
    <div class="small" style="font-family:ui-monospace,monospace;margin-top:8px">${rows.map(([k, v]) => `<div class="row"><span class="muted">${k}</span><span>${esc(v)}</span></div>`).join("")}${stakes}</div>
  </details>`;
}

function marketView(d: EventResponse, m: Market) {
  const x = d.flags.find((f) => f.id === m.id)?.execution ?? m.execution;
  const sides = [...m.sides].sort((a, b) => (b.side_index === m.best.side_index ? 1 : 0) - (a.side_index === m.best.side_index ? 1 : 0));
  root.innerHTML = `
    <a href="#" id="back" class="small">← All on this page</a>
    <div><div class="small muted">${esc(d.event)}</div><h2 style="font-size:20px;margin-top:4px">${esc(m.question)}</h2></div>
    ${sides.map((s) => sideCard(s, s.side_index === m.best.side_index)).join("")}
    <section class="inner small">${priceCheck(x)}</section>
    ${pros(m, x)}
    <a class="btn primary" target="_blank" href="${API}/m/${encodeURIComponent(m.id)}">Open in Kismet</a>
    <a class="btn" target="_blank" href="${esc(m.url.startsWith("https://polymarket.com/") ? m.url : `https://polymarket.com/event/${d.slug}`)}">Open on Polymarket</a>`;
  root.querySelector("#back")!.addEventListener("click", (e) => { e.preventDefault(); select(d.slug, null); });
}

function listView(d: EventResponse) {
  const best = d.markets.filter((m) => m.best.roi_pct > 0);
  root.innerHTML = `
    <div><div class="small muted">${esc(d.event)}</div><h2 style="font-size:20px;margin-top:4px">${formatCount(d.flags.length)} best bets on this page</h2></div>
    ${best.length ? best.map((m) => `
      <a href="#" data-id="${esc(m.id)}" class="inner" style="display:block;color:var(--text)">
        <div class="row"><span>${esc(m.question)}</span><span class="num" style="color:var(--accent);font-size:18px;font-weight:700">${ret(m.best.roi_pct)}</span></div>
        <div class="small muted">${esc(m.best.outcome)} · won ${pct(m.best.win_prob)} before · market says ${pct(m.best.ask)} · ${chance(m.best.win_prob)}</div>
      </a>`).join("") : `<p class="muted">No market on this page has an edge right now.</p>`}`;
  root.querySelectorAll<HTMLElement>("[data-id]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); select(d.slug, a.dataset.id!); }));
}

function select(slug: string, marketId: string | null) {
  const sel: Selection = { slug, marketId, at: Date.now() };
  chrome.storage.local.set({ selection: sel });
}

async function render(sel?: Selection) {
  if (!sel) return;
  const d = await (chrome.runtime.sendMessage({ type: "event", slug: sel.slug } satisfies Msg) as Promise<EventResponse | null>);
  if (!d) { root.innerHTML = `<p class="muted">Kismet has no data for this page, or ${esc(API.replace(/^https?:\/\//, ""))} is not reachable.</p>`; return; }
  const m = sel.marketId ? d.markets.find((x) => x.id === sel.marketId) : undefined;
  if (m) marketView(d, m); else listView(d);
  window.scrollTo(0, 0);
}

chrome.storage.local.get("selection").then((v) => render(v.selection as Selection | undefined));
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.selection) render(c.selection.newValue as Selection); });

// Tabs: "This page" (market view) and "Paper trading" (key vault + limits). sidepanel.html#trade opens on trading.
const tabs = { page: document.getElementById("tab-page")!, trade: document.getElementById("tab-trade")! };
const trade = document.getElementById("trade")!;
function show(which: "page" | "trade") {
  tabs.page.setAttribute("aria-selected", String(which === "page"));
  tabs.trade.setAttribute("aria-selected", String(which === "trade"));
  root.hidden = which !== "page";
  trade.hidden = which !== "trade";
  if (which === "trade") renderTrade(trade);
}
tabs.page.addEventListener("click", () => show("page"));
tabs.trade.addEventListener("click", () => show("trade"));
if (location.hash === "#trade") show("trade");
