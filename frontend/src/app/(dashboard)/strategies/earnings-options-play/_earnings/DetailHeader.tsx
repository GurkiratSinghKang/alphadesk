"use client";

import { useEffect, useRef } from "react";
import type { EarningsReportTime } from "@/types";
import type { SelectionSource } from "../page";
import { fmtCurrency, fmtDate, fmtPct } from "@/lib/intl";
import { fmtRelativeTime, useTick } from "@/lib/time";

export interface DetailHeaderProps {
  symbol: string;
  company: string;
  sector: string;
  // Nullable for stub-detail responses — see B-41 in earnings_screener.py.
  reportDate: string | null;
  reportTime: EarningsReportTime;
  quote: { last: number; change: number; changePct: number } | null;
  /** ISO datetime of the most-recent detail snapshot. Surfaces as the
   *  "Updated 5 m ago" label in the header. */
  generatedAt?: string;
  /** Round-4 (B-NEW-4): whether to autofocus the heading on symbol
   *  change. Pointer selections suppress autofocus to avoid stealing
   *  focus mid-click; keyboard / URL selections want focus restoration. */
  selectionSource?: SelectionSource;
}

export default function DetailHeader({
  symbol, company, sector, reportDate, reportTime, quote, generatedAt,
  selectionSource = null,
}: DetailHeaderProps) {
  const change = quote?.change ?? null;
  const changePct = quote?.changePct ?? null;
  const isNeg = (change ?? 0) < 0;
  const reportTiming = describeReportTiming(reportTime);

  // Round-4 (CLUSTER E/14): 15s tick re-evaluates the freshness/relative
  // text without refetching the detail payload. Don't tick MetricsStrip
  // or StrikeLadder — those decay only on data refresh, not the wall
  // clock.
  //
  // Round-7 / EP-4: the LIVE → DELAYED threshold sits at 30s but the
  // 15s tick means the pill could lie for up to 15s past the boundary.
  // The pill is positioned next to the price so a 40-45s-old quote
  // still rendered "LIVE" was a real risk — at 5s tick we're never
  // more than 5s stale around the 30s edge, which is below human
  // perception for a price-decision affordance. Cost is one extra
  // re-render every 5s of an unchanged header — negligible.
  useTick(5_000);
  const freshness = getFreshness(generatedAt);

  // Round-4 (B-NEW-4): autofocus the H2 only on keyboard / URL selection
  // sources. Pointer-driven selections shouldn't rip focus off the
  // click target.
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (selectionSource === "keyboard" || selectionSource === "url") {
      headingRef.current?.focus();
    }
    // We _intentionally_ depend on `symbol` here — when the user navigates
    // to a different symbol via keyboard, refocus the new heading. Pointer
    // selections also change `symbol` but selectionSource gates the focus.
  }, [symbol, selectionSource]);

  return (
    <header
      data-slot="detail-header"
      className="flex items-baseline justify-between gap-6 border-b border-[color:var(--border)] pb-3"
    >
      <div>
        <p className="t-label">§ EARNINGS · OPTIONS PLAY</p>
        {/* B-56 headingRef + tabIndex={-1}: parent moves focus here after a
            filter-driven symbol change so SR users land on the new symbol.
            B-90 id: the parent <section aria-labelledby="detail-header-title">
            uses it to name the detail region. */}
        <h2
          id="detail-header-title"
          ref={headingRef}
          tabIndex={-1}
          className="t-display-section italic mt-1 outline-none"
        >
          {company} <span className="text-[color:var(--fg-dim)]">· {symbol}</span>
        </h2>
        <p className="t-meta mt-1">
          {sector} · Reports {reportDate ? formatReportDate(reportDate) : "—"} ·{" "}
          <span title={reportTiming.help}>{reportTiming.label}</span>
        </p>
        {generatedAt && (
          <p
            data-slot="detail-updated"
            className="t-meta mt-0.5 u-muted"
            title={generatedAt}
          >
            Updated {fmtRelativeTime(generatedAt)}
          </p>
        )}
      </div>
      <div className="text-right">
        <div className="flex items-center justify-end gap-2">
          {freshness && (
            <span
              data-slot="freshness-pill"
              title={generatedAt}
              aria-label={freshness.kind === "live" ? "Live price" : `Delayed price, ${freshness.age}`}
              className={
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 t-mono text-[10px] uppercase tracking-wide " +
                (freshness.kind === "live"
                  ? "border-[color:var(--profit)] text-[color:var(--profit)]"
                  : "border-[color:var(--border)] u-muted")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "h-1.5 w-1.5 rounded-full " +
                  (freshness.kind === "live"
                    ? "bg-[color:var(--profit)]"
                    : "bg-[color:var(--fg-muted)]")
                }
              />
              {freshness.kind === "live" ? "LIVE" : `DELAYED ${freshness.age}`}
            </span>
          )}
          <div className="t-num-hero">
            {quote ? fmtCurrency(quote.last, "USD") : "—"}
          </div>
        </div>
        <div className={"t-mono text-[13px] " + (isNeg ? "u-loss" : "u-profit")}>
          {change == null
            ? "—"
            : /* Round-8 visual-bug DH1: ``changePct`` is a percentage
                 across the codebase (MarketMovers.tsx, LiveSignalFeed,
                 SectorTreemap all treat ``2.15`` as "+2.15%"), but
                 ``fmtPct`` uses ``Intl.NumberFormat({style:"percent"})``
                 which multiplies the input by 100 (expects decimals).
                 So a real 2.15% rendered as 215% — a $2.62 drop on a
                 $121.75 stock landed as ``-211.00%`` on the live page,
                 a clearly impossible value that erodes user trust. Pass
                 the value through ``/100`` to convert to the decimal
                 fraction the locale formatter expects. ``signDisplay``
                 keeps the sign visible to match the dollar change. */
              `${fmtCurrency(change, "USD", { signDisplay: "always" })} · ${fmtPct((changePct ?? 0) / 100, 2, { signDisplay: "always" })}`}
        </div>
      </div>
    </header>
  );
}

/**
 * Convert a generatedAt timestamp into a LIVE/DELAYED pill descriptor.
 * <30s old reads as live; otherwise shows the short relative age.
 */
function getFreshness(iso: string | undefined): { kind: "live" | "delayed"; age: string } | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const ageSec = (Date.now() - then) / 1000;
  if (ageSec < 30) return { kind: "live", age: "just now" };
  return { kind: "delayed", age: fmtRelativeTime(iso) };
}

function formatReportDate(iso: string): string {
  // Locale-aware via Intl — formats in the viewer's timezone and locale.
  return fmtDate(iso, { weekday: "short", month: "short", day: "numeric" });
}

function describeReportTiming(reportTime: EarningsReportTime): { label: string; help: string } {
  switch (reportTime) {
    case "BMO":
      return {
        label: "BMO (before open)",
        help: "Provider says the company reports before the market opens.",
      };
    case "AMC":
      return {
        label: "AMC (after close)",
        help: "Provider says the company reports after the market closes.",
      };
    default:
      return {
        label: "DMT (unconfirmed)",
        help: "Provider did not confirm before-open or after-close timing; verify before placing an earnings order.",
      };
  }
}
