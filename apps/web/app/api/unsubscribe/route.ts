// /api/unsubscribe?t=<signed token> (docs/14 §5, RFC 8058).
// GET shows a confirm button (mail scanners prefetch GET links, so GET never changes anything).
// POST unsubscribes: mail clients send `List-Unsubscribe=One-Click`, the confirm button posts the same URL.
// Effect: removes "email" from the user's alert rule (or all their rules when the token has no rule id).
import { DISCLAIMER } from "@/lib/email/templates";
import { verifyUnsubscribe, type UnsubClaims } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const page = (body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe · Kismet</title></head>
<body style="margin:0;background:#0b0f0d;color:#e6ece9;font-family:system-ui,sans-serif"><main style="max-width:480px;margin:0 auto;padding:48px 16px">
<p style="color:#10b981;font-weight:600">Kismet</p>${body}
<footer style="margin-top:48px;font-size:12px;color:#8a9a93">${DISCLAIMER}</footer></main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );

const claims = (req: Request) => verifyUnsubscribe(new URL(req.url).searchParams.get("t") ?? "");

/** Drops the email channel from the matching alert rules. No Supabase configured = nothing stored server-side. */
async function stopEmail(c: UnsubClaims): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const filter = `user_id=eq.${encodeURIComponent(c.u)}${c.r ? `&id=eq.${encodeURIComponent(c.r)}` : ""}`;
  const res = await fetch(`${url}/rest/v1/alert_rules?${filter}&select=id,channels`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`alert_rules read HTTP ${res.status}`);
  const rules = (await res.json()) as { id: string; channels: string[] | null }[];
  for (const r of rules.filter((x) => x.channels?.includes("email"))) {
    const patch = await fetch(`${url}/rest/v1/alert_rules?id=eq.${encodeURIComponent(r.id)}`, {
      method: "PATCH", headers, body: JSON.stringify({ channels: r.channels!.filter((ch) => ch !== "email") }),
    });
    if (!patch.ok) throw new Error(`alert_rules update HTTP ${patch.status}`);
  }
}

const invalid = () => page(`<h1>This link has expired or is not valid</h1><p>Turn email off for any alert on the Alerts page in Kismet.</p>`, 400);

export function GET(req: Request): Response {
  const c = claims(req);
  if (!c) return invalid();
  const what = c.r ? "this alert" : "all alert emails";
  return page(`<h1>Stop ${what}?</h1><p>You will no longer get ${what} by email. In-app alerts stay on.</p>
<form method="post"><button type="submit" style="background:#10b981;color:#000;border:0;border-radius:12px;padding:10px 16px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`);
}

export async function POST(req: Request): Promise<Response> {
  const c = claims(req);
  if (!c) return invalid();
  try {
    await stopEmail(c);
  } catch (e) {
    console.error("[unsubscribe] failed:", (e as Error).message);
    return page(`<h1>Something went wrong</h1><p>Please try the link again in a minute.</p>`, 500);
  }
  return page(`<h1>You're unsubscribed</h1><p>${c.r ? "This alert" : "Alert emails"} will no longer be emailed to you.</p>`);
}
