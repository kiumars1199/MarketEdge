// RFC 9728 protected resource metadata for /api/mcp, served at /.well-known/oauth-protected-resource/api/mcp (the
// path-suffixed form MCP clients try first) and at /.well-known/oauth-protected-resource. Public, CORS *, no secrets.
import { resourceMetadata } from "./auth";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

// No Supabase project configured (demo, local): there is no authorization server to point at, so no metadata.
export const metadataGET = () =>
  !process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new Response(null, { status: 404, headers: CORS })
    : Response.json(resourceMetadata(), { headers: { ...CORS, "Cache-Control": "public, max-age=300" } });
export const metadataOPTIONS = () => new Response(null, { status: 204, headers: CORS });
