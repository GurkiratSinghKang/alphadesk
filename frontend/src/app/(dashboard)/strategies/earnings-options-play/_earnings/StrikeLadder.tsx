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
          · expiry {ladder.expiry} · underlying {ladder.underlying_price.toFixed(2)}
        </span>
      </h3>
      <table className="mt-1 w-full table-auto border-separate border-spacing-0 t-mono text-[12.5px] tabular-nums">
        <thead>
          <tr className="t-ladder-row t-ladder-row--head">
            <th scope="col" className="text-left font-normal">STRIKE</th>
            <th scope="col" className="text-left font-normal">Δ</th>
            <th scope="col" className="text-left font-normal">MID</th>
            <th scope="col" className="text-left font-normal">IV</th>
            <th scope="col" className="text-left font-normal">YLD</th>
            <th scope="col" className="text-left font-normal">POP</th>
            <th scope="col" className="text-right font-normal">SIDE</th>
          </tr>
        </thead>
        <tbody>
          {ladder.rows.map((r) => (
            <LadderDataRow key={`${r.side}-${r.bucket}-${r.strike}`} row={r} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LadderDataRow({ row }: { row: LadderRow }) {
  const sideLabel = `${row.side} ${row.bucket}`;
  const yieldStr = `${(row.yield_pct * 100).toFixed(1)}%`;
  // Flag wide bid/ask spreads (>10% of mid). Guard against zero-side
  // quotes which aren't real two-sided markets.
  const wideSpread = isWideSpread(row.bid, row.ask);
  const midCell = wideSpread ? (
    <td className="u-loss" title="Wide bid/ask spread — liquidity risk">
      {row.mid.toFixed(2)}
      <span className="ml-1" aria-label="wide spread" role="img">⚠</span>
    </td>
  ) : (
    <td>{row.mid.toFixed(2)}</td>
  );
  return (
    <tr className="t-ladder-row t-ladder-row--data">
      <th scope="row" className="text-left font-normal">{row.strike.toFixed(0)}</th>
      <td>{row.delta >= 0 ? `+${row.delta.toFixed(2)}` : row.delta.toFixed(2)}</td>
      {midCell}
      <td>{(row.iv * 100).toFixed(0)}%</td>
      <td className="u-profit">{yieldStr}</td>
      <td>{(row.pop * 100).toFixed(0)}%</td>
      <td className="text-right u-dim">{sideLabel}</td>
    </tr>
  );
}

function isWideSpread(bid: number, ask: number): boolean {
  if (bid <= 0 || ask <= 0) return false; // not a real two-sided quote
  const mid = (ask + bid) / 2;
  if (mid <= 0) return false;
  return (ask - bid) / mid > 0.10;
}
