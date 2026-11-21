// Paywall matrix on the wired production build (:3161). Paced so the limiter doesn't answer for the gate.
import fs from "fs";
const W = "http://localhost:3161", M = "6674492";
const ck = (st) => { const c = JSON.parse(fs.readFileSync(`states/${st}.json`)).cookies[0]; return `${c.name}=${c.value}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keys = (o) => o && typeof o === "object" ? Object.keys(o) : [];
let ev;
for (const st of ["anon", "free", "pro", "premium"]) {
  const h = st === "anon" ? {} : { cookie: ck(st) };
  const get = async (u) => { await sleep(700); const r = await fetch(W + u, { headers: h }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t }; };
  const out = [];
  for (const u of ["/api/flags?ps=1000", "/api/flags?pg=2", "/api/markets?ps=1000", "/api/markets?pg=2", "/api/markets?pg=99999"]) {
    const { s, j } = await get(u);
    out.push(`${u} → ${s} ${j?.rows ? `rows ${j.rows.length} page ${j.page} page_size ${j.page_size} pages ${j.pages} first ${j.rows[0]?.market?.id}` : JSON.stringify(j).slice(0, 80)}`);
  }
  const m = await get(`/api/markets/${M}`);
  if (m.j?.market) { ev ??= m.j.market.event_id; const s0 = m.j.market.sides?.[0] ?? {}; out.push(`/api/markets/${M} → ${m.s} side0 ask ${s0.ask} win_prob ${s0.win_prob} edge ${s0.edge} ranges ${JSON.stringify(s0.ranges ?? null).slice(0, 60)} stake ${s0.stake ?? s0.kelly ?? "-"} capacity ${m.j.market.execution?.capacity_usd ?? "-"}; market keys: ${keys(m.j.market).length}`); }
  else out.push(`/api/markets/${M} → ${m.s} ${m.t.slice(0, 80)}`);
  for (const u of [`/api/events/${ev ?? "1306312"}`, `/api/model/curve?id=${M}`, "/api/kalshi", "/api/combos", "/api/account/export", "/api/admin/export", "/api/data/watchlist", "/api/backtest"]) {
    const { s, t } = await get(u); out.push(`${u} → ${s} ${t.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  const all = await get(`/api/markets/${M}`);
  out.push(`theta/covariance in /api/markets/${M}: ${/theta|covariance|cov_/.test(all.t)}`);
  console.log(`## ${st}\n` + out.join("\n"));
}
