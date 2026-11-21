"use client";
// Combo builder state (docs/18 §5.1): the user's own legs, 2–6, kept in this browser only. Persisted with
// skipHydration so server and first client render agree; <ComboTray/> rehydrates once on mount.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { legGone, legProblem, MAX_LEGS, type Leg } from "@/lib/combos";

interface ComboStore {
  legs: Leg[];
  open: boolean;
  /** Adds a leg; returns an error message when it can't (closed, past-dated, or an event already in the combo;
   *  Marc #15, #42). Same market again replaces the side. */
  add: (leg: Leg, now?: number) => string | null;
  /** Drops saved legs that closed or whose date has passed; returns how many went. */
  prune: (now?: number) => number;
  remove: (marketId: string) => void;
  clear: () => void;
  setOpen: (open: boolean) => void;
}

export const useCombo = create<ComboStore>()(
  persist(
    (set, get) => ({
      legs: [],
      open: false,
      add: (leg, now = Date.now() / 1000) => {
        const problem = legProblem(leg, get().legs, now);
        if (problem) return problem;
        const legs = get().legs.filter((l) => l.market_id !== leg.market_id);
        if (legs.length >= MAX_LEGS) return `A combo can have up to ${MAX_LEGS} legs.`;
        set({ legs: [...legs, leg] });
        return null;
      },
      prune: (now = Date.now() / 1000) => {
        const { legs } = get();
        const keep = legs.filter((l) => !legGone(l, now));
        if (keep.length !== legs.length) set({ legs: keep });
        return legs.length - keep.length;
      },
      remove: (id) => set((s) => ({ legs: s.legs.filter((l) => l.market_id !== id) })),
      clear: () => set({ legs: [], open: false }),
      setOpen: (open) => set({ open }),
    }),
    {
      name: "me-combo-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ legs: s.legs }),
      skipHydration: true,
    },
  ),
);
