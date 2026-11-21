// Manifest V3, generated at build time so the web origin comes from KISMET_ORIGIN (docs/09, docs/15 § Extension).
// Permissions stay minimal: storage + sidePanel; hosts = our API and Kalshi's DEMO exchange only.
// The content script's Polymarket match is not a host permission.

/** Dev-only public key: pins the unpacked extension ID to DEV_EXTENSION_ID. `pnpm ext:zip` strips it (the store assigns its own ID). */
const DEV_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnwUyu5kxsOb3jLm1j0EVI1TPvTVByXezVA+UZhYqKHzeo36HzcM56X1Ai1VMn4pRKKTjHrkcQXpYro3ho7L0lTtq46tAsuUn+din00yZAJa08Y24jQ6xu+DHXJQPLLP+aKeoy0yXMd0vdDrCawXQ+NNmqJduYNt6/XDaC/PXtk6aIdYHpQEEBA2eVeX+6vM5xUYCfk+sqxOgWQY4NgLWtinFomC0OB6Npeq2VQXsPiULaLAq4Rnz3ESOYrGtLvaBiAgLNsQoY2Y0Ivsjj8ZWI/hHm+OIGQ84JcfZ1x6Wsy5Zx1/RYcHg7/XIjKsbEK+FpG6shXSZHwKioZZ1PL+H/wIDAQAB";
const DEV_EXTENSION_ID = "cgoaaiaghbckpalppklocajbdpoelmbd";
const KALSHI_DEMO_HOST = "https://external-api.demo.kalshi.co";

export function manifest(origin: string, version: string, store = false) {
  return {
    manifest_version: 3,
    name: "Kismet for Polymarket",
    short_name: "Kismet",
    version,
    description: "Shows Kismet analytics next to Polymarket outcomes.",
    ...(store ? {} : { key: DEV_KEY }),
    icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
    permissions: ["storage", "sidePanel"],
    host_permissions: [`${origin}/*`, `${KALSHI_DEMO_HOST}/*`],
    background: { service_worker: "background.js", type: "module" },
    action: { default_title: "Kismet", default_popup: "popup.html", default_icon: { 16: "icons/16.png", 32: "icons/32.png" } },
    side_panel: { default_path: "sidepanel.html" },
    content_scripts: [
      { matches: ["https://polymarket.com/event/*", "https://polymarket.com/sports/*"], js: ["content.js"], run_at: "document_idle" },
    ],
    // Only our web app may message the extension (sign-in handoff, order intents carrying a server nonce).
    externally_connectable: { matches: [`${origin}/*`] },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  };
}
