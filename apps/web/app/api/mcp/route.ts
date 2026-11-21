// /api/mcp: the Kismet MCP server (T-280), streamable HTTP, stateless. Bearer auth only (OAuth 2.1 via Supabase,
// lib/mcp/auth.ts): no cookies, no BotID (AI clients can't solve it), plan gates and rate limits per tool call
// (lib/mcp/server.ts). Serves the 2026-07-28 protocol and, statelessly, 2025-era clients.
import { createMcpHandler, originValidationResponse } from "@modelcontextprotocol/server";
import { authenticate } from "@/lib/mcp/auth";
import { buildServer, withDisclaimer } from "@/lib/mcp/server";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createMcpHandler(() => buildServer(), {
  legacy: "stateless",
  responseMode: "json",
  onerror: (e) => console.error("[mcp]", e.message),
});

const noStore = (res: Response) => {
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, no-store");
  return out;
};

/** Hostnames a browser may call from (MCP spec: validate Origin against DNS rebinding). No Origin = a server-side
 *  client (Claude, ChatGPT, Cursor), allowed. MCP_ALLOWED_ORIGINS adds comma-separated hostnames. */
function allowedOriginHosts(req: Request): string[] {
  const hosts = [new URL(siteUrl()).hostname, new URL(req.url).hostname];
  for (const h of (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",")) if (h.trim()) hosts.push(h.trim());
  return hosts;
}

/** Answers the SDK writes itself (input validation errors) skip our done(): add the disclaimer to every tool result.
 *  Only tools/call replies are rewritten; they are single, finished replies (JSON, or one SSE event in stateless mode),
 *  so reading the whole body is safe. Long-lived streams (GET, subscriptions) pass through untouched. */
async function disclaimed(req: Request, res: Response): Promise<Response> {
  if (req.method !== "POST") return res;
  let call = false;
  try {
    const sent = (await req.json()) as { method?: string } | { method?: string }[];
    call = (Array.isArray(sent) ? sent : [sent]).some((m) => m?.method === "tools/call");
  } catch { /* not JSON: the SDK already answered it */ }
  const type = res.headers.get("content-type") ?? "";
  if (!call || !(type.includes("application/json") || type.includes("text/event-stream"))) return res;
  const text = await res.text();
  const fix = (json: string) => { try { return JSON.stringify(withDisclaimer(JSON.parse(json))); } catch { return json; } };
  const out = type.includes("application/json")
    ? fix(text)
    : text.split("\n").map((l) => (l.startsWith("data:") ? `data: ${fix(l.slice(5).trim())}` : l)).join("\n");
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(out, { status: res.status, statusText: res.statusText, headers });
}

async function serve(req: Request): Promise<Response> {
  const badOrigin = originValidationResponse(req, allowedOriginHosts(req));
  if (badOrigin) {
    // Real AI clients call server to server (no Origin); log any refusal so a wrongly blocked client is easy to spot.
    console.warn("[mcp] refused Origin", req.headers.get("origin"));
    return noStore(badOrigin);
  }
  const auth = await authenticate(req);
  if (auth instanceof Response) return noStore(auth);
  return noStore(await disclaimed(req.clone(), await handler.fetch(req, { authInfo: auth })));
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
