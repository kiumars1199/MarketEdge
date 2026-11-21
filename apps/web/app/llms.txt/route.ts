// /llms.txt (T-281, llmstxt.org): a short Markdown guide to Kismet for AI assistants reading the site for a person.
// Public pages only; no market data. Assistants that need data use the MCP connector (OAuth, a paid plan).
import { DISCLAIMER } from "@/components/shell/Footer";
import { getStore } from "@/lib/data/store";
import { HIT_RATE_VS_PROFIT, siteProof } from "@/lib/proof";
import { SITE, siteUrl } from "@/lib/site";
import { CONNECTOR_PLANS_LINE } from "@/lib/connector-plan";

export const dynamic = "force-dynamic";

/** T-290: the test result and the live record together, as on every page that shows either; nothing when the engine
 *  output isn't there (the guide still serves). */
async function record(): Promise<string> {
  try {
    const s = await getStore();
    const p = siteProof({ backtest: s.backtest, ledger: s.ledgerSummary, since: s.ledgerSince });
    return p.test ? `\n## Track record, in one line\n\n${p.test} ${p.live}\n\nBasis: ${p.help}\n\n${HIT_RATE_VS_PROFIT}\n` : "";
  } catch {
    return "";
  }
}

export async function GET() {
  const u = siteUrl();
  const rec = await record();
  const body = `# ${SITE.name}

> ${SITE.name} shows prediction-market traders which contracts are priced below their estimated win chance, after the
> fee and after the cost of crossing the spread. Every number comes with its basis: sample size, model level and the
> walk-forward backtest record. Flags are the same for everyone; ${SITE.name} gives no personal advice and places no bets.

${DISCLAIMER}

## Public pages

- [How it works](${u}/about): the model, the price check and what the numbers mean
- [Track record](${u}/track-record): walk-forward backtest, calibration and the live settled-bet record
- [Pricing](${u}/pricing): Free, Pro and Premium
- [Terms](${u}/terms), [Privacy](${u}/privacy), [Refunds](${u}/refunds), [Disclaimer](${u}/disclaimer), [Contact](${u}/contact)
${rec}
## Use ${SITE.name} in an AI assistant (MCP)

- Server URL: ${u}/api/mcp (streamable HTTP, OAuth 2.1 sign-in with your ${SITE.name} account)
- Read-only tools: best_bets, search_markets, get_market, track_record, my_list
- Plans: ${CONNECTOR_PLANS_LINE}
- Setup steps for Claude, ChatGPT and Cursor: ${u}/account (signed in)

## For crawlers

Market data, Best bets and account pages need a signed-in account and aren't for automated reading. Training
crawlers are not allowed anywhere (see ${u}/robots.txt).
`;
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
