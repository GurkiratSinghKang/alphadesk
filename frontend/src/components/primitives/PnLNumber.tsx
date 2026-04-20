import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * PnLNumber
 * ─────────
 * Tabular-mono P&L span. Color follows the sign via `text-profit` / `text-loss`
 * / `text-fg-muted` (for zero). Three format modes:
 *
 *  - `currency`  → `+$1,602` · `-$258`
 *  - `percent`   → `+1.8%` · `-1.1%`
 *  - `bps`       → `+24.38 bps`
 *
 * `abbreviate` shortens large dollar values to the 28.4M / 1.5K form.
 */
export type PnLFormat = "currency" | "percent" | "bps";

export interface PnLNumberProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  value: number;
  format: PnLFormat;
  /** Show explicit + for positive values. Default true. */
  showSign?: boolean;
  /** Abbreviate currency ($1.2K, $28.4M). Ignored for percent / bps. */
  abbreviate?: boolean;
  /** Force a specific tone; defaults to sign-derived. */
  tone?: "profit" | "loss" | "neutral";
}

function abbreviateValue(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(abs >= 100_000_000_000 ? 0 : 1) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(abs >= 100_000_000 ? 0 : 1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(abs >= 100_000 ? 0 : 1) + "K";
  return n.toFixed(0);
}

function formatValue(value: number, format: PnLFormat, abbreviate: boolean): string {
  if (format === "currency") {
    if (abbreviate) {
      const absStr = abbreviateValue(Math.abs(value));
      return `$${absStr}`;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
      maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
    })
      .format(Math.abs(value));
  }
  if (format === "percent") {
    return `${Math.abs(value).toFixed(Math.abs(value) < 10 ? 2 : 1)}%`;
  }
  // bps
  return `${Math.abs(value).toFixed(2)} bps`;
}

export default function PnLNumber({
  value,
  format,
  showSign = true,
  abbreviate = false,
  tone,
  className,
  ...rest
}: PnLNumberProps) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const sign = safeValue > 0 ? "+" : safeValue < 0 ? "-" : "";
  const resolvedTone =
    tone ?? (safeValue > 0 ? "profit" : safeValue < 0 ? "loss" : "neutral");
  const toneCls =
    resolvedTone === "profit"
      ? "text-profit"
      : resolvedTone === "loss"
        ? "text-loss"
        : "text-fg-muted";

  const body = formatValue(safeValue, format, abbreviate);
  const prefix = showSign ? sign : "";

  return (
    <span
      data-slot="pnl-number"
      data-tone={resolvedTone}
      className={cn("font-mono tabular-nums", toneCls, className)}
      {...rest}
    >
      {prefix}
      {body}
    </span>
  );
}
