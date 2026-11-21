// Results (T-26, F-14, F-29; T-296 plain words): the live forward record (ledger_summary.json) and the walk-forward
// backtest (backtest.json, chosen half-life) side by side, then model calibration (model.json). Every figure is read,
// never invented. Each section leads with one headline and one sentence; t-stats, cents per share and full tables
// sit in a "Details" expand. Charts stay in ./Charts (client, lazy-loadable on their own).
import { Tiles } from "@/components/results/Tiles";
import { Count } from "@/components/kit";
import { chosenResult, coarseCurve, curve } from "@/lib/data/model";
import { getTier } from "@/lib/auth/server";
import { can } from "@/lib/entitlements";
import { getResults } from "@/lib/data/top";
import { ProofLine } from "@/components/results/ProofLine";
import {
  biggestGroup, compareSentence, intlOnlyNote, liveHeadline, paysHeadline, ratedHigher, samePayoutHeadline, samePayoutRows,
  testHeadline, usHeadline, weeksHeadline, type Headline,
} from "@/components/results/summary";
import { liveBase, liveReturn, siteProof, sinceDay, testSpan, testWeeks, usEvents } from "@/lib/proof";
import { DASH, edge, exactCount, formatCount, pct, ret } from "@/lib/format";
import { TAXONOMY } from "@/lib/taxonomy";
import { PAYS_READ_TEXT, bucketRows, foldRows, paysRows, recordRows, tiles } from "@/lib/trackRecord";
import type { BacktestRecord, LedgerSummary } from "@/lib/types";
import type { CalibrationSet } from "./Charts";
import { CalibrationChart, EdgeChart, FoldCharts } from "./LazyCharts";

export const metadata = { title: "Results", description: "How Kismet best bets have done: the live record of real bets next to a week-by-week test on past markets.", alternates: { canonical: "/track-record" } };
export const dynamic = "force-static";   // T-295: prerendered + revalidated (lib/static-routes.ts); signed in: app/signed-in/*
export const revalidate = 300;

const DATE = { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } as const;
const date = (unix: unknown) => (typeof unix === "number" ? new Date(unix * 1000).toLocaleDateString("en-US", DATE) : DASH);
const label = (cat: string) => TAXONOMY[cat]?.label ?? cat;
const H_NAME: Record<string, string> = { "1": "~1 hour", "6": "~6 hours", "24": "~1 day", "72": "~3 days", "168": "~1 week" };

