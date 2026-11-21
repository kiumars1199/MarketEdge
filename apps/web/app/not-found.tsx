// 404 (T-76): same shell as every page, so the header, footer and disclaimer stay.
import Link from "next/link";
import { btnGhost, btnPrimary } from "@/components/kit/classes";   // not the kit: its client code would load on every page

export const metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 py-16 md:py-24">
      <p className="font-heading text-sm font-semibold tabular-nums text-accent">404</p>
      <h1 className="text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">This page doesn&apos;t exist</h1>
      <p className="text-[15px] leading-relaxed text-muted">The link may be old, or the market may have closed and dropped out of the scan.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href="/" className={btnPrimary}>Go to Best bets</Link>
        <Link href="/markets" className={btnGhost}>Browse all markets</Link>
      </div>
    </section>
  );
}
