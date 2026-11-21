-- T-280: the 3-session limit (20261117000000_init.sql) counts sign-ins on devices. Sessions created by the OAuth 2.1
-- server for an approved app (the Kismet MCP connector in Claude, ChatGPT or Cursor) carry auth.sessions.oauth_client_id.
-- Counted together, connecting an assistant would sign a browser out, and a new browser sign-in would silently cut the
-- assistant off. So the two kinds are capped separately: at most 3 browser sessions (unchanged) and at most 3 app
-- connections per user. App tokens can't read any table (20261120000000_oauth_clients_no_tables.sql), so they are no
-- way around the device limit on the site.
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
        and (oauth_client_id is null) = (new.oauth_client_id is null)
      order by created_at desc
      offset 3
    );
  return null;
end;
$$;
revoke execute on function public.enforce_session_limit() from public, anon, authenticated;
