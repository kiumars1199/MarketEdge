"use client";
// Header: "Log in" + "Sign up" (primary) when signed out, "Account" when signed in (paid mode only; nothing in demo mode).
import Link from "next/link";
import { headerView, useMe, type HeaderHint } from "@/lib/me";

// signedOutHint (T-295): accounts on and no session cookie, so the buttons render with the page instead of popping in
// when /api/me answers (that moved the whole page down: CLS on every prerendered page).
// hint (#17/#73): signed in with a session cookie, the layout already knows who this is, so Account (and Admin) are in
// the first HTML of every page instead of appearing when /api/me answers.
export function AccountLink({ signedOutHint = false, hint = null }: { signedOutHint?: boolean; hint?: HeaderHint | null }) {
  const me = useMe();
  const view = headerView(me, hint);
  if (!me ? !signedOutHint && !hint : !me.auth) return null;
  return view?.signedIn
    ? (
      <>
        {view.admin && <Link href="/admin" className="hidden min-h-11 sm:flex items-center rounded-input px-3 text-sm text-muted hover:text-text">Admin</Link>}
        <Link href="/account" className="flex min-h-11 items-center rounded-input px-3 text-sm text-muted hover:text-text">Account</Link>
      </>
    )
    : (
      <>
        <Link href="/login" className="flex min-h-11 flex-none items-center whitespace-nowrap rounded-input px-2 text-sm font-medium text-muted hover:text-text sm:px-2.5">Log in</Link>
        <Link href="/signup" className="flex min-h-11 flex-none items-center whitespace-nowrap rounded-input bg-accent px-3 text-sm sm:px-3.5 font-semibold text-on-accent hover:bg-accent-hover">Sign up</Link>
      </>
    );
}
