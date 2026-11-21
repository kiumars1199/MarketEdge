// Default share card for every page without its own (/, /about, /pricing…). /m/[id] overrides it.
// Plain facts only: no return figures or profit wording (docs/01 Compliance). Colors = dark theme tokens.
import { ImageResponse } from "next/og";
import { DISCLAIMER } from "@/components/shell/Footer";
import { C, TAGLINE, Wordmark, brandFonts } from "./_brand";

export const alt = "Kismet: good-value bets on Polymarket, how often bets like them win, and what $10 pays";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: C.bg, color: C.text, fontFamily: "Inter" }}>
        <Wordmark />
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 104, lineHeight: 1, letterSpacing: "-0.03em" }}>{TAGLINE}</div>
          <div style={{ fontSize: 34, lineHeight: 1.35, color: C.muted, maxWidth: 900 }}>Prediction-market prices next to how often similar bets won, after fees and the cost of crossing the spread.</div>
        </div>
        <div style={{ display: "flex", borderTop: `1px solid ${C.border}`, paddingTop: 24, color: C.muted, fontSize: 24 }}>{DISCLAIMER}</div>
      </div>
    ),
    { ...size, fonts: await brandFonts() },
  );
}
