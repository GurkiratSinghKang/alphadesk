"use client";

import { useMemo, useState } from "react";
import { ChartLine, WarningCircle } from "@phosphor-icons/react";

import {
  calculatePayoffSummary,
  type OptionStrategyDraft,
  type PayoffPoint,
  type PayoffSummary,
  type PayoffValue,
} from "@/lib/optionsPayoff";
import { cn, formatCurrency } from "@/lib/utils";

interface OptionsPayoffPanelProps {
  draft: OptionStrategyDraft | null;
  title?: string;
  compact?: boolean;
  onOpenBuilder?: () => void;
  className?: string;
}

// PM-A 2026-05-05: per-comboType educational caption. Rendered as a
// one-liner below the leg list so users learn "what does this
// strategy actually win on" without leaving the panel.
const STRATEGY_CAPTIONS: Record<string, string> = {
  iron_condor: "Profits if the stock stays inside the breakevens; IV crush helps if you're short.",
  iron_butterfly: "Profits if the stock pins near the body strike; IV crush is the main edge.",
  short_strangle: "Profits if the stock stays inside the breakevens. Tail risk is uncapped.",
  short_straddle: "Profits on a flat move; IV crush is the edge. Tail risk is uncapped.",
  long_straddle: "Profits on a big move in either direction; IV crush works against you.",
  long_strangle: "Profits on a big move beyond the strikes; IV crush works against you.",
  bear_call_spread: "Profits if the stock falls or stays flat; defined max loss.",
  bull_put_spread: "Profits if the stock rises or stays flat; defined max loss.",
  bull_call_spread: "Profits if the stock rises through both strikes; defined max loss.",
  bear_put_spread: "Profits if the stock falls through both strikes; defined max loss.",
  long_call: "Profits on upside; pays for IV crush at expiration.",
  long_put: "Profits on downside; pays for IV crush at expiration.",
  calendar_spread: "Profits if the stock pins near the strike; IV crush asymmetry is the edge.",
  diagonal_spread: "Profits if the stock pins near the strike; mixed IV-crush exposure.",
};

// PM-A 2026-05-05: credit comboTypes get a one-line IV-crush note
// inside the leg list so traders entering before earnings see the
// trade-off explicitly: the credit you collect must beat the
// post-event vol compression.
const CREDIT_STRATEGIES = new Set([
  "iron_condor",
  "iron_butterfly",
  "short_strangle",
  "short_straddle",
  "bear_call_spread",
  "bull_put_spread",
]);

