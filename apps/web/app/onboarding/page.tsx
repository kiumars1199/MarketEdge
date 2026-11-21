import { Onboarding } from "@/components/onboarding/Onboarding";
import { safeNext } from "@/lib/auth/server";

export const metadata = { title: "Get started", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const raw = (await searchParams).next;
  return <Onboarding next={safeNext(typeof raw === "string" ? raw : undefined, "") || undefined} />;
}
