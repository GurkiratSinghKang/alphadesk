"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * MetricRibbon — v2 Phase 1.2 Trade chrome per v2-plan §1.2.
 *
 * 8-cell metric ribbon mounted above the cockpit header. Voices the
 * v2 editorial typography while exposing the at-a-glance numbers
 * traders consult before staging an order. Each cell renders an
 * eyebrow label + mono numeric value.
 *
 * Cells (locked):
 *   1. Symbol      · ticker
 *   2. Last        · last trade price
 *   3. Bid × Ask   · best NBBO
 *   4. Spread      · ask − bid (bps)
 *   5. Day range   · low — high
 *   6. Volume/ADV  · volume ratio vs 30d ADV
 *   7. IV / Rank   · 30d IV + percentile rank
 *   8. Earnings    · days to next print or ✓ none
 *
 * Render is pure — caller passes the values. Missing values show as
 * em-dashes; the ribbon never crashes on partial data.
 */
export interface MetricRibbonProps {
  symbol: string | null | undefined;
  last: number | null | undefined;
  bid?: number | null;
  ask?: number | null;
  spreadBps?: number | null;
  dayLow?: number | null;
  dayHigh?: number | null;
  volume?: number | null;
  advRatio?: number | null;
  iv30d?: number | null;
  ivRank?: number | null;
  earningsInDays?: number | null;
  className?: string;
}

const dash = "—";

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return dash;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtVol(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dash;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}

interface CellProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "profit" | "loss" | "brand";
  className?: string;
}

function Cell({ label, value, hint, tone = "default", className }: CellProps) {
  return (
    <div
      className={cn(
        "min-w-0 px-3 py-2 border-r border-border-hair last:border-r-0 flex flex-col gap-0.5",
        className,
      )}
    >
      <span className="text-eyebrow uppercase tracking-[0.12em] text-fg-muted font-semibold">
        {label}
      </span>
      <span
        className={cn(
          "text-numeric-md font-mono tabular-nums truncate",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
          tone === "brand" && "text-brand",
          tone === "default" && "text-fg",
        )}
      >
        {value}
      </span>
      {hint && (
        <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-hint truncate">
          {hint}
        </span>
      )}
    </div>
  );
}

export default function MetricRibbon({
  symbol,
  last,
  bid,
  ask,
  spreadBps,
  dayLow,
  dayHigh,
  volume,
  advRatio,
  iv30d,
  ivRank,
  earningsInDays,
  className,
}: MetricRibbonProps) {
  const symLabel = (symbol ?? "—").toUpperCase();
  const earningsHint =
    earningsInDays == null
      ? dash
      : earningsInDays === 0
      ? "Today"
      : earningsInDays > 0
      ? `+${earningsInDays}d`
      : `${earningsInDays}d`;

  return (
    <section
      data-slot="metric-ribbon"
      aria-label="Symbol metrics"
      className={cn(
        "grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 rounded-md border border-border-hair bg-bg-elev-1 overflow-hidden",
        className,
      )}
    >
      <Cell label="Symbol" value={<span className="text-fg font-semibold">{symLabel}</span>} hint="Trade context" tone="brand" />
      <Cell label="Last" value={fmt(last)} hint={last != null ? "Live" : "—"} />
      <Cell
        label="Bid × Ask"
        value={
          bid != null && ask != null ? (
            <span>
              {fmt(bid)} <span className="text-fg-muted">×</span> {fmt(ask)}
            </span>
          ) : (
            dash
          )
        }
      />
      <Cell
        label="Spread"
        value={spreadBps != null ? `${spreadBps.toFixed(1)} bps` : dash}
        tone={spreadBps != null && spreadBps > 20 ? "loss" : "default"}
      />
      <Cell
        label="Day range"
        value={
          dayLow != null && dayHigh != null
            ? `${fmt(dayLow)} – ${fmt(dayHigh)}`
            : dash
        }
      />
      <Cell
        label="Volume / ADV"
        value={fmtVol(volume)}
        hint={advRatio != null ? `${advRatio.toFixed(2)}× ADV` : undefined}
      />
      <Cell
        label="IV / Rank"
        value={iv30d != null ? `${(iv30d * 100).toFixed(1)}%` : dash}
        hint={ivRank != null ? `Rank ${ivRank}` : undefined}
        tone={ivRank != null && ivRank > 75 ? "brand" : "default"}
      />
      <Cell
        label="Earnings"
        value={earningsHint}
        hint={earningsInDays != null && Math.abs(earningsInDays) <= 7 ? "Window" : undefined}
        tone={earningsInDays != null && Math.abs(earningsInDays) <= 3 ? "loss" : "default"}
      />
    </section>
  );
}
