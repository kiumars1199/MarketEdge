-- T-280: OAuth-client tokens (Supabase OAuth 2.1 server, used by the Kismet MCP connector) get no direct table access.
-- Those access tokens are ordinary `authenticated` JWTs with a `client_id` claim, so without this any app a user
-- approves (Claude, ChatGPT, Cursor, or anything that registers itself) could call PostgREST with the public anon key
-- and read or write that user's rows, bypassing the read-only MCP server. A RESTRICTIVE policy is ANDed with the
-- permissive "own rows" policies: a token carrying client_id matches nothing. The MCP server reads the user's plan and
-- My list with the service role, scoped to the verified user id (apps/web/lib/auth/server.ts getMeForUser,
-- apps/web/lib/mcp). Browser sessions (no client_id) are unchanged.
-- Apply BEFORE turning on the OAuth server in the Supabase dashboard.
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists "no oauth clients" on public.%I', t);
    execute format(
      'create policy "no oauth clients" on public.%I as restrictive for all to anon, authenticated '
      'using ((select auth.jwt() ->> ''client_id'') is null) with check ((select auth.jwt() ->> ''client_id'') is null)', t);
  end loop;
end $$;
