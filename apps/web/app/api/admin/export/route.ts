// GET /api/admin/export — the user list as CSV (T-141). Admin only (404 otherwise), rate-limited, audited.
// Account and plan fields only: no saved items, no bets.
import { rateLimit } from "@/lib/abuse";
import { adminOnly405, audit, requireAdmin } from "@/lib/admin/server";
import { sameSiteRequest } from "@/lib/auth/server";
import { cell } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const other = adminOnly405("GET");
export const POST = other, PUT = other, PATCH = other, DELETE = other, OPTIONS = other;

const PAGE = 200, MAX_PAGES = 100;   // ponytail: 20,000 users; stream it if the list outgrows that
const COLS = ["id", "email", "created_at", "last_sign_in_at", "tier", "status", "comp_tier", "comp_expires_at"] as const;
type Row = Record<(typeof COLS)[number], unknown>;

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireAdmin();
  if (!sameSiteRequest(req)) return Response.json({ error: "Open the export from the admin page" }, { status: 403 });   // RT2-01: no cross-site link
  const limited = await rateLimit("admin", `u:${ctx.admin.id}`);
  if (limited) return limited;
  const rows: Row[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await ctx.db.rpc("admin_users", { q: "", lim: PAGE, off: p * PAGE });
    if (error) return Response.json({ error: "Couldn't read users" }, { status: 502 });
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  await audit(ctx, "users.export", null, null, { rows: rows.length });
  const csv = [COLS.join(","), ...rows.map((r) => COLS.map((c) => cell(r[c])).join(","))].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kismet-users-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
