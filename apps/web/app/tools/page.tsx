// Owner: Lane D2 (T-27).
import { PageTitle } from "@/components/kit";
import { Calculators } from "@/components/tools/Calculators";

export const metadata = { title: "Tools", description: "Bet-sizing and estimated-return calculators for prediction markets, based on past results." };

export default function Page() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageTitle title="Calculators" sub="Check a price before you bet: estimated return, payout, fees and sizing. Everything runs in your browser." />
      <Calculators />
    </div>
  );
}
