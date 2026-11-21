"use client";

// Market detail (F-04): drawer body and the shareable /m/[id] page. Live price check from /api/book every 5 s.
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { softNav } from "@/lib/softNav";
import { useEffect, useRef, useState } from "react";
import { fetchBook, fetchMarket, type BookResponse, type MarketResponse } from "@/lib/api";
import { useWhen } from "./When";
import { ago, basis, edge, money, pct, points, price, ret, sideEdge, formatCount, LONG_SHOT_LINE } from "@/lib/format";
import { betFigures, betQuote, edgeAbove0, PTS_HELP, RETURN_HELP_ONE, RETURN_LABEL_LONG, RETURNS_FAQ } from "@/lib/betFigures";
import { useProfile } from "@/lib/repo/hooks";
import { useEntitlements } from "@/lib/entitlements";
import type { Execution, Side, StoreMarket } from "@/lib/types";
import { WatchStar } from "@/components/watch/WatchStar";
import { DrawerExtras } from "./DrawerExtras";
// Recharts (~390 KB) loads only when a drawer opens, not with Best bets; the placeholder keeps the chart's height.
const CurveChart = dynamic(() => import("./CurveChart").then((m) => m.CurveChart), { ssr: false, loading: () => <div className="h-[236px]" /> });
import { InfoTip, OddsBars, Skeleton, Val } from "./bits";
import { VERDICT_LABEL, VERDICT_TONE, chanceTone, returnTone, topicLabel } from "./labels";
import { LowerConfidence, TierNote } from "./TierNote";
import { AddToCombo } from "@/components/combo/AddToCombo";
import { drawerHref } from "./drawer";
import { TradeButton, VenueLink } from "@/components/trade/TradeButton";
import { VenueButton, primaryVenue } from "@/components/trade/VenueButton";
import { INTL_ONLY, NOT_FOR_US, STAKE, US_SMALL_PRINT } from "@/lib/card";
import { Count } from "@/components/kit";
import { ProofLine } from "@/components/results/ProofLine";

const card = "rounded-inner border border-border bg-raised p-4";
const LEVEL = { all: "all markets", cat: "category", niche: "niche", nmt: "niche + type" } as const;

/** Loads the market (unless given) and renders the detail. `onClose` = drawer mode. */
export function MarketDetail({ id, side, initial, onClose }: { id: string; side?: 0 | 1; initial?: MarketResponse; onClose?: () => void }) {
  const [res, setRes] = useState<{ id: string; data?: MarketResponse; error?: boolean }>(initial ? { id, data: initial } : { id: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (initial && initial.market.id === id) return;
    const ac = new AbortController();
    setRes({ id });
    fetchMarket(id, { signal: ac.signal }, true)
      .then((data) => setRes({ id, data }))
      .catch(() => !ac.signal.aborted && setRes({ id, error: true }));
    return () => ac.abort();
  }, [id, initial, retry]);

  const data = res.id === id ? res.data : undefined;
  if (res.id === id && res.error)
    return (
      <Frame onClose={onClose}>
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="font-semibold">Couldn&apos;t load this market.</p>
          <p className="text-sm text-muted">It may have closed since the last scan, or the data server didn&apos;t answer.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="min-h-11 rounded-input bg-accent px-4 font-semibold text-on-accent">Try again</button>
            <Link href="/status" className="flex min-h-11 items-center rounded-input border border-border px-4">Data status</Link>
          </div>
        </div>
      </Frame>
    );
  if (!data)
    return (
      <Frame onClose={onClose}>
        <div aria-busy="true" aria-label="Loading market" className="flex flex-col gap-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-14" />
          <Skeleton className="h-36 rounded-inner" />
          <Skeleton className="h-40 rounded-inner" />
          <Skeleton className="h-48 rounded-inner" />
        </div>
      </Frame>
    );
  return <Detail data={data} side={side} onClose={onClose} />;
}

function Frame({ onClose, children, title }: { onClose?: () => void; children: React.ReactNode; title?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      {onClose && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" data-autofocus className="flex size-11 flex-none items-center justify-center rounded-input bg-muted-bg text-muted hover:text-text">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}
      {!onClose && title}
      {children}
    </div>
  );
}

type Live = { book?: BookResponse; error?: boolean };
function useLiveBook(m: StoreMarket, s: Side, stake?: number): Live {
  const [live, setLive] = useState<Live>({});
  useEffect(() => {
    setLive({});
    let stop = false;
    const ac = new AbortController();
    const load = () =>
      fetchBook({ token: m.tokens[s.side_index], q: s.win_prob, cat: m.category, stake }, { signal: ac.signal })
        .then((book) => !stop && setLive({ book }))
        .catch(() => !stop && !ac.signal.aborted && setLive((l) => ({ book: l.book, error: true })));
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 5000);
    return () => {
      stop = true;
      ac.abort();
      clearInterval(t);
    };
  }, [m.tokens, m.category, s.side_index, s.win_prob, stake]);
  return live;
}

