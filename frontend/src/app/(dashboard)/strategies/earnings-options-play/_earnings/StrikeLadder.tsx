"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StrikeLadder as LadderShape, LadderRow } from "@/types";
import { fmtCurrency, fmtNumber, fmtPct } from "@/lib/intl";
import { formatOccSymbol } from "@/lib/occ";
import { cn } from "@/lib/utils";
import ContractNBBO from "@/components/options/ContractNBBO";

export interface StrikeLadderProps {
  ladder: LadderShape | null;
  /**
   * Underlying ticker — required for the row-expand NBBO panel because
   * OCC symbols are built from underlying + expiry + side + strike.
   * When omitted, the ladder gracefully degrades to read-only (no
   * chevrons, no expand). PM-C wires this from EarningsDetailPanel
   * via ``detail.symbol``.
   */
  underlying?: string;
}

export default function StrikeLadder({ ladder, underlying }: StrikeLadderProps) {
  const [showGreeks, setShowGreeks] = useState(false);
  // PM-C: track which row's NBBO panel is expanded. Single-expansion
  // model — expanding one row collapses any other; this keeps the
  // 2s-poll volume to one contract at a time and avoids the
  // visual noise of stacked NBBO panels in a narrow column.
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  if (!ladder || ladder.rows.length === 0) {
    return (
      <section data-slot="strike-ladder">
        <h3 className="t-section-cap italic mt-4">Strike ladder</h3>
        <p className="mt-1 font-mono text-label text-[color:var(--fg-muted)]">
          — options chain unavailable.
        </p>
      </section>
    );
  }
  // Show Greeks toggle only when at least one row actually has numeric
  // theta/gamma/vega — avoids a disclosure that reveals a column of —.
  const hasGreeks = ladder.rows.some(
    (r) => Number.isFinite(r.theta) || Number.isFinite(r.gamma) || Number.isFinite(r.vega),
  );
  // Column count for the expanded NBBO row's colSpan. Static columns:
  // STRIKE / Δ / MID / IV / YLD / POP / SIDE = 7. Greeks adds 3 (θ γ ν).
  // The new "expand chevron" lives inside the STRIKE cell so it doesn't
  // claim its own column.
  const colCount = 7 + (showGreeks ? 3 : 0);
  // Expansion is only meaningful when we know the underlying — without
  // it we can't build an OCC symbol to query. Pass through to data
  // rows so they can hide the chevron + skip the click handler.
  const canExpand = !!underlying;
  return (
    <section data-slot="strike-ladder">
      <div className="mt-4 flex items-baseline justify-between gap-2">
        <h3 className="t-section-cap italic flex items-center gap-2">
          <span>
            Strike ladder{" "}
            <span className="t-label">
              · expiry {ladder.expiry} · underlying {fmtCurrency(ladder.underlyingPrice, "USD")}
            </span>
          </span>
          {/* Round-4 (CLUSTER D/13): demo-data badge. The wire field is
              optional — omitted on real broker data, true when synthetic. */}
          {ladder.isDemo && (
            <span
              data-slot="strike-ladder-demo-badge"
              className="not-italic rounded border border-[color:var(--brand)] px-1.5 py-0.5 t-label u-brand"
              title="This ladder is synthetic / demo data — broker connection unavailable."
            >
              ⚠ DEMO DATA
            </span>
          )}
        </h3>
        {hasGreeks && (
          <button
            type="button"
            data-slot="ladder-greeks-toggle"
            onClick={() => setShowGreeks((v) => !v)}
            aria-expanded={showGreeks}
            aria-controls="ladder-greeks-cols"
            className="rounded border border-[color:var(--border)] bg-transparent px-3 py-2 t-mono text-label u-muted hover:border-[color:var(--brand)] hover:u-brand"
          >
            {showGreeks ? "Hide Greeks" : "Show Greeks"}
          </button>
        )}
      </div>
      {/* Round-4 (CLUSTER E/15): wrap the ladder in a scrollable region
          so narrow viewports get horizontal scroll instead of overflow
          clip. role=region + tabIndex makes it keyboard-scrollable +
          announceable. Sticky <thead> keeps the column labels visible
          while scrolling within the panel column. */}
      <div
        role="region"
        aria-label="Strike ladder, scrollable"
        tabIndex={0}
        className="mt-1 overflow-x-auto"
      >
        <table className="w-full table-auto border-separate border-spacing-0 t-mono text-body-sm tabular-nums">
          <thead className="sticky top-0 bg-[color:var(--bg-card)] z-10">
            {/*
              Round-8 / AX-11: every Greek glyph carries an
              ``aria-label`` so NVDA / VoiceOver speak "delta" instead
              of "Capital Delta" / "Theta" garbled name.
              Round-8 / QR-03: ``title`` attributes on every column
              header surface the unit and sign convention so quants
              can tell whether ``θ -0.05`` is per-day-per-share or
              per-day-per-contract.
            */}
            <tr className="t-ladder-row t-ladder-row--head">
              <th scope="col" className="text-left font-normal">STRIKE</th>
              <th scope="col" className="text-left font-normal" aria-label="Delta" title="Δ — change in option price per $1 underlying move (≈ probability ITM, only an approximation under skew)">Δ</th>
              <th scope="col" className="text-left font-normal" title="Mid — (bid + ask) ÷ 2; marked with ⚠ when bid-ask spread > 10% of mid">MID</th>
              <th scope="col" className="text-left font-normal" title="Implied volatility for this strike + expiry, annualised">IV</th>
              <th scope="col" className="text-left font-normal" title="Yield — mid ÷ underlying spot, the credit you collect as a % of stock price">YLD</th>
              <th scope="col" className="text-left font-normal" title="Probability of profit — (1 - |Δ|) approximation; not the true distribution-integrated value">POP</th>
              {showGreeks && (
                <>
                  <th scope="col" className="text-left font-normal" id="ladder-greeks-cols" aria-label="Theta (per day)" title="θ — option price decay per day (negative for long contracts, positive for short)">θ</th>
                  <th scope="col" className="text-left font-normal" aria-label="Gamma" title="γ — delta change per $1 underlying move (curvature of the option's price function)">γ</th>
                  <th scope="col" className="text-left font-normal" aria-label="Vega (per 1% IV)" title="ν — option price change per 1% IV move (positive for long, negative for short)">ν</th>
                </>
              )}
              <th scope="col" className="text-right font-normal">SIDE</th>
            </tr>
          </thead>
          <tbody>
            {ladder.rows.map((r) => {
              // Build an OCC symbol per row when we have an underlying.
              // ``formatOccSymbol`` returns null on malformed input —
              // missing underlying, bad expiry shape, non-finite strike.
              // We treat that as "row cannot be expanded" rather than
              // crashing the ladder: the chevron disappears and the
              // click handler is wired to a no-op for that row.
              const occ = canExpand
                ? formatOccSymbol({
                    symbol: underlying!,
                    expiry: r.expiry ?? ladder.expiry,
                    side: r.side,
                    strike: r.strike,
                  })
                : null;
              const isExpanded = !!occ && expandedRow === occ;
              return (
                <LadderDataRow
                  key={`${r.side}-${r.bucket}-${r.strike}`}
                  row={r}
                  showGreeks={showGreeks}
                  occSymbol={occ}
                  isExpanded={isExpanded}
                  colCount={colCount}
                  onToggleExpand={() => {
                    if (!occ) return;
                    setExpandedRow((prev) => (prev === occ ? null : occ));
                  }}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface LadderDataRowProps {
  row: LadderRow;
  showGreeks: boolean;
  occSymbol: string | null;
  isExpanded: boolean;
  colCount: number;
  onToggleExpand: () => void;
}

function LadderDataRow({
  row,
  showGreeks,
  occSymbol,
  isExpanded,
  colCount,
  onToggleExpand,
}: LadderDataRowProps) {
  const sideLabel = `${row.side} ${row.bucket}`;
  // Flag wide bid/ask spreads (>10% of mid). Guard against zero-side
  // quotes which aren't real two-sided markets.
  const wideSpread = isWideSpread(row.bid, row.ask);
  const midCell = wideSpread ? (
    <td className="u-loss" title="Wide bid/ask spread — liquidity risk">
      {fmtCurrency(row.mid, "USD")}
      <span className="ml-1" aria-label="wide spread" role="img">⚠</span>
    </td>
  ) : (
    <td>{fmtCurrency(row.mid, "USD")}</td>
  );
  const expandable = !!occSymbol;
  // Maverick FIX-E (new-trader P0 #4): the entire <tr> used to carry
  // role="button" + tabIndex, which collapses the row's table semantics
  // for screen readers — VoiceOver / NVDA could not navigate cell by
  // cell. Move the interactive affordance onto the chevron itself
  // (a real <button> inside the STRIKE cell). The row goes back to
  // being a plain <tr>, the button gets aria-expanded / aria-controls
  // / aria-label, and the chevron's hit area is padded out to meet
  // the 44px mobile touch-target requirement.
  return (
    <>
      <tr
        data-slot="ladder-data-row"
        data-expandable={expandable || undefined}
        data-expanded={isExpanded || undefined}
        className={cn(
          "t-ladder-row t-ladder-row--data",
          expandable && "hover:bg-[color:var(--bg-elev-2)]",
        )}
      >
        <th scope="row" className="text-left font-normal">
          {expandable && occSymbol ? (
            <button
              type="button"
              data-slot="ladder-row-toggle"
              onClick={onToggleExpand}
              aria-expanded={isExpanded}
              aria-controls={`nbbo-${occSymbol}`}
              aria-label={`Toggle NBBO for ${row.strike} ${row.side}`}
              className={cn(
                // ≥44px touch target on mobile via min-h/min-w; padding
                // expands the chevron's hit area without disturbing the
                // tabular layout (the visible glyph stays small).
                "inline-flex items-center justify-center align-middle mr-1",
                "min-h-touch min-w-touch p-1.5 -m-1.5",
                "rounded u-muted hover:u-brand",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]",
              )}
            >
              {isExpanded ? (
                <ChevronDown size={12} aria-hidden="true" />
              ) : (
                <ChevronRight size={12} aria-hidden="true" />
              )}
            </button>
          ) : null}
          {fmtNumber(row.strike, { maximumFractionDigits: 0 })}
        </th>
        <td>
          {fmtNumber(row.delta, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
            signDisplay: "always",
          })}
        </td>
        {midCell}
        <td>{fmtPct(row.iv, 0)}</td>
        <td className="u-profit">{fmtPct(row.yieldPct, 1)}</td>
        <td>{fmtPct(row.pop, 0)}</td>
        {showGreeks && (
          <>
            <td>{fmtGreek(row.theta)}</td>
            <td>{fmtGreek(row.gamma)}</td>
            <td>{fmtGreek(row.vega)}</td>
          </>
        )}
        <td className="text-right u-dim">{sideLabel}</td>
      </tr>
      {isExpanded && occSymbol && (
        <tr data-slot="strike-ladder-nbbo-row">
          <td
            colSpan={colCount}
            className="p-0 border-b border-[color:var(--border)]"
          >
            <div className="px-3 py-2 bg-[color:var(--bg-elev-2)]">
              <ContractNBBO occSymbol={occSymbol} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function fmtGreek(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return fmtNumber(n, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "always",
  });
}

function isWideSpread(bid: number, ask: number): boolean {
  if (bid <= 0 || ask <= 0) return false; // not a real two-sided quote
  const mid = (ask + bid) / 2;
  if (mid <= 0) return false;
  return (ask - bid) / mid > 0.10;
}
