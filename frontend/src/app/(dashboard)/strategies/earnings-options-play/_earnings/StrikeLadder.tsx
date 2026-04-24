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
        <h3 className="t-display-section italic text-[13px]">
          Strike ladder{" "}
          <span className="t-label">
            · expiry {ladder.expiry} · underlying {fmtCurrency(ladder.underlying_price, "USD")}
          </span>
        </h3>
        {hasGreeks && (
          <button
            type="button"
            data-slot="ladder-greeks-toggle"
            onClick={() => setShowGreeks((v) => !v)}
            aria-expanded={showGreeks}
            aria-controls="ladder-greeks-cols"
            className="rounded border border-[color:var(--border)] bg-transparent px-3 py-2 t-mono text-[11px] u-muted hover:border-[color:var(--brand)] hover:u-brand"
          >
            {showGreeks ? "Hide Greeks" : "Show Greeks"}
          </button>
        )}
      </div>
      <table className="mt-1 w-full table-auto border-separate border-spacing-0 t-mono text-[12.5px] tabular-nums">
        <thead>
          <tr className="t-ladder-row t-ladder-row--head">
            <th scope="col" className="text-left font-normal">STRIKE</th>
            <th scope="col" className="text-left font-normal">Δ</th>
            <th scope="col" className="text-left font-normal">MID</th>
            <th scope="col" className="text-left font-normal">IV</th>
            <th scope="col" className="text-left font-normal">YLD</th>
            <th scope="col" className="text-left font-normal">POP</th>
            {showGreeks && (
              <>
                <th scope="col" className="text-left font-normal" id="ladder-greeks-cols">θ</th>
                <th scope="col" className="text-left font-normal">γ</th>
                <th scope="col" className="text-left font-normal">ν</th>
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
      <td className="u-profit">{fmtPct(row.yield_pct, 1)}</td>
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
