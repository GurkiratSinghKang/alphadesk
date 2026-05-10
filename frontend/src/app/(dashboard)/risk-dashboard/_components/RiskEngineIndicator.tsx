"use client";

import { useCallback, useEffect, useState } from "react";

import { recomputeRiskDashboard } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Top-right Risk hero indicator + Recompute button per risk-dark.png.
 *
 * Renders a "● Risk engine · {Ns} ago" status pill alongside a
 * Recompute button. The button POSTs /api/v1/risk/recompute (added in
 * the same backend PR as this component); the response shape is
 * RiskDashboard but we don't propagate it here — the existing
 * dashboard polling at the page level picks up the freshened numbers
 * within a tick.
 *
 * Live timestamp ticks every second so the operator sees the staleness
 * grow visually instead of staring at a frozen "—".
 */
export default function RiskEngineIndicator() {
  const [lastComputedMs, setLastComputedMs] = useState<number>(() => Date.now());
  const [tick, setTick] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tick the elapsed-seconds display every second.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsedSec = Math.max(0, Math.floor((Date.now() - lastComputedMs) / 1000));
  const elapsedLabel = elapsedSec < 60
    ? `${elapsedSec}s ago`
    : elapsedSec < 3600
      ? `${Math.floor(elapsedSec / 60)}m ago`
      : `${Math.floor(elapsedSec / 3600)}h ago`;
  // Dot color reflects freshness — green within polling cadence (60s),
  // amber when stale, coral when very stale.
  const dotClass = elapsedSec < 60
    ? "bg-profit"
    : elapsedSec < 300
      ? "bg-amber"
      : "bg-loss";

  const onRecompute = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await recomputeRiskDashboard();
      setLastComputedMs(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recompute failed");
    } finally {
      setSubmitting(false);
    }
  }, [submitting]);

  // Read the tick to keep the elapsed label live (linter would warn
  // if we computed without referencing tick — useEffect drives state
  // but elapsedSec is computed on render).
  void tick;

  return (
    <div className="flex items-center gap-3 shrink-0">
      <span className="flex items-center gap-1.5 font-mono text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotClass)} aria-hidden />
        Risk engine
        <span className="text-fg-muted/70">· {elapsedLabel}</span>
      </span>
      <button
        type="button"
        onClick={onRecompute}
        disabled={submitting}
        title={
          error
            ? `Last attempt: ${error}`
            : submitting
              ? "Recomputing…"
              : "Force a fresh recomputation of the risk dashboard"
        }
        className={cn(
          "rounded-sm border border-border bg-bg-elev-2 px-2.5 py-1 font-mono text-eyebrow font-semibold uppercase tracking-[0.08em] transition-colors",
          submitting
            ? "text-fg-muted opacity-60 cursor-wait"
            : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
        )}
      >
        {submitting ? "Recomputing…" : "Recompute"}
      </button>
    </div>
  );
}
