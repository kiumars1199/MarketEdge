// BillingDb over Supabase with the service role (webhook writes; RLS blocks users from writing tiers).
import { supabaseAdmin } from "@/lib/auth/server";
import type { BillingDb } from "./stripe";

const must = <T extends { error: { message: string } | null }>(r: T) => {
  if (r.error) throw new Error(r.error.message);
  return r;
};

export function supabaseBillingDb(): BillingDb {
  const db = supabaseAdmin();
  return {
    seen: async (id) => !!must(await db.from("stripe_events").select("id").eq("id", id).maybeSingle()).data,
    markSeen: async (id, type) => { must(await db.from("stripe_events").upsert({ id, type }, { onConflict: "id", ignoreDuplicates: true })); },
    linkCustomer: async (user_id, stripe_customer_id) => {
      must(await db.from("subscriptions").upsert({ user_id, stripe_customer_id, updated_at: new Date().toISOString() }, { onConflict: "user_id" }));
    },
    userForCustomer: async (customer) =>
      must(await db.from("subscriptions").select("user_id").eq("stripe_customer_id", customer).maybeSingle()).data?.user_id ?? null,
    customerOf: async (userId) => {
      const row = must(await db.from("subscriptions").select("stripe_customer_id, status").eq("user_id", userId).maybeSingle()).data;
      return { customer: row?.stripe_customer_id ?? null, status: row?.status ?? null };
    },
    emailFor: async (userId) => (await db.auth.admin.getUserById(userId)).data.user?.email ?? null,
    upsertSubscription: async (user_id, row) => {
      must(await db.from("subscriptions").upsert({ user_id, ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" }));
    },
  };
}
