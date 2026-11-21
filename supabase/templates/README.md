# Supabase Auth email templates

Supabase sends the sign-up confirmation, magic link, password reset and email-change emails itself. These files are
the Kismet versions (same layout, disclaimer and account link as our own mail), rendered from
`apps/web/lib/email/templates.ts` (`AUTH_EMAILS`). Don't edit them by hand: change the source and run
`UPDATE_TEMPLATES=1 npx vitest run test/auth-email-templates.test.ts` in `apps/web`.

Owner step: Supabase dashboard → Authentication → Email Templates. For each template paste the file's HTML and set
the subject:

| Template | File | Subject |
|---|---|---|
| Confirm signup | confirmation.html | Confirm your Kismet account |
| Magic Link | magic_link.html | Your Kismet sign-in link |
| Reset Password | recovery.html | Reset your Kismet password |
| Change Email Address | email_change.html | Confirm your new Kismet email |
