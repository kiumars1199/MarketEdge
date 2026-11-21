// #22 (Marc, Nov 20): where settings, saved views and My bets are kept, said the same way everywhere. With accounts on,
// everything is saved to the account (Supabase, row-level security: lib/repo/supabase.ts via /api/data), so it follows
// the user to every device. Demo mode (and a build without Supabase keys) keeps it in this browser (lib/repo/local.ts).
import { demoFlag } from "@/lib/config";

export const accountsOn = (
  demo = demoFlag(process.env.NEXT_PUBLIC_DEMO_MODE),
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
): boolean => !demo && !!url && !!anon;

export const savedWhere = (on = accountsOn()) => ({
  settings: on ? "Saved to your account, so they follow you to any device. Changes apply right away." : "Saved in this browser. Changes apply right away.",
  journal: on ? "Saved to your account." : "Stored on this device only.",
  log: on ? "Saved to My bets in your account." : "Saved on this device only.",
  bankroll: on ? "Money you set aside for betting. Saved to your account; only you can see it." : "Money you set aside for betting. Stays on this device.",
  data: on ? "Saved to your account (only you can read it). Download a copy any time." : "Everything is stored in this browser only. Nothing is sent to a server.",
});
