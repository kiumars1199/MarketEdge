-- Plan grants by email (docs/19 P8). An admin grants Pro or Premium (optional expiry) to an email address,
-- whether or not that person has an account yet. The grant is applied as the existing admin comp
-- (subscriptions.comp_tier / comp_expires_at, 20261118000000_admin.sql), which getMe() (lib/entitlements.ts
-- effectiveTier) and plan_of() already honor:
--   * the email already has an account: applied at once by admin_grant_plan();
--   * no account yet: applied when the account is created (first sign-in, magic link or Google) by the
--     after-insert trigger on auth.users below.
-- Service-role only, like the rest of the admin schema: RLS on with no policies, functions for service_role alone.
-- The web app calls them only after requireAdmin() and an audit row (app/api/admin/route.ts).

create table public.plan_grants (
  email text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  tier text not null check (tier in ('pro','premium')),
  expires_at timestamptz,                  -- null = no end date
  created_at timestamptz not null default now(),
  created_by uuid not null,                -- admin user id (no FK: the record outlives the admin)
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  applied_user_id uuid,                    -- set once the grant is on an account (no FK: survives account deletion)
  applied_at timestamptz
);
alter table public.plan_grants enable row level security;        -- no policies: service role only
revoke all on public.plan_grants from anon, authenticated;

-- Create or edit a grant, and put it on the account now if one exists. Returns {user_id} (null = pending).
create or replace function public.admin_grant_plan(e text, t text, exp timestamptz, actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := lower(btrim(e));
  uid uuid;
begin
  insert into public.plan_grants (email, tier, expires_at, created_by, updated_by)
    values (em, t, exp, actor, actor)
  on conflict (email) do update
    set tier = excluded.tier, expires_at = excluded.expires_at, updated_at = now(), updated_by = excluded.updated_by;
  select u.id into uid from auth.users u where lower(u.email) = em order by u.created_at limit 1;
  if uid is not null then
    insert into public.subscriptions (user_id, comp_tier, comp_expires_at) values (uid, t, exp)
    on conflict (user_id) do update set comp_tier = excluded.comp_tier, comp_expires_at = excluded.comp_expires_at;
    update public.plan_grants set applied_user_id = uid, applied_at = coalesce(applied_at, now()) where email = em;
  end if;
  return jsonb_build_object('user_id', uid);
end;
$$;

-- Revoke: delete the grant and take the comp off the account (a paid Stripe tier is never touched).
create or replace function public.admin_revoke_grant(e text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := lower(btrim(e));
  n int;
  uid uuid;
begin
  delete from public.plan_grants where email = em;
  get diagnostics n = row_count;
  select u.id into uid from auth.users u where lower(u.email) = em order by u.created_at limit 1;
  if uid is not null then
    update public.subscriptions set comp_tier = null, comp_expires_at = null where user_id = uid;
  end if;
  return jsonb_build_object('removed', n > 0, 'user_id', uid);
end;
$$;

-- Pending grant → new account. Named to sort after on_auth_user_created (Postgres fires same-event triggers
-- alphabetically), so the subscriptions row exists; the upsert covers it either way.
create or replace function public.apply_pending_plan_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare g record;
begin
  select tier, expires_at into g from public.plan_grants
    where email = lower(btrim(new.email)) and (expires_at is null or expires_at > now());
  if found then
    insert into public.subscriptions (user_id, tier, comp_tier, comp_expires_at) values (new.id, 'free', g.tier, g.expires_at)
    on conflict (user_id) do update set comp_tier = excluded.comp_tier, comp_expires_at = excluded.comp_expires_at;
    update public.plan_grants set applied_user_id = new.id, applied_at = now() where email = lower(btrim(new.email));
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created_grant
  after insert on auth.users
  for each row execute function public.apply_pending_plan_grant();

revoke execute on function public.admin_grant_plan(text, text, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.admin_revoke_grant(text) from public, anon, authenticated;
revoke execute on function public.apply_pending_plan_grant() from public, anon, authenticated;
grant execute on function public.admin_grant_plan(text, text, timestamptz, uuid) to service_role;
grant execute on function public.admin_revoke_grant(text) to service_role;
