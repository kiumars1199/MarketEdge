"use client";
// Applies display prefs from the profile to <html> (T-34): data-theme (globals.css [data-theme="light"])
// and data-density (compact scales the rem base). Mounted once in app/layout.tsx.
import { useEffect } from "react";
import { useProfile } from "@/lib/repo/hooks";

export function DisplayEffects() {
  const { theme, density } = useProfile();
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.theme = theme;
    html.dataset.density = density;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f7faf8" : "#070a09");
  }, [theme, density]);
  return null;
}
