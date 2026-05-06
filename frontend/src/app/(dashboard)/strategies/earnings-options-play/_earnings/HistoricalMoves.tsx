import type { HistoricalBlock, HistQuarter } from "@/types";
import { fmtDate, fmtNumber, fmtPct } from "@/lib/intl";

export interface HistoricalMovesProps {
  historical: HistoricalBlock | null;
}

/**
 * B2.7: short quarter label (e.g. "Q1 24") derived from the report
 * date. Renders under each bar so users can tell which quarter each
 * column represents at a glance.
 */
function quarterLabel(isoDate: string): string {
  if (!isoDate) return "";
  // Use UTC parse for bare ``YYYY-MM-DD`` so a west-of-UTC viewer
  // doesn't pull the bar back a quarter.
  const isBareDate = isoDate.length === 10;
  const d = new Date(isBareDate ? isoDate + "T00:00:00Z" : isoDate);
  if (Number.isNaN(d.getTime())) return "";
  const month = d.getUTCMonth() + 1; // 1..12
  const quarter = Math.ceil(month / 3); // 1..4
  const yearShort = String(d.getUTCFullYear()).slice(-2);
  return `Q${quarter} ${yearShort}`;
}

/**
 * B2.7: rich per-bar tooltip — report date, EPS surprise, 1-day move,
 * 5-day move. We render the same data into the native ``title`` attr
 * (so it surfaces consistently even outside a hover-aware host) and
 * also into the bar's ``aria-label`` for screen readers.
 */
function barTooltip(q: HistQuarter): string {
  const lines: string[] = [];
  lines.push(`Report: ${fmtDate(q.reportDate, { year: "numeric", month: "short", day: "numeric" })}`);
  if (q.surprisePct != null && Number.isFinite(q.surprisePct)) {
    const sign = q.surprisePct >= 0 ? "+" : "";
    lines.push(`EPS surprise: ${sign}${fmtPct(q.surprisePct, 1)}`);
  }
  if (q.nextDayMovePct != null && Number.isFinite(q.nextDayMovePct)) {
    const sign = q.nextDayMovePct >= 0 ? "+" : "";
    lines.push(`1-day move: ${sign}${fmtPct(q.nextDayMovePct, 1)}`);
  }
  if (q.fiveDayMovePct != null && Number.isFinite(q.fiveDayMovePct)) {
    const sign = q.fiveDayMovePct >= 0 ? "+" : "";
    lines.push(`5-day move: ${sign}${fmtPct(q.fiveDayMovePct, 1)}`);
  }
  return lines.join("\n");
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
        <div className="relative pr-10">
          {/* Bars + axis-max gridline. ``items-end`` aligns bars to the
              chart baseline; the wrapper below holds the per-bar quarter
              label. */}
          <div className="relative flex h-12 items-end gap-1">
            {historical.quarters.map((q) => {
              const pct = q.nextDayMovePct;
              const h = Math.max(6, (Math.abs(pct) / maxAbs) * 44);
              const sign = pct >= 0 ? "pos" : "neg";
              const tooltip = barTooltip(q);
              return (
                <div
                  key={q.reportDate}
                  data-slot="hist-bar"
                  data-sign={sign}
                  // B2.7: cursor-pointer + interactive tabindex so the
                  // bar reads as something you can hover/focus, not a
                  // dead pixel.
                  tabIndex={0}
                  role="img"
                  aria-label={tooltip.replace(/\n/g, "; ")}
                  title={tooltip}
                  className={
                    "w-4 cursor-pointer rounded-sm transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand)] " +
                    (sign === "pos" ? "bg-[color:var(--profit)]" : "bg-[color:var(--loss)]")
                  }
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
          {/* B2.7: x-axis quarter labels under each bar so the user can
              tell which earnings each column represents. ``gap-1``
              matches the bar gap so labels line up. */}
          <div
            data-slot="hist-bar-labels"
            className="mt-1 flex gap-1 t-mono text-label u-muted"
            aria-hidden="true"
          >
            {historical.quarters.map((q) => (
              <span
                key={q.reportDate}
                data-slot="hist-bar-label"
                className="w-4 text-center text-[10px] leading-tight"
                title={fmtDate(q.reportDate, { year: "numeric", month: "short", day: "numeric" })}
              >
                {quarterLabel(q.reportDate)}
              </span>
            ))}
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
