// Owner: Lane D2 (T-36).
import { DashboardView } from "@/components/dashboards/Dashboards";

export const metadata = { title: "Dashboard" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DashboardView id={id} />;
}
