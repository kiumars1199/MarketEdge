"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { BETA_LINKS, MAIN_TABS, MORE_LINKS, SALES_TABS, isActive } from "./nav";
import { headerView, useMe, type HeaderHint } from "@/lib/me";
import { BETA_FEATURES } from "@/lib/beta-list";
import { BetaBadge } from "@/components/beta/BetaBadge";

// Mobile (<768px) bottom tab bar: Best bets · All markets · My list · More (docs/06 § App shell).
export function MobileNav({ signedOutHint = false, hint = null }: { signedOutHint?: boolean; hint?: HeaderHint | null }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.close(), [pathname]);
  const me = useMe();
  const view = headerView(me, hint);   // #17/#73: the same links as the desktop header, decided on the server
  const beta = BETA_LINKS.filter((l) => view?.nav.includes(l.feature));
  const admin = view?.admin ? [{ href: "/admin", label: "Admin" }] : [];   // the header's Admin link is hidden on phones
  const moreActive = [...MORE_LINKS, ...beta, ...admin].some((l) => isActive(pathname, l.href));
  const tab = "relative flex min-h-11 items-center justify-center py-2.5";
  // P7: the current tab is bright text plus a short accent bar on top, so it reads at a glance
  const on = "font-medium text-text before:absolute before:inset-x-5 before:-top-1 before:h-0.5 before:rounded-full before:bg-accent";
  if (me ? me.auth && !me.user : hint ? !hint.signedIn : signedOutHint) {   // before /api/me answers: the layout's hint (T-295)
    // T-276: signed out, the app tabs only lead to the sign-up wall; show the sales pages and sign-up instead.
    return (
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-background pb-[max(env(safe-area-inset-bottom),8px)] pt-1 text-[13px] md:hidden">
        {SALES_TABS.map((t) => (
          <Link key={t.href} href={t.href} aria-current={pathname === t.href ? "page" : undefined} className={`${tab} ${pathname === t.href ? on : "text-muted"}`}>
            {t.label}
          </Link>
        ))}
        <Link href="/signup" className={`${tab} font-semibold text-accent`}>Sign up</Link>
      </nav>
    );
  }

  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-background pb-[max(env(safe-area-inset-bottom),8px)] pt-1 text-[13px] md:hidden">
        {MAIN_TABS.slice(0, 3).map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={`${tab} ${active ? on : "text-muted"}`}>
              {t.label}
            </Link>
          );
        })}
        <button type="button" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()} className={`${tab} ${moreActive ? on : "text-muted"}`}>
          More
        </button>
      </nav>
      <dialog
        ref={dialog}
        aria-label="More"
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        className="m-0 mt-auto w-full max-w-none rounded-t-2xl border border-border bg-surface p-0 text-text backdrop:bg-black/60 md:hidden"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-lg font-semibold">More</h2>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="flex size-11 items-center justify-center rounded-card bg-raised text-muted">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <ul className="px-3 pb-8 pt-2">
          {MORE_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} aria-current={isActive(pathname, l.href) ? "page" : undefined} className="block rounded-card px-3 py-3 hover:bg-raised aria-[current=page]:text-accent">
                {l.label}
              </Link>
            </li>
          ))}
          {admin.map((l) => (
            <li key={l.href}>
              <Link href={l.href} aria-current={isActive(pathname, l.href) ? "page" : undefined} className="block rounded-card px-3 py-3 hover:bg-raised aria-[current=page]:text-accent">
                {l.label}
              </Link>
            </li>
          ))}
          {beta.map((l) => (
            <li key={l.href}>
              <Link href={l.href} aria-current={isActive(pathname, l.href) ? "page" : undefined} className="flex items-center gap-2 rounded-card px-3 py-3 hover:bg-raised aria-[current=page]:text-accent">
                {l.label}{BETA_FEATURES.includes(l.feature) && <BetaBadge variant="pill" />}
              </Link>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
