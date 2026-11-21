// Disclaimer and responsible-trading resources (docs/14 §3, T-49).
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type Section } from "@/components/legal/Legal";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";   // T-295: prerendered + revalidated (lib/static-routes.ts)
export const revalidate = 300;

export const metadata: Metadata = { title: "Disclaimer", description: "Market analytics, not financial advice. How to read the numbers, and where to get help.", alternates: { canonical: "/disclaimer" } };

export default function Page() {
  const sections: Section[] = [
    {
      id: "not-advice", title: "Not financial or betting advice",
      body: <p>
        {SITE.name} is market analytics. The bets are picked the same way for everyone, and they don&apos;t take your situation into
        account. Nothing here tells you what you should buy or sell. Decide for yourself, and get professional advice if you need it.
      </p>,
    },
    {
      id: "estimates", title: "Estimates from past data",
      body: <p>
        Win chances and return figures are estimates built from how similar past markets settled. They can be wrong,
        and past results don&apos;t promise future ones. Each estimate shows its sample size and track record one hover away;
        see <Link href="/track-record">Results</Link> for how the method has done.
      </p>,
    },
    {
      id: "loss", title: "You can lose money",
      body: <p>Any single bet can lose, including ones with a high win chance or a good estimated return. Only bet money you can afford to lose.</p>,
    },
    {
      id: "venues", title: "Where you live matters",
      body: <p>
        Whether you can use a venue such as Polymarket or Kalshi depends on where you live. We don&apos;t run those venues and
        can&apos;t make them available to you. Follow their rules and your local law. You must be {SITE.minAge} or older.
      </p>,
    },
    {
      id: "help", title: "If betting stops being fun",
      body: <>
        <p>Set limits before you start, don&apos;t chase losses, and take breaks. Free, confidential help is available any time:</p>
        <ul>
          <li><strong>Call or text 1-800-GAMBLER</strong> (<a href="tel:+18004262537" className="underline underline-offset-[3px]">1-800-426-2537</a>), the U.S. National Problem Gambling Helpline.</li>
          <li><a href="https://www.ncpgambling.org" className="underline underline-offset-[3px]" rel="noopener noreferrer" target="_blank">ncpgambling.org</a>: the National Council on Problem Gambling, with chat and local resources.</li>
        </ul>
      </>,
    },
  ];
  return <LegalPage title="Disclaimer" intro={<p>Market analytics, not financial advice. Based on past results. {SITE.minAge}+.</p>} sections={sections} />;
}
