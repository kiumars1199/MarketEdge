import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { SlowDown, eventBody, pageBudget, pageStore, pendingLine } from "@/lib/data/respond";
import { PendingState } from "@/components/screener/States";
import { SlowDownState } from "@/components/screener/SlowDownState";
import { EventView } from "@/components/screener/EventView";
import { TeaserView } from "@/components/market/Teaser";
import { requestZone } from "@/lib/zone-server";
import { authEnabled, getUser } from "@/lib/auth/server";
import { TEASER_DESCRIPTION, eventTeaser } from "@/lib/teaser";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

// RT3-02: the /api/events/[id] rate limit plus the Free row budget; cache(): metadata and page count once per request.
const load = cache(async (id: string) => {
  const ctx = await pageStore();
  const markets = ctx.store.byEvent.get(id);
  const ev = markets ? eventBody(ctx.store, markets, ctx.tier) : null;
  if (ev) await pageBudget(ctx, ev.markets.map((m) => m.id));
  return ev;
});

// T-276: signed out (with accounts on), a teaser: title, category, closing time, sign up. No model output.
const teaser = cache(async () => authEnabled() && !(await getUser()));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (await teaser()) {
    const t = await eventTeaser((await params).id).catch(() => null);
    return t ? { title: t.title, description: TEASER_DESCRIPTION } : { title: "Event" };
  }
  try {
    return { title: (await load((await params).id))?.event ?? "Event" };
  } catch (e) {
    return e instanceof SlowDown ? { title: "Event", robots: { index: false } } : { title: "Event" };   // RT3-02: never index the slow-down state
  }
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  if (await teaser()) {
    let t: Awaited<ReturnType<typeof eventTeaser>>;
    try {
      t = await eventTeaser(id);
    } catch (e) {
      return <div className="mx-auto w-full max-w-[720px]"><PendingState line={pendingLine(e)} /></div>;   // no store yet is not a missing page
    }
    if (!t) notFound();
    return <TeaserView t={t} path={`/event/${encodeURIComponent(id)}`} zone={await requestZone()} />;
  }
  let ev: Awaited<ReturnType<typeof load>>;
  try {
    ev = await load(id);
  } catch (e) {
    if (e instanceof SlowDown) return <div className="mx-auto w-full max-w-[720px]"><SlowDownState /></div>;
    return <div className="mx-auto w-full max-w-[720px]"><PendingState line={pendingLine(e)} /></div>;   // a missing store is not a missing event
  }
  if (!ev) notFound();
  return (
    <Suspense>
      <EventView ev={ev} />
    </Suspense>
  );
}
