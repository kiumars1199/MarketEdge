// MCP bearer auth (T-280). /api/mcp is an OAuth 2.1 protected resource (RFC 9728); Supabase Auth's OAuth server is
// the authorization server (PKCE, dynamic client registration, consent at /oauth/consent). Access tokens are
// ordinary Supabase JWTs plus a `client_id` claim. Server only.
import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { OAuthError, OAuthErrorCode, bearerAuthChallengeResponse, requireBearerAuth, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { authEnabled, type SessionUser } from "@/lib/auth/server";
import { siteUrl } from "@/lib/site";
import { clientKey, rateLimit, tooMany } from "@/lib/abuse";

/** The resource identifier: exactly the URL people paste into "Add custom connector". */
export const mcpResource = () => `${siteUrl()}/api/mcp`;
/** RFC 9728 metadata URL for /api/mcp (path-suffixed form). The bare /.well-known/oauth-protected-resource serves the same. */
export const mcpMetadataUrl = () => `${siteUrl()}/.well-known/oauth-protected-resource/api/mcp`;
/** Supabase's OAuth 2.1 issuer. Discovery: <project>/.well-known/oauth-authorization-server/auth/v1. */
export const issuer = () => `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "")}/auth/v1`;

/** The protected resource metadata document. No `scopes_supported`: Supabase's OAuth server issues no custom scopes,
 *  and `openid` needs asymmetric signing keys (owner step), so nothing is advertised that can't be granted. */
export const resourceMetadata = () => ({
  resource: mcpResource(),
  authorization_servers: [issuer()],
  bearer_methods_supported: ["header"],
  resource_name: "Kismet",
  resource_documentation: `${siteUrl()}/llms.txt`,
});

const b64json = (part: string): Record<string, unknown> => {
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const invalid = (why: string) => new OAuthError(OAuthErrorCode.InvalidToken, why);
/** Rejections decided locally (not a JWT, no client_id, expired): no Supabase call was made, so they don't count
 *  toward the failed-token budget (audit run 4, MCP-c: ordinary expiry must never block a client). */
const local = new WeakSet<Error>();
const localInvalid = (why: string) => { const e = invalid(why); local.add(e); return e; };
/** Supabase is asked with a time limit: a hung auth server is an outage, not a hung /api/mcp. */
const SUPABASE_TIMEOUT_MS = 5000;
const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(SUPABASE_TIMEOUT_MS) });

/** Supabase verifies the token (signature, expiry, revoked session) with GET /auth/v1/user; the claims are read only
 *  after that. Only OAuth-client tokens are accepted: a site session token (no `client_id`) is refused, so a stolen
 *  browser cookie can't be replayed here and the consent screen is the only way in. */
export const supabaseVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    // Cheap local checks first: junk, site session tokens and expired tokens never reach Supabase.
    const pre = b64json(token.split(".")[1] ?? "");
    if (token.split(".").length !== 3 || typeof pre.sub !== "string") throw localInvalid("Malformed token");
    if (typeof pre.client_id !== "string" || !pre.client_id) throw localInvalid("Not an OAuth access token");
    if (typeof pre.exp === "number" && pre.exp * 1000 <= Date.now()) throw localInvalid("Token expired");
    const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } });
    const down = () => new OAuthError(OAuthErrorCode.ServerError, "Sign-in service unavailable");
    const { data, error } = await sb.auth.getUser(token).catch(() => { throw down(); });
    if (error || !data.user) {
      // Only a 4xx from Supabase means the token is bad. Unreachable (supabase-js reports status 0) or 5xx is an
      // outage: answering invalid_token would make every connected assistant drop its token and redo OAuth.
      const status = (error as { status?: number } | null)?.status ?? 0;
      // 408 and 429 are Supabase being slow or busy, not a verdict on the token.
      if (error && (!(status >= 400 && status < 500) || status === 408 || status === 429)) throw down();
      throw invalid("Invalid or expired token");
    }
    const claims = b64json(token.split(".")[1] ?? "");
    const clientId = typeof claims.client_id === "string" ? claims.client_id : "";
    if (!clientId) throw invalid("Not an OAuth access token");
    if (claims.sub !== data.user.id) throw invalid("Token subject mismatch");
    const exp = typeof claims.exp === "number" ? claims.exp : 0;
    const user: SessionUser = { id: data.user.id, email: data.user.email ?? "", verified: !!data.user.email_confirmed_at };
    return { token, clientId, scopes: [], expiresAt: exp, extra: { user } } satisfies AuthInfo;
  },
};

let forced: OAuthTokenVerifier | null = null;
/** Tests (and the e2e mock) swap the verifier. */
export const _setVerifier = (v: OAuthTokenVerifier | null) => void (forced = v);

/** The verified token, or the 401 challenge Response (`WWW-Authenticate: Bearer resource_metadata="…"`).
 *  With accounts off (demo mode, no Supabase keys) every request is refused: the endpoint never opens without a user. */
export async function authenticate(req: Request): Promise<AuthInfo | Response> {
  const resourceMetadataUrl = mcpMetadataUrl();
  if (!forced && !authEnabled()) return bearerAuthChallengeResponse(invalid("Sign-in is not configured"), { resourceMetadataUrl });
  // Failed-token budget per client key. Only tokens Supabase itself rejected count (local rejections and outages
  // don't), and a blocked key still lets through tokens this instance verified recently: a junk-token flood from a
  // shared assistant IP can't lock out its real users (audit run 4, MCP-c).
  const key = clientKey(req), now = Date.now();
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  const hash = token ? createHash("sha256").update(token).digest("base64url") : "";
  const until = blockedUntil.get(key) ?? 0;
  if (until > now && !((verified.get(hash) ?? 0) > now)) return tooMany(until);
  const base = forced ?? supabaseVerifier;
  let counted = false;
  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(t) {
      try {
        const info = await base.verifyAccessToken(t);
        if (hash) {
          if (verified.size > 10_000) verified.clear();   // per instance, bounded
          verified.set(hash, info.expiresAt ? info.expiresAt * 1000 : now + 5 * 60_000);
        }
        return info;
      } catch (e) {
        counted = e instanceof OAuthError && e.code === OAuthErrorCode.InvalidToken && !local.has(e);
        throw e;
      }
    },
  };
  const out = await requireBearerAuth({ verifier, resourceMetadataUrl })(req);
  if (out instanceof Response && counted) {
    const over = await rateLimit("mcp_bad_token", key);
    if (over) {
      blockedUntil.set(key, now + 1000 * Number(over.headers.get("Retry-After") ?? 60));
      if (blockedUntil.size > 10_000) blockedUntil.clear();   // per instance, bounded
    }
  }
  return out;
}
const blockedUntil = new Map<string, number>();
/** sha256(token) → when it stops being trusted (its exp): tokens verified recently pass a blocked key. */
const verified = new Map<string, number>();
export const _resetBadTokenBlocks = () => { blockedUntil.clear(); verified.clear(); };

export const userOf = (auth: AuthInfo | undefined): SessionUser | null => (auth?.extra?.user as SessionUser | undefined) ?? null;
