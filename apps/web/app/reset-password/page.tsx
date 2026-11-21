// Set a new password (T-275). Reached from a password-reset email via /auth/callback, which signs the browser in and
// sets the 15-minute reset marker (lib/auth/password.ts). Without both, explain and point back to "Forgot password?".
import Link from "next/link";
import { ResetForm } from "@/components/auth/ResetForm";
import { getUser } from "@/lib/auth/server";
import { hasResetProof } from "@/lib/auth/password";

export const metadata = { title: "Set a new password", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getUser();
  const ok = !!user && (await hasResetProof(user.id));
  return (
    <section className="mx-auto flex w-full max-w-[420px] flex-col gap-7 py-6 md:py-14">
      <header className="flex flex-col gap-2.5">
        <h1 className="text-balance text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">Set a new password</h1>
        {ok && <p className="text-[15px] leading-relaxed text-muted">For {user.email}. At least 8 characters.</p>}
      </header>
      {ok ? (
        <ResetForm />
      ) : (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5 text-sm leading-relaxed text-soft">
          <p>
            This page works only right after you open a password-reset link from your email, in this browser, within
            15 minutes. The link may have expired or been opened somewhere else.
          </p>
          <p>
            <Link href="/login" className="font-medium text-accent-hover underline underline-offset-4">Forgot password? Send a new reset link</Link>
          </p>
        </div>
      )}
    </section>
  );
}
