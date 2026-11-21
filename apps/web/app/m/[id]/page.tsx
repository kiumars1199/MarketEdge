// Shareable market page (T-25): the drawer's content as a page, server-rendered from the store.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import type { MarketResponse } from "@/lib/api";
import { SlowDown, liveMarketBody, pageBudget, pageStore, pendingLine } from "@/lib/data/respond";
import { PendingState } from "@/components/screener/States";
import { SlowDownState } from "@/components/screener/SlowDownState";
import { betLine, sideRet } from "@/lib/format";
import { MarketDetail } from "@/components/market/MarketDetail";
import { TeaserView } from "@/components/market/Teaser";
import { requestZone } from "@/lib/zone-server";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { topicCrumb } from "@/components/market/labels";
import { authEnabled, getUser } from "@/lib/auth/server";
import { TEASER_DESCRIPTION, marketTeaser } from "@/lib/teaser";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ side?: string }> };

// T-44: same tier shaping as /api/markets/[id]; RT3-02: same rate limit, plus the Free row budget. cache(): the
// metadata and the page share one load (one count) per request.
const load = cache(async (id: string): Promise<MarketResponse | null> => {
  const ctx = await pageStore();
  const m = ctx.store.flagsById.get(id) ?? ctx.store.byId.get(id);
  if (!m) return null;
  await pageBudget(ctx, [m.id]);
  return liveMarketBody(ctx.store, m, ctx.tier);
});

// T-276: signed out (with accounts on), the page is a teaser: title, category, closing time, sign up. No model output.
const teaser = cache(async () => authEnabled() && !(await getUser()));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (await teaser()) {
    const t = await marketTeaser((await params).id).catch(() => null);
    return t ? { title: t.title, description: TEASER_DESCRIPTION } : { title: "Market" };
  }
  let data: MarketResponse | null;
  try {
    data = await load((await params).id);
  } catch (e) {
    return e instanceof SlowDown ? { title: "Market", robots: { index: false } } : { title: "Market" };   // RT3-02: never index the slow-down state
  }
  if (!data) return { title: "Market" };
  const m = data.market;
  return { title: m.question, description: `${betLine(m.best)} · ${sideRet(m.best)} estimated return, based on past results. Market analytics, not financial advice.` };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ id }, { side }] = await Promise.all([params, searchParams]);
  if (await teaser()) {
    let t: Awaited<ReturnType<typeof marketTeaser>>;
    try {
      t = await marketTeaser(id);
    } catch (e) {
      return <div className="mx-auto w-full max-w-[720px]"><PendingState line={pendingLine(e)} /></div>;   // no store yet is not a missing page
    }
    if (!t) notFound();
    return <TeaserView t={t} path={`/m/${encodeURIComponent(id)}`} zone={await requestZone()} />;
  }
  let data: MarketResponse | null;
  try {
    data = await load(id);
  } catch (e) {
    if (e instanceof SlowDown) return <div className="mx-auto w-full max-w-[720px]"><SlowDownState /></div>;
    return <div className="mx-auto w-full max-w-[720px]"><PendingState line={pendingLine(e)} /></div>;   // a missing store is not a missing market
  }
  if (!data) notFound();
  const m = data.market;
  return (
    <div className="mx-auto w-full max-w-[720px]">
      <Breadcrumbs className="mb-3" items={[{ label: "Best bets", href: "/bets" }, topicCrumb(m), ...(m.event && m.event !== m.question ? [{ label: m.event, href: `/event/${encodeURIComponent(m.event_id)}` }] : []), { label: m.question }]} />
      <Suspense>
        <MarketDetail id={id} side={side === "0" ? 0 : side === "1" ? 1 : undefined} initial={data} />
      </Suspense>
    </div>
  );
}
