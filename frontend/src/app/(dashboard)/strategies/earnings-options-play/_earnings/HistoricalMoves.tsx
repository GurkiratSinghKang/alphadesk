import type { HistoricalBlock } from "@/types";
import { fmtDate, fmtNumber, fmtPct } from "@/lib/intl";

export interface HistoricalMovesProps {
  historical: HistoricalBlock | null;
}

export default function HistoricalMoves({ historical }: HistoricalMovesProps) {
  if (!historical || historical.quarters.length === 0) {
    return (
      <section data-slot="historical-moves" className="mt-4">
        <h3 className="t-display-section italic text-[13px]">Historical earnings</h3>
        <p className="mt-1 t-mono text-[12px] u-muted">
          — no quarterly data available.
        </p>
      </section>
    );
  }
  const maxAbs = Math.max(...historical.quarters.map((q) => Math.abs(q.next_day_move_pct)), 0.01);
  return (
    <section data-slot="historical-moves" className="mt-4">
      <h3 className="t-display-section italic text-[13px]">
        Historical earnings{" "}
        <span className="t-label u-muted">· last {historical.quarters.length}q</span>
      </h3>
      <div className="mt-2 flex items-end gap-3">
        <div className="flex h-[48px] items-end gap-1">
          {historical.quarters.map((q) => {
            const pct = q.next_day_move_pct;
            const h = Math.max(6, (Math.abs(pct) / maxAbs) * 44);
            const sign = pct >= 0 ? "pos" : "neg";
            return (
              <div
                key={q.report_date}
                data-slot="hist-bar"
                data-sign={sign}
                title={`${fmtDate(q.report_date, { year: "numeric", month: "short", day: "numeric" })}: ${fmtPct(pct, 1)}`}
                className={"w-4 rounded-sm " + (sign === "pos" ? "bg-[color:var(--profit)]" : "bg-[color:var(--loss)]")}
                style={{ height: `${h}px`, opacity: 0.7 }}
              />
            );
          })}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 t-mono text-[11.5px]">
          <dt className="t-label u-muted">AVG |MV|</dt>
          <dd className="u-brand">±{fmtPct(Math.abs(historical.stats.avg_abs_move_pct), 1)}</dd>
          <dt className="t-label u-muted">W / L</dt>
          <dd className="u-profit">{historical.stats.wins}W / {historical.stats.losses}L</dd>
          <dt className="t-label u-muted">BEAT RATE</dt>
          <dd>{fmtPct(historical.stats.surprise_beat_rate, 0)}</dd>
          {historical.stats.iv_vs_hist_vol_points != null && (
            <>
              <dt className="t-label u-muted">IV vs HV</dt>
              <dd className="u-muted">
                {historical.stats.iv_vs_hist_vol_points > 0 ? "over" : "under"}-pricing{" "}
                {fmtNumber(Math.abs(historical.stats.iv_vs_hist_vol_points), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} vol pts
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}
