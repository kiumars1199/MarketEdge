// POST /api/funnel { step } (T-299, lib/funnel.ts): the browser's funnel steps. Same origin only, rate limited, and
// only the client steps: signup_done, trial_start and paid are recorded by server code and refused here.
// Always answers 200 { counted } for a valid step (counted = false when signed in/out doesn't fit the step, when it
// was already counted for this user, or when the funnel isn't set up), so a page never logs an error over analytics.
import "@/lib/zod-jitless";
import { z } from "zod";
import { clientKey, rateLimit } from "@/lib/abuse";
import { getUser, sameOrigin } from "@/lib/auth/server";
import { allowed, isClientStep } from "@/lib/funnel";
import { recordFunnel } from "@/lib/funnel-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ step: z.string().max(40) }).strict();

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const step = parsed.success ? parsed.data.step : null;
  if (!isClientStep(step)) return Response.json({ error: "Unknown step" }, { status: 400 });
  const user = await getUser();
  // Own bucket ("funnel:" prefix) on the markets limits: 60 a minute is far above one step per page view.
  const limited = await rateLimit("markets", `funnel:${clientKey(req, user?.id)}`);
  if (limited) return limited;
  if (!allowed(step, !!user)) return Response.json({ counted: false });
  return Response.json({ counted: await recordFunnel(step, user?.id ?? null) });
}
