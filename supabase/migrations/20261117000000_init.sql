-- Kismet user data (docs/03-data-model.md §3, docs/08, docs/15 § Database). T-40.
-- Every public table has RLS on. User tables: owner-only via user_id = (select auth.uid()).
-- subscriptions and stripe_events are written only by the service role (Stripe webhook).

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text, timezone text default 'America/New_York',
  bankroll_usd numeric,
  kelly_fraction numeric default 0.25,
  default_stake_usd numeric default 100,
  odds_format text default 'cents' check (odds_format in ('cents','percent','decimal','american')),
  favorite_topics text[] default '{}',
  density text default 'comfortable' check (density in ('comfortable','compact')),
  theme text default 'dark' check (theme in ('dark','light')),
  numbers_mode text default 'simple' check (numbers_mode in ('simple','pro')),
  accepted_terms_at timestamptz,          -- 18+ and Terms checkbox at sign-up
  onboarded_at timestamptz, created_at timestamptz default now()
);

-- ---------------------------------------------------------------- subscriptions (webhook-written)
create table public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  stripe_customer_id text unique, stripe_subscription_id text,
  tier text not null default 'free' check (tier in ('free','pro','premium')),
  status text,
  current_period_end timestamptz, cancel_at_period_end boolean default false,
  trialed_at timestamptz,                 -- set once a trial starts; checkout skips the trial after that
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------- stripe_events (idempotency)
create table public.stripe_events (
  id text primary key,                    -- Stripe event.id
  type text not null,
  processed_at timestamptz default now()
);

-- ---------------------------------------------------------------- user collections
create table public.presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, emoji text,
  query jsonb not null,
  columns text[], sort jsonb,
  is_default boolean default false, position int default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, layout jsonb not null,
  position int default 0, created_at timestamptz default now()
);

create table public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  market_id text not null, side_index smallint,
  note text, target_price numeric,
  snapshot jsonb,
  created_at timestamptz default now(),
  unique nulls not distinct (user_id, market_id, side_index)   -- one "whole market" row, like LocalRepo
);

create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, enabled boolean default true,
  kind text not null check (kind in ('preset_match','market_price','edge_change','closing_soon')),
  query jsonb,
  market_id text, side_index smallint, threshold numeric,
  channels text[] default '{email}',
  webhook_url text,
  cooldown_minutes int default 60, quiet_hours smallint[],   -- [start_hour, end_hour), may wrap midnight
  last_fired_at timestamptz, created_at timestamptz default now()
);

create table public.alert_events (
  id bigserial primary key, rule_id uuid references public.alert_rules on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  market_id text not null, side_index smallint,
  payload jsonb, sent_channels text[], fired_at timestamptz default now(), read_at timestamptz,
  dedupe_key text not null,
  unique (dedupe_key)
);

create table public.journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  market_id text not null, side_index smallint not null, outcome text,
  question text, category text, niche text,
  price numeric not null, shares numeric not null, fee numeric default 0,
  placed_at timestamptz not null default now(),
  model_win_prob numeric, model_edge numeric,
  closing_price numeric,
  result text check (result in ('won','lost','void')), settled_at timestamptz,
  pnl_usd numeric, tags text[], note text
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text unique not null, keys jsonb not null, created_at timestamptz default now()
);

-- Free tier: market details revealed per day (docs/08 LIMITS flagsPerDay = 3).
create table public.drawer_reveals (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null default current_date,
  market_id text not null,
  primary key (user_id, day, market_id)
);

create index on public.presets (user_id);
create index on public.dashboards (user_id);
create index on public.alert_rules (user_id);
create index on public.alert_events (user_id, fired_at desc);
create index on public.journal (user_id, placed_at desc);
create index on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;        -- no policies: service role only
alter table public.presets enable row level security;
alter table public.dashboards enable row level security;
alter table public.watchlist enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alert_events enable row level security;
alter table public.journal enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.drawer_reveals enable row level security;

-- Profiles: read and edit your own row. Rows are created by the signup trigger.
create policy "own profile read" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own profile update" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Subscriptions: read only. Tier is written by the Stripe webhook with the service role.
create policy "own subscription read" on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- Owner-only CRUD on user collections.
create policy "own rows" on public.presets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.dashboards for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.watchlist for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.alert_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.alert_events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.journal for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows read" on public.drawer_reveals for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows insert" on public.drawer_reveals for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- signup trigger
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.subscriptions (user_id, tier) values (new.id, 'free') on conflict do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- 3-session limit (docs/14 §1)
-- When a 4th session starts, the oldest ones are deleted; their refresh tokens go with them
-- (auth.refresh_tokens.session_id cascades), so the old device is signed out at its next refresh.
create or replace function public.enforce_session_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.sessions
  where user_id = new.user_id
    and id in (
      select id from auth.sessions
      where user_id = new.user_id
      order by created_at desc
      offset 3
    );
  return null;
end;
$$;
revoke execute on function public.enforce_session_limit() from public, anon, authenticated;

create trigger on_auth_session_created
  after insert on auth.sessions
  for each row execute function public.enforce_session_limit();
