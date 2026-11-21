// /account "Use Kismet in Claude" (T-280): how to add the read-only MCP connector in Claude, ChatGPT and Cursor.
// App menus move often: Claude's steps follow its help centre (Nov 2026); ChatGPT's are kept general on purpose.
import Link from "next/link";
import { card, inner } from "@/components/kit";
import type { Tier } from "@/lib/entitlements";
import { CONNECTOR_PLANS_LINE, connectorAllowance } from "@/lib/connector-plan";

const code = "rounded-inner border border-border bg-raised px-2 py-1 font-mono text-[13px] text-text break-all";

export function McpSetup({ tier, url }: { tier: Tier; url: string }) {
  const json = JSON.stringify({ mcpServers: { kismet: { url } } }, null, 2);
  return (
    <section aria-labelledby="mcp-h" className={`${card} flex flex-col gap-4 p-5 md:p-6`}>
      <h2 id="mcp-h" className="text-lg font-semibold">Use Kismet in Claude</h2>
      <p className="text-sm text-soft">
        Ask Claude, ChatGPT or Cursor for today&apos;s Best bets, a market&apos;s price check or the track record. The connector is
        read-only: it can&apos;t place bets or change your account, and it shows the same flags everyone sees.
      </p>
      <p className="text-sm text-muted" data-testid="mcp-plan">
        {/* #38/#58/#72: the same statement as /pricing (lib/connector-plan.ts) */}
        {tier === "free" ? <>Not on Free. {CONNECTOR_PLANS_LINE.replace(" Not on Free.", "")} <Link href="/pricing" className="text-accent-hover underline-offset-4 hover:underline">See plans</Link>.</>
          : <>Your {tier === "premium" ? "Premium" : "Pro"} plan: {connectorAllowance(tier)}.{tier === "pro" && <> Premium: {connectorAllowance("premium")}. <Link href="/pricing" className="text-accent-hover underline-offset-4 hover:underline">See plans</Link>.</>}</>}
      </p>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted">Server URL</p>
        <p className={code}>{url}</p>
      </div>
      <div className={`${inner} flex flex-col gap-2 p-4 text-sm text-soft`}>
        <h3 className="font-semibold text-text">Claude (web and desktop)</h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open <span className="text-text">Customize</span> → <span className="text-text">Connectors</span>, choose <span className="text-text">+</span> → <span className="text-text">Add custom connector</span>.</li>
          <li>Name it Kismet, paste the server URL above, and add it.</li>
          <li>Choose <span className="text-text">Connect</span>, sign in to Kismet and approve.</li>
        </ol>
        <p className="text-muted">On a Team or Enterprise plan an owner adds it first, under Organization settings → Connectors.</p>
        <p className="text-muted">Claude Code: run <span className={code}>claude mcp add --transport http kismet {url}</span>, then <span className={code}>/mcp</span> to sign in.</p>
      </div>
      <div className={`${inner} flex flex-col gap-2 p-4 text-sm text-soft`}>
        <h3 className="font-semibold text-text">ChatGPT</h3>
        <p>In ChatGPT&apos;s settings, open the apps / connectors section, turn on developer mode if it asks, and create a connector with the
          server URL above and OAuth sign-in. Then sign in to Kismet and approve. Which ChatGPT plans allow custom connectors changes over time; ChatGPT&apos;s help
          centre has the current steps.</p>
      </div>
      <div className={`${inner} flex flex-col gap-2 p-4 text-sm text-soft`}>
        <h3 className="font-semibold text-text">Cursor</h3>
        <p>Add this to <span className={code}>~/.cursor/mcp.json</span> (or <span className={code}>.cursor/mcp.json</span> in a project), then connect Kismet under Cursor&apos;s MCP settings and sign in:</p>
        <pre className={`${code} whitespace-pre-wrap`}>{json}</pre>
      </div>
      <p className="text-xs text-muted">To disconnect, remove the connector in the app. Market analytics, not financial advice. Based on past results. 18+.</p>
    </section>
  );
}
