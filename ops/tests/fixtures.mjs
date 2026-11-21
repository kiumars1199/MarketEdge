// Fake, well-formed production values for the ops script tests.
export const GOOD_ENV = {
  DEMO_MODE: "false", DATA_SOURCE: "supabase", NEXT_PUBLIC_SITE_URL: "https://kismetodds.example",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlYW5vbg",
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlc3Jr",
  STRIPE_SECRET_KEY: "sk_test_FAKEFAKEFAKEFAKEFAKE", STRIPE_WEBHOOK_SECRET: "whsec_FAKEFAKEFAKEFAKE",
  STRIPE_PRICE_PRO_MONTHLY: "price_FAKE0001", STRIPE_PRICE_PRO_YEARLY: "price_FAKE0002",
  STRIPE_PRICE_PREMIUM_MONTHLY: "price_FAKE0003", STRIPE_PRICE_PREMIUM_YEARLY: "price_FAKE0004",
  CRON_SECRET: "a".repeat(64), UNSUBSCRIBE_SECRET: "b".repeat(64), EXT_SIGNING_SECRET: "c".repeat(64),
  UPSTASH_REDIS_REST_URL: "https://fake-123.upstash.io", UPSTASH_REDIS_REST_TOKEN: "FAKEtokenFAKEtokenFAKEtoken",
  RESEND_API_KEY: "re_FAKEFAKE_FAKE", EMAIL_FROM: "Kismet <alerts@mail.kismetodds.example>",
  GITHUB_DATA_TOKEN: "github_pat_FAKEFAKEFAKEFAKEFAKEFAKE", GITHUB_DATA_REPO: "owner/repo",
  NEXT_PUBLIC_SENTRY_DSN: "https://abc@o1.ingest.sentry.io/1", NEXT_PUBLIC_POSTHOG_KEY: "phc_FAKEFAKEFAKEFAKE",
  NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com", NEXT_PUBLIC_EXTENSION_ID: "abcdefghijklmnopabcdefghijklmnop",
  ADMIN_EMAILS: "a@kismetodds.example,b@kismetodds.example",
};
export const GOOD_SITE = {
  name: "Kismet", domain: "kismetodds.example", support_email: "help@kismetodds.example",
  legal: { operator_names: "A and B", operator_type: "individuals", governing_state: "Delaware", mailing_address: "1 Main St",
    refund_policy: "first_charge_7_days", response_time: "2 business days", min_age: 18, countries: "United States", last_updated: "November 18, 2026" },
  stripe: { mode: "checkout", paymentLinks: { pro_monthly: "", pro_yearly: "", premium_monthly: "", premium_yearly: "" }, portal_url: "" },
  prices_usd: { pro_monthly: 19, pro_yearly: 190, premium_monthly: 29, premium_yearly: 290 },
};
