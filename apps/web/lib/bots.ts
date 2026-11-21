// AI agents (docs/14 §6, docs/15 § Bots). Edge-safe (middleware imports it).
// Training and index crawlers are disallowed in robots.txt and refused (403) by middleware everywhere, since a
// crawler may ignore robots.txt. User-triggered fetchers (T-281: an assistant opening a page because a person asked
// it to) may read the public pages and /llms.txt only. The MCP endpoint and OAuth discovery serve any agent: they
// need an OAuth token or hold nothing private.
const esc = (b: string) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = (list: readonly string[]) => new RegExp(list.map(esc).join("|"), "i");

/** Fetchers that act for one person in a chat, not crawlers: allowed on PUBLIC_FOR_USER_AGENTS. */
export const USER_AGENTS = ["ChatGPT-User", "Claude-User", "Perplexity-User"] as const;

/** Everything else: training crawlers, AI search indexers, scrapers. Blocked everywhere. */
export const TRAINING_BOTS = [
  "GPTBot", "OAI-SearchBot", "ClaudeBot", "Claude-Web", "Claude-SearchBot", "anthropic-ai",
  "CCBot", "PerplexityBot", "Google-Extended", "GoogleOther", "Applebot-Extended", "Bytespider",
  "Amazonbot", "meta-externalagent", "meta-externalfetcher", "FacebookBot", "cohere-ai", "cohere-training-data-crawler",
  "Diffbot", "ImagesiftBot", "Omgilibot", "Omgili", "Timpibot", "YouBot", "AI2Bot", "Ai2Bot-Dolma",
  "DuckAssistBot", "MistralAI-User", "Scrapy", "img2dataset", "Kangaroo Bot", "PanguBot", "SemrushBot-OCOB", "Webzio-Extended",
];

/** Every AI agent we recognise. */
export const AI_BOTS = [...TRAINING_BOTS, ...USER_AGENTS];

/** Public pages a user-triggered fetcher may read (exact paths; robots.txt lists them the same way). */
export const PUBLIC_FOR_USER_AGENTS = ["/", "/pricing", "/about", "/track-record", "/terms", "/privacy", "/refunds", "/disclaimer", "/contact", "/llms.txt"];

/** Any agent may reach these: the bearer-token MCP endpoint and OAuth discovery (no data without a token). */
export const AGENT_OPEN = ["/api/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"];

const TRAINING = re(TRAINING_BOTS), USER = re(USER_AGENTS), ANY = re(AI_BOTS);
const under = (path: string, list: readonly string[]) => list.some((p) => path === p || path.startsWith(p + "/"));

/** True for a known AI agent user agent (crawler or user-triggered fetcher). */
export const isAiBot = (ua: string | null | undefined) => !!ua && ANY.test(ua);
/** True for a training / index crawler. */
export const isTrainingBot = (ua: string | null | undefined) => !!ua && TRAINING.test(ua);

/** Whether an AI agent with this user agent may load `path`. People (no AI agent match) always may. */
export function agentAllowed(ua: string | null | undefined, path: string): boolean {
  if (!isAiBot(ua)) return true;
  if (under(path, AGENT_OPEN)) return true;
  return !TRAINING.test(ua!) && USER.test(ua!) && PUBLIC_FOR_USER_AGENTS.includes(path);
}
