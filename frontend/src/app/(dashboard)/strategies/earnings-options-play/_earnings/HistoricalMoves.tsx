import type { HistoricalBlock } from "@/types";
import { fmtDate, fmtNumber, fmtPct } from "@/lib/intl";

export interface HistoricalMovesProps {
  historical: HistoricalBlock | null;
}

export default function HistoricalMoves({ historical }: HistoricalMovesProps) {
  if (!historical || historical.quarters.length === 0) {
    return (
      <section data-slot="historical-moves" className="mt-4">
        <h3 className="t-section-cap italic">Historical earnings</h3>
        <p className="mt-1 t-mono text-label u-muted">
          — no quarterly data available.
        </p>
      </section>
    );
  }
  const maxAbs = Math.max(...historical.quarters.map((q) => Math.abs(q.nextDayMovePct)), 0.01);
  return (
    <section data-slot="historical-moves" className="mt-4">
      <h3 className="t-section-cap italic">
        Historical earnings{" "}
        <span className="t-label u-muted">· last {historical.quarters.length}q</span>
      </h3>
      <div className="mt-2 flex items-end gap-3">
        <div className="relative flex h-12 items-end gap-1 pr-10">
          {historical.quarters.map((q) => {
            const pct = q.nextDayMovePct;
            const h = Math.max(6, (Math.abs(pct) / maxAbs) * 44);
            const sign = pct >= 0 ? "pos" : "neg";
            return (
              <div
                key={q.reportDate}
                data-slot="hist-bar"
                data-sign={sign}
                title={`${fmtDate(q.reportDate, { year: "numeric", month: "short", day: "numeric" })}: ${fmtPct(pct, 1)}`}
                className={"w-4 rounded-sm " + (sign === "pos" ? "bg-[color:var(--profit)]" : "bg-[color:var(--loss)]")}
                style={{ height: `${h}px`, opacity: 0.7 }}
              />
            );
          })}
          {/* Dashed gridline + right-aligned label at the max absolute move
              so users can calibrate bar heights at a glance (B-104). */}
          <div
            data-slot="hist-axis-max"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end"
          >
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-[color:var(--border)]" />
            <span className="relative z-10 bg-[color:var(--bg-card)] px-1 t-mono text-label u-muted leading-none">
              ±{(maxAbs * 100).toFixed(1)}%
            </span>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 t-mono text-label">
          <dt className="t-label u-muted">AVG |MV|</dt>
          <dd className="u-brand">±{fmtPct(Math.abs(historical.stats.avgAbsMovePct), 1)}</dd>
          <dt className="t-label u-muted">W / L</dt>
          <dd className="u-profit">{historical.stats.wins}W / {historical.stats.losses}L</dd>
          <dt className="t-label u-muted">BEAT RATE</dt>
          <dd>{fmtPct(historical.stats.surpriseBeatRate, 0)}</dd>
          {historical.stats.ivVsHistVolPoints != null && (
            <>
              <dt className="t-label u-muted">IV vs HV</dt>
              <dd className="u-muted">
                {historical.stats.ivVsHistVolPoints > 0 ? "over" : "under"}-pricing{" "}
                {fmtNumber(Math.abs(historical.stats.ivVsHistVolPoints), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} vol pts
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}
