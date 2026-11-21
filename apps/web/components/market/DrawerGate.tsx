"use client";
// Loaded by LazyHosts as the site-wide drawer host. The real DrawerHost (MarketDetail, ~13 kB) is fetched only once a
// URL asks for the drawer (?m=<market id>), not on every page load (Lighthouse TBT, AUDIT run 3 fail 5).
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/me";

const Host = dynamic(() => import("./DrawerHost").then((m) => m.DrawerHost), { ssr: false });

export function DrawerHost() {
  const id = useSearchParams().get("m");
  const me = useMe();
  // T-276: the drawer's data needs an account. A signed-out click (a landing card) goes to sign-up, then to the market.
  const signedOut = !!me?.auth && !me.user;
  useEffect(() => {
    if (id && signedOut) window.location.assign(`/signup?next=${encodeURIComponent(`/m/${id}`)}`);
  }, [id, signedOut]);
  return id && !signedOut ? <Host /> : null;
}
