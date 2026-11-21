-- Admin dashboard (T-140): audit log, site settings, comp tiers, and read/act functions for /admin.
-- Every object here is service-role only: RLS on with no policies, functions executable by service_role alone.
-- The web app calls them only after requireAdmin() (apps/web/lib/admin.ts) has passed.

-- ---------------------------------------------------------------- comp tier (admin override)
-- getMe() / alerts take the higher of the Stripe tier and an unexpired comp (lib/entitlements.ts effectiveTier).
-- Users can read their own row (existing policy) but never write it.
alter table public.subscriptions
  add column comp_tier text check (comp_tier in ('pro','premium')),
  add column comp_expires_at timestamptz;

-- ---------------------------------------------------------------- admin_audit_log (append-only)
create table public.admin_audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid not null,                 -- no FK: the record outlives the admin and the target
  actor_email text not null,
  action text not null,
  target text,
  before jsonb,
  after jsonb
);
create index on public.admin_audit_log (at desc);
alter table public.admin_audit_log enable row level security;   -- no policies: service role only
revoke all on public.admin_audit_log from anon, authenticated;

create or replace function public.admin_audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_log is append-only';
end;
$$;
revoke execute on function public.admin_audit_log_append_only() from public, anon, authenticated;
create trigger admin_audit_log_no_update before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_append_only();
create trigger admin_audit_log_no_truncate before truncate on public.admin_audit_log
  for each statement execute function public.admin_audit_log_append_only();

-- ---------------------------------------------------------------- app_settings
-- One row per setting (lib/settings-core.ts SETTINGS); missing or invalid rows fall back to the code default.
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.app_settings enable row level security;      -- no policies: read through the server
revoke all on public.app_settings from anon, authenticated;

-- ---------------------------------------------------------------- read functions (auth schema is not in the API)
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'users_total', (select count(*) from auth.users),
    'tiers', (select jsonb_build_object(
        'free', count(*) filter (where t = 'free'),
        'pro', count(*) filter (where t = 'pro'),
        'premium', count(*) filter (where t = 'premium'),
        'trialing', count(*) filter (where status = 'trialing'),
        'comped', count(*) filter (where comp_tier is not null and (comp_expires_at is null or comp_expires_at > now())))
      from (select s.status, s.comp_tier, s.comp_expires_at,
              case when s.comp_tier = 'premium' and (s.comp_expires_at is null or s.comp_expires_at > now()) then 'premium'
                   when s.tier = 'premium' then 'premium'
                   when s.comp_tier = 'pro' and (s.comp_expires_at is null or s.comp_expires_at > now()) then 'pro'
                   else s.tier end as t
            from public.subscriptions s) x),
    'paying', (select jsonb_build_object(
        'pro', count(*) filter (where tier = 'pro'),
        'premium', count(*) filter (where tier = 'premium'))
      from public.subscriptions where status in ('active','past_due') and stripe_subscription_id is not null),
    'canceled_this_month', (select count(*) from public.subscriptions
      where status = 'canceled' and updated_at >= date_trunc('month', now())),
    'trials_started', (select count(*) from public.subscriptions where trialed_at is not null),
    'trials_converted', (select count(*) from public.subscriptions where trialed_at is not null and status in ('active','past_due')),
    'active_24h', (select count(distinct user_id) from auth.sessions
      where coalesce(refreshed_at::timestamptz, updated_at, created_at) > now() - interval '24 hours'),
    'active_7d', (select count(distinct user_id) from auth.sessions
      where coalesce(refreshed_at::timestamptz, updated_at, created_at) > now() - interval '7 days'),
    'alerts_24h', (select count(*) from public.alert_events where fired_at > now() - interval '24 hours'),
    'paper_orders', (select count(*) from public.journal where 'kalshi-paper' = any(tags)),
    'signups', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'n', n) order by d), '[]'::jsonb) from (
        select d, (select count(*) from auth.users u where u.created_at >= d and u.created_at < d + interval '1 day') as n
        from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d) s)
  ) into r;
  return r;
end;
$$;

-- Search by email (case-insensitive substring), newest first, with the total for pagination.
create or replace function public.admin_users(q text, lim int, off int)
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, tier text, status text,
  comp_tier text, comp_expires_at timestamptz, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, s.tier, s.status, s.comp_tier, s.comp_expires_at,
      count(*) over () as total
    from auth.users u left join public.subscriptions s on s.user_id = u.id
    where q is null or q = '' or u.email ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    order by u.created_at desc
    limit least(greatest(lim, 1), 200) offset greatest(off, 0);
end;
$$;

-- One user for the support view: account, plan, sessions and how many saved items (counts only).
create or replace function public.admin_user_detail(uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'id', u.id, 'email', u.email, 'email_confirmed_at', u.email_confirmed_at,
    'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
    'last_seen_at', (select max(coalesce(refreshed_at::timestamptz, updated_at, created_at)) from auth.sessions where user_id = u.id),
    'sessions', (select count(*) from auth.sessions where user_id = u.id),
    'onboarded_at', p.onboarded_at, 'accepted_terms_at', p.accepted_terms_at,
    'tier', s.tier, 'status', s.status, 'stripe_customer_id', s.stripe_customer_id,
    'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end,
    'trialed_at', s.trialed_at, 'comp_tier', s.comp_tier, 'comp_expires_at', s.comp_expires_at,
    'counts', jsonb_build_object(
      'presets', (select count(*) from public.presets where user_id = u.id),
      'dashboards', (select count(*) from public.dashboards where user_id = u.id),
      'watchlist', (select count(*) from public.watchlist where user_id = u.id),
      'alert_rules', (select count(*) from public.alert_rules where user_id = u.id),
      'alert_events', (select count(*) from public.alert_events where user_id = u.id),
      'journal', (select count(*) from public.journal where user_id = u.id)))
  into r
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  left join public.subscriptions s on s.user_id = u.id
  where u.id = uid;
  return r;
end;
$$;

-- Sign a user out everywhere: their refresh tokens go with the sessions (cascade), so no device can refresh.
create or replace function public.admin_revoke_sessions(uid uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  delete from auth.sessions where user_id = uid;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.admin_overview() from public, anon, authenticated;
revoke execute on function public.admin_users(text, int, int) from public, anon, authenticated;
revoke execute on function public.admin_user_detail(uuid) from public, anon, authenticated;
revoke execute on function public.admin_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_overview() to service_role;
grant execute on function public.admin_users(text, int, int) to service_role;
grant execute on function public.admin_user_detail(uuid) to service_role;
grant execute on function public.admin_revoke_sessions(uuid) to service_role;
