-- T-300 (docs/OVERHAUL.md §F4): lifecycle emails sent, so each goes out once however often its trigger fires
-- (Stripe retries a webhook, the daily cron sees the same trial twice, a user signs in on two devices).
-- The server claims (user_id, kind, ref) before sending and deletes the claim if the send fails, so a later trigger
-- can try again. ref: '' for once-per-account mail (welcome, first-charge receipt), the Stripe subscription id for
-- trial reminders and cancel confirmations. Service role only (apps/web/lib/email/lifecycle.ts): RLS on, no policies.
-- Applied by the owner (HANDOFF.md). Until then claims fail and no lifecycle email is sent (never a duplicate).

create table if not exists public.lifecycle_emails (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('welcome', 'trial_ending', 'receipt', 'cancel')),
  ref text not null default '',
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
alter table public.lifecycle_emails enable row level security;
revoke all on public.lifecycle_emails from anon, authenticated;
-- T-280 (20261120000000_oauth_clients_no_tables.sql) covers tables that existed then; every new table repeats it.
drop policy if exists "no oauth clients" on public.lifecycle_emails;
create policy "no oauth clients" on public.lifecycle_emails as restrictive for all to anon, authenticated
  using ((select auth.jwt() ->> 'client_id') is null) with check ((select auth.jwt() ->> 'client_id') is null);
