"use client";

import HistoricalMoves from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/HistoricalMoves";
import { fmtDate, fmtPct } from "@/lib/intl";
import type { EarningsReportTime, HistoricalBlock, IVTermPoint } from "@/types";

export interface EarningsPanelProps {
  isETF: boolean;
  historicalEarnings: HistoricalBlock | null;
  ivTermStructure: IVTermPoint[] | null;
  nextReportDate: string | null;
  nextReportTime: EarningsReportTime | null;
}

// Front-to-back ATM IV slope across the term structure. Positive = back >
// front (contango — typical quiet regime); negative = inverted (event-rich
// front month, common into earnings). Falls back to null when fewer than
// two finite points exist so the chip silently hides instead of rendering
// a misleading 0.
function termSteepness(points: IVTermPoint[] | null): number | null {
  if (!points) return null;
  const finite = points.filter((p) => Number.isFinite(p.atmIv));
  if (finite.length < 2) return null;
  const first = finite[0];
  const last = finite[finite.length - 1];
  return last.atmIv - first.atmIv;
}

// T9 / UI-SPEC §1 Section 11. Wraps HistoricalMoves with the next-report
// eyebrow and an IV term steepness chip. Hidden on ETFs because the
// curated earnings universe excludes them.
export function EarningsPanel({
  isETF,
  historicalEarnings,
  ivTermStructure,
  nextReportDate,
  nextReportTime,
}: EarningsPanelProps) {
  if (isETF) return null;

  const steepness = termSteepness(ivTermStructure);

  return (
    <section
      id="earnings"
      data-testid="earnings-panel"
      data-slot="earnings-panel"
      className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24 mx-4 sm:mx-6 mb-6"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="t-label u-muted">EARNINGS</h2>
        {nextReportDate && (
          <p data-testid="earnings-next" className="t-mono text-body-sm u-muted">
            Next:{" "}
            <span className="tabular-nums">
              {fmtDate(nextReportDate, { year: "numeric", month: "short", day: "numeric" })}
            </span>
            {nextReportTime ? ` · ${nextReportTime}` : ""}
          </p>
        )}
      </header>
      <HistoricalMoves historical={historicalEarnings} />
      {steepness != null && (
        <p
          data-testid="earnings-iv-steepness"
          className="mt-2 t-mono text-label u-muted"
          title="Back-month minus front-month ATM IV. Negative = event-rich front (typical pre-earnings)."
        >
          IV term steepness:{" "}
          <span className="tabular-nums u-brand">{fmtPct(steepness, 1)}</span>
        </p>
      )}
    </section>
  );
}

export default EarningsPanel;
