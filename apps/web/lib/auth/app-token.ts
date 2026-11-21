// T-280: access tokens Supabase's OAuth 2.1 server issues to approved apps (the MCP connector in Claude, ChatGPT,
// Cursor) are ordinary `authenticated` JWTs plus a `client_id` claim. They are for /api/mcp only: the site treats a
// session carrying one as signed out, so an app can't replay its tokens as a browser cookie to reach account,
// billing or admin routes. Pure and edge-safe (middleware imports it). Only call it on a token Supabase has already
// verified (after auth.getUser()): it decodes, it doesn't verify.
export function isAppToken(token: string | null | undefined): boolean {
  const part = token?.split(".")[1];
  if (!part) return false;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const claims = JSON.parse(json) as { client_id?: unknown };
    return typeof claims.client_id === "string" && claims.client_id.length > 0;
  } catch {
    return true;   // a verified token we can't read: fail closed
  }
}
