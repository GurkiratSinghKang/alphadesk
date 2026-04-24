import type { StrikeLadder as LadderShape, LadderRow } from "@/types";
import { fmtCurrency, fmtNumber, fmtPct } from "@/lib/intl";

export interface StrikeLadderProps {
  ladder: LadderShape | null;
}

export default function StrikeLadder({ ladder }: StrikeLadderProps) {
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
  return (
    <section data-slot="strike-ladder">
      <h3 className="t-display-section italic text-[13px] mt-4">
        Strike ladder{" "}
        <span className="t-label">
          · expiry {ladder.expiry} · underlying {fmtCurrency(ladder.underlying_price, "USD")}
        </span>
      </h3>
      <div className="mt-1">
        <div className="t-ladder-row t-ladder-row--head">
          <span>STRIKE</span>
          <span>Δ</span>
          <span>MID</span>
          <span>IV</span>
          <span>YLD</span>
          <span>POP</span>
          <span className="text-right">SIDE</span>
        </div>
        {ladder.rows.map((r) => (
          <LadderDataRow key={`${r.side}-${r.bucket}-${r.strike}`} row={r} />
        ))}
      </div>
    </section>
  );
}

function LadderDataRow({ row }: { row: LadderRow }) {
  const sideLabel = `${row.side} ${row.bucket}`;
  return (
    <div className="t-ladder-row t-ladder-row--data">
      <span>{fmtNumber(row.strike, { maximumFractionDigits: 0 })}</span>
      <span>
        {fmtNumber(row.delta, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          signDisplay: "always",
        })}
      </span>
      <span>{fmtCurrency(row.mid, "USD")}</span>
      <span>{fmtPct(row.iv, 0)}</span>
      <span className="u-profit">{fmtPct(row.yield_pct, 1)}</span>
      <span>{fmtPct(row.pop, 0)}</span>
      <span className="text-right u-dim">{sideLabel}</span>
    </div>
  );
}
