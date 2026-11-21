// Share card for /m/[id] (T-276: the teaser). Social crawlers are signed out, so the card shows only what the
// signed-out page shows: the question, its category and a sign-up line. No verdict, price, chance or return.
// Colors = dark theme tokens (globals.css).
import { ImageResponse } from "next/og";
import { DISCLAIMER } from "@/components/shell/Footer";
import { TEASER_LINE, marketTeaser } from "@/lib/teaser";
import { C, Wordmark, brandFonts } from "../../_brand";

export const runtime = "nodejs";
export const alt = "Kismet market";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await marketTeaser(id).catch(() => null);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: C.bg, color: C.text, fontSize: 28 }}>
        <Wordmark size={30} />
        {t ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div style={{ display: "flex", color: C.muted, fontSize: 26, textTransform: "uppercase", letterSpacing: 2 }}>{t.category}</div>
            {/* 3 lines at most, ellipsis after (the longest real titles are ~120 characters) */}
            <div style={{ display: "block", fontSize: 54, fontWeight: 700, lineHeight: 1.15, lineClamp: 3 }}>{t.title}</div>
            <div style={{ display: "block", fontSize: 32, color: C.accent, lineClamp: 2 }}>{TEASER_LINE}</div>
          </div>
        ) : (
          <div style={{ fontSize: 54, fontWeight: 700 }}>Bets where the odds lean your way</div>
        )}
        <div style={{ display: "flex", borderTop: `1px solid ${C.border}`, paddingTop: 24, color: C.muted, fontSize: 24 }}>{DISCLAIMER}</div>
      </div>
    ),
    { ...size, fonts: await brandFonts({ withDefault: true }) },
  );
}
