// Owner: Lane D2 (T-36).
import { DashboardList } from "@/components/dashboards/Dashboards";

export const metadata = { title: "Dashboards", robots: { index: false } };

export default function Page() {
  return <DashboardList />;
}
