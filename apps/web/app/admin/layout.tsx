// /admin (T-141). requireAdmin() here and again in every page (layouts don't re-run on client navigation),
// so a non-admin or anonymous visitor gets the site's normal 404. Never indexed, never in the sitemap.
import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/Controls";
import { requireAdmin } from "@/lib/admin/server";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { admin } = await requireAdmin();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">Admin</h1>
        <p className="text-sm text-muted">Signed in as <span className="text-soft">{admin.email}</span></p>
      </div>
      <AdminNav />
      {children}
    </div>
  );
}
