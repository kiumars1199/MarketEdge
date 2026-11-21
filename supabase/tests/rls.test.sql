-- pgTAP checks for a real Supabase DB: `supabase test db` (local) or the owner's project.
-- Mirrors apps/web/test/rls.test.ts (which runs the same migrations in PGlite on every `pnpm test`).
begin;
select plan(5);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity), 0,
  'every public table has RLS on');

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@rls.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@rls.test', 'authenticated', 'authenticated');

select is((select tier from public.subscriptions where user_id = '00000000-0000-0000-0000-00000000000a'), 'free',
  'signup trigger creates a free subscription');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into public.presets (name, query) values ('A view', '{"v":1}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.presets), 0, 'user B sees none of user A''s presets');
update public.subscriptions set tier = 'premium';
select is((select count(*)::int from public.subscriptions where tier = 'premium'), 0, 'users cannot write their tier');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.profiles), 0, 'anon sees no profiles');

select * from finish();
rollback;
