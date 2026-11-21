// Site settings (T-141/T-142). Read fresh from app_settings; saved through /api/admin (validated, audited).
import { SettingsForm } from "@/components/admin/Controls";
import { requireAdmin } from "@/lib/admin/server";
import { bustSettings, getSettings } from "@/lib/settings";
import { tradingEnv } from "@/lib/trade/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdmin();
  bustSettings();
  const settings = await getSettings();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted">Changes apply on this server at once and on every server within a minute. Each change is recorded in the audit log.</p>
      <SettingsForm initial={settings} tradingOn={!!tradingEnv()} />
    </div>
  );
}
