// PATCH / DELETE one row of the signed-in user's collection (RLS limits it to their own rows).
import { TOO_LARGE, tooLarge } from "@/lib/body";
import { deleteRow, readBody, updateRow, withUser } from "@/lib/repo/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { params: Promise<{ collection: string; id: string }> };

export const PATCH = (req: Request, { params }: P) =>
  withUser(req, async (ctx) => {
    const { collection, id } = await params;
    const body = await readBody(req);
    if (body === TOO_LARGE) return tooLarge();
    return body === undefined ? Response.json({ error: "Invalid body" }, { status: 400 }) : updateRow(ctx, collection, id, body);
  });

export const DELETE = (req: Request, { params }: P) =>
  withUser(req, async (ctx) => {
    const { collection, id } = await params;
    return deleteRow(ctx, collection, id);
  });
