"use client";

import { useUIStore } from "@/stores/ui";

/**
 * usePaperLive
 * ─────────────
 * v2 redesign — read access for the trading-mode (paper vs. live).
 * Wraps the existing `useUIStore.tradingMode` so dollar-amount
 * components do not need to know which store the value lives in,
 * and so future store moves (or a v2.x rename) only need to touch
 * this hook.
 *
 * NOTE: the underlying `tradingMode` is already persisted to
 * localStorage with cross-tab sync (preservation invariant #1
 * from PRESERVATION-REGISTER.md). DO NOT BYPASS this hook to
 * write directly — `setMode` runs through the same setter so the
 * cross-tab listener picks up the change in other open tabs.
 *
 * The paper→live flip in TopBar's PaperLiveToggle still triggers
 * the existing `confirmLiveOpen` safety gate in CommandPalette;
 * this hook does not own that flow, only the read.
 */
export interface PaperLiveState {
  mode: "paper" | "live";
  isPaper: boolean;
  isLive: boolean;
  setMode: (next: "paper" | "live") => void;
}

export function usePaperLive(): PaperLiveState {
  const mode = useUIStore((s) => s.tradingMode);
  const setMode = useUIStore((s) => s.setTradingMode);
  return {
    mode,
    isPaper: mode === "paper",
    isLive: mode === "live",
    setMode,
  };
}
