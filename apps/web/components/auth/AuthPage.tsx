// /login and /signup (docs/19 P2, T-275): optional Google, then email + password or an email link, behind the 18+ and
// Terms box. The password tab signs in on /login and creates an account on /signup; the email link does either.
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { accountsOffNote, authEnabled, getUser, safeNext } from "@/lib/auth/server";
import { FREE_BEST_BETS_A_DAY } from "@/lib/entitlements";

const ERRORS: Record<string, string> = {
  terms: "Tick the box to confirm you're 18 or older and agree to the Terms.",
  link: "That link didn't work. It may have expired or been opened in a different browser. If you were confirming a new account, your email is confirmed: log in with your password. Otherwise send a new link.",
  google: "Google sign-in didn't start. Try again, or use your email.",
  rate: "Too many sign-in tries. Wait a minute and try again.",
  unavailable: "Sign-in isn't available right now. Try again in a minute.",
  closed: "New sign-ups are paused right now. Existing accounts can still log in.",
};

const COPY = {
  login: {
    title: "Log in",
    lede: "Welcome back. Log in with your email and password, or get a sign-in link by email.",
    other: { q: "New to Kismet?", label: "Create a free account", href: "/signup" },
  },
  signup: {
    title: "Create your free account",
    lede: `${FREE_BEST_BETS_A_DAY} best bets a day free, no card. Save views and keep My list on every device.`,
    other: { q: "Already have an account?", label: "Log in", href: "/login" },
  },
} as const;

export async function AuthPage({ mode, searchParams }: {
  mode: keyof typeof COPY;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getUser()) redirect(next);
  const c = COPY[mode];
  const other = next === "/" ? c.other.href : `${c.other.href}?next=${encodeURIComponent(next)}`;

  return (
    <section className="mx-auto flex w-full max-w-[420px] flex-col gap-7 py-6 md:py-14">
      <header className="flex flex-col gap-2.5">
        <h1 className="text-balance text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">{c.title}</h1>
        <p className="text-[15px] leading-relaxed text-muted">{c.lede}</p>
      </header>
      {authEnabled() ? (
        <>
          <LoginForm mode={mode} next={next} error={sp.error ? ERRORS[sp.error] ?? ERRORS.unavailable : undefined} />
          <p className="text-sm text-muted">
            {c.other.q}{" "}
            <Link href={other} className="font-medium text-accent-hover underline-offset-4 hover:underline">{c.other.label}</Link>
          </p>
        </>
      ) : (
        <p className="rounded-card border border-border bg-surface p-5 text-sm leading-relaxed text-soft">
          {accountsOffNote()}{" "}
          <Link href="/" className="text-accent-hover underline-offset-4 hover:underline">Go to Best bets</Link>
        </p>
      )}
    </section>
  );
}
