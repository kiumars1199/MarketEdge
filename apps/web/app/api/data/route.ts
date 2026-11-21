// GET: all of the signed-in user's rows + profile (SupabaseRepo loads once). POST: first sign-in import.
import { TOO_LARGE, tooLarge } from "@/lib/body";
import { importLocal, readAll, readBody, withUser } from "@/lib/repo/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withUser(req, async (ctx) => Response.json(await readAll(ctx), { headers: { "Cache-Control": "no-store" } }));

export const POST = (req: Request) =>
  withUser(req, async (ctx) => {
    const body = await readBody(req);
    if (body === TOO_LARGE) return tooLarge();
    return importLocal(ctx, (body as { import?: unknown } | null)?.import);
  });
