// Log in (docs/14 §1, T-41, docs/19 P2): Google (when enabled), email + password, or an email link. 18+ and Terms box required.
import { AuthPage } from "@/components/auth/AuthPage";

export const metadata = { title: "Log in", robots: { index: false } };
export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <AuthPage mode="login" searchParams={searchParams} />;
}
