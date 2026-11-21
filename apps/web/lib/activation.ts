import "server-only";
// T-276 admin activation: stamp profiles.first_bets_at once, on a signed-in user's first Best bets render.
// Best effort and after the response: before the owner applies 20261119000500_first_bets_visit.sql the column is
// missing, the update fails and nothing else changes. Service role, because the column is server-owned.
import { after } from "next/server";
import { adminEnabled, supabaseAdmin } from "@/lib/auth/server";

export function markFirstBetsVisit(userId: string, now = new Date()): void {
  if (!adminEnabled()) return;
  after(async () => {
    try {
      await supabaseAdmin().from("profiles").update({ first_bets_at: now.toISOString() }).eq("user_id", userId).is("first_bets_at", null);
    } catch { /* counts only; never break the page */ }
  });
}
