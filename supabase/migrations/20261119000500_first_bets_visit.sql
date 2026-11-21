-- T-276: the account wall makes "signed up" and "reached Best bets" the two activation steps the admin counts.
-- profiles.first_bets_at is stamped once, by the server with the service role, on a signed-in user's first Best bets
-- render (apps/web/lib/activation.ts). Server-owned like accepted_terms_at: a user can't set or reset it.
-- Applied by the owner (HANDOFF.md). Until then the app skips the write and the admin hides the section.

alter table public.profiles add column if not exists first_bets_at timestamptz;

-- RLS stays as it is (own row read/update); the trigger below keeps first_bets_at out of the user's hands.
create or replace function public.guard_profile_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and (
    new.accepted_terms_at is distinct from old.accepted_terms_at or new.created_at is distinct from old.created_at
    or new.first_bets_at is distinct from old.first_bets_at
  ) then
    raise exception 'accepted_terms_at, created_at and first_bets_at are set by the server' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Admin activation counts: sign-ups and first Best bets visits per day (last 30 days), and 7-day totals.
-- Counts only, nothing per user. Service role only, like the other admin_* functions.
create or replace function public.admin_activation()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
        'signups', (select count(*) from auth.users u where u.created_at >= d and u.created_at < d + interval '1 day'),
        'first_bets', (select count(*) from public.profiles p where p.first_bets_at >= d and p.first_bets_at < d + interval '1 day'))
      order by d), '[]'::jsonb)
      from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d),
    'signups_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'first_bets_7d', (select count(*) from public.profiles where first_bets_at > now() - interval '7 days'),
    'first_bets_total', (select count(*) from public.profiles where first_bets_at is not null)
  ) into r;
  return r;
end;
$$;

revoke execute on function public.admin_activation() from public, anon, authenticated;
grant execute on function public.admin_activation() to service_role;