export default async function Page() {
  const [store, tier] = await Promise.all([getResults(), getTier()]);
  const exact = can(tier, "exact_edge");   // RT3-01: Free / signed-out see the curves rounded to their band width
  const b = store.backtest;
  const r = chosenResult(b);
  const folds = foldRows(b);
  const buckets = bucketRows(b);
  const cats = recordRows(r?.by_category).map((x) => ({ ...x, name: label(x.key) }));
  const horizons = recordRows(r?.by_horizon).sort((x, y) => Number(x.key) - Number(y.key)).map((x) => ({ ...x, name: H_NAME[x.key] ?? `${x.key} h` }));

  const calCats = ["all", ...((store.model.vocab as { cat?: string[] } | undefined)?.cat ?? [])];
  const sets: Record<string, CalibrationSet> = Object.fromEntries(calCats.map((c) => [c, {
    label: c === "all" ? "All categories" : label(c),
    byH: Object.fromEntries(Object.keys(H_NAME).map((h) => {
      const cv = curve(store.model, c === "all" ? "all" : `cat:${c}`, Number(h));
      return [h, cv ? { points: (exact ? cv : coarseCurve(cv)).points, events: cv.events } : null];
    })),
  }]));

  const ledger = store.ledgerSummary;
  const since = store.ledgerSince ?? null;
  const proof = siteProof({ backtest: b, ledger, since });
  const tw = testWeeks(b);
  const span = testSpan(b);
  const same = samePayoutHeadline(ledger, proof.needs);
  const sameRows = samePayoutRows(ledger);
  const us = usHeadline(ledger);
  const live = liveHeadline(ledger, since ? sinceDay(since) : null);
  const intl = intlOnlyNote(ledger);
  const test = testHeadline(r?.taker, span);
  const compare = compareSentence(ledger, r?.taker);
  const weeks = weeksHeadline(folds);
  const rated = ratedHigher(buckets);
  const catHead = biggestGroup(cats, "Categories");
  const hHead = biggestGroup(horizons, "Timings");
  const pays = paysHeadline(r?.by_pays?.best);

  return (
    <article className="mx-auto flex max-w-6xl flex-col gap-12 pb-8">
      <header className="flex flex-col gap-3">
        <h1 className="max-w-3xl text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">How best bets have done</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted">
          Real best bets logged live as we showed them, first the ones you could place on Polymarket US, next to a replay of past weeks. Past results, not a promise: any single bet can lose.
        </p>
      </header>

      <section aria-labelledby="compare-h" className="flex flex-col gap-4">
        <h2 id="compare-h" className="sr-only">Live and testing</h2>
        <div className={`grid gap-4 md:grid-cols-2 ${same ? "" : "lg:grid-cols-3"}`}>
          <Card testId="us-card" kicker="Live on Polymarket US" head={us}>
            <p className="text-xs leading-relaxed text-muted">The bets a US user could actually have placed. Each bet counted once; each game is one event.</p>
          </Card>
          {same && (
            <Card testId="same-payout-card" kicker="Kismet's picks vs other bets at the same payout" head={same}>
              <p className="text-xs leading-relaxed text-muted">
                For every new pick we also log one random other bet that pays about the same, priced and graded the same way.
                Counted in events: bets on one game or one day&apos;s weather win or lose together.
              </p>
              {sameRows.length > 0 && (
                <Details summary="Details">
                  <Table head={["Pays", "Our picks", "Same-payout bets", "Their events"]}
                    rows={sameRows.map((x) => [x.band, ret(x.picks.roi_pct), ret(x.others.roi_pct), formatCount(x.others.events)])} />
                </Details>
              )}
            </Card>
          )}
          <Card testId="live-card" kicker="Live, every best bet" head={live}>
            {intl && <p data-testid="intl-only" className="text-xs leading-relaxed text-muted">{intl}</p>}
            <Details summary="Details">
              <LiveDetails ledger={ledger} needs={proof.needs} />
            </Details>
          </Card>
          <Card testId="test-card" kicker="Testing on past weeks" head={test}>
            <Details summary="Details">
              <div className="flex flex-col gap-3">
                <Tiles tiles={tiles(b)} />
                <p className="text-xs leading-relaxed text-muted">
                  &ldquo;Every bet, no filter&rdquo; buys every side of every market in the same weeks: what the fee and the spread cost
                  without a filter. Confidence (t-stat): how far the result sits from zero given its noise; above 2 is unlikely to be
                  luck alone.{span ? ` Test covers ${span}.` : ""} Test last run {date(b.ran_at)}.
                </p>
              </div>
            </Details>
          </Card>
        </div>
        {compare && <p data-testid="compare" className="max-w-3xl text-[15px] leading-relaxed text-soft">{compare}</p>}
        <ProofLine p={proof} className="max-w-3xl text-sm leading-relaxed text-muted" />
      </section>

      <Section id="weeks" title="Week by week" head={{ value: weeks.value, tone: "flat", sentence: weeks.sentence }}>
        <FoldCharts rows={folds} />
        <Details summary="Show weeks as a table">
          <Table head={["Week of", "Bets", "Return"]} rows={folds.map((f) => [f.week, <Count key="n" n={f.bets} />, f.retText])} />
        </Details>
      </Section>

      <Section id="edges" title={rated.title} note={rated.sentence}>
        <EdgeChart rows={buckets} />
        <Details summary="Details">
          <p className="mb-2 text-xs text-muted">Bets grouped by the edge the model predicted, in cents per $1 share, next to what each group actually earned in testing.</p>
          <Table head={["Predicted edge", "Bets", "Predicted", "Actually earned"]}
            rows={buckets.map((x) => [x.bucket, <Count key="n" n={x.bets} />, edge(x.predicted / 100), edge(x.realized / 100)])} />
        </Details>
      </Section>

      <div className="grid gap-12 lg:grid-cols-2 lg:gap-8">
        <Section id="cats" title="By category" head={catHead}>
          <SimpleTable first="Category" rows={cats} />
          <Details summary="Details"><RecordTable first="Category" rows={cats} /></Details>
        </Section>
        <Section id="close" title="By time before close" head={hHead}>
          <SimpleTable first="Placed" rows={horizons} />
          <Details summary="Details"><RecordTable first="Placed" rows={horizons} /></Details>
        </Section>
      </div>

      <Section id="pays" title="By payout" head={pays}>
        <Details summary="Details">
          <p className="mb-2 text-xs text-muted">
            Every tested bet grouped by what it paid per $1. Lower-confidence bets are the extra ones you see when you choose a payout.
            The verdict uses whichever group tested more bets, and calls a result only when it is too big to be luck.
          </p>
          <PaysTable rows={paysRows(r)} />
        </Details>
      </Section>

      <Section id="calibration" title="Are the win chances honest?"
        note="How often past bets at each price actually won. On the dashed line means the price was right; above it, bets won more often than the price said.">
        <CalibrationChart sets={sets} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="limits-h" className="rounded-card border border-border bg-surface p-5 md:p-6">
          <h2 id="limits-h" className="text-xl font-semibold">Limitations</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-soft">
            <li>The live record is young. Bets on the same game or the same day&apos;s weather win or lose together, so a few days of results swing a lot.</li>
            <li>Headline live numbers count each bet once, even when we showed it again at a lower price. Details also shows every logged row.</li>
            <li>Bets logged before Polymarket US prices were added have no game id, so events are counted, and the live record judged, on the US record only.</li>
            <li>Past prices are mid prices (halfway between buy and sell). The real asking price was higher.</li>
            <li>To cover that gap, each test bet is charged half of today&apos;s typical spread for its kind of market. Spreads at the time are estimated, not recorded.</li>
            {weeks.lastTwoShare !== null && weeks.lastTwoShare >= 0.5 && (
              <li>Most test bets ({pct(weeks.lastTwoShare)}) come from the last two test weeks, so the test leans on a short, recent stretch.</li>
            )}
            <li>Weather history is short, only a few weeks so far.</li>
            <li>Some categories and weeks have very few bets. Their numbers can be luck either way.</li>
          </ul>
        </section>
        <section aria-labelledby="method-h" className="rounded-card border border-border bg-surface p-5 md:p-6">
          <h2 id="method-h" className="text-xl font-semibold">How it works</h2>
          <div className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-soft">
            <p>For thousands of settled markets we record the price some hours before close and whether it won. Grouped by sport,
              topic, bet type and time before close, that gives a curve: priced at 70%, how often did bets like this win?</p>
            <p>When a group is small, its curve leans toward its broader parent (a niche leans on its category, a category on all
              markets), so a few lucky results can&apos;t drive it alone.</p>
            <p>Older results count less than recent ones, and bets from one game or one weather day are treated as one piece of
              evidence, not many.</p>
            <p>The test replays {(b.folds as number | undefined) ?? DASH} weeks one at a time, but only {tw.withBets} of them had best
              bets{tw.lastTwoShare !== null ? `, with ${pct(tw.lastTwoShare)} of all test bets in the last two` : ""}: each week the model only knows what
              happened before it, chooses its best bets, and we check how they settled, paying the estimated asking price plus Polymarket&apos;s fee.</p>
            <p>A bet is a best bet when its win chance beats the asking price plus the fee by at least {edge(store.meta.rule?.min_edge)} per $1
              share, still beats it on a pessimistic estimate, and its category and timing made money in this test.</p>
          </div>
        </section>
      </div>
    </article>
  );
}

