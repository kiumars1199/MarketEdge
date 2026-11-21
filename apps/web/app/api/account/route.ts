// Delete account (docs/14 §1): confirm by typing the email → cancel Stripe subscription → delete the
// Supabase user (every row cascades) → sign out. Stripe first: a failed cancel must not leave a paying ghost.
import { z } from "zod";
import { deleteAccount } from "@/lib/auth/delete";
import { readBody, withUser } from "@/lib/repo/server";
import { TOO_LARGE, tooLarge } from "@/lib/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().max(254) }).strict();

export const DELETE = (req: Request) =>
  withUser(req, async ({ db, userId }) => {
    const raw = await readBody(req);
    if (raw === TOO_LARGE) return tooLarge();
    const parsed = Body.safeParse(raw);
    const { data: u } = await db.auth.getUser();
    const email = u.user?.email ?? "";
    if (!parsed.success || parsed.data.email.trim().toLowerCase() !== email.toLowerCase()) {
      return Response.json({ error: "Type your account email exactly to confirm." }, { status: 400 });
    }
    const r = await deleteAccount(userId);
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    await db.auth.signOut({ scope: "local" }).catch(() => {});
    return Response.json({ deleted: true });
  });
