// OAuth consent (T-280): Supabase's OAuth 2.1 server sends people here (dashboard: Authentication > OAuth Server >
// Authorization Path = /oauth/consent) when an app such as Claude, ChatGPT or Cursor asks to connect to Kismet.
// Signed-out visitors log in first and come back. The decision is a same-origin POST (app/api/oauth/decision).
import { redirect } from "next/navigation";
import { PageTitle, btnGhost, btnPrimary, card } from "@/components/kit";
import { authEnabled, getUser, supabaseServer } from "@/lib/auth/server";
import { CONNECTOR_PLANS_LINE } from "@/lib/connector-plan";

export const metadata = { title: "Connect an app", robots: { index: false } };
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9._~-]{1,256}$/;   // URL-safe; the format is Supabase's
const host = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === "http:" && (x.hostname === "localhost" || x.hostname === "127.0.0.1") ? `${x.hostname} (an app on your computer)` : x.host;
  } catch {
    return "an unknown address";
  }
};

function Problem({ text }: { text: string }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageTitle title="Connect an app" sub={text} />
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: id } = await searchParams;
  if (!authEnabled()) return <Problem text="Accounts aren't switched on here, so apps can't connect." />;
  if (!id || !ID.test(id)) return <Problem text="This link is missing its request. Start again from the app you're connecting." />;
  if (!(await getUser())) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);

  const { data, error } = await (await supabaseServer()).auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <Problem text="This request has expired or was already used. Start again from the app you're connecting." />;
  if (!("authorization_id" in data)) redirect(data.redirect_url);   // already approved: straight back to the app

  const name = data.client.name || "An app";
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageTitle title={`Connect ${name} to Kismet?`} />
      <section className={`${card} flex flex-col gap-4 p-5 md:p-6`}>
        <p className="text-sm text-soft">
          <span className="font-medium text-text">{name}</span> wants to read Kismet for you: Best bets, market details, the track record
          and your saved markets (My list). It can&apos;t change anything, place bets or see your billing.
        </p>
        <p className="text-sm text-muted">After you approve, you&apos;ll go back to <span className="font-medium text-text">{host(data.redirect_uri)}</span>.
          Only approve if you started this from that app.</p>
        <p className="text-sm text-muted">{CONNECTOR_PLANS_LINE}</p>
        <form method="post" action="/api/oauth/decision" className="flex flex-wrap gap-3">
          <input type="hidden" name="authorization_id" value={data.authorization_id} />
          <button type="submit" name="decision" value="approve" className={btnPrimary}>Approve</button>
          <button type="submit" name="decision" value="deny" className={btnGhost}>Deny</button>
        </form>
      </section>
    </div>
  );
}
