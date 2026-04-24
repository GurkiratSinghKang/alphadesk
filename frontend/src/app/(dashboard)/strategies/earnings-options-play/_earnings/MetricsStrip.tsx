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
      {/* B-93 — `ariaLabel` passed for 0-100 indexed metrics so SR users
          hear "IV rank 75 out of 100" instead of a bare "75". Omitted on
          percentages/ratios/counts where the value is self-describing. */}
      <Cell
        label="IV RANK"
        value={fmtInt(metrics.ivRank)}
        accent={!!(metrics.ivRank && metrics.ivRank > 70)}
        ariaLabel={metrics.ivRank == null ? "IV rank unavailable" : `IV rank ${Math.round(metrics.ivRank)} out of 100`}
      />
      <Cell
        label="IV %ILE"
        value={fmtInt(metrics.ivPercentile)}
        ariaLabel={metrics.ivPercentile == null ? "IV percentile unavailable" : `IV percentile ${Math.round(metrics.ivPercentile)} out of 100`}
      />
      <Cell label="HV 20" value={fmtPctCell(metrics.hv20)} />
      <Cell label="HV / IV" value={fmtRatio(metrics.hvIvRatio)} />
      <Cell label="EXP MOVE" value={fmtPctSigned(metrics.expectedMovePct)} accent />
      <Cell label="HIST |MV|" value={fmtPctSigned(metrics.histAvgAbsMovePct)} />
      <Cell
        label="BEAT %"
        value={fmtInt(metrics.beatRate != null ? metrics.beatRate * 100 : null)}
        ariaLabel={metrics.beatRate == null ? "Beat rate unavailable" : `Beat rate ${Math.round(metrics.beatRate * 100)} out of 100`}
      />
      <Cell label="DTE" value={metrics.daysToExpiry == null ? DASH : fmtNumber(metrics.daysToExpiry, { maximumFractionDigits: 0 })} />
    </div>
  );
}

function Cell({
  label,
  value,
  accent = false,
  ariaLabel,
}: {
  label: string;
  value: string;
  accent?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="flex flex-col" aria-label={ariaLabel}>
      <span className="t-label" aria-hidden={ariaLabel ? true : undefined}>{label}</span>
      <span
        className={"t-mono text-[14px] " + (accent ? "u-brand" : "")}
        aria-hidden={ariaLabel ? true : undefined}
      >
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