const TONE: Record<Headline["tone"], string> = { pos: "text-positive", neg: "text-negative", flat: "text-text" };

function Card({ testId, kicker, head, children }: { testId: string; kicker: string; head: Headline; children: React.ReactNode }) {
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-surface p-5 md:p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{kicker}</p>
      <p data-testid="headline" className={`font-heading text-[40px] font-bold leading-none tracking-[-0.02em] ${TONE[head.tone]}`}>{head.value}</p>
      <p className="text-sm leading-relaxed text-soft">{head.sentence}</p>
      {children}
    </div>
  );
}

function Section({ id, title, note, head, children }: { id: string; title: string; note?: string; head?: Headline | null; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} data-testid={`section-${id}`} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 id={`${id}-h`} className="text-2xl font-semibold tracking-[-0.01em]">{title}</h2>
        {head && (
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            <span data-testid="headline" className={`mr-1.5 font-heading text-xl font-bold ${TONE[head.tone]}`}>{head.value}</span>
            {head.sentence}
          </p>
        )}
        {note && <p className="max-w-2xl text-sm leading-relaxed text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Details({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent-hover">{summary}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {head.map((h, i) => <th key={h} scope="col" className={`px-3 py-3 font-medium md:px-4 ${i ? "text-right" : ""}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border">
              {row.map((c, j) => <td key={j} className={`px-3 py-2.5 md:px-4 ${j ? "text-right" : ""}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type RecRow = { key: string; name: string; r: BacktestRecord; f: ReturnType<typeof recordRows>[number]["f"] };
const retCell = (r: BacktestRecord, f: RecRow["f"]) => (
  <span key="r" className={!r.flags ? "text-muted" : (r.roi_pct ?? 0) < 0 ? "text-negative" : "text-positive"} title={r.flags ? undefined : "not available"}>
    {r.flags ? f.ret : DASH}
  </span>
);
/** Up front: group, bets, return. */
function SimpleTable({ first, rows }: { first: string; rows: RecRow[] }) {
  return <Table head={[first, "Bets", "Return"]} rows={rows.map(({ name, r, f }) => [name, r.flags ? <Count key="b" n={r.flags} /> : f.bets, retCell(r, f)])} />;
}
/** In Details: everything, t-stat and cents per share included. */
function RecordTable({ first, rows }: { first: string; rows: RecRow[] }) {
  return (
    <Table head={[first, "Bets", "Events", "Won", "Per $1 share", "t-stat", "Return"]} rows={rows.map(({ name, r, f }) => [
      name, r.flags ? <Count key="b" n={r.flags} /> : f.bets, r.events !== undefined ? <Count key="e" n={r.events} /> : f.events, f.won,
      f.cents, f.t, retCell(r, f),
    ])} />
  );
}

function PaysTable({ rows }: { rows: ReturnType<typeof paysRows> }) {
  const cell = (x: BacktestRecord | undefined) => {
    if (!x?.flags) return <span className="text-muted" title="no bets at this payout in testing">{DASH}</span>;
    return (
      <span title={`${exactCount(x.flags)} bets · ${x.events !== undefined ? exactCount(x.events) : DASH} events · won ${x.win_rate !== undefined ? pct(x.win_rate) : DASH}`}>
        <Count n={x.flags} /> · <span className={(x.roi_pct ?? 0) < 0 ? "text-negative" : "text-positive"}>{ret(x.roi_pct)}</span>
      </span>
    );
  };
  return (
    <Table head={["Pays", "Best bets", "Lower confidence", "Verdict"]} rows={rows.map((x) => [
      x.key.replace("-", "–"), cell(x.best), cell(x.edge),
      <span key="v" data-testid={`pays-read-${x.key}`} className={x.read.startsWith("lost") ? "text-negative" : x.read === "won" ? "text-positive" : "text-muted"}>{PAYS_READ_TEXT[x.read]}</span>,
    ])} />
  );
}

function LiveDetails({ ledger, needs }: { ledger?: LedgerSummary; needs: number | null }) {
  if (!ledger) return <p className="text-xs text-muted">Every best bet is logged the moment it is shown, then graded when its market settles.</p>;
  const once = liveBase(ledger)!;
  const cats = Object.entries(ledger.by_category).sort((a, b) => b[1].entries - a[1].entries);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Best bets logged (each once)" value={formatCount(once.entries)} />
        <Stat label="Settled" value={once.graded ? `${formatCount(once.wins)} won · ${formatCount(once.losses)} lost` : "none yet"} />
        <Stat label="Events settled, US record" value={usEvents(ledger) !== null ? formatCount(usEvents(ledger)) : "none yet"} />
        <Stat label="Average profit per $1 share" value={edge(once.avg_pnl)} />
        <Stat label="Every logged row, re-shows included" value={ledger.graded ? `${formatCount(ledger.graded)} settled · ${ret(liveReturn(ledger))}` : "none settled"} />
        <Stat label="Updated" value={date(ledger.updated_at)} />
      </dl>
      {cats.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs text-soft">
          {cats.map(([c, s]) => (
            <li key={c} className="rounded-full bg-muted-bg px-3 py-1">{label(c)} <Count n={s.entries} /> rows · <Count n={s.graded} /> settled{s.graded ? ` · ${ret(liveReturn(s))}` : ""}</li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-relaxed text-muted">
        Every best bet is logged the moment it is shown, then graded when its market settles: one $1 share at the asking price plus the fee, no hindsight.
        {needs ? ` About ${formatCount(needs)} settled events would be enough to tell a return the size of the test's from zero (test events × (2 ÷ test t-stat)²).` : ""}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-heading text-lg font-bold">{value}</dd>
    </div>
  );
}