export default function OptionsPayoffPanel({
  draft,
  title = "Options payoff",
  compact = false,
  onOpenBuilder,
  className,
}: OptionsPayoffPanelProps) {
  const summary = useMemo(() => calculatePayoffSummary(draft), [draft]);
  const hasLegs = !!draft && draft.legs.length > 0;

  return (
    <section
      data-slot="options-payoff-panel"
      className={cn(
        "overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/95 shadow-[0_18px_60px_-42px_rgba(16,22,17,0.36)]",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-hair px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
            <ChartLine className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-body font-semibold text-ink-1000">{title}</h2>
            <p className="truncate text-label text-fg-muted">
              {draft?.label ?? "Model an option strategy before staging the ticket."}
            </p>
          </div>
        </div>
        {onOpenBuilder ? (
          <button
            type="button"
            onClick={onOpenBuilder}
            className="inline-flex min-h-9 items-center rounded-sm border border-border bg-bg px-3 text-label font-semibold text-fg-muted transition hover:border-primary hover:text-fg active:translate-y-px"
          >
            Build strategy
          </button>
        ) : null}
      </header>

      {!hasLegs ? (
        <EmptyPayoff copy="Open the builder or choose an earnings play to see max profit, max loss, and breakevens." />
      ) : summary.status !== "ready" ? (
        <div className="px-4 py-4">
          <MetricGrid summary={summary} compact={compact} />
          <div className="mt-3 flex gap-2 rounded-md border border-amber/30 bg-amber/10 px-3 py-3 text-body-sm text-fg-muted">
            <WarningCircle className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
            <span>{summary.reason}</span>
          </div>
          <LegList draft={draft} />
          <StrategyCaption comboType={draft?.comboType} />
        </div>
      ) : (
        <div className="px-4 py-4">
          <MetricGrid summary={summary} compact={compact} />
          <PayoffChart summary={summary} />
          {!compact ? <LegList draft={draft} /> : null}
          {!compact ? <StrategyCaption comboType={draft.comboType} /> : null}
        </div>
      )}
    </section>
  );
}

function MetricGrid({ summary, compact: _compact }: { summary: PayoffSummary; compact: boolean }) {
  // PM-A 2026-05-05: slimmed from 4 cells to 2. The breakeven cell
  // moved into the chart (commit 3 callouts), and net premium is
  // already visible in the leg list. Two cells means each can
  // breathe — larger text, full width — and the rest of the panel
  // gets vertical room for the redesigned chart.
  const metrics = [
    { label: "Max profit", value: formatPayoffValue(summary.maxProfit), tone: "text-profit" },
    { label: "Max loss", value: formatPayoffValue(summary.maxLoss), tone: "text-loss" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-hair bg-border-hair">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0 bg-bg px-4 py-4">
          <p className="t-label text-fg-hint">{metric.label}</p>
          <p className={cn("mt-2 truncate font-mono text-body font-semibold tabular-nums", metric.tone)}>
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function PayoffChart({ summary }: { summary: PayoffSummary }) {
  const [hovered, setHovered] = useState<PayoffPoint | null>(null);
  // EOP-AUDIT 2026-05-06 PR-3 (a11y): keyboard-driven readout. When
  // the chart container has focus, arrow keys move the selected
  // point; the visible readout + an aria-live region announce the
  // change so screen-reader users get the same per-price PnL info
  // pointer users get from hovering. Pointer activity overrides
  // keyboard selection (and vice versa) via setHovered.
  const [keyboardActive, setKeyboardActive] = useState(false);
  // EOP-AUDIT 2026-05-06 / B1.10: track whether the user has hovered
  // at least once. Pre-fix the "Hover or focus for P/L" overlay sat
  // in the chart's upper-left corner blocking the gridlines + max-
  // profit/loss callouts; once the user moves the cursor inside, the
  // overlay disappears for good (until next mount). Re-shown only on
  // a fresh page render.
  const [hasHoveredOnce, setHasHoveredOnce] = useState(false);
  const points = summary.payoffPoints;
  const chart = useMemo(() => buildSvgModel(points, summary), [points, summary]);
  if (!chart) {
    return <EmptyPayoff copy="The payoff curve will appear once every selected leg has a usable price." compact />;
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const currentIndex = hovered
      ? points.findIndex((p) => p.underlyingPrice === hovered.underlyingPrice)
      : -1;
    const startIndex = currentIndex >= 0 ? currentIndex : Math.floor(points.length / 2);
    let nextIndex = startIndex;
    const step10 = Math.max(1, Math.round(points.length / 10));
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = Math.max(0, startIndex - 1);
        break;
      case "ArrowRight":
        nextIndex = Math.min(points.length - 1, startIndex + 1);
        break;
      case "PageUp":
        nextIndex = Math.max(0, startIndex - step10);
        break;
      case "PageDown":
        nextIndex = Math.min(points.length - 1, startIndex + step10);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = points.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setKeyboardActive(true);
    setHovered(points[nextIndex] ?? null);
  };

  return (
    <div className="mt-4 rounded-md border border-border-hair bg-bg px-3 py-3">
      {/* EOP-AUDIT 2026-05-06 / B1.10: inline hint sits above the chart
          so the chart body stays uncluttered. Fades out once the user
          has interacted, since they no longer need the prompt. */}
      <p
        data-slot="payoff-chart-hint"
        aria-hidden={hasHoveredOnce ? "true" : undefined}
        className={cn(
          "mb-2 font-mono text-eyebrow u-muted transition-opacity",
          hasHoveredOnce ? "opacity-0" : "opacity-100",
        )}
      >
        Hover or focus the chart for per-price P/L.
      </p>
      <div
        className="relative h-[220px] w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary"
        role="application"
        aria-label="Options payoff chart. Use left and right arrow keys to step through prices, Home and End to jump to the extremes."
        tabIndex={0}
        onFocus={() => {
          setKeyboardActive(true);
          setHasHoveredOnce(true);
          if (!hovered && points.length > 0) {
            const spotIdx = summary.spotPrice != null
              ? points.findIndex((p) => p.underlyingPrice === nearestPoint(points, summary.spotPrice!)?.underlyingPrice)
              : -1;
            setHovered(points[spotIdx >= 0 ? spotIdx : Math.floor(points.length / 2)]);
          }
        }}
        onBlur={() => {
          setKeyboardActive(false);
          setHovered(null);
        }}
        onKeyDown={handleKeyDown}
        onMouseLeave={() => {
          if (!keyboardActive) setHovered(null);
        }}
        onMouseMove={(event) => {
          if (!hasHoveredOnce) setHasHoveredOnce(true);
          // EOP-AUDIT 2026-05-06 Bug 2c: the SVG has chart.padding=28
          // horizontal padding on each side, so mapping cursor.x
          // directly through (rect.width) over-states the price by
          // up to 28/innerWidth at the extremes. Project cursor
          // px → SVG px → inner-x first; clamp to [0, innerWidth].
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          const svgPxPerCssPx = chart.width / rect.width;
          const svgX = (event.clientX - rect.left) * svgPxPerCssPx;
          const innerX = Math.max(0, Math.min(chart.innerWidth, svgX - chart.padding));
          const ratio = chart.innerWidth > 0 ? innerX / chart.innerWidth : 0;
          const price = chart.xMin + ratio * (chart.xMax - chart.xMin);
          setKeyboardActive(false);
          setHovered(nearestPoint(points, price));
        }}
      >
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-full w-full overflow-visible" role="img" aria-label="Options profit and loss at expiration">
          {/* PM-A 2026-05-05: gradient zone fills replace flat
              tints so profit/loss bands fade away from the zero
              line — easier to read at a glance which side of zero
              the curve lives on. */}
          <defs>
            <linearGradient id="payoff-profit-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--profit-tint)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--profit-tint)" stopOpacity="0.7" />
            </linearGradient>
            <linearGradient id="payoff-loss-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--loss-tint)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="var(--loss-tint)" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width={chart.width} height={chart.height} rx="10" fill="transparent" />
          <rect x={chart.padding} y={chart.yTop} width={chart.innerWidth} height={Math.max(0, chart.zeroY - chart.yTop)} fill="url(#payoff-profit-fill)" />
          <rect x={chart.padding} y={chart.zeroY} width={chart.innerWidth} height={Math.max(0, chart.yBottom - chart.zeroY)} fill="url(#payoff-loss-fill)" />
          {chart.gridYs.map((y) => (
            <line key={`grid-y-${y}`} x1={chart.padding} x2={chart.width - chart.padding} y1={y} y2={y} stroke="var(--border-hair)" />
          ))}
          {chart.gridXs.map((x) => (
            <line key={`grid-x-${x}`} x1={x} x2={x} y1={chart.yTop} y2={chart.yBottom} stroke="var(--border-hair)" />
          ))}
          <line x1={chart.padding} x2={chart.width - chart.padding} y1={chart.zeroY} y2={chart.zeroY} stroke="var(--fg-muted)" strokeDasharray="4 5" opacity="0.85" />
          {summary.spotPrice != null ? (
            <g>
              {/* PM-A 2026-05-05: solid spot indicator (was dashed,
                  identical to breakevens). Adds a small triangular
                  tick marker at the chart top edge — like a price
                  ruler — so the spot stands out visually. */}
              <line x1={chart.x(summary.spotPrice)} x2={chart.x(summary.spotPrice)} y1={chart.yTop} y2={chart.yBottom} stroke="var(--brand)" opacity="0.9" />
              <polygon
                points={`${chart.x(summary.spotPrice) - 4},${chart.yTop - 1} ${chart.x(summary.spotPrice) + 4},${chart.yTop - 1} ${chart.x(summary.spotPrice)},${chart.yTop + 5}`}
                fill="var(--brand)"
              />
              <circle cx={chart.x(summary.spotPrice)} cy={chart.zeroY} r="3.5" fill="var(--brand)" />
            </g>
          ) : null}
          {/* PM-A 2026-05-05: dollar-valued Y-axis tick labels. The
              old chart had unlabelled gridlines so users had to
              hover to read pnl magnitudes. yAxisTicks is computed
              by buildSvgModel and always includes $0 when the
              range straddles zero. */}
          {chart.yAxisTicks.map((tick) => (
            <text
              key={`y-tick-${tick.label}-${tick.y.toFixed(2)}`}
              x={chart.padding - 4}
              y={tick.y + 3}
              textAnchor="end"
              fontSize="9"
              fill="var(--fg-hint)"
            >
              {tick.label}
            </text>
          ))}
          {summary.breakevens.map((breakeven, idx) => {
            const leader = chart.breakevenLeader[idx];
            return (
              <g key={`be-${breakeven}`}>
                <line x1={chart.x(breakeven)} x2={chart.x(breakeven)} y1={chart.yTop} y2={chart.yBottom} stroke="var(--fg-muted)" strokeDasharray="2 4" opacity="0.7" />
                <circle cx={chart.x(breakeven)} cy={chart.zeroY} r="3" fill="var(--bg)" stroke="var(--fg-muted)" />
                {/* PM-A 2026-05-05: in-chart breakeven callout. The
                    leader line connects label → vertical so users
                    don't have to map text to gridline position. */}
                {leader ? (
                  <g>
                    <line
                      x1={leader.labelX}
                      x2={leader.x}
                      y1={leader.labelY + 2}
                      y2={chart.yTop + 14}
                      stroke="var(--fg-muted)"
                      strokeDasharray="1 2"
                      opacity="0.6"
                    />
                    <text
                      x={leader.labelX}
                      y={leader.labelY}
                      textAnchor="middle"
                      fontSize="9"
                      fill="var(--fg-muted)"
                    >
                      {`BE ${formatCurrency(breakeven)}`}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
          <path d={chart.path} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {/* PM-A 2026-05-05: max-profit / max-loss markers on the
              curve. Filled coloured circles + labelled text give
              users the headline numbers without parsing the metric
              grid above. "∞" replaces "+\$Infinity" when the
              strategy is unbounded on that side. */}
          {chart.maxProfitCoord ? (
            <g>
              <circle cx={chart.maxProfitCoord.x} cy={chart.maxProfitCoord.y} r="5" fill="var(--profit)" />
              <text
                x={chart.maxProfitCoord.x}
                y={chart.maxProfitCoord.y - 8}
                textAnchor="middle"
                fontSize="9"
                fill="var(--profit)"
                fontWeight="600"
              >
                {chart.maxProfitCoord.label === "∞"
                  ? "+∞"
                  : `+${formatCurrency(chart.maxProfitCoord.pnl)}`}
              </text>
            </g>
          ) : null}
          {chart.maxLossCoord ? (
            <g>
              <circle cx={chart.maxLossCoord.x} cy={chart.maxLossCoord.y} r="5" fill="var(--loss)" />
              <text
                x={chart.maxLossCoord.x}
                y={chart.maxLossCoord.y + 14}
                textAnchor="middle"
                fontSize="9"
                fill="var(--loss)"
                fontWeight="600"
              >
                {chart.maxLossCoord.label === "∞"
                  ? "−∞"
                  : `−${formatCurrency(Math.abs(chart.maxLossCoord.pnl))}`}
              </text>
            </g>
          ) : null}
          {hovered ? (
            <g>
              <line x1={chart.x(hovered.underlyingPrice)} x2={chart.x(hovered.underlyingPrice)} y1={chart.yTop} y2={chart.yBottom} stroke="var(--fg)" opacity="0.18" />
              <circle cx={chart.x(hovered.underlyingPrice)} cy={chart.y(hovered.pnl)} r="4" fill={hovered.pnl >= 0 ? "var(--profit)" : "var(--loss)"} />
            </g>
          ) : null}
        </svg>
        {/* EOP-AUDIT 2026-05-06 / B1.10: live readout only renders
            once a price is hovered/focused. The static "Hover or
            focus for P/L" placeholder moved out of the chart body
            into an inline hint above (see ``payoff-chart-hint``). */}
        <div
          aria-live="polite"
          aria-atomic="true"
          data-slot="payoff-chart-readout"
          className={cn(
            "pointer-events-none absolute left-2 top-2 rounded border border-border-hair bg-bg-elev-1/95 px-2 py-1 font-mono text-label text-fg-muted shadow-[0_10px_24px_-18px_rgba(16,22,17,0.55)] transition-opacity",
            hovered ? "opacity-100" : "opacity-0",
          )}
        >
          {hovered
            ? `${formatCurrency(hovered.underlyingPrice)} -> ${formatCurrency(hovered.pnl)}`
            : ""}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-eyebrow text-fg-muted">
        <span>At expiration</span>
        {summary.spotPrice != null ? <span>Spot {formatCurrency(summary.spotPrice)}</span> : null}
        {summary.expiries[0] ? <span>Expiry {summary.expiries[0]}</span> : null}
      </div>
      {/* EOP-AUDIT 2026-05-06 PR-3 (a11y): screen-reader summary of the
          chart's key prices, so non-pointer users get max profit, max
          loss, and breakevens without having to step through every
          payoff point. The interactive arrow-key nav above gives them
          per-price PnL on demand; this provides the high-level shape. */}
      <div className="sr-only">
        <h3>Payoff summary</h3>
        <ul>
          {summary.spotPrice != null ? <li>Spot price: {formatCurrency(summary.spotPrice)}</li> : null}
          <li>Maximum profit: {formatPayoffValue(summary.maxProfit)}</li>
          <li>Maximum loss: {formatPayoffValue(summary.maxLoss)}</li>
          {summary.breakevens.length > 0 ? (
            <li>
              Breakeven{summary.breakevens.length > 1 ? "s" : ""}:{" "}
              {summary.breakevens.map((be) => formatCurrency(be)).join(", ")}
            </li>
          ) : (
            <li>No breakeven inside the modeled price range.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function LegList({ draft }: { draft: OptionStrategyDraft }) {
  const normalizedCombo = normalizeComboType(draft.comboType);
  const isCredit = normalizedCombo ? CREDIT_STRATEGIES.has(normalizedCombo) : false;
  return (
    <div className="mt-4 grid gap-2">
      {draft.legs.map((leg, index) => (
        <div key={`${leg.id}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border-hair bg-bg px-3 py-2 font-mono text-label">
          <span className={cn("rounded px-2 py-1 uppercase", leg.side === "buy" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss")}>
            {leg.side}
          </span>
          <span className="min-w-0 truncate text-fg">
            {leg.expiry} {leg.strike} {leg.kind.toUpperCase()} x {leg.qty}
          </span>
          <span className="text-fg-muted">{leg.entryPrice == null ? "Unpriced" : formatCurrency(leg.entryPrice)}</span>
        </div>
      ))}
      {isCredit ? (
        <p className="t-label text-[var(--fg-muted)]">
          Entering before earnings means selling IV crush; the credit must exceed the post-event compression.
        </p>
      ) : null}
    </div>
  );
}

// Defensive alias map — payoffDraft now emits long-form names, but keep
// these in case other code paths (e.g. backend recommender setup_id, URL
// params) feed in the older shorthand. PM-A persona finding #1.
const COMBO_TYPE_ALIASES: Record<string, string> = {
  straddle: "long_straddle",
  strangle: "long_strangle",
  vertical_spread: "bull_call_spread",
  calendar: "calendar_spread",
  diagonal: "diagonal_spread",
};

function normalizeComboType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return COMBO_TYPE_ALIASES[raw] ?? raw;
}

function StrategyCaption({ comboType }: { comboType?: string | null }) {
  const normalized = normalizeComboType(comboType);
  if (!normalized) return null;
  const text = STRATEGY_CAPTIONS[normalized];
  if (!text) return null;
  return (
    <p className="text-[var(--fg-muted)] text-body-sm mt-2">
      {text} <span className="text-[var(--fg-hint)]">(at expiration)</span>
    </p>
  );
}

function EmptyPayoff({ copy, compact = false }: { copy: string; compact?: boolean }) {
  return (
    <div className={cn("px-4 py-4", compact && "px-3 py-3")}>
      <div className="rounded-md border border-dashed border-border-hair bg-bg px-4 py-6 text-center text-body-sm text-fg-muted">
        {copy}
      </div>
    </div>
  );
}

// PM-A 2026-05-05: extended buildSvgModel return shape with
// maxProfitCoord, maxLossCoord, yAxisTicks, breakevenLeader. These
// support the redesigned payoff chart's curve annotations,
// dollar-labelled Y axis, and breakeven callouts. No visual change
// in this commit — fields are declared but not yet rendered.
export interface PayoffCurveCoord {
  x: number;
  y: number;
  pnl: number;
  price: number;
  label?: string;
}

export interface YAxisTick {
  y: number;
  label: string;
}

export interface BreakevenLeader {
  x: number;
  labelX: number;
  labelY: number;
  price: number;
}

export interface SvgModel {
  width: number;
  height: number;
  padding: number;
  innerWidth: number;
  yTop: number;
  yBottom: number;
  zeroY: number;
  xMin: number;
  xMax: number;
  x: (price: number) => number;
  y: (pnl: number) => number;
  path: string;
  gridYs: number[];
  gridXs: number[];
  maxProfitCoord: PayoffCurveCoord | null;
  maxLossCoord: PayoffCurveCoord | null;
  yAxisTicks: YAxisTick[];
  breakevenLeader: BreakevenLeader[];
}

export function buildSvgModel(points: PayoffPoint[], summary: PayoffSummary): SvgModel | null {
  if (points.length < 2) return null;
  const width = 720;
  const height = 220;
  // PM-A 2026-05-05: widened padding from 28 → 48 so dollar Y-axis
  // labels (e.g. "−$1,200") have room to render without clipping
  // the chart body.
  const padding = 48;
  const innerWidth = width - padding * 2;
  const yTop = 16;
  const yBottom = height - 28;
  const innerHeight = yBottom - yTop;
  const xMin = summary.priceRange.min;
  const xMax = summary.priceRange.max;
  // EOP-AUDIT 2026-05-06 Bug 2b: when priceRange collapses (single
  // strike or upstream pricing failure), every payoff point would
  // map to x = padding via the divide-by-zero-guarded fallback,
  // collapsing the curve to a vertical line at the chart's left
  // edge. Bail early so the empty-state copy renders instead.
  if (xMax - xMin <= 0) return null;
  const pnlValues = [...points.map((point) => point.pnl), 0];
  const rawMin = Math.min(...pnlValues);
  const rawMax = Math.max(...pnlValues);
  // EOP-AUDIT 2026-05-06 Bug 2a: previous symmetric span (yMin =
  // -span*1.12, yMax = span*1.12) crushed asymmetric strategies —
  // a long call with $370 max loss and ~$4,330 max profit rendered
  // its loss-tinted band across half the chart in dead space. Pad
  // up and down independently so each side of zero gets ~12%
  // breathing room, with a small floor so a flat curve still has
  // visible vertical extent.
  const upPad = Math.max(rawMax * 0.12, 1);
  const downPad = Math.max(Math.abs(rawMin) * 0.12, 1);
  const yMin = Math.min(0, rawMin) - downPad;
  const yMax = Math.max(0, rawMax) + upPad;
  const x = (price: number) => padding + ((price - xMin) / (xMax - xMin)) * innerWidth;
  const y = (pnl: number) => yBottom - ((pnl - yMin) / Math.max(1e-6, yMax - yMin)) * innerHeight;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.underlyingPrice).toFixed(2)} ${y(point.pnl).toFixed(2)}`).join(" ");
  const gridYs = [0.25, 0.5, 0.75].map((ratio) => yTop + innerHeight * ratio);
  const gridXs = [0.25, 0.5, 0.75].map((ratio) => padding + innerWidth * ratio);

  // PM-A 2026-05-05: compute max-profit coordinate. If the strategy
  // is unbounded on the upside (e.g. long call), pin to the chart's
  // top-right corner with label "∞". Otherwise scan the payoff
  // points for the highest pnl > 0 and project to (x, y).
  const right = width - padding;
  let maxProfitCoord: PayoffCurveCoord | null = null;
  if (summary.maxProfit.kind === "unlimited") {
    maxProfitCoord = { x: right, y: yTop, pnl: Infinity, price: xMax, label: "∞" };
  } else {
    let best: PayoffPoint | null = null;
    for (const point of points) {
      if (point.pnl > 0 && (best === null || point.pnl > best.pnl)) best = point;
    }
    if (best) {
      maxProfitCoord = { x: x(best.underlyingPrice), y: y(best.pnl), pnl: best.pnl, price: best.underlyingPrice };
    }
  }

  // PM-A 2026-05-05: max-loss coordinate. Unbounded → bottom edge.
  let maxLossCoord: PayoffCurveCoord | null = null;
  if (summary.maxLoss.kind === "unlimited") {
    // Pin to a point reflecting the directional risk: short calls
    // blow up to the right; short puts blow up to the left. We don't
    // know the leg mix here, so anchor to the lowest-pnl curve
    // point as a conservative fallback.
    let worst: PayoffPoint | null = null;
    for (const point of points) {
      if (worst === null || point.pnl < worst.pnl) worst = point;
    }
    if (worst) {
      maxLossCoord = { x: x(worst.underlyingPrice), y: yBottom, pnl: -Infinity, price: worst.underlyingPrice, label: "∞" };
    }
  } else {
    let worst: PayoffPoint | null = null;
    for (const point of points) {
      if (point.pnl < 0 && (worst === null || point.pnl < worst.pnl)) worst = point;
    }
    if (worst) {
      maxLossCoord = { x: x(worst.underlyingPrice), y: y(worst.pnl), pnl: worst.pnl, price: worst.underlyingPrice };
    }
  }

  // PM-A 2026-05-05: pick 4–5 nice round-number dollar Y-axis ticks
  // within [yMin, yMax]. Always include $0. Step is rounded to a
  // {1,2,2.5,5}*10^k "nice" number for human readability.
  const yAxisTicks = computeYAxisTicks(yMin, yMax, y);

  // PM-A 2026-05-05: breakeven leader lines. For each breakeven
  // price, compute its chart x and a label position at the chart's
  // top edge. If the breakeven label collides with the spot
  // indicator (within 20px), shift it 20px left.
  const labelY = yTop + 10;
  const spotX = summary.spotPrice != null ? x(summary.spotPrice) : null;
  const breakevenLeader: BreakevenLeader[] = summary.breakevens.map((price) => {
    const bx = x(price);
    let labelX = bx;
    if (spotX != null && Math.abs(bx - spotX) < 20) {
      labelX = bx - 20;
    }
    return { x: bx, labelX, labelY, price };
  });

  return {
    width,
    height,
    padding,
    innerWidth,
    yTop,
    yBottom,
    zeroY: y(0),
    xMin,
    xMax,
    x,
    y,
    path,
    gridYs,
    gridXs,
    maxProfitCoord,
    maxLossCoord,
    yAxisTicks,
    breakevenLeader,
  };
}

function computeYAxisTicks(yMin: number, yMax: number, project: (pnl: number) => number): YAxisTick[] {
  const range = yMax - yMin;
  if (!Number.isFinite(range) || range <= 0) return [];
  // Aim for ~4 ticks; pick a "nice" step.
  const target = 4;
  const rough = range / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  let nice: number;
  if (normalised < 1.5) nice = 1;
  else if (normalised < 3) nice = 2;
  else if (normalised < 7) nice = 5;
  else nice = 10;
  const step = nice * magnitude;
  const start = Math.ceil(yMin / step) * step;
  const ticks: YAxisTick[] = [];
  // Always include $0 if it's in range.
  const includeZero = yMin <= 0 && yMax >= 0;
  for (let value = start; value <= yMax + 1e-6 && ticks.length < 6; value += step) {
    if (includeZero && Math.abs(value) < step / 2 && !ticks.some((t) => t.label === "$0")) {
      ticks.push({ y: project(0), label: "$0" });
      continue;
    }
    ticks.push({ y: project(value), label: formatTickLabel(value) });
  }
  if (includeZero && !ticks.some((t) => t.label === "$0")) {
    ticks.push({ y: project(0), label: "$0" });
  }
  return ticks;
}

function formatTickLabel(value: number): string {
  if (Math.abs(value) < 0.5) return "$0";
  const sign = value < 0 ? "−" : "+";
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const thousands = abs / 1000;
    const rounded = thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10;
    return `${sign}$${rounded}k`;
  }
  return `${sign}$${Math.round(abs)}`;
}

function nearestPoint(points: PayoffPoint[], underlyingPrice: number): PayoffPoint | null {
  if (points.length === 0) return null;
  return points.reduce((best, point) => (
    Math.abs(point.underlyingPrice - underlyingPrice) < Math.abs(best.underlyingPrice - underlyingPrice)
      ? point
      : best
  ), points[0]);
}

function formatPayoffValue(value: PayoffValue): string {
  if (value.kind === "unlimited") return "Unlimited";
  if (value.kind === "unknown") return "Unknown";
  return formatCurrency(value.value);
}
