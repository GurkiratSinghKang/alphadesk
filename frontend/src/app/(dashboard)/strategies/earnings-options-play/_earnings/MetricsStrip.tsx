import type { EarningsMetricsBlock } from "@/types";
import { fmtNumber, fmtPct as fmtPctIntl } from "@/lib/intl";
import { HelpCircle } from "@/components/ui/HelpCircle";

export interface MetricsStripProps {
  metrics: EarningsMetricsBlock | null;
}

const DASH = "—";

// Round-8 / Persona-NV (NV-03/04) + Persona-QR (QR-01): every label is
// jargon for a novice and every number lacks methodology context for a
// quant. One-sentence plain-language tooltips on each label close both
// gaps without inflating the visible UI. Copy is intentionally short
// enough to fit the 220px tooltip width.
const TOOLTIPS = {
  ivRank:
    "Where today's IV sits between the 1-year low and high (0=lowest, 100=highest). High = options are pricing in unusual uncertainty.",
  ivPercentile:
    "What share of the past year had IV ≤ today. IV rank and IV percentile diverge in skewed distributions; both ≥70 is a strong signal options are rich.",
  hv20:
    "Realised volatility over the last 20 trading days, annualised. Use vs. IV to spot over- or under-priced options.",
  hvIvRatio:
    "HV ÷ IV. < 1 means options are pricing more vol than the stock has actually moved (options expensive). > 1 means options look cheap vs. realised.",
  expMove:
    "Straddle mid ÷ spot. The price move the options market is pricing into THIS expiry. ±X% is roughly a 1σ band — the stock has ~68% chance of landing inside.",
  histMv:
    "Average absolute move on prior earnings days for this name. Use as an anchor — compare to EXP MOVE: is today's implied move ±2σ from the typical?",
  beatPct:
    "Share of past earnings reports that beat consensus EPS. Higher = company tends to surprise upward; doesn't predict the move's size.",
  dte:
    "Days from today to the option expiry shown on the strike ladder. Theta acceleration spikes inside ~7 DTE.",
} as const;

export default function MetricsStrip({ metrics }: MetricsStripProps) {
  if (!metrics) {
    return (
      <div data-slot="metrics-strip" className="flex gap-6 border-b border-[color:var(--border)] py-2">
        <span className="t-label">{DASH} no metrics available</span>
      </div>
    );
  }
  return (
    <section
      data-slot="metrics-strip"
      role="group"
      aria-label="Volatility and earnings metrics"
      className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-[color:var(--border)] py-2"
    >
      {/* B-93 — `ariaLabel` passed for 0-100 indexed metrics so SR users
          hear "IV rank 75 out of 100" instead of a bare "75". Omitted on
          percentages/ratios/counts where the value is self-describing. */}
      <Cell
        label="IV RANK"
        tooltip={TOOLTIPS.ivRank}
        value={fmtInt(metrics.ivRank)}
        accent={!!(metrics.ivRank && metrics.ivRank > 70)}
        ariaLabel={metrics.ivRank == null ? "IV rank unavailable" : `IV rank ${Math.round(metrics.ivRank)} out of 100`}
      />
      <Cell
        label="IV %ILE"
        tooltip={TOOLTIPS.ivPercentile}
        value={fmtInt(metrics.ivPercentile)}
        ariaLabel={metrics.ivPercentile == null ? "IV percentile unavailable" : `IV percentile ${Math.round(metrics.ivPercentile)} out of 100`}
      />
      <Cell label="HV 20" tooltip={TOOLTIPS.hv20} value={fmtPctCell(metrics.hv20)} />
      <Cell label="HV / IV" tooltip={TOOLTIPS.hvIvRatio} value={fmtRatio(metrics.hvIvRatio)} />
      <Cell label="EXP MOVE" tooltip={TOOLTIPS.expMove} value={fmtPctSigned(metrics.expectedMovePct)} accent />
      <Cell label="HIST |MV|" tooltip={TOOLTIPS.histMv} value={fmtPctSigned(metrics.histAvgAbsMovePct)} />
      <Cell
        label="BEAT %"
        tooltip={TOOLTIPS.beatPct}
        value={fmtInt(metrics.beatRate != null ? metrics.beatRate * 100 : null)}
        ariaLabel={metrics.beatRate == null ? "Beat rate unavailable" : `Beat rate ${Math.round(metrics.beatRate * 100)} out of 100`}
      />
      <Cell label="DTE" tooltip={TOOLTIPS.dte} value={metrics.daysToExpiry == null ? DASH : fmtNumber(metrics.daysToExpiry, { maximumFractionDigits: 0 })} />
    </section>
  );
}

function Cell({
  label,
  value,
  accent = false,
  ariaLabel,
  tooltip,
}: {
  label: string;
  value: string;
  accent?: boolean;
  ariaLabel?: string;
  tooltip?: string;
}) {
  return (
    <div className="flex flex-col" aria-label={ariaLabel}>
      <span className="t-label inline-flex items-center gap-1" aria-hidden={ariaLabel ? true : undefined}>
        {label}
        {tooltip && <HelpCircle text={tooltip} />}
      </span>
      <span
        className={"t-mono text-[15px] " + (accent ? "u-brand" : "")}
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
