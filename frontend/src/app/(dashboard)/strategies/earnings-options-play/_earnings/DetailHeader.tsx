"use client";

import { useEffect, useRef } from "react";
import type { EarningsReportTime, Quote } from "@/types";
import type { SelectionSource } from "../page";
import { fmtDate } from "@/lib/intl";
import { fmtRelativeTime } from "@/lib/time";
import TickerPriceDisplay from "@/components/primitives/TickerPriceDisplay";

export interface DetailHeaderProps {
  symbol: string;
  company: string;
  sector: string;
  // Nullable for stub-detail responses — see B-41 in earnings_screener.py.
  reportDate: string | null;
  reportTime: EarningsReportTime;
  quote: { last: number; change: number; changePct: number; timestamp?: string } | null;
  /** PM-B: when present, drives the after-hours / pre-market secondary
   *  line under the regular-session price. ``Partial<Quote>`` because the
   *  ticker-context envelope is the source of truth for extended-hours
   *  fields and may omit any subset depending on broker availability. */
  extendedQuote?: Partial<Quote> | null;
  /** ISO datetime of the most-recent detail snapshot. Surfaces as the
   *  "Quote updated 5 m ago" label in the header.
   *
   *  B1.7 (2026-05-06 audit): explicitly QUOTE-scoped now. The previous
   *  "Updated just now" copy implied the whole page was that fresh,
   *  which contradicted the EARNINGS / OPTIONS / RESEARCH chips that
   *  could be 2 days stale. The TickerFreshnessStrip is the canonical
   *  source for non-quote domains; this header line speaks only to
   *  the regular-session price tick. */
  generatedAt?: string;
  /** Round-4 (B-NEW-4): whether to autofocus the heading on symbol
   *  change. Pointer selections suppress autofocus to avoid stealing
   *  focus mid-click; keyboard / URL selections want focus restoration. */
  selectionSource?: SelectionSource;
}

export default function DetailHeader({
  symbol, company, sector, reportDate, reportTime, quote, extendedQuote, generatedAt,
  selectionSource = null,
}: DetailHeaderProps) {
  const change = quote?.change ?? null;
  const changePct = quote?.changePct ?? null;
  const reportTiming = describeReportTiming(reportTime);
  const quoteTimestamp = quote?.timestamp ?? generatedAt ?? null;

  // PM-B: TickerPriceDisplay owns the LIVE/DELAYED freshness pill, the
  // 5s tick that drives it, and the regular-/extended-session two-line
  // layout. Leaving the autofocus-on-symbol behaviour here because
  // that's a header-level concern; the ticker primitive is purely
  // about price rendering.
  //
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
      // PM-B: switched ``sm:items-baseline`` → ``sm:items-start`` so the
      // right column's optional after-hours secondary line doesn't push
      // the left-column heading out of vertical alignment when an AH
      // mark appears.
      className="flex flex-col gap-3 border-b border-[color:var(--border)] pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
    >
      <div className="min-w-0">
        <p className="t-label">§ EARNINGS · OPTIONS PLAY</p>
        {/* B-56 headingRef + tabIndex={-1}: parent moves focus here after a
            filter-driven symbol change so SR users land on the new symbol.
            B-90 id: the parent <section aria-labelledby="detail-header-title">
            uses it to name the detail region. */}
        <h2
          id="detail-header-title"
          ref={headingRef}
          tabIndex={-1}
          className="t-section-display italic mt-1 break-words outline-none"
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
            title={`Quote tick at ${formatGeneratedAt(generatedAt)} · see freshness chips above for OPTIONS / EARNINGS / RESEARCH`}
          >
            {/* B1.7 (2026-05-06 audit): scope this label to QUOTE only.
                Previously "Updated just now" implied the whole page was
                fresh, which contradicted the freshness-chip strip when
                EARNINGS / RESEARCH were 2 days old. */}
            Quote updated {fmtRelativeTime(generatedAt)}
          </p>
        )}
      </div>
      <div className="min-w-0 text-left sm:text-right">
        {quote ? (
          <TickerPriceDisplay
            last={quote.last}
            change={change}
            changePct={changePct}
            timestamp={quoteTimestamp}
            extendedPrice={extendedQuote?.extended_price ?? null}
            extendedChange={extendedQuote?.extended_change ?? null}
            extendedChangePct={extendedQuote?.extended_change_pct ?? null}
            extendedSession={extendedQuote?.extended_session ?? null}
            extendedTimestamp={extendedQuote?.last_trade_time ?? null}
            layout="stacked"
            className="sm:ml-auto sm:max-w-[24rem]"
          />
        ) : (
          <div className="t-num-hero min-w-0 max-w-full text-numeric-hero tracking-[0]">—</div>
        )}
      </div>
    </header>
  );
}

function formatReportDate(iso: string): string {
  // Locale-aware via Intl — formats in the viewer's timezone and locale.
  return fmtDate(iso, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Format an ISO instant for the "Quote tick at …" tooltip — matches the
 * TickerFreshnessStrip's chip timestamp format ("Today 1:50 PM" /
 * "May 4, 8:00 PM") so the tooltip and the chips speak the same dialect
 * (B2.16).
 */
function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (sameDay) return `Today ${time}`;
  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
  return `${datePart}, ${time}`;
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
