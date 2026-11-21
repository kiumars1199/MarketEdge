// Owner: Lane D2 (alerts, demo F-11/F-23).
// #23 (Marc, Nov 20, "blank on first load"): belt and braces. If this boundary ever suspends (useSearchParams), it shows
// the page skeleton instead of nothing. In the mock the view server-renders, so the blank was not reproduced here.
import { Suspense } from "react";
import { AlertsView } from "@/components/alerts/AlertsView";
import { PageSkeleton } from "@/components/shell/PageSkeleton";

export const metadata = { title: "Alerts", robots: { index: false } };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlertsView />
    </Suspense>
  );
}
