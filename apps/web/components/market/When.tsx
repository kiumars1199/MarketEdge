"use client";
// Close times on cards and the market page (T-288): the user's zone from the first render, one clock, one rounding
// rule. The shared clock lives in components/clock.tsx.
export { useWhen } from "@/components/clock";
