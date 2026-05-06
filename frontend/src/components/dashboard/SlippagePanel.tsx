"use client";

import { useEffect, useState } from "react";
import { Activity, TrendingUp } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { getSlippageSummary, type SlippageSummary } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────

interface SlippagePanelProps {
  /** Inclusive lower-bound entry-time filter (YYYY-MM-DD). Defaults to no bound. */
  startDate?: string;
  /** Inclusive upper-bound entry-time filter (YYYY-MM-DD). Defaults to no bound. */
  endDate?: string;
  /** Restrict to a single strategy id. Defaults to all strategies. */
  strategy?: string;
  /**
   * Pre-loaded summary — when supplied skips the fetch entirely. Used
   * by the unit tests to render deterministic data without mocking the
   * API layer.
   */
  initialSummary?: SlippageSummary | null;
}

// ─── Number formatting helpers ─────────────────────────────

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  // ``slippage_pct`` is a fraction. Multiply by 100 for display and
  // show two decimals so 0.0267 surfaces as "+2.67%". Sign matters —
  // negative is a fill BETTER than mid (good!).
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatDollars(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return formatCurrency(value);
}

// ─── Component ─────────────────────────────────────────────

export function SlippagePanel({
  startDate,
  endDate,
  strategy,
  initialSummary,
}: SlippagePanelProps) {
  // When a deterministic summary is injected (tests, storybook) seed
  // both summary and loading state at mount so the effect never has to
  // re-set them synchronously on the first render.
  const seedFromProp = initialSummary !== undefined;
  const [summary, setSummary] = useState<SlippageSummary | null>(
    seedFromProp ? (initialSummary ?? null) : null,
  );
  const [loading, setLoading] = useState<boolean>(!seedFromProp);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (seedFromProp) {
      // Tests/storybook path: nothing to fetch.
      return;
    }

    let cancelled = false;
    // Don't reset loading/error synchronously here — initial values
    // already have loading=true/error=null and an in-flight refetch
    // can keep showing the previous data until the new response lands.
    getSlippageSummary({ startDate, endDate, strategy })
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, strategy, seedFromProp]);

  if (loading) {
    return (
      <Shell>
        <p className="t-label text-fg-muted">Loading execution data…</p>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <p className="t-label text-[var(--loss)]">
          Could not load execution data: {error}
        </p>
      </Shell>
    );
  }

  // Empty state — no trades have target_price yet. We deliberately
  // distinguish "no rows in window" (null/0) from "rows exist but none
  // captured target_price" (trades_without_target > 0) so the operator
  // gets actionable copy.
  const hasMetrics = summary != null && summary.total_trades > 0;
  if (!hasMetrics) {
    return (
      <Shell>
        <div className="py-6 text-center">
          <p className="t-meta text-fg-muted mb-2">
            No execution data yet — submit an order with patient mid-pricing
            to start measuring.
          </p>
          {summary != null && summary.trades_without_target > 0 ? (
            <p className="t-meta text-fg-muted">
              {summary.trades_without_target} legacy trade
              {summary.trades_without_target === 1 ? "" : "s"} in this window
              pre-date execution telemetry.
            </p>
          ) : null}
        </div>
      </Shell>
    );
  }

  // Sort by total leakage descending so worst offenders surface first.
  const strategyRows = Object.entries(summary.by_strategy)
    .map(([name, b]) => ({ name, ...b }))
    .sort((a, b) => b.total_dollars_leaked - a.total_dollars_leaked);

  const fillModes = Object.entries(summary.fill_mode_comparison);
  const showFillModeRow = fillModes.length >= 2;

  return (
    <Shell>
      {/* Headline metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Metric
          label="Avg slippage"
          value={formatPct(summary.avg_slippage_pct)}
          tone={toneFor(summary.avg_slippage_pct)}
        />
        <Metric
          label="Median"
          value={formatPct(summary.median_slippage_pct)}
          tone={toneFor(summary.median_slippage_pct)}
        />
        <Metric
          label="p90"
          value={formatPct(summary.p90_slippage_pct)}
          tone={toneFor(summary.p90_slippage_pct)}
        />
        <Metric
          label="$ leaked"
          value={formatDollars(summary.total_dollars_leaked)}
          tone={summary.total_dollars_leaked > 0 ? "loss" : "neutral"}
        />
      </div>

      {/* Per-strategy table */}
      {strategyRows.length > 0 ? (
        <div className="mb-4">
          <p className="t-label mb-2">By strategy</p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-label tabular-nums">
              <thead className="bg-bg-elev-1/40">
                <tr>
                  <th className="t-label text-left px-3 py-1.5">Strategy</th>
                  <th className="t-label text-right px-3 py-1.5">Trades</th>
                  <th className="t-label text-right px-3 py-1.5">Avg slip</th>
                  <th className="t-label text-right px-3 py-1.5">$ leaked</th>
                </tr>
              </thead>
              <tbody>
                {strategyRows.map((row) => (
                  <tr key={row.name} className="border-t border-border">
                    <td className="px-3 py-1.5 text-ink-1000 font-display italic">
                      {row.name}
                    </td>
                    <td className="px-3 py-1.5 text-right text-ink-1000">
                      {row.trades}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right font-mono",
                        toneClass(toneFor(row.avg_slippage_pct)),
                      )}
                    >
                      {formatPct(row.avg_slippage_pct)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-ink-1000">
                      {formatDollars(row.total_dollars_leaked)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Patient vs immediate comparison */}
      {showFillModeRow ? (
        <div>
          <p className="t-label mb-2">Patient vs immediate</p>
          <div className="grid grid-cols-2 gap-3">
            {fillModes.map(([mode, b]) => (
              <div
                key={mode}
                className="rounded-md border border-border bg-bg-elev-1/30 px-3 py-2"
              >
                <p className="t-label capitalize mb-0.5">{mode}</p>
                <p
                  className={cn(
                    "t-num-md tabular-nums",
                    toneClass(toneFor(b.avg_slippage_pct)),
                  )}
                >
                  {formatPct(b.avg_slippage_pct)}
                </p>
                <p className="t-meta text-fg-muted mt-0.5">
                  {b.trades} trade{b.trades === 1 ? "" : "s"} ·{" "}
                  {formatDollars(b.total_dollars_leaked)} leaked
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

// ─── Internal sub-components ───────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  // Same outer surface as the other dashboard widgets so the panel
  // drops into either the reports page section grid or the admin
  // control-center two-column layout without adjustments.
  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Activity className="h-4 w-4 text-fg-muted shrink-0" aria-hidden />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="t-label">§ EXECUTION</span>
          <h2 className="t-section-display text-ink-1000 truncate">
            Execution Quality
          </h2>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss" | "neutral";
}) {
  return (
    <div className="rounded-md border border-border bg-bg-elev-1/30 px-3 py-2">
      <p className="t-label mb-0.5">{label}</p>
      <p className={cn("t-num-lg tabular-nums", toneClass(tone))}>{value}</p>
    </div>
  );
}

function toneFor(value: number | null | undefined): "profit" | "loss" | "neutral" {
  if (value == null) return "neutral";
  // Slippage percentages: positive = trader did worse than mid (loss colour),
  // negative = better than mid (profit colour). Use a small dead-band so
  // sub-bps noise doesn't get coloured.
  if (value > 0.001) return "loss";
  if (value < -0.001) return "profit";
  return "neutral";
}

function toneClass(tone: "profit" | "loss" | "neutral"): string {
  if (tone === "profit") return "text-[var(--profit)]";
  if (tone === "loss") return "text-[var(--loss)]";
  return "text-ink-1000";
}

// Re-export the shared icon import so the reports page section header
// can match the panel's lead glyph if it wants.
export const SlippagePanelIcon = TrendingUp;
