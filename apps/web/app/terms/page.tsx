// Terms of use (docs/14 §3, T-49). Owner values from config/site.json; empty ones render as [[PLACEHOLDER]].
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, SupportEmail, tradingEnabled, type Section } from "@/components/legal/Legal";
import { usd } from "@/lib/format";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";   // T-295: prerendered + revalidated (lib/static-routes.ts)
export const revalidate = 300;
export const metadata: Metadata = { title: "Terms of use", description: `The terms for using ${SITE.name}, a market analytics service.`, alternates: { canonical: "/terms" } };

export default function Page() {
  const p = SITE.prices;
  const sections: Section[] = [
    {
      id: "service", title: "What the service is",
      body: <>
        <p>
          {SITE.name} is analytics software. It shows prediction-market prices next to win chances estimated from how
          similar past markets settled, after fees and the cost of crossing the spread. It is operated by {SITE.operator},
          {" "}{SITE.operatorType}, in the {SITE.countries} (&ldquo;we&rdquo;).
        </p>
        <p>
          We are <strong>not a broker, exchange or adviser</strong>. Nothing on the site is financial, investment or betting
          advice. The bets are picked the same way for everyone (Free sees fewer, later, as ranges); we never look at your own bets to tell you what to buy. Estimates come
          from past data and can be wrong. Any single bet can lose.
        </p>
        {tradingEnabled()
          ? <p>Order placement is available only where the trading terms below apply.</p>
          : <p>We do not place orders. You decide and bet yourself, on the venue&apos;s own site.</p>}
      </>,
    },
    {
      id: "eligibility", title: "Who can use it",
      body: <p>
        You must be {SITE.minAge} or older and allowed to use prediction markets where you live. Venue availability
        depends on your location; checking that is your responsibility.
      </p>,
    },
    {
      id: "your-part", title: "Your responsibilities",
      body: <ul>
        <li>Follow the rules of any venue you trade on (for example Polymarket or Kalshi). We are not part of those venues.</li>
        <li>Keep your sign-in secure. Accounts are for one person; don&apos;t share them.</li>
        <li>Make your own decisions. You are responsible for every bet you place and for any taxes on it.</li>
      </ul>,
    },
    {
      id: "subscriptions", title: "Plans, trials and renewal",
      body: <>
        <p>
          Free is free. Pro costs {usd(p.pro_monthly)} a month or {usd(p.pro_yearly)} a year; Premium costs {usd(p.premium_monthly)} a
          month or {usd(p.premium_yearly)} a year (US dollars, plus any tax). See <Link href="/pricing">Pricing</Link>.
        </p>
        <p>
          Paid plans start with a 7-day free trial if you haven&apos;t had one before. Unless you cancel before the trial ends,
          your card is charged and the plan <strong>renews automatically</strong> each month or year until you cancel.
          Payments are handled by Stripe.
        </p>
        <p>
          You can cancel any time: open your <Link href="/account">account page</Link> and choose <strong>Manage billing or cancel</strong> (Stripe&apos;s billing page). You keep your plan until the end of the period
          you paid for; it does not renew after that. Refunds follow our <Link href="/refunds">refund policy</Link>.
        </p>
      </>,
    },
    {
      id: "acceptable-use", title: "Acceptable use",
      body: <>
        <p>You may not:</p>
        <ul>
          <li>scrape, crawl or bulk-download the site or its data, or access it by bot or other automated means (our browser extension is allowed);</li>
          <li>resell, republish or redistribute our data or numbers;</li>
          <li>share your account or let others use your plan;</li>
          <li>try to get around plan limits, rate limits or security controls, or disrupt the service.</li>
        </ul>
        <p>We may suspend or close accounts that break these rules.</p>
      </>,
    },
    {
      id: "ip", title: "Our content",
      body: <p>
        The site, the software and our analyses belong to us. We give you a personal, non-transferable licence to use them
        while your account is in good standing. Market names and prices belong to their venues.
      </p>,
    },
    ...(tradingEnabled() ? [{
      id: "trading", title: "Trading terms",
      body: <>
        <p>
          Where order placement is switched on, orders go to Kalshi through your own Kalshi account and API key, using our
          browser extension. Your keys stay in your browser; we never hold your funds.
        </p>
        <ul>
          <li>Every order needs your confirmation. We never place orders on our own, copy trades or trade automatically.</li>
          <li>Prices move. A limit order may not fill, and a filled order can lose all the money you put in.</li>
          <li>Kalshi&apos;s own terms and risk disclosure apply to every order. Read them before you trade.</li>
          <li>Outages, delays or errors in our software, the extension or the venue can affect orders. You are responsible for checking order status on Kalshi.</li>
        </ul>
      </>,
    }] : []),
    {
      id: "disclaimers", title: "No warranty",
      body: <p>
        The service is provided &ldquo;as is&rdquo;. Data can be late, missing or wrong, and past results don&apos;t promise
        future ones. We give no guarantee that any estimate is right or that the site will always be available. Read the
        full <Link href="/disclaimer">disclaimer</Link>.
      </p>,
    },
    {
      id: "liability", title: "Limitation of liability",
      body: <p>
        To the extent the law allows, we are not liable for trading or betting losses, lost profits, or indirect damages.
        Our total liability for any claim is limited to what you paid us in the 12 months before it.
      </p>,
    },
    {
      id: "law", title: "Governing law",
      body: <p>These terms are governed by the laws of the State of {SITE.state}, {SITE.countries}.</p>,
    },
    {
      id: "changes", title: "Changes",
      body: <p>
        We may update these terms. The date at the top shows the latest version. For material changes we will tell
        signed-in users before they take effect. Using the service after that means you accept them.
      </p>,
    },
    {
      id: "contact", title: "Contact",
      body: <p>Questions: <SupportEmail />. More on the <Link href="/contact">contact page</Link>.</p>,
    },
  ];
  return <LegalPage title="Terms of use" intro={<p>The rules for using {SITE.name}, in plain English. By creating an account or using the site you agree to them.</p>} sections={sections} />;
}