function Detail({ data, side: sideParam, onClose }: { data: MarketResponse; side?: 0 | 1; onClose?: () => void }) {
  const m = data.market;
  const when = useWhen(m.closes_at);
  const s = m.sides.find((x) => x.side_index === sideParam) ?? m.best;
  const other = m.sides.find((x) => x !== s);
  const profile = useProfile();
  const pro = profile.numbers_mode === "pro";
  const ent = useEntitlements();
  const free = ent.known && ent.tier === "free";   // the Free plan limits this drawer: say so, with a way up (QA-A #40: never on the guess before /api/me answers)
  // P9: say how many exact looks are left today instead of restating the rule (the server counts them: reveals_left)
  const looks = ent.quota("flags_revealed");
  const left = data.reveals_left;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [stake, setStake] = useState<number | undefined>();
  const live = useLiveBook(m, s, stake);

  // live check; scan-time fallback only for the side it was computed for
  const scanX = s.side_index === m.best.side_index ? m.execution : undefined;
  const liveX = live.book && live.book.book_ok ? (live.book as Execution & { warning?: string }) : undefined;
  const x: Execution | undefined = liveX ?? (live.book ? undefined : scanX);
  const bookState = live.book && !live.book.book_ok ? live.book.verdict : undefined;
  // T-289: the headline's figures come from the same helper as the cards, at the live price once the book answers
  // QA-B #37/#54: the card's price (the US price on a US card; the live international book only moves an international
  // card), its one payout (after the fee) and the cards' $10 stake, so headline, card and "If you bet" box agree
  const f = betFigures(s, { market: m, ask: liveX?.best_ask, fee: liveX?.fee_at_ask ?? undefined, stake: STAKE });
  const c = f.chance;

  const pickSide = (i: 0 | 1) => (onClose ? softNav(pathname + drawerHref(m.id, i, params), { replace: true }) : router.replace(`${pathname}?side=${i}`, { scroll: false }));
  const H = onClose ? "h2" : "h1";

  return (
    <Frame
      onClose={onClose}
      title={
        <div>
          {/* page mode (no onClose): the breadcrumbs above already name the topic and the game */}
          <div className="text-xs text-muted">{onClose && <>{topicLabel(m)} · </>}<span title={when.full} suppressHydrationWarning>{when.game}</span> · <span suppressHydrationWarning>{when.closes}</span></div>
          <H className="mt-1.5 text-[22px] font-semibold leading-tight">{m.question}</H>
          {onClose && m.event !== m.question && <Link href={`/event/${m.event_id}`} className="mt-1 inline-block text-[13px] text-accent-hover hover:text-accent-soft">{m.event}</Link>}
        </div>
      }
    >
      <Actions m={m} s={s} />

      <section aria-label="Headline" className="rounded-inner border border-accent-border bg-accent-bg p-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LiveBet s={s} pays={f.pays} ask={f.quote.venue === "us" ? undefined : liveX?.best_ask} />
          {m.tier === "edge" && <LowerConfidence />}
        </div>
        <p data-testid="one-bet" className="mt-2 font-heading text-[26px] font-bold leading-tight text-text" title={basis(m, s)}>
          <span title={f.feeHelp}>Pays {f.pays}</span> <span className="font-sans text-base font-medium text-accent-soft">after the fee · <span className="whitespace-nowrap" title={`Won ${f.winPct} of the time in similar past bets`}>wins about {f.wins}</span></span>
        </p>
        <p data-testid="verdict" className={`text-[13px] ${f.verdict.tone === "up" ? "text-accent-softer" : VERDICT_TONE[f.verdict.tone]}`}>{f.verdict.text} <span className="font-semibold" title={PTS_HELP}>({f.pts})</span></p>
        {s.win_prob < 0.25 && <p data-testid="long-shot-line" className="mt-2 text-[13px] leading-relaxed text-text">{edgeAbove0(s) ? LONG_SHOT_LINE : "Most of the time this loses."}</p>}
        <div className="mt-2 flex items-baseline gap-2.5">
          <div data-testid="bet-return" className={`font-heading text-[30px] font-bold leading-none tracking-tight ${(f.ret.roi ?? 0) >= 0 ? "text-accent-soft" : "text-negative"}`} title={f.quote.math ?? basis(m, s)}>
            {f.ret.text}
          </div>
          <div className="flex items-center gap-1 text-[13px] text-accent-soft">
            {RETURN_LABEL_LONG}{pro && <span className="text-accent-softer">· edge {sideEdge(s)} per share</span>}<InfoTip text={RETURN_HELP_ONE} className="text-accent-softer" />
          </div>
        </div>
        <p className={`mt-1.5 text-[13px] ${chanceTone(c)}`}>{c ?? ""}{c && " · "}<span data-testid="payout" className="text-accent-soft" title={f.feeHelp}>Bet {f.stakeText} → get {f.payoutText} back if it wins</span></p>
        {m.tier === "edge" && <TierNote s={s} className="mt-1.5 !text-accent-soft" />}
        {free && (
          <p data-testid="upgrade-note" className="mt-3 border-t border-accent-border pt-3 text-[13px] text-accent-softer">
            {s.ranges
              ? left === 0
                ? `You've used today's ${looks} exact looks, so this shows ranges. Pro shows exact numbers and the full price check on every bet.`
                : "Free shows ranges. Exact numbers and the full price check are on Pro."
              : left !== undefined
                ? `Exact numbers on this bet. Free has ${left} of ${looks} exact looks left today; Pro shows them on every bet.`
                : `Free shows exact numbers on ${looks} bets a day. Pro shows them on every bet.`}{" "}
            <Link href="/pricing" className="font-semibold text-accent-soft underline underline-offset-4 hover:text-accent">See plans</Link>
          </p>
        )}
      </section>

      {other && (
        <div role="group" aria-label="Both sides" className="grid grid-cols-2 gap-2">
          {[...m.sides].map((x) => {
            const on = x === s;
            const xq = betQuote(m, x);   // the same payout and return the card would show for this side
            return (
              <button key={x.side_index} type="button" aria-pressed={on} onClick={() => pickSide(x.side_index)}
                className={`flex min-h-11 flex-col rounded-input border p-3 text-left ${on ? "border-accent-border bg-accent-bg/60" : "border-border bg-raised hover:border-accent-border"}`}>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                  <span className="min-w-0 break-words font-semibold leading-snug sm:truncate">{x.outcome}</span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">pays {xq.paysText ?? "—"}</span>
                </div>
                <div className="mt-1 flex flex-wrap justify-between gap-x-2 whitespace-nowrap text-xs text-muted">
                  <span title={basis(m, x)}>won {pct(x.win_prob)} before</span>
                  {/* docs/17 fix 11: no scary negative return on the other side; just say so */}
                  {x.ranges || (xq.roi ?? 0) >= 0
                    ? <span className={returnTone(xq.roi)}>{xq.retText}</span>
                    : <span>Not recommended</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <section className={card} aria-labelledby="why">
        <h3 id="why" className="mb-3 font-sans text-sm font-semibold">{edgeAbove0(s) ? "Why it's a good price" : "How the price compares"}</h3>
        <OddsBars big market={s.ask} won={s.win_prob} labels={["Market's odds", "How often similar bets won"]} basis={basis(m, s)} />
        <p className="mt-3 text-[13px] leading-relaxed text-soft">
          Based on <Count n={s.model_events} /> past {topicLabel(m)} events ({m.market_type}, about {m.horizon_h} h before close
          {s.model_level === "all" || s.model_level === "cat" ? `, using all ${LEVEL[s.model_level]}` : ""}). Bets like this priced at {price(s.ask)} won {pct(s.win_prob)} of the time
          {s.win_prob_low > 0 ? `; a cautious estimate is ${pct(s.win_prob_low)}` : ""}.
        </p>
        {data.curve && <div className="mt-3"><CurveChart curve={data.curve} ask={s.ask} winProb={s.win_prob} /></div>}
      </section>

      <StakeSection x={x} live={!!liveX} fetchedAt={live.book?.fetched_at} error={live.error} bookState={bookState} scanAt={scanX && !liveX ? true : false} onStake={setStake} stake={stake} />

      <TrackRecord data={data} pro={pro} />
      <Warnings m={m} s={s} x={x} />

      <details className={`${card} text-[13px] text-soft`}>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-text">Details for pros</summary>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
          {([
            ["Ask", price(x?.best_ask ?? s.ask)], ["Mid", price(x?.book_mid ?? s.mid)],
            ["Spread", price(x?.spread ?? m.spread)], ["Fee", price(x?.fee_at_ask ?? s.fee)],
            ["Edge", edge(x?.net_edge ?? s.edge)], ["Cautious edge", edge(s.edge_low)],
            ["Edge kept after spread", pct(x?.retention)], ["Win chance range", `${pct(s.win_prob_low)}–${pct(s.win_prob)}`],
            ["Model level", LEVEL[s.model_level] ?? s.model_level], ["Samples", `${formatCount(s.model_neff)} eff. · ${formatCount(s.model_events)} events`],
          ] as const).map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="m-0 text-right"><Val v={v} /></dd></div>
          ))}
        </dl>
        {x && x.limit_price != null && x.limit_edge != null && x.limit_price > 0 && (
          <p className="mt-3 leading-relaxed">Prefer a limit order? At {price(x.limit_price)} your edge would be {edge(x.limit_edge)} per share, but it may not fill.</p>
        )}
        <p className="mt-2 text-xs text-muted">{basis(m, s)}</p>
      </details>

      <DrawerExtras market={m} side={s.side_index} />

      {data.event_markets.length > 0 && (
        <section aria-labelledby="others">
          <h3 id="others" className="mb-2 font-sans text-sm font-semibold">Other markets in this event</h3>
          <ul className="flex flex-col">
            {data.event_markets.slice(0, 8).map((o) => (
              <li key={o.id}>
                <Link href={onClose ? drawerHref(o.id, undefined, params) : `/m/${o.id}`} replace={!!onClose} scroll={!onClose}
                  className="flex min-h-11 items-center justify-between gap-3 border-t border-border py-2 text-[13px] hover:text-accent-hover">
                  <span className="line-clamp-2">{o.question}</span>
                  <span className={`flex-none tabular-nums ${returnTone(betQuote(o, o.best).roi)}`}>{betQuote(o, o.best).retText}</span>
                </Link>
              </li>
            ))}
          </ul>
          {data.event_markets.length > 8 && <Link href={`/event/${m.event_id}`} className="mt-2 inline-block text-[13px] text-accent-hover">All {formatCount(data.event_markets.length + 1)} markets in this event</Link>}
        </section>
      )}
    </Frame>
  );
}

/** "Bet Yes · pays 1.43x" with the live price; the number briefly highlights when the live book moves it (docs/17). */
function LiveBet({ s, pays, ask }: { s: Side; pays: string; ask?: number }) {
  const prev = useRef(ask);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (ask !== undefined && prev.current !== undefined && ask !== prev.current) setPulse((n) => n + 1);
    prev.current = ask;
  }, [ask]);
  return (
    <div className="text-[13px] text-accent-softer">
      Bet <strong className="font-semibold text-accent-soft">{s.outcome}</strong> · pays{" "}
      <span key={pulse} data-testid="live-price" className={`rounded px-0.5 tabular-nums text-accent-soft ${pulse ? "price-pulse" : ""}`}>{pays}</span>
      {ask !== undefined && <span className="text-accent-softer"> live</span>}
    </div>
  );
}

function Actions({ m, s }: { m: StoreMarket; s: Side }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/m/${m.id}${s.side_index !== m.best.side_index ? `?side=${s.side_index}` : ""}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  // docs/17 fix 10: the venue button gets its own full-width row; the rest sit under it as one even row
  const box = "items-center justify-center rounded-input border border-border bg-muted-bg text-text hover:border-accent-border";
  const btn = `flex min-h-11 flex-1 gap-1.5 whitespace-nowrap px-2.5 text-[13px] sm:px-3 ${box}`;   // px-2.5 on phones keeps the row on one line at 390 px
  const icon = `flex size-11 flex-none ${box}`;   // no px-3: conflicting padding classes made the star box 70 px
  return (
    <div className="flex flex-col gap-2">
      {/* T-302 (§G1/§F1): same rule as the card. US-listed → Polymarket US; us === null → International only, with the
          international link kept as a plain secondary link that says US residents can't use it. Old scans (no `us`) unchanged. */}
      {m.us === undefined
        ? <VenueLink m={m} className="flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-input bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover" />
        : primaryVenue(m, s)
          ? <div className="flex flex-col gap-1">
              <VenueButton m={m} s={s} className="w-full" />
              {m.us && m.us.ask != null && <p data-testid="us-price" className="text-center text-xs text-muted">Pays {betQuote(m, m.best).paysText} on Polymarket US · {US_SMALL_PRINT}</p>}
            </div>
          : <div className="flex flex-col gap-1">
              <p data-testid="intl-only" className="flex min-h-11 items-center justify-center rounded-input border border-border bg-raised/60 px-3 text-center text-xs text-muted">{INTL_ONLY}</p>
              <VenueLink m={m} className="inline-flex min-h-11 items-center justify-center gap-1.5 text-xs text-muted underline underline-offset-2 hover:text-text" />
              <p className="text-center text-xs text-muted">{NOT_FOR_US}</p>
            </div>}
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        <TradeButton m={m} s={s} className={btn} />
        <AddToCombo m={m} s={s} className={btn} />
        <div className={`flex flex-none ${box}`}><WatchStar marketId={m.id} side={s.side_index} market={m} tipAlign="left" /></div>
        <Link href={`/alerts?market=${m.id}&side=${s.side_index}`} className={btn}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
          {/* "me" drops visually under 400 px so the four controls stay on one row; the name stays "Alert me" */}
          Alert<span className="max-[399px]:sr-only"> me</span>
        </Link>
        <button type="button" onClick={share} className={icon} aria-label={copied ? "Link copied" : "Copy a link to share"} title={copied ? "Link copied" : "Copy a link to share"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {copied ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>}
          </svg>
          <span role="status" className="sr-only">{copied ? "Link copied" : ""}</span>
        </button>
      </div>
    </div>
  );
}

function StakeSection({ x, live, fetchedAt, error, bookState, scanAt, stake, onStake }: {
  x?: Execution; live: boolean; fetchedAt?: number; error?: boolean; bookState?: string; scanAt: boolean; stake?: number; onStake: (n: number | undefined) => void;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const v = x?.verdict;
  const check =
    bookState ? <span className="text-warning">{VERDICT_LABEL[bookState as keyof typeof VERDICT_LABEL] ?? bookState}</span>
    : !x ? <span className="text-muted">{error ? "Live price unavailable" : "Checking the live price…"}</span>
    : v === "worth it" && (x.capacity_usd == null || x.capacity_usd >= 100) ? <span className="text-accent">Price check ✓ fair fill</span>
    : v === "worth it" && x.capacity_usd != null ? <span className="text-warning">Only ~{money(Math.round(x.capacity_usd))} available at this price</span>
    : <span className={v === "thin" ? "text-warning" : "text-negative"}>{VERDICT_LABEL[v!]}</span>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(text);
    onStake(Number.isFinite(n) && n > 0 && n <= 1e6 ? Math.round(n * 100) / 100 : undefined);
  };

  return (
    <section className={card} aria-labelledby="betnow">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 id="betnow" className="font-sans text-sm font-semibold">If you bet now</h3>
        <span className="text-xs" aria-live="polite">{check}</span>
      </div>
      {x && x.stakes.length > 0 ? (
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="whitespace-nowrap py-1 pr-2 font-medium">You bet</th>
              <th scope="col" className="font-medium">You get back if it wins</th>
              <th scope="col" className="text-right font-medium" title="The model's own estimate at the price this stake fills at, before any correction from how similar past bets did. The headline's estimated return is the one to compare bets by.">Model&apos;s est. profit</th>
            </tr>
          </thead>
          <tbody>
            {x.stakes.map((r) => (
              <tr key={r.stake_usd} className={r.stake_usd === stake ? "text-accent-soft" : ""}>
                <td className="py-1.5 pr-2">{money(r.stake_usd)}{r.filled_usd < r.stake_usd - 0.01 && <span className="block text-xs text-warning">only {money(r.filled_usd)} fills</span>}</td>
                <td>{money(r.shares)}</td>
                <td className={`text-right ${r.expected_profit_usd >= 0 ? "text-accent" : "text-negative"}`}>{money(r.expected_profit_usd, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[13px] text-muted">{bookState ? "Nobody is selling this side right now, so there is no price to fill at." : error ? "The live order book didn't answer. The numbers above are from the last scan." : "Loading the live order book…"}</p>
      )}
      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
          Your own stake
          <span className="flex items-center rounded-[10px] border border-border bg-input focus-within:border-accent">
            <span className="pl-2.5 text-muted" aria-hidden="true">$</span>
            <input ref={input} type="number" inputMode="decimal" min={1} step="any" value={text} onChange={(e) => setText(e.target.value)} placeholder="250"
              className="min-h-10 w-full bg-transparent px-2 tabular-nums text-text placeholder:text-muted focus:outline-none" />
          </span>
        </label>
        <button type="submit" className="min-h-11 rounded-input border border-accent-border bg-accent-bg px-4 text-accent-soft hover:border-accent">Check</button>
      </form>
      {x && x.capacity_usd != null && x.capacity_usd > 0 && (
        <p className="mt-2.5 text-xs text-muted">The good price holds for bets up to about {money(Math.round(x.capacity_usd))}.</p>
      )}
      <p className="mt-1 text-xs text-muted">
        {live && fetchedAt ? `Live order book, checked ${ago(fetchedAt / 1000)}. Refreshes every 5 s.` : scanAt ? "From the last scan; live book unavailable." : ""}
      </p>
    </section>
  );
}

function TrackRecord({ data, pro }: { data: MarketResponse; pro: boolean }) {
  const m = data.market;
  const b = data.backtest;
  const cat = m.category;
  return (
    <section className={card} aria-labelledby="record">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="record" className="font-sans text-sm font-semibold">Track record</h3>
        {m.validated ? (
          <span className="rounded-full border border-accent-border bg-accent-bg px-2.5 py-0.5 text-xs text-accent-soft">Tested on past data</span>
        ) : (
          <span className="rounded-full bg-muted-bg px-2.5 py-0.5 text-xs text-warning">Not validated</span>
        )}
      </div>
      {b ? (
        <p data-testid="tested-line" className="text-[13px] leading-relaxed text-soft" title={data.proof?.help}>
          <strong className="font-semibold text-text">How bets like this did in testing:</strong> in our walk-forward test, <Count n={b.flags} /> past {cat} best bets
          {b.win_rate !== undefined ? ` won ${pct(b.win_rate)} of the time` : ""}
          {b.roi_pct !== undefined ? ` and returned ${ret(b.roi_pct)} on average` : ""}
          {b.events !== undefined && <>, across <Count n={b.events} /> events</>}.
          {pro && b.t_stat !== undefined && <span className="text-muted" title="t-statistic: how far the result is from luck"> (t = {b.t_stat.toFixed(1)})</span>}
        </p>
      ) : (
        <p className="text-[13px] text-muted" title="not available">No past test covers {cat} markets yet.</p>
      )}
      {b && data.proof ? <ProofLine p={data.proof} liveOnly testId="drawer-live" className="mt-1.5 text-[13px] leading-relaxed text-soft" /> : null}
      {b && <p className="mt-2 text-xs text-muted">
        That is the whole {cat} group, so it differs from this bet&apos;s {RETURN_LABEL_LONG} above.{" "}
        <Link href={RETURNS_FAQ} className="text-accent-hover underline underline-offset-4">Why two numbers?</Link>
      </p>}
      {!m.validated && <p className="mt-2 text-[13px] text-warning">This kind of bet hasn&apos;t made money in testing yet. Treat the numbers as a rough guide.</p>}
    </section>
  );
}

function Warnings({ m, s, x }: { m: StoreMarket; s: Side; x?: Execution }) {
  const w: string[] = [];
  if (x && x.spread >= 0.05) w.push(`Wide spread: buyers and sellers are ${points(x.spread)} apart, so the price can move against you.`);
  if (x && x.verdict !== "not worth it" && x.capacity_usd != null && x.capacity_usd < 100) w.push(`Thin order book: only about ${money(Math.round(x.capacity_usd))} can be bought at a good price.`);
  if (s.edge >= 0.15) w.push("Higher risk: estimates this high have usually been too optimistic. In testing, bets that looked this good earned far less than shown. Bet small.");
  if (s.model_events < 50) w.push(`Small evidence: only ${formatCount(s.model_events)} past events like this.`);
  if (s.model_level === "all" || s.model_level === "cat")
    w.push(`Few markets like this one, so the estimate leans on ${s.model_level === "all" ? "all markets" : `all ${m.category} markets`}.`);
  if (!w.length) return null;
  return (
    <section aria-label="Warnings" className="rounded-inner border border-warning/30 bg-warning/5 p-4">
      <ul className="flex flex-col gap-1.5 text-[13px] text-soft">
        {w.map((t) => (
          <li key={t} className="flex gap-2"><span aria-hidden="true" className="mt-1.5 size-1.5 flex-none rounded-full bg-warning" />{t}</li>
        ))}
      </ul>
    </section>
  );
}

