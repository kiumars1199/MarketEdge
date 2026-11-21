// Refund and cancellation policy (docs/14 §3, T-49). The owner picks the policy in config/site.json legal.refund_policy.
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, SupportEmail, type Section } from "@/components/legal/Legal";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";   // T-295: prerendered + revalidated (lib/static-routes.ts)
export const revalidate = 300;

export const metadata: Metadata = { title: "Refunds and cancellation", description: "How to cancel, what happens to your plan, and when you can get a refund.", alternates: { canonical: "/refunds" } };

const POLICIES: Record<string, string> = {
  none: "Payments are not refunded. Cancelling stops future renewals, and you keep your plan until the period you paid for ends.",
  first_charge_7_days: "If you ask within 7 days of your first paid charge, we refund it in full. Renewal charges are not refunded; cancelling stops future renewals, and you keep your plan until the period you paid for ends.",
  prorated: "If you cancel mid-period, we refund the unused part of that period, worked out by the day.",
};

export default function Page() {
  const policy = POLICIES[SITE.refundPolicy] ?? (SITE.refundPolicy || "[[REFUND_POLICY]]");
  const sections: Section[] = [
    {
      id: "cancel", title: "Cancel any time",
      body: <p>
        Open your <Link href="/account">account page</Link> and choose <strong>Manage billing or cancel</strong>. Cancelling takes a minute
        and there&apos;s nothing to call or email. Pro and Premium both start with a 7-day free trial: cancel during it and you aren&apos;t charged.
      </p>,
    },
    {
      id: "after", title: "What happens after you cancel",
      body: <p>Your plan stays active until the end of the period you&apos;ve paid for, then your account moves to the Free plan. Your saved items stay, within Free plan limits.</p>,
    },
    { id: "policy", title: "Refund policy", body: <p>{policy}</p> },
    {
      id: "request", title: "How to ask for a refund",
      body: <p>Email <SupportEmail /> from your account&apos;s email address with the date of the charge. We reply within {SITE.responseTime}.</p>,
    },
    {
      id: "timeline", title: "When the money arrives",
      body: <p>Approved refunds go back to the card you paid with through Stripe. Banks usually show them within 5 to 10 business days.</p>,
    },
    {
      id: "disputes", title: "Disputes",
      body: <p>If something looks wrong on your bill, please email us first; we can usually fix it faster than a card dispute.</p>,
    },
  ];
  return <LegalPage title="Refunds and cancellation" intro={<p>Cancel in a few clicks, keep what you paid for, and know when a refund applies.</p>} sections={sections} />;
}
