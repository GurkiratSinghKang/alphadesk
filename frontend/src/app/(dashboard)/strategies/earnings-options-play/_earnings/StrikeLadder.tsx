"use client";

import { useState } from "react";
import type { StrikeLadder as LadderShape, LadderRow } from "@/types";
import { fmtCurrency, fmtNumber, fmtPct } from "@/lib/intl";

export interface StrikeLadderProps {
  ladder: LadderShape | null;
}

export default function StrikeLadder({ ladder }: StrikeLadderProps) {
  const [showGreeks, setShowGreeks] = useState(false);

  if (!ladder || ladder.rows.length === 0) {
    return (
      <section data-slot="strike-ladder">
        <h3 className="t-display-section italic text-[13px] mt-4">Strike ladder</h3>
        <p className="mt-1 font-mono text-[12px] text-[color:var(--fg-muted)]">
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
  return (
    <section data-slot="strike-ladder">
      <div className="mt-4 flex items-baseline justify-between gap-2">
        <h3 className="t-display-section italic text-[13px] flex items-center gap-2">
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
            className="rounded border border-[color:var(--border)] bg-transparent px-3 py-2 t-mono text-[12px] u-muted hover:border-[color:var(--brand)] hover:u-brand"
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
        <table className="w-full table-auto border-separate border-spacing-0 t-mono text-[13px] tabular-nums">
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
            {ladder.rows.map((r) => (
              <LadderDataRow
                key={`${r.side}-${r.bucket}-${r.strike}`}
                row={r}
                showGreeks={showGreeks}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LadderDataRow({ row, showGreeks }: { row: LadderRow; showGreeks: boolean }) {
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
  return (
    <tr className="t-ladder-row t-ladder-row--data">
      <th scope="row" className="text-left font-normal">
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
