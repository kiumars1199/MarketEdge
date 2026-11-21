// The 18+/Terms tick has to survive the email or Google round trip: a short-lived HttpOnly cookie set when
// the user submits the sign-in form, consumed by /auth/callback (stored as profiles.accepted_terms_at).
import { cookies } from "next/headers";
import { COOKIE_OPTIONS } from "./server";

export const TERMS_COOKIE = "me_terms";

export async function rememberTerms() {
  (await cookies()).set(TERMS_COOKIE, new Date().toISOString(), { ...COOKIE_OPTIONS, maxAge: 60 * 60 });
}

/** The time the box was ticked, if it was in this browser within the last hour. Clears the cookie. */
export async function takeTerms(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(TERMS_COOKIE)?.value ?? null;
  if (v) jar.delete(TERMS_COOKIE);
  return v && !Number.isNaN(Date.parse(v)) ? v : null;
}
