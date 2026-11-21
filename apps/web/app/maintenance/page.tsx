// Shown (with a 503) to everyone except admins while maintenance mode is on (middleware.ts, T-142).
// Same shell as every page, so the footer disclaimer stays.

export const metadata = { title: "Down for maintenance", robots: { index: false } };

export default function Maintenance() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 py-16 md:py-24">
      <span className="flex size-11 items-center justify-center rounded-input bg-accent-bg text-accent-soft" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
        </svg>
      </span>
      <h1 className="text-[32px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[40px]">Down for maintenance</h1>
      <p className="text-[15px] leading-relaxed text-muted">
        We&apos;re updating Kismet. Your account, saved views and My list are safe. Check back in a few minutes.
      </p>
    </section>
  );
}
