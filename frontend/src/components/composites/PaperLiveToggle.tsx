"use client";

import * as React from "react";

import { useToast } from "@/hooks/useToast";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

/**
 * PaperLiveToggle
 * ────────────────
 * v2 redesign — first-class top-bar segmented control for the
 * paper / live trading mode (per v2-plan §13). Visual: 24px tall
 * pair of buttons with red tint on the active "Live" segment.
 *
 * State source: existing `useUIStore.tradingMode`. Persistence +
 * cross-tab sync are inherited from that store and explicitly
 * preserved (PRESERVATION-REGISTER invariant #1 — flipping live in
 * tab A must propagate to tab B).
 *
 * Safety gate: paper→live is admin-gated. The CommandPalette already
 * owns the canonical flow (see lines 191-227). To avoid duplicating
 * that copy, PaperLiveToggle mimics the same outcome inline:
 *
 *   - live → paper: switches immediately + info toast.
 *   - paper → live: NO flip; shows the existing admin-gated toast.
 *
 * Round-10 / W-2 noted that the previous flow let a user convince
 * themselves they were live while the backend was still paper. That
 * fix is preserved here — we never flip to live client-side without
 * the operator endpoint.
 */
export interface PaperLiveToggleProps {
  /** Optional className override on the outer wrapper. */
  className?: string;
  /**
   * Visual variant. `default` is the top-bar pill; `compact` removes
   * the labels and uses just dots, suitable for very narrow chrome
   * (e.g. mobile drawer head).
   */
  variant?: "default" | "compact";
}

export default function PaperLiveToggle({
  className,
  variant = "default",
}: PaperLiveToggleProps) {
  const mode = useUIStore((s) => s.tradingMode);
  const setMode = useUIStore((s) => s.setTradingMode);
  const { toast } = useToast();

  const setPaper = React.useCallback(() => {
    if (mode === "paper") return;
    setMode("paper");
    toast({ type: "info", message: "Switched to paper trading" });
  }, [mode, setMode, toast]);

  const requestLive = React.useCallback(() => {
    if (mode === "live") return;
    // Per Round-10 / W-2: do NOT flip to live client-side. The
    // backend has no `/auth/switch-mode` endpoint; live posture
    // requires operator action. Mirror the CommandPalette toast
    // copy verbatim so users never see two contradictory truths
    // ("Live enabled" here vs. "admin-gated" there).
    toast({
      type: "info",
      message:
        "Live trading is admin-gated — contact your AlphaDesk operator to enable real-capital orders.",
    });
  }, [mode, toast]);

  const isCompact = variant === "compact";

  return (
    <div
      role="group"
      aria-label="Trading mode"
      data-slot="paper-live-toggle"
      data-mode={mode}
      className={cn(
        "inline-flex items-stretch rounded-pill border border-border-strong bg-bg-elev-1",
        isCompact ? "h-7 p-0.5" : "h-7 p-0.5",
        className,
      )}
    >
      <button
        type="button"
        onClick={setPaper}
        aria-pressed={mode === "paper"}
        aria-label={`Paper trading${mode === "paper" ? " (active)" : ""}`}
        className={cn(
          "inline-flex items-center justify-center rounded-pill px-2.5 text-eyebrow font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          mode === "paper"
            ? "bg-bg-elev-2 text-fg shadow-hair"
            : "text-fg-muted hover:text-fg",
        )}
      >
        {isCompact ? "P" : "Paper"}
      </button>
      <button
        type="button"
        onClick={requestLive}
        aria-pressed={mode === "live"}
        aria-label={`Live trading${mode === "live" ? " (active)" : ""}`}
        className={cn(
          "inline-flex items-center justify-center rounded-pill px-2.5 text-eyebrow font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss",
          mode === "live"
            ? "bg-loss/90 text-loss-foreground shadow-hair"
            : "text-fg-muted hover:text-loss",
        )}
      >
        {isCompact ? "L" : "Live"}
      </button>
    </div>
  );
}
