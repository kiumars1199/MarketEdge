// Owner: Lane D2 (T-37).
import { PageTitle } from "@/components/kit";
import { savedWhere } from "@/lib/saved-where";
import { JournalView } from "@/components/journal/JournalView";
import { KalshiPanel } from "@/components/trade/KalshiPanel";

export const metadata = { title: "My bets", robots: { index: false } };

export default function Page() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageTitle title="My bets" sub={`Bets you logged, settled automatically when Polymarket resolves them. ${savedWhere().journal}`} />
      <JournalView />
      <KalshiPanel />
    </div>
  );
}
