// Admin users (T-141): search by email, paginated, newest first. Plan and account fields only.
import Link from "next/link";
import { day } from "@/components/admin/Stats";
import { btn, input } from "@/components/kit";
import { requireAdmin } from "@/lib/admin/server";
import { effectiveTier } from "@/lib/entitlements";
import { exactCount } from "@/lib/format";

export const dynamic = "force-dynamic";

const PER = 50;
const PLAN = { free: "Free", pro: "Pro", premium: "Premium" } as const;

interface Row { id: string; email: string; created_at: string; last_sign_in_at: string | null; tier: string | null; status: string | null; comp_tier: string | null; comp_expires_at: string | null; total: number }

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { db } = await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 254).trim();
  const page = Math.min(Math.max(1, Math.trunc(Number(sp.page)) || 1), 10_000);
  const { data, error } = await db.rpc("admin_users", { q, lim: PER, off: (page - 1) * PER });
  const rows = (data ?? []) as Row[];
  const total = Number(rows[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER));
  const href = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" action="/admin/users" role="search" className="flex flex-[1_1_320px] gap-2">
          <label htmlFor="q" className="sr-only">Search by email</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Search by email" autoComplete="off" className={`${input} max-w-md`} />
          <button type="submit" className={btn}>Search</button>
        </form>
        <a href="/api/admin/export" className={btn} download>Export CSV</a>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-warning">Couldn&apos;t load users. Has the admin migration been applied?</p>
      ) : (
        <>
          <p className="text-sm text-muted" aria-live="polite">
            {exactCount(total)} {total === 1 ? "user" : "users"}{q ? <> matching <span className="text-soft">“{q}”</span></> : null}
          </p>
          <div className="overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-3 font-medium">Email</th>
                  <th scope="col" className="px-4 py-3 font-medium">Plan</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Signed up</th>
                  <th scope="col" className="px-4 py-3 font-medium">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tier = effectiveTier(r);
                  return (
                    <tr key={r.id} className="border-t border-border first:border-t-0 hover:bg-raised">
                      <td className="max-w-[280px] truncate px-4 py-3">
                        <Link href={`/admin/users/${r.id}`} className="text-text underline-offset-4 hover:text-accent-hover hover:underline">{r.email}</Link>
                      </td>
                      <td className="px-4 py-3">
                        {PLAN[tier]}
                        {r.comp_tier && tier !== (r.tier ?? "free") && <span className="ml-2 rounded-full bg-accent-bg px-2 py-0.5 text-[11px] text-accent-soft">comp</span>}
                      </td>
                      <td className="px-4 py-3 text-soft">{r.status ?? "—"}</td>
                      <td className="px-4 py-3 tabular-nums text-soft">{day(r.created_at)}</td>
                      <td className="px-4 py-3 tabular-nums text-soft">{day(r.last_sign_in_at)}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No users{q ? " match that search" : " yet"}.</td></tr>}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
              {page > 1 ? <Link href={href(page - 1)} className={btn}>Newer</Link> : <span />}
              <span className="text-muted">Page {page} of {pages}</span>
              {page < pages ? <Link href={href(page + 1)} className={btn}>Older</Link> : <span />}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
