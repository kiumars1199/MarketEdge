import { ago } from "./format";
import { API, type Msg, type SessionInfo } from "./types";

const $ = (id: string) => document.getElementById(id)!;
const dot = (color: string, text: string) => {
  const s = document.createElement("span");
  s.innerHTML = `<span class="dot" style="background:${color}"></span>`;
  s.append(text);
  return s;
};
const host = API.replace(/^https?:\/\//, "");

$("open").addEventListener("click", () => chrome.tabs.create({ url: API }));
$("signin").addEventListener("click", () => chrome.tabs.create({ url: `${API}/ext/connect` }));
$("panel").addEventListener("click", async () => {
  const win = await chrome.windows.getCurrent();
  if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
  window.close();
});

chrome.runtime.sendMessage({ type: "session" } satisfies Msg).then((s: SessionInfo) => {
  const tier = s?.tier ? s.tier[0]!.toUpperCase() + s.tier.slice(1) : "Signed out";
  $("tier").textContent = tier;
  $("tier").classList.toggle("on", s?.tier === "premium");
  $("who").replaceChildren(s?.signedIn ? dot("var(--accent)", "Signed in") : dot("var(--warning)", "Signed out"));
  ($("signin") as HTMLButtonElement).hidden = !!s?.signedIn;
  if (s?.signedIn && s.tier !== "premium") $("hint").textContent = "Badges on Polymarket are part of Premium. Open Kismet to upgrade.";
});

chrome.runtime.sendMessage({ type: "vault.status" }).then((v: { ok: boolean; connected?: boolean }) => {
  $("paper").textContent = v?.ok && v.connected ? "Demo key connected" : "Off";
});

fetch(`${API}/api/meta`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((m: { meta: { scanned_at: number } }) => {
    $("status").replaceChildren(dot("var(--accent)", "Connected"));
    $("scan").textContent = ago(m.meta.scanned_at);
  })
  .catch(() => $("status").replaceChildren(dot("var(--warning)", `Can't reach ${host}`)));
