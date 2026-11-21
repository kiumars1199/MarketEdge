// Supabase Auth emails (confirm, magic link, reset, email change) carry the same footer as our own mail: the
// disclaimer and an unsubscribe link (docs/OVERNIGHT §3 item 10). The committed files in
// supabase/templates/ must match what lib/email/templates.ts renders; regenerate with UPDATE_TEMPLATES=1.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_EMAILS, DISCLAIMER, authEmailHtml } from "@/lib/email/templates";

const DIR = join(__dirname, "../../../supabase/templates");
const BANNED = /\b(pick|lock|guaranteed|sure thing|can't lose)\b/i;

describe("Supabase auth email templates", () => {
  for (const kind of Object.keys(AUTH_EMAILS) as (keyof typeof AUTH_EMAILS)[]) {
    it(`${kind}: disclaimer, unsubscribe link, confirmation URL, committed copy up to date`, () => {
      const html = authEmailHtml(kind);
      expect(html).toContain(DISCLAIMER);
      expect(html).toContain('href="{{ .ConfirmationURL }}"');
      expect(html).toContain('href="{{ .SiteURL }}/alerts"');
      expect(html).toMatch(/Unsubscribe/);
      expect(html).not.toMatch(BANNED);
      const file = join(DIR, `${kind}.html`);
      if (process.env.UPDATE_TEMPLATES === "1") writeFileSync(file, html + "\n");
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toBe(html + "\n");
    });
  }
});
