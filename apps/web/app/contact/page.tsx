// Contact (docs/14 §3, T-49): support email, response time, mailing address if provided.
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, SupportEmail, type Section } from "@/components/legal/Legal";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";   // T-295: prerendered + revalidated (lib/static-routes.ts)
export const revalidate = 300;

export const metadata: Metadata = { title: "Contact", description: `How to reach the people behind ${SITE.name}.`, alternates: { canonical: "/contact" } };

export default function Page() {
  const sections: Section[] = [
    { id: "email", title: "Email", body: <p><SupportEmail />. We reply within {SITE.responseTime}.</p> },
    {
      id: "billing", title: "Billing",
      body: <p>Change or cancel your plan yourself from your <Link href="/account">account page</Link>. For refunds, see the <Link href="/refunds">refund policy</Link>.</p>,
    },
    ...(SITE.address ? [{ id: "mail", title: "Mailing address", body: <address className="not-italic whitespace-pre-line">{SITE.address}</address> }] : []),
  ];
  return <LegalPage title="Contact" intro={<p>{SITE.name} is run by {SITE.operator}. Questions, bugs and billing problems all go to the same inbox.</p>} sections={sections} />;
}
