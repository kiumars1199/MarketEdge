// Kalshi markets + Kalshi Combos (docs/03 § kalshi.json). Live for every signed-in plan (owner decision, Nov 21) once
// KALSHI_DATA_PERMISSION=true (docs/16 §2); without it the page 404s. Signed out: the account wall sends people to
// sign-up first (lib/auth/public-paths). No kalshi.json yet: an empty state, not a 404. Not indexed (robots.ts).
import { notFound } from "next/navigation";
import { KalshiBoard } from "@/components/kalshi/KalshiBoard";
import { getMe } from "@/lib/auth/server";
import { canBeta } from "@/lib/beta";
import { getKalshi } from "@/lib/data/store";

export const metadata = { title: "Kalshi markets", description: "Kalshi prices, volume and combos, credited to Kalshi.", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Page() {
  if (!canBeta(await getMe(), "kalshi")) notFound();
  const data = await getKalshi();
  if (!data)
    return (
      <section className="mx-auto w-full max-w-[1200px]">
        <h1 className="text-2xl font-bold">Kalshi markets</h1>
        <p className="mt-2 text-sm text-muted">No Kalshi data yet. It appears here after the next scan.</p>
      </section>
    );
  return <KalshiBoard data={data} />;
}
