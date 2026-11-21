// Owner values from config/site.json (docs/14). Empty strings render as [[PLACEHOLDER]]; never invented.
import raw from "../../../config/site.json";

export const site = raw;

/** The owner's value, or a visible placeholder like [[SUPPORT_EMAIL]]. */
const ph = (value: string | undefined | null, name: string) => (value && value.trim()) || `[[${name}]]`;

export const SITE = {
  name: site.name || "Kismet",
  supportEmail: ph(site.support_email, "SUPPORT_EMAIL"),
  operator: ph(site.legal.operator_names, "OPERATOR_NAMES"),
  operatorType: site.legal.operator_type,
  state: ph(site.legal.governing_state, "GOVERNING_STATE"),
  address: site.legal.mailing_address.trim() || null,
  refundPolicy: site.legal.refund_policy.trim(),
  responseTime: ph(site.legal.response_time, "RESPONSE_TIME"),
  minAge: site.legal.min_age,
  countries: site.legal.countries,
  lastUpdated: ph(site.legal.last_updated, "LAST_UPDATED"),
  domain: ph(site.domain, "DOMAIN"),
  prices: site.prices_usd,
};

/** Canonical origin for metadata, sitemap and robots. */
export const siteUrl = () =>
  (process.env.NEXT_PUBLIC_SITE_URL || (site.domain ? `https://${site.domain.replace(/^https?:\/\//, "")}` : "http://localhost:3000")).replace(/\/$/, "");
