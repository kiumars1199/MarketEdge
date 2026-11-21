S=/tmp/claude-0/-home-user-MarketEdge/2e8d356b-d1b5-5401-91e6-9f451833b42c/scratchpad
cd $S/clean6/apps/web
O=http://localhost:3160
exec env -i PATH=$PATH HOME=$HOME DATA_SOURCE=local DATA_CLOCK=scan LIVE_REPRICE=0 DEMO_MODE=false NEXT_PUBLIC_DEMO_MODE=false E2E_MOCK=1 \
 NEXT_PUBLIC_SITE_URL=$O ADMIN_EMAILS=audit4-admin@example.com KALSHI_TRADING_ENV=demo TRADING_ALLOWLIST=audit4-premium@example.com \
 NEXT_PUBLIC_SUPABASE_URL=$O/e2e-mock/supabase NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon SUPABASE_SERVICE_ROLE_KEY=e2e-service \
 STRIPE_SECRET_KEY=sk_test_REDACTED STRIPE_WEBHOOK_SECRET=whsec_REDACTED STRIPE_API_BASE=$O \
 STRIPE_PRICE_PRO_MONTHLY=price_pro_m STRIPE_PRICE_PRO_YEARLY=price_pro_y STRIPE_PRICE_PREMIUM_MONTHLY=price_premium_m STRIPE_PRICE_PREMIUM_YEARLY=price_premium_y \
 NODE_OPTIONS=--max-old-space-size=6144 pnpm exec next dev -p 3160
