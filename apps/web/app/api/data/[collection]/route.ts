// POST /api/data/<collection>: insert a row. PATCH /api/data/profile: update settings.
import { TOO_LARGE, tooLarge } from "@/lib/body";
import { insertRow, patchProfile, readBody, withUser } from "@/lib/repo/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { params: Promise<{ collection: string }> };
const bad = () => Response.json({ error: "Invalid body" }, { status: 400 });

export const POST = (req: Request, { params }: P) =>
  withUser(req, async (ctx) => {
    const body = await readBody(req);
    if (body === TOO_LARGE) return tooLarge();
    return body === undefined ? bad() : insertRow(ctx, (await params).collection, body);
  });

export const PATCH = (req: Request, { params }: P) =>
  withUser(req, async (ctx) => {
    if ((await params).collection !== "profile") return Response.json({ error: "Not found" }, { status: 404 });
    const body = await readBody(req);
    if (body === TOO_LARGE) return tooLarge();
    return body === undefined ? bad() : patchProfile(ctx, body);
  });
