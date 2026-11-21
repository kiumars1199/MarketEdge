// Headline backtest tiles (Results page + landing). Strategy number big, "every bet, no filter" under it.
import { exactCount } from "@/lib/format";
import type { Tile } from "@/lib/trackRecord";

export function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className={`grid gap-px overflow-hidden rounded-card border border-border bg-border ${tiles.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 lg:grid-cols-5"}`}>
      {tiles.map((t) => (
        <div key={t.key} data-testid={`tile-${t.key}`} title={t.help} className="flex flex-col gap-1 bg-surface p-4 md:p-5 last:max-lg:col-span-2">
          <dt className="text-xs text-muted">{t.label}</dt>
          <dd data-testid="tile-value" title={t.key === "bets" || t.key === "events" ? exactCount(t.value) : undefined} className={`font-heading text-[30px] font-bold leading-tight tracking-[-0.02em] ${t.key === "ret" || t.key === "cents" ? "text-accent" : ""}`}>
            {t.text}
          </dd>
          <dd className="sr-only">{t.help}</dd>
          <dd className="text-xs text-muted">Every bet, no filter: <span className="text-soft tabular-nums" title={t.baseline_value !== undefined ? exactCount(t.baseline_value) : undefined}>{t.baseline}</span></dd>
        </div>
      ))}
    </dl>
  );
}
