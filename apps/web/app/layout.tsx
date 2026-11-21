import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { Header } from "@/components/shell/Header";
import { Footer } from "@/components/shell/Footer";
import { MobileNav } from "@/components/shell/MobileNav";
import { LazyHosts } from "@/components/shell/LazyHosts";
import { siteUrl } from "@/lib/site";
import { getSettings } from "@/lib/settings";
import { hasSessionCookie, requestClock } from "@/lib/zone-server";
import { authEnabled, getMe } from "@/lib/auth/server";
import { isAdminEmail } from "@/lib/admin/core";
import { navFeatures } from "@/lib/beta";
import { DEMO_MODE } from "@/lib/config";
import type { HeaderHint } from "@/lib/me";
import { unstable_rethrow } from "next/navigation";
import { ClockProvider } from "@/components/clock";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  openGraph: { siteName: "Kismet", type: "website", images: [{ url: "/opengraph-image", width: 1200, height: 630 }] },   // fallback; app/opengraph-image.tsx and twitter-image.tsx (and /m/[id]) win
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
  title: { default: "Kismet", template: "%s · Kismet" },
  description: "Prediction-market analytics: which contracts are priced below how often bets like them have won.",
};

export const viewport: Viewport = { themeColor: "#070a09" };
// T-295: no `dynamic` here. requestClock() reads cookies() and headers(), so every route renders per request (fresh
// CSP nonce, middleware.ts) unless its page opts into `dynamic = "force-static"` (lib/static-routes.ts): there those
// read as empty, the zone is unknown (clock times show after mount) and the page is prerendered + revalidated.

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [settings, clock, session] = await Promise.all([getSettings(), requestClock(), hasSessionCookie()]);   // banner (T-142, cached 60 s); the visitor's zone (T-288)
  // T-295: accounts on and no session cookie (every prerendered page): the header renders signed out from the first
  // paint, so the landing never ships search and alerts code it would hide once /api/me answers.
  const signedOut = authEnabled() && !session;
  const hint = authEnabled() && session ? await headerHint() : null;
  const now = Date.now();   // one clock for the server render and the hydration render (components/clock.tsx)
  const banner = settings.banner_on && settings.banner_text ? settings.banner_text : null;
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
      <body className="flex min-h-dvh flex-col bg-background text-text">
        <ClockProvider zone={clock.zone} saved={clock.saved} now={now}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-input focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent">
          Skip to content
        </a>
        {banner && (
          <div role="status" data-testid="site-banner" className="border-b border-accent-border bg-accent-bg px-4 py-2.5 text-center text-sm text-accent-soft md:px-8">
            {banner}
          </div>
        )}
        <Header signedOutHint={signedOut} hint={hint} />
        <main id="main" className="flex-1 px-4 py-6 md:px-8">
          {children}
        </main>
        <Footer />
        <MobileNav signedOutHint={signedOut} hint={hint} />
        <LazyHosts />
        </ClockProvider>
      </body>
    </html>
  );
}

/** #17/#73 (Nov 20): with a session cookie, the header renders signed in from the first HTML (Account, Admin for admins,
 *  Combos/Kalshi when they show), the same on every page, instead of filling in when /api/me answers. getMe() is
 *  cache()d, so a page that reads it too doesn't check the session twice. A failed read falls back to /api/me. */
async function headerHint(): Promise<HeaderHint | null> {
  try {
    const me = await getMe();
    return { signedIn: !!me.user, admin: isAdminEmail(me.user, process.env.ADMIN_EMAILS, DEMO_MODE), nav: navFeatures(me) };
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
}
