"use client";
import { useSyncExternalStore } from "react";

const Q = "(min-width: 768px)";
const sub = (cb: () => void) => {
  const m = window.matchMedia(Q);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** md breakpoint and up: rows; below: cards. Server render assumes desktop. */
export const useDesktop = () => useSyncExternalStore(sub, () => window.matchMedia(Q).matches, () => true);
