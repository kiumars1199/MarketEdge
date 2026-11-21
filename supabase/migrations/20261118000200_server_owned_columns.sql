-- Own-row RLS was wider than the API (REDTEAM RT-11). With their own JWT straight against PostgREST a user could
-- forge profiles.accepted_terms_at (the 18+/Terms record) and write Pro-only rows. Quotas: 20261118000100.
-- A trigger rather than column grants: Supabase's default grants (and table-level UPDATE) would undo a column revoke.

-- 1. Server-owned profile columns. accepted_terms_at is written by /auth/callback with the service role.
--    onboarded_at stays user-owned (the onboarding screen sets it; it gates nothing).
create or replace function public.guard_profile_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and (
    new.accepted_terms_at is distinct from old.accepted_terms_at or new.created_at is distinct from old.created_at
  ) then
    raise exception 'accepted_terms_at and created_at are set by the server' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_profile_server_columns before update on public.profiles
  for each row execute function public.guard_profile_server_columns();

-- 2. My bets (journal) is a Pro feature: inserting needs a paying tier, checked in the policy itself.
drop policy "own rows" on public.journal;
create policy "own rows read" on public.journal for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows update" on public.journal for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows delete" on public.journal for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows insert on a paid plan" on public.journal for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.plan_of((select auth.uid())) in ('pro', 'premium')   -- Stripe tier or an unexpired comp
  );
