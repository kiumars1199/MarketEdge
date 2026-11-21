// Privacy policy (docs/14 §3, T-49). Owner values from config/site.json; empty ones render as [[PLACEHOLDER]].
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, SupportEmail, type Section } from "@/components/legal/Legal";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";   // T-295: prerendered + revalidated (lib/static-routes.ts)
export const revalidate = 300;

export const metadata: Metadata = { title: "Privacy policy", description: `What ${SITE.name} collects, why, who processes it, and how to export or delete it.`, alternates: { canonical: "/privacy" } };

const PROCESSORS: [string, string][] = [
  ["Supabase", "sign-in (including your password, stored only as a one-way hash) and the database that stores your account and saved items"],
  ["Vercel", "hosting the site and its server code"],
  ["Stripe", "payments, invoices and the billing portal"],
  ["Resend", "sending sign-in, confirmation and password-reset links, alerts and account emails"],
  ["PostHog", "product analytics, in cookieless mode"],
  ["Sentry", "error reports so we can fix bugs"],
];

export default function Page() {
  const sections: Section[] = [
    {
      id: "collect", title: "What we collect",
      body: <ul>
        <li><strong>Account:</strong> your email address, your password if you set one (Supabase stores only a one-way hash; we never see it), when you accepted the terms, and your Google name if you sign in with Google.</li>
        <li><strong>Settings and saved items:</strong> display settings, saved views, dashboards, your list, alert rules and where alerts go.</li>
        <li><strong>Bet journal:</strong> only the entries you type in yourself.</li>
        <li><strong>Payment status:</strong> your plan, trial and renewal dates from Stripe.</li>
        <li><strong>Usage analytics:</strong> pages viewed and features used, without advertising identifiers.</li>
        <li><strong>Logs:</strong> IP address, browser type and error details, kept for security and debugging.</li>
      </ul>,
    },
    {
      id: "not-collect", title: "What we don't collect",
      body: <ul>
        <li>Card numbers: Stripe handles them and we never see them.</li>
        <li>Wallet keys or exchange passwords.</li>
        <li>Your positions from any venue. We don&apos;t pull them, and we never use your bets to suggest new ones.</li>
      </ul>,
    },
    {
      id: "purposes", title: "Why we use it",
      body: <ul>
        <li>To run your account, save your settings and send the alerts you set up.</li>
        <li>To bill you and apply your plan.</li>
        <li>To keep the service secure, prevent abuse and fix errors.</li>
        <li>To understand which features help, so we can improve them.</li>
      </ul>,
    },
    {
      id: "processors", title: "Who processes it for us",
      body: <>
        <p>We share data only with these service providers, only for the uses listed:</p>
        <ul>{PROCESSORS.map(([n, d]) => <li key={n}><strong>{n}:</strong> {d}.</li>)}</ul>
        <p><strong>We don&apos;t sell or share your personal information</strong> for advertising, as those terms are used in the California Consumer Privacy Act (CCPA).</p>
      </>,
    },
    {
      id: "retention", title: "How long we keep it",
      body: <p>
        We keep account data while your account is open. When you delete your account, your rows and sign-in are
        deleted straight away and your subscription is cancelled. Stripe keeps payment records as the law requires.
        Logs and error reports expire on our providers&apos; rolling schedules and are not kept longer than needed for security and debugging.
      </p>,
    },
    {
      id: "rights", title: "Your rights",
      body: <>
        <p>From your <Link href="/account">account page</Link> you can:</p>
        <ul>
          <li><strong>Access and export</strong> everything we store about you as a JSON file;</li>
          <li><strong>Delete</strong> your account and its data;</li>
          <li>correct your settings and saved items at any time.</li>
        </ul>
        <p>California residents have the right to know, delete and correct, and to not be treated differently for using them. For anything you can&apos;t do yourself, email <SupportEmail />.</p>
      </>,
    },
    {
      id: "cookies", title: "Cookies and local storage",
      body: <>
        <p>We use only cookies the site needs to work:</p>
        <ul>
          <li>sign-in session cookies (secure, not readable by scripts);</li>
          <li>a short-lived cookie that carries your terms acceptance through sign-in;</li>
          <li>on the Free plan, a cookie that counts how many details you&apos;ve opened today;</li>
          <li>a cookie with your time zone (for example America/New_York), so times show in your zone from the first load.</li>
        </ul>
        <p>When you&apos;re signed out, your settings and saved items stay in your browser&apos;s local storage. Analytics run without cookies. We don&apos;t use advertising cookies.</p>
      </>,
    },
    {
      id: "children", title: "Children",
      body: <p>{SITE.name} is not for anyone under {SITE.minAge}. We don&apos;t knowingly collect data from them; if you think we have, email us and we&apos;ll delete it.</p>,
    },
    {
      id: "changes", title: "Changes",
      body: <p>We&apos;ll update the date at the top when this policy changes and tell signed-in users about material changes.</p>,
    },
    {
      id: "contact", title: "Contact",
      body: <p>Privacy questions: <SupportEmail />. {SITE.name} is run by {SITE.operator}.</p>,
    },
  ];
  return <LegalPage title="Privacy policy" intro={<p>What we collect, why, and how to get a copy or delete it. Short version: we keep only what the service needs, we never see your card, and we don&apos;t sell your data.</p>} sections={sections} />;
}
