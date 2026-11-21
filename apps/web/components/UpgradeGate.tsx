"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEntitlements, type Feature } from "@/lib/entitlements";
import { track } from "@/lib/telemetry";

/** Renders children when the tier has `feature`; otherwise a blurred, inert preview with an upgrade link. */
export function UpgradeGate({ feature, children }: { feature: Feature; children: ReactNode }) {
  const { can, known } = useEntitlements();
  if (can(feature)) return <>{children}</>;
  // #40: plan not known yet (a paid user's first second on the page): a quiet placeholder, no upgrade pitch
  if (!known) return <div aria-busy="true" inert className="pointer-events-none select-none opacity-40">{children}</div>;
  return (
    <div className="relative">
      <div aria-hidden="true" inert className="pointer-events-none select-none blur-sm">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <Link
          href="/pricing"
          onClick={() => track("upgrade_clicked", { feature })}
          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black shadow"
        >
          Upgrade to unlock
        </Link>
      </div>
    </div>
  );
}
