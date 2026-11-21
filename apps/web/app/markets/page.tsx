import { MarketsScreener } from "@/components/screener/MarketsScreener";
import { firstPage } from "@/lib/data/respond";

export const metadata = { title: "All markets", description: "Every open prediction market with its estimated win chance and estimated return after fees and spread." };

type Search = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const params = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v[0]! : v]])));
  const initial = await firstPage(params, "markets");   // P6: page 1 ships with the HTML; same body as /api/markets
  // no Suspense: see app/bets/page.tsx (a boundary held back the server-rendered rows)
  return <MarketsScreener initial={initial?.main} scannedAt={initial?.scanned_at} />;
}
