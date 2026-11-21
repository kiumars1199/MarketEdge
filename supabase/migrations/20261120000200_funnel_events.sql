-- T-299 (docs/OVERHAUL.md §F3): the conversion funnel. One row per counted step.
--   Signed in: at most one row per user and step (unique (user_id, event)), so "first Best bets view" and
--   "first Bet on Polymarket click" fire once per person, ever, and step counts are people.
--   Signed out (landing view, signup start, upgrade view): user_id null, one row per visit. Postgres treats NULLs
--   as distinct, so those rows never collide. No IP, no user agent, no URL: just the step and the day.
-- Written only by the server with the service role (apps/web/lib/funnel-server.ts): RLS on, no policies, so
-- users and anon can neither read nor write it. Deleting an account deletes its rows (on delete cascade).
-- Applied by the owner (HANDOFF.md). Until then the app's funnel writes fail quietly and /admin/funnel says so.

create table if not exists public.funnel_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  event text not null check (event in ('landing_view', 'signup_start', 'signup_done', 'first_bets_view', 'first_bet_click',
                                       'upgrade_view', 'checkout_start', 'trial_start', 'paid')),
  day date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now(),
  unique (user_id, event)
);
create index if not exists funnel_events_day on public.funnel_events (day, event);
alter table public.funnel_events enable row level security;
revoke all on public.funnel_events from anon, authenticated;
-- T-280 (20261120000000_oauth_clients_no_tables.sql) covers tables that existed then; every new table repeats it.
drop policy if exists "no oauth clients" on public.funnel_events;
create policy "no oauth clients" on public.funnel_events as restrictive for all to anon, authenticated
  using ((select auth.jwt() ->> 'client_id') is null) with check ((select auth.jwt() ->> 'client_id') is null);

-- Admin: rows of (day, event, n) for the last p_days days (UTC). Counts only, nothing per user.
create or replace function public.admin_funnel(p_days int default 30)
returns table (day date, event text, n bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select f.day, f.event, count(*)::bigint
  from public.funnel_events f
  where f.day > (now() at time zone 'utc')::date - least(greatest(p_days, 1), 366)
  group by f.day, f.event
  order by f.day, f.event;
$$;

revoke execute on function public.admin_funnel(int) from public, anon, authenticated;
grant execute on function public.admin_funnel(int) to service_role;
