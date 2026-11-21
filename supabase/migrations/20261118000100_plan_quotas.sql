-- Plan quotas enforced in Postgres (REDTEAM RT-08, RT-11). The API's count-then-insert let parallel requests
-- (and direct PostgREST calls with the user's own JWT) store more rows than the plan allows. This trigger
-- serializes inserts per user and table with a transaction advisory lock, then counts.
-- Limits mirror apps/web/lib/entitlements.ts QUOTAS (null = unlimited); change both together.
-- Only the `authenticated` role (a user's JWT) is bound; the service role and migrations are not.

-- The user's plan as the app sees it: the higher of the Stripe tier and an unexpired admin comp
-- (apps/web/lib/entitlements.ts effectiveTier; comp columns from 20261118000000_admin.sql). Invoker rights:
-- a user reads only their own subscriptions row (RLS), which is the only row these callers ask for.
create or replace function public.plan_of(uid uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when s.comp_tier = 'premium' and (s.comp_expires_at is null or s.comp_expires_at > now()) then 'premium'
    when s.tier = 'premium' then 'premium'
    when s.comp_tier = 'pro' and (s.comp_expires_at is null or s.comp_expires_at > now()) then 'pro'
    when s.tier = 'pro' then 'pro'
    else 'free' end
  from (select 1) one left join public.subscriptions s on s.user_id = uid;
$$;

create or replace function public.enforce_plan_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan text;
  lim int;
  n int;
begin
  -- someone else's user_id: row-level security refuses the row right after this trigger
  if current_user <> 'authenticated' or new.user_id is distinct from auth.uid() then
    return new;
  end if;
  plan := public.plan_of(new.user_id);
  lim := case tg_table_name
    when 'presets' then case plan when 'free' then 1 when 'pro' then 25 end
    when 'dashboards' then case plan when 'free' then 0 when 'pro' then 3 end
    when 'watchlist' then case plan when 'free' then 10 end
    when 'alert_rules' then case plan when 'free' then 0 when 'pro' then 20 else 100 end
  end;
  if lim is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || new.user_id::text, 0));
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into n using new.user_id;
  if n >= lim then
    raise exception 'plan_quota: your plan allows % %', lim, tg_table_name using errcode = 'P0001', hint = lim::text;
  end if;
  return new;
end;
$$;

create trigger plan_quota before insert on public.presets for each row execute function public.enforce_plan_quota();
create trigger plan_quota before insert on public.dashboards for each row execute function public.enforce_plan_quota();
create trigger plan_quota before insert on public.watchlist for each row execute function public.enforce_plan_quota();
create trigger plan_quota before insert on public.alert_rules for each row execute function public.enforce_plan_quota();
