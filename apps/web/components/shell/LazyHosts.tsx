"use client";
// Site-wide hosts that render nothing until the user acts or a fetch returns (drawer, shortcuts, trade ticket,
// combo tray, alert runner, account boot, display prefs). Loaded after hydration in their own chunks, so first paint and hydration don't pay for them (Lighthouse
// TBT/LCP, audit run 2 fail 6). AuthBoot and DisplayEffects only act in effects (after hydration) anyway.
import dynamic from "next/dynamic";

const DrawerHost = dynamic(() => import("@/components/market/DrawerGate").then((m) => m.DrawerHost), { ssr: false });
const Shortcuts = dynamic(() => import("@/components/keyboard/Shortcuts").then((m) => m.Shortcuts), { ssr: false });
const TicketHost = dynamic(() => import("@/components/trade/TradeTicket").then((m) => m.TicketHost), { ssr: false });
const ComboTray = dynamic(() => import("@/components/combo/ComboTray").then((m) => m.ComboTray), { ssr: false });
const AlertRunner = dynamic(() => import("@/components/alerts/AlertRunner").then((m) => m.AlertRunner), { ssr: false });
const AuthBoot = dynamic(() => import("@/components/auth/AuthBoot").then((m) => m.AuthBoot), { ssr: false });
const DisplayEffects = dynamic(() => import("@/components/settings/DisplayEffects").then((m) => m.DisplayEffects), { ssr: false });

export function LazyHosts() {
  return (
    <>
      <DrawerHost />
      <Shortcuts />
      <TicketHost />
      <ComboTray />
      <AlertRunner />
      <AuthBoot />
      <DisplayEffects />
    </>
  );
}
