import type { StrikeLadder as LadderShape, LadderRow } from "@/types";

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
          · expiry {ladder.expiry} · underlying {ladder.underlyingPrice.toFixed(2)}
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
  const yieldStr = `${(row.yieldPct * 100).toFixed(1)}%`;
  return (
    <div className="t-ladder-row t-ladder-row--data">
      <span>{row.strike.toFixed(0)}</span>
      <span>{row.delta >= 0 ? `+${row.delta.toFixed(2)}` : row.delta.toFixed(2)}</span>
      <span>{row.mid.toFixed(2)}</span>
      <span>{(row.iv * 100).toFixed(0)}%</span>
      <span className="u-profit">{yieldStr}</span>
      <span>{(row.pop * 100).toFixed(0)}%</span>
      <span className="text-right u-dim">{sideLabel}</span>
    </div>
  );
}
