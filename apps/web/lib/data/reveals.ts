// Free tier: exact numbers in the market details panel for 3 markets a day (docs/08 flagsPerDay).
// Signed in: drawer_reveals table (RLS). Signed out: counted on the server per client IP (RT-01: Upstash, else per
// instance); the HttpOnly cookie only remembers which ones this browser opened.
import { cookies } from "next/headers";
import { clientIp, distinct } from "@/lib/abuse";
import { COOKIE_OPTIONS, supabaseServer, type SessionUser } from "@/lib/auth/server";
import { quota, type Tier } from "@/lib/entitlements";

const COOKIE = "me_reveals";
const today = () => new Date().toISOString().slice(0, 10);

/** Marks `marketId` revealed today if the tier's allowance has room (re-opening one is free). Returns remaining + ok. */
export async function reveal(req: Request, tier: Tier, user: SessionUser | null, marketId: string): Promise<{ ok: boolean; left: number }> {
  const limit = quota(tier, "flags_revealed");
  if (limit === Infinity) return { ok: true, left: Infinity };
  if (user) {
    const db = await supabaseServer();
    const { data } = await db.from("drawer_reveals").select("market_id").eq("day", today());
    const ids = (data ?? []).map((r) => r.market_id as string);
    if (ids.includes(marketId)) return { ok: true, left: limit - ids.length };
    if (ids.length >= limit) return { ok: false, left: 0 };
    const { error } = await db.from("drawer_reveals").insert({ market_id: marketId, day: today() });
    return error ? { ok: false, left: limit - ids.length } : { ok: true, left: limit - ids.length - 1 };
  }
  const r = await distinct(`reveal:${clientIp(req)}:${today()}`, [marketId], limit, 26 * 3_600_000);
  if (!r.ok) return { ok: false, left: 0 };
  const jar = await cookies();
  const [day, list = ""] = (jar.get(COOKIE)?.value ?? "").split("|");
  const ids = new Set(day === today() ? list.split(",").filter(Boolean) : []).add(marketId);
  jar.set(COOKIE, `${today()}|${[...ids].slice(-limit).join(",")}`, { ...COOKIE_OPTIONS, maxAge: 60 * 60 * 26 });
  return { ok: true, left: limit - r.size };
}
