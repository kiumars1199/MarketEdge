// POST /api/tz { tz } (T-288): the browser's IANA time zone, kept in an httpOnly cookie so the server renders every
// time in it on the next page load (components/clock.tsx, lib/zone.ts). Same origin only; the zone is validated with
// Intl; nothing is stored server-side. 204, or 400 / 403.
import "@/lib/zod-jitless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { COOKIE_OPTIONS, sameOrigin } from "@/lib/auth/server";
import { TZ_COOKIE, validZone } from "@/lib/zone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ tz: z.string().max(64) }).strict();

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const tz = parsed.success ? validZone(parsed.data.tz) : null;
  if (!tz) return Response.json({ error: "Unknown time zone" }, { status: 400 });
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(TZ_COOKIE, tz, { maxAge: 31_536_000, ...COOKIE_OPTIONS });
  return res;
}
