// Email templates. Each returns subject + html + text and always includes the disclaimer; optional mail (alerts,
// support links) also carries the unsubscribe link (T-300 notices have none). Wording follows docs/06: plain facts, never "bet this".
import { message, title } from "@/lib/alerts";
import type { Market, Side } from "@/lib/types";
import { siteUrl, type Email } from "./index";

export const DISCLAIMER = "Market analytics, not financial advice. Based on past results. 18+.";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** unsub null = a required notice with no unsubscribe link (T-300 transactional mail); the reason line stays. */
export function layout(heading: string, lines: string[], cta: { href: string; label: string }, unsub: string | null, why: string, unsubLabel = "Unsubscribe") {
  const html = `<!doctype html><html><body style="margin:0;background:#0b0f0d;color:#e6ece9;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px">
<p style="margin:0 0 4px;color:#10b981;font-weight:600">Kismet</p>
<h1 style="margin:0 0 16px;font-size:18px">${esc(heading)}</h1>
${lines.map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`).join("\n")}
<p style="margin:20px 0"><a href="${esc(cta.href)}" style="background:#10b981;color:#000;padding:10px 16px;border-radius:12px;text-decoration:none;font-weight:600">${esc(cta.label)}</a></p>
<hr style="border:0;border-top:1px solid #1a2520;margin:24px 0">
<p style="margin:0 0 8px;font-size:12px;color:#8a9a93">${esc(why)}${unsub ? ` <a href="${esc(unsub)}" style="color:#8a9a93">${esc(unsubLabel)}</a>` : ""}</p>
<p style="margin:0;font-size:12px;color:#8a9a93">${esc(DISCLAIMER)}</p>
</div></body></html>`;
  const text = [heading, "", ...lines, "", `${cta.label}: ${cta.href}`, "", unsub ? `${why} ${unsubLabel}: ${unsub}` : why, DISCLAIMER].join("\n");
  return { html, text };
}

export interface AlertEmailInput {
  to: string;
  ruleName: string;
  market: Market;
  side: Side;
  timeZone: string;
  live?: { ask: number; roi: number } | null;
  unsubscribeUrl: string;
}

export function alertEmail(i: AlertEmailInput): Email {
  const heading = title(i.market);
  const { html, text } = layout(
    heading,
    [message(i.market, i.side, i.timeZone, i.live)],
    { href: `${siteUrl()}/m/${encodeURIComponent(i.market.id)}?side=${i.side.side_index}`, label: "Open in Kismet" },
    i.unsubscribeUrl,
    `You get this because you set the alert "${i.ruleName}".`,
  );
  return { to: i.to, subject: `Alert: ${heading}`.slice(0, 140), html, text, unsubscribeUrl: i.unsubscribeUrl };
}

/** One-time sign-in link sent from the admin panel (support: "my link never came"). Expires like any magic link. */
export function signInEmail(to: string, link: string, unsubscribeUrl: string): Email {
  const { html, text } = layout(
    "Your Kismet sign-in link",
    ["Use the button below to sign in. The link works once and expires soon.", "If you didn't ask for this, ignore this email."],
    { href: link, label: "Sign in to Kismet" },
    unsubscribeUrl,
    "You get this because our support team sent you a sign-in link.",
  );
  return { to, subject: "Your Kismet sign-in link", html, text, unsubscribeUrl };
}

/** Stripe invoice.payment_failed (lib/billing/stripe.ts). Account mail, but still carries unsubscribe and the disclaimer. */
export function paymentFailedEmail(to: string, unsubscribeUrl: string): Email {
  const { html, text } = layout(
    "Your Kismet payment didn't go through",
    ["We couldn't charge your card. Update it from your account page (Manage billing) to keep your plan."],
    { href: `${siteUrl()}/account`, label: "Open your account" },
    unsubscribeUrl,
    "You get this because you have a Kismet subscription.",
  );
  return { to, subject: "Your Kismet payment didn't go through", html, text, unsubscribeUrl };
}

/**
 * Supabase Auth emails (confirm sign-up, magic link, password reset, email change). Supabase sends these itself, so
 * they live as templates in supabase/templates/ and the owner pastes them into Auth > Email Templates. Same layout,
 * disclaimer and footer as our own mail. They're sent only when someone asks; the footer still carries an unsubscribe
 * link (docs/OVERNIGHT §3: unsubscribe in every email) to /alerts, where every alert email can be turned off. Go template fields: {{ .ConfirmationURL }}, {{ .SiteURL }}.
 */
export const AUTH_EMAILS = {
  confirmation: {
    subject: "Confirm your Kismet account",
    heading: "Confirm your email",
    lines: ["Tap the button to confirm this address and finish creating your free Kismet account.", "If you didn't sign up, ignore this email. Nothing happens without the link."],
    cta: "Confirm my email",
  },
  magic_link: {
    subject: "Your Kismet sign-in link",
    heading: "Your Kismet sign-in link",
    lines: ["Use the button below to sign in. The link works once and expires soon.", "If you didn't ask for this, ignore this email."],
    cta: "Sign in to Kismet",
  },
  recovery: {
    subject: "Reset your Kismet password",
    heading: "Reset your password",
    lines: ["Tap the button to set a new password. The link works once and expires soon.", "If you didn't ask for this, ignore this email. Your password stays the same."],
    cta: "Set a new password",
  },
  email_change: {
    subject: "Confirm your new Kismet email",
    heading: "Confirm your new email",
    lines: ["Tap the button to use this address for your Kismet account.", "If you didn't ask for this, ignore this email."],
    cta: "Confirm new email",
  },
} as const;

export function authEmailHtml(kind: keyof typeof AUTH_EMAILS): string {
  const e = AUTH_EMAILS[kind];
  return layout(
    e.heading, [...e.lines], { href: "{{ .ConfirmationURL }}", label: e.cta }, "{{ .SiteURL }}/alerts",
    "You get this because someone asked for it with this address on Kismet. Sign-in emails only come when asked for; alert emails can be turned off any time.",
    "Unsubscribe from Kismet emails",
  ).html;
}
