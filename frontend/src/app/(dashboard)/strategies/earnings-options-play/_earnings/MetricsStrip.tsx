import type { EarningsMetricsBlock } from "@/types";
import { fmtNumber, fmtPct as fmtPctIntl } from "@/lib/intl";

export interface MetricsStripProps {
  metrics: EarningsMetricsBlock | null;
}

const DASH = "—";

export default function MetricsStrip({ metrics }: MetricsStripProps) {
  if (!metrics) {
    return (
      <div data-slot="metrics-strip" className="flex gap-6 border-b border-[color:var(--border)] py-2">
        <span className="t-label">{DASH} no metrics available</span>
      </div>
    );
  }
  return (
    <div
      data-slot="metrics-strip"
      className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-[color:var(--border)] py-2"
    >
      <Cell label="IV RANK" value={fmtInt(metrics.iv_rank)} accent={!!(metrics.iv_rank && metrics.iv_rank > 70)} />
      <Cell label="IV %ILE" value={fmtInt(metrics.iv_percentile)} />
      <Cell label="HV 20" value={fmtPctCell(metrics.hv_20)} />
      <Cell label="HV / IV" value={fmtRatio(metrics.hv_iv_ratio)} />
      <Cell label="EXP MOVE" value={fmtPctSigned(metrics.expected_move_pct)} accent />
      <Cell label="HIST |MV|" value={fmtPctSigned(metrics.hist_avg_abs_move_pct)} />
      <Cell label="BEAT %" value={fmtInt(metrics.beat_rate != null ? metrics.beat_rate * 100 : null)} />
      <Cell label="DTE" value={metrics.days_to_expiry == null ? DASH : fmtNumber(metrics.days_to_expiry, { maximumFractionDigits: 0 })} />
    </div>
  );
}

function Cell({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="t-label">{label}</span>
      <span className={"t-mono text-[14px] " + (accent ? "u-brand" : "")}>
        {value}
      </span>
    </div>
  );
}

function fmtInt(n: number | null): string {
  return n == null ? DASH : fmtNumber(Math.round(n), { maximumFractionDigits: 0 });
}
function fmtPctCell(n: number | null): string {
  return n == null ? DASH : fmtPctIntl(n, 1);
}
function fmtPctSigned(n: number | null): string {
  if (n == null) return DASH;
  // Use absolute-value magnitude with ± prefix (the label already implies
  // "either direction"); fmtPct on the abs value gives locale-aware digits.
  return `±${fmtPctIntl(Math.abs(n), 1)}`;
}
function fmtRatio(n: number | null): string {
  return n == null ? DASH : fmtNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
