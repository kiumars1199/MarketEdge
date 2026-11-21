// Plan grants (docs/19 P8): Pro or Premium by email, optional expiry, before or after the person signs up.
// Changes go through POST /api/admin (audit row first); this page only reads, after requireAdmin().
import { Grants, type Grant } from "@/components/admin/Controls";
import { requireAdmin } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { db } = await requireAdmin();
  const { data, error } = await db.from("plan_grants").select("email, tier, expires_at, applied_at, updated_at")
    .order("updated_at", { ascending: false }).limit(500);
  if (error) return <p role="alert" className="text-sm text-warning">Couldn&apos;t load grants. Has the plan grants migration (20261119000300) been applied?</p>;
  return <Grants rows={(data ?? []) as Grant[]} />;
}
