// Audit log (T-141): every admin mutation, newest first. Append-only in the DB (trigger refuses update/delete).
import Link from "next/link";
import { btn } from "@/components/kit";
import { requireAdmin } from "@/lib/admin/server";
import { utcWhen as when } from "@/lib/format";

export const dynamic = "force-dynamic";

const PER = 50;
interface Entry { id: number; at: string; actor_email: string; action: string; target: string | null; before: unknown; after: unknown }
const show = (v: unknown) => (v === null || v === undefined ? "—" : JSON.stringify(v));

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { db } = await requireAdmin();
  const page = Math.min(Math.max(1, Math.trunc(Number((await searchParams).page)) || 1), 10_000);
  const { data, error } = await db.from("admin_audit_log").select("id, at, actor_email, action, target, before, after")
    .order("at", { ascending: false }).range((page - 1) * PER, page * PER);   // one extra row = there is an older page
  const rows = ((data ?? []) as Entry[]).slice(0, PER);
  const older = (data?.length ?? 0) > PER;

  if (error) return <p role="alert" className="text-sm text-warning">Couldn&apos;t load the audit log. Has the admin migration been applied?</p>;
  return (
    <div className="flex flex-col gap-4">
      <ol className="overflow-hidden rounded-card border border-border bg-surface" data-testid="audit-log">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5 border-t border-border px-4 py-3 first:border-t-0 md:px-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm"><span className="font-medium">{r.action}</span>{r.target && <span className="text-soft"> · {r.target}</span>}</p>
              <p className="text-xs tabular-nums text-muted">{when(r.at)} · {r.actor_email}</p>
            </div>
            {(r.before != null || r.after != null) && (
              <p className="break-all font-mono text-xs text-muted">
                <span className="text-soft">before</span> {show(r.before)} <span className="text-soft">after</span> {show(r.after)}
              </p>
            )}
          </li>
        ))}
        {!rows.length && <li className="px-4 py-8 text-center text-sm text-muted">No admin actions yet.</li>}
      </ol>
      {(page > 1 || older) && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
          {page > 1 ? <Link href={`/admin/audit?page=${page - 1}`} className={btn}>Newer</Link> : <span />}
          <span className="text-muted">Page {page}</span>
          {older ? <Link href={`/admin/audit?page=${page + 1}`} className={btn}>Older</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
