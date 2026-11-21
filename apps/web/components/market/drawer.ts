// Drawer URL helpers (?m=<market id>&side=<0|1>), kept apart from DrawerHost so cards, the header bell and the
// screeners don't pull MarketDetail into every page's first load (it loads lazily with DrawerHost, LazyHosts.tsx).
import { usePathname, useSearchParams } from "next/navigation";
import { softNav } from "@/lib/softNav";
import { useCallback } from "react";

/** Query string that opens the drawer, keeping the other params of `current` (e.g. the screener filters). */
export function drawerHref(marketId: string, side?: 0 | 1, current?: string | URLSearchParams): string {
  const p = new URLSearchParams(current);
  p.set("m", marketId);
  if (side === undefined) p.delete("side");
  else p.set("side", String(side));
  return `?${p}`;
}

/** Open / close the drawer from any page: `const { open, close } = useOpenDrawer()`. */
export function useOpenDrawer() {
  const pathname = usePathname();
  const params = useSearchParams();
  const open = useCallback(
    (marketId: string, side?: 0 | 1) => softNav(pathname + drawerHref(marketId, side, params)),
    [pathname, params],
  );
  const close = useCallback(() => {
    const p = new URLSearchParams(params);
    p.delete("m");
    p.delete("side");
    const qs = p.toString();
    softNav(qs ? `${pathname}?${qs}` : pathname, { replace: true });
  }, [pathname, params]);
  return { open, close };
}
