// Brand pieces for the share cards (opengraph-image routes): the mark, the wordmark, and the two site fonts
// as static TTF instances (Space Grotesk Bold, Inter Regular; Latin subset, cut from the next/font files).
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const TAGLINE = "Good-value bets on Polymarket.";
export const C = { bg: "#070a09", surface: "#0c120f", border: "#1a2520", text: "#e6efe9", muted: "#a9bab1", accent: "#10b981", onAccent: "#04140d", soft: "#d1fae5" };

// withDefault: keep next/og's own Noto Sans first (the default face), for cards whose body text predates the brand fonts.
export async function brandFonts({ withDefault = false } = {}) {
  const [grotesk, inter, noto] = await Promise.all([
    readFile(join(process.cwd(), "app/SpaceGrotesk-Bold.ttf")),
    readFile(join(process.cwd(), "app/Inter-Regular.ttf")),
    withDefault ? readFile(join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf")) : null,
  ]);
  return [
    ...(noto ? [{ name: "Noto Sans", data: noto, weight: 400 as const, style: "normal" as const }] : []),
    { name: "Space Grotesk", data: grotesk, weight: 700 as const, style: "normal" as const },
    { name: "Inter", data: inter, weight: 400 as const, style: "normal" as const },
  ];
}

// Mark + wordmark, same geometry as app/icon.svg and the header Logo.
export function Wordmark({ size = 44 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.36, fontFamily: "Space Grotesk", fontWeight: 700, fontSize: size, letterSpacing: "-0.01em", color: C.text }}>
      <svg width={size * 1.3} height={size * 1.3} viewBox="0 0 32 32">
        <rect width="32" height="32" rx="8" fill={C.accent} />
        <path fill={C.onAccent} d="M9.15 25V7H12.55V14.15H13.01L18.85 7H23.19L15.68 15.87L23.45 25H18.97L13.01 17.7H12.55V25Z" />
      </svg>
      Kismet
    </div>
  );
}
