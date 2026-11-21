// Owner: Lane D2 (T-34).
import Link from "next/link";
import { PageTitle } from "@/components/kit";
import { accountsOn, savedWhere } from "@/lib/saved-where";
import { SettingsForm } from "@/components/settings/SettingsForm";

export const metadata = { title: "Settings", robots: { index: false } };

export default function Page() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageTitle title="Settings" sub={savedWhere().settings}>
        {/* #21: plan, billing and cancel live on /account (and /account links back here) */}
        {accountsOn() && <Link href="/account" className="inline-flex min-h-11 items-center rounded-input px-3 text-sm text-muted hover:text-text">Plan and billing</Link>}
      </PageTitle>
      <SettingsForm />
    </div>
  );
}
