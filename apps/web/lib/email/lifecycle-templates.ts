// Lifecycle emails (docs/OVERHAUL.md §F4, T-300). Same layout, disclaimer and plain wording as the other mail.
//
// Unsubscribe, and why only the welcome has one:
//   welcome       optional relationship mail → unsubscribe link + List-Unsubscribe header (RFC 8058). The token is the
//                 existing account-wide one (lib/email unsubscribeUrl): it turns off alert emails, the only other
//                 optional mail we send. The welcome itself goes out once, so there is nothing further to stop.
//   trial_ending  required notice: card networks and state automatic-renewal laws expect a reminder before a free
//                 trial turns into a charge. An unsubscribe would let someone switch off the warning the law wants them
//                 to get, so it has none.
//   receipt       transactional (CAN-SPAM 16 CFR 316.3: confirms a transaction the person agreed to) → no unsubscribe.
//   cancel        transactional (confirms the change they asked for, and what they keep until when) → no unsubscribe.
// Every link points at a page of this app (checked against the route list in lifecycle.test.ts).
import { siteUrl, type Email } from "./index";
import { layout } from "./templates";

export type PlanName = "Pro" | "Premium";
export const planName = (tier: string | null | undefined): PlanName => (tier === "premium" ? "Premium" : "Pro");

const date = (ms: number) => new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** Cents → "$1,234.56" (CLAUDE.md rule 6). */
export const amount = (cents: number, currency = "usd") =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: 2 });

const NOTICE = "This is a notice about your Kismet subscription, so it has no unsubscribe link.";

export function welcomeEmail(to: string, unsubscribeUrl: string): Email {
  const subject = "Welcome to Kismet: how to read a bet card";
  const { html, text } = layout(
    "Welcome to Kismet",
    [
      "Each card is one bet: what it's on, and the side to take (“Bet Yes”).",
      "“Wins about 7 in 10” is how often bets like it won before; “$10 wins $5.60” is your profit on $10 if it wins.",
      "More stars means a better price for that chance. Tap “Why this bet?” for the numbers behind it.",
    ],
    { href: `${siteUrl()}/bets`, label: "See today's best bets" },
    unsubscribeUrl,
    "You get this once, because you created a Kismet account.",
  );
  return { to, subject, html, text, unsubscribeUrl };
}

export function trialEndingEmail(i: { to: string; plan: PlanName; endsAt: number; now: number }): Email {
  const days = Math.max(1, Math.round((i.endsAt - i.now) / 86_400_000));
  const when = days === 1 ? "tomorrow" : `in ${days} days`;
  const subject = `Your Kismet ${i.plan} trial ends ${when}`;
  const { html, text } = layout(
    subject,
    [
      `Your free ${i.plan} trial ends on ${date(i.endsAt)}. After that, the card you added is charged for ${i.plan} at the price you chose at checkout, and the plan renews until you cancel.`,
      "To cancel: open your account, tap Manage billing and cancel there. Cancel before the trial ends and you won't be charged.",
      "Want to keep it? Do nothing.",
    ],
    { href: `${siteUrl()}/account`, label: "Manage or cancel" },
    null,
    `You get this because your Kismet ${i.plan} trial is ending. ${NOTICE}`,
  );
  return { to: i.to, subject, html, text };
}

export function receiptEmail(i: { to: string; plan: PlanName; cents: number; currency?: string; paidAt: number; invoice?: string | null }): Email {
  const subject = `Receipt: ${amount(i.cents, i.currency)} for Kismet ${i.plan}`;
  const { html, text } = layout(
    "Thanks, your payment went through",
    [
      `We charged ${amount(i.cents, i.currency)} for Kismet ${i.plan} on ${date(i.paidAt)}.${i.invoice ? ` Invoice ${i.invoice}.` : ""}`,
      "Every invoice and receipt is in your account under Manage billing, where you can also change or cancel your plan.",
    ],
    { href: `${siteUrl()}/account`, label: "Open your account" },
    null,
    `You get this because you paid for a Kismet subscription. ${NOTICE}`,
  );
  return { to: i.to, subject, html, text };
}

export function cancelEmail(i: { to: string; plan: PlanName; endsAt: number | null; now: number }): Email {
  const keeps = i.endsAt !== null && i.endsAt > i.now;
  const subject = keeps ? `Your Kismet ${i.plan} plan is canceled` : `Your Kismet ${i.plan} plan has ended`;
  const { html, text } = layout(
    subject,
    keeps
      ? [`You keep ${i.plan} until ${date(i.endsAt!)}. You won't be charged again.`, "After that your account moves to Free. Your saved views and lists stay."]
      : ["You won't be charged again. Your account is on Free now; your saved views and lists stay."],
    { href: `${siteUrl()}/pricing`, label: keeps ? "Changed your mind? See plans" : "See plans" },
    null,
    `You get this because your Kismet subscription was canceled. ${NOTICE}`,
  );
  return { to: i.to, subject, html, text };
}
