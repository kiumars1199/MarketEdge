"use client";
// P6: below-the-fold rows (Big payouts, Combos, More bets with an edge) fetch only when the user scrolls near them,
// so a plain page load makes no protected API call and never starts the BotID challenge.
import { useEffect, useRef, useState } from "react";

/** [ref for a placeholder, whether it has come within `margin` of the viewport]. Latches true. No
 *  IntersectionObserver (old browsers, tests) = near at once. */
export function useNear<T extends Element = HTMLDivElement>(margin = "300px") {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near] as const;
}
