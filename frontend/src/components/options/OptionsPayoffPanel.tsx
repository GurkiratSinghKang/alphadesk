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
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-brand/10 text-brand">
            <ChartLine className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-ink-1000">{title}</h2>
            <p className="truncate text-[12px] text-fg-muted">
              {draft?.label ?? "Model an option strategy before staging the ticket."}
            </p>
          </div>
        </div>
        {onOpenBuilder ? (
          <button
            type="button"
            onClick={onOpenBuilder}
            className="inline-flex min-h-9 items-center rounded-sm border border-border bg-bg px-3 text-[12px] font-semibold text-fg-muted transition hover:border-brand hover:text-fg active:translate-y-px"
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
          <div className="mt-3 flex gap-2 rounded-md border border-amber/30 bg-amber/10 px-3 py-3 text-[13px] text-fg-muted">
            <WarningCircle className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
            <span>{summary.reason}</span>
          </div>
          <LegList draft={draft} />
        </div>
      ) : (
        <div className="px-4 py-4">
          <MetricGrid summary={summary} compact={compact} />
          <PayoffChart summary={summary} />
          {!compact ? <LegList draft={draft} /> : null}
        </div>
      )}
    </section>
  );
}

function MetricGrid({ summary, compact }: { summary: PayoffSummary; compact: boolean }) {
  const netLabel = summary.netPremium >= 0 ? "Net credit" : "Net debit";
  const netValue =
    summary.status === "ready"
      ? formatCurrency(Math.abs(summary.netPremium))
      : "Unknown";
  const breakevenValue =
    summary.breakevens.length === 0
      ? summary.status === "ready"
        ? "None"
        : "Unknown"
      : summary.breakevens.map((price) => formatCurrency(price)).join(", ");
  const metrics = [
    { label: "Max profit", value: formatPayoffValue(summary.maxProfit), tone: "text-profit" },
    { label: "Max loss", value: formatPayoffValue(summary.maxLoss), tone: "text-loss" },
    { label: "Breakeven", value: breakevenValue, tone: "text-fg" },
    { label: netLabel, value: netValue, tone: summary.netPremium >= 0 ? "text-profit" : "text-loss" },
  ];
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-md border border-border-hair bg-border-hair", compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0 bg-bg px-3 py-3">
          <p className="t-label text-fg-hint">{metric.label}</p>
          <p className={cn("mt-2 truncate font-mono text-[14px] font-semibold tabular-nums", metric.tone)}>
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function PayoffChart({ summary }: { summary: PayoffSummary }) {
  const [hovered, setHovered] = useState<PayoffPoint | null>(null);
  const points = summary.payoffPoints;
  const chart = useMemo(() => buildSvgModel(points, summary), [points, summary]);
  if (!chart) {
    return <EmptyPayoff copy="The payoff curve will appear once every selected leg has a usable price." compact />;
  }

  return (
    <div className="mt-4 rounded-md border border-border-hair bg-bg px-3 py-3">
      <div
        className="relative h-[220px] w-full"
        onMouseLeave={() => setHovered(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
          const price = chart.xMin + Math.max(0, Math.min(1, ratio)) * (chart.xMax - chart.xMin);
          setHovered(nearestPoint(points, price));
        }}
      >
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-full w-full overflow-visible" role="img" aria-label="Options profit and loss at expiration">
          <rect x="0" y="0" width={chart.width} height={chart.height} rx="10" fill="transparent" />
          <rect x={chart.padding} y={chart.yTop} width={chart.innerWidth} height={Math.max(0, chart.zeroY - chart.yTop)} fill="var(--profit-tint)" opacity="0.55" />
          <rect x={chart.padding} y={chart.zeroY} width={chart.innerWidth} height={Math.max(0, chart.yBottom - chart.zeroY)} fill="var(--loss-tint)" opacity="0.6" />
          {chart.gridYs.map((y) => (
            <line key={`grid-y-${y}`} x1={chart.padding} x2={chart.width - chart.padding} y1={y} y2={y} stroke="var(--border-hair)" />
          ))}
          {chart.gridXs.map((x) => (
            <line key={`grid-x-${x}`} x1={x} x2={x} y1={chart.yTop} y2={chart.yBottom} stroke="var(--border-hair)" />
          ))}
          <line x1={chart.padding} x2={chart.width - chart.padding} y1={chart.zeroY} y2={chart.zeroY} stroke="var(--fg-muted)" strokeDasharray="4 5" opacity="0.85" />
          {summary.spotPrice != null ? (
            <g>
              <line x1={chart.x(summary.spotPrice)} x2={chart.x(summary.spotPrice)} y1={chart.yTop} y2={chart.yBottom} stroke="var(--brand)" strokeDasharray="3 5" opacity="0.9" />
              <circle cx={chart.x(summary.spotPrice)} cy={chart.zeroY} r="3.5" fill="var(--brand)" />
            </g>
          ) : null}
          {summary.breakevens.map((breakeven) => (
            <g key={`be-${breakeven}`}>
              <line x1={chart.x(breakeven)} x2={chart.x(breakeven)} y1={chart.yTop} y2={chart.yBottom} stroke="var(--fg-muted)" strokeDasharray="2 4" opacity="0.7" />
              <circle cx={chart.x(breakeven)} cy={chart.zeroY} r="3" fill="var(--bg)" stroke="var(--fg-muted)" />
            </g>
          ))}
          <path d={chart.path} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {hovered ? (
            <g>
              <line x1={chart.x(hovered.underlyingPrice)} x2={chart.x(hovered.underlyingPrice)} y1={chart.yTop} y2={chart.yBottom} stroke="var(--fg)" opacity="0.18" />
              <circle cx={chart.x(hovered.underlyingPrice)} cy={chart.y(hovered.pnl)} r="4" fill={hovered.pnl >= 0 ? "var(--profit)" : "var(--loss)"} />
            </g>
          ) : null}
        </svg>
        <div className="pointer-events-none absolute left-2 top-2 rounded border border-border-hair bg-bg-elev-1/95 px-2 py-1 font-mono text-[12px] text-fg-muted shadow-[0_10px_24px_-18px_rgba(16,22,17,0.55)]">
          {hovered
            ? `${formatCurrency(hovered.underlyingPrice)} -> ${formatCurrency(hovered.pnl)}`
            : "Hover for P/L"}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-fg-muted">
        <span>At expiration</span>
        {summary.spotPrice != null ? <span>Spot {formatCurrency(summary.spotPrice)}</span> : null}
        {summary.expiries[0] ? <span>Expiry {summary.expiries[0]}</span> : null}
      </div>
    </div>
  );
}

function LegList({ draft }: { draft: OptionStrategyDraft }) {
  return (
    <div className="mt-4 grid gap-2">
      {draft.legs.map((leg, index) => (
        <div key={`${leg.id}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border-hair bg-bg px-3 py-2 font-mono text-[12px]">
          <span className={cn("rounded px-2 py-1 uppercase", leg.side === "buy" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss")}>
            {leg.side}
          </span>
          <span className="min-w-0 truncate text-fg">
            {leg.expiry} {leg.strike} {leg.kind.toUpperCase()} x {leg.qty}
          </span>
          <span className="text-fg-muted">{leg.entryPrice == null ? "Unpriced" : formatCurrency(leg.entryPrice)}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyPayoff({ copy, compact = false }: { copy: string; compact?: boolean }) {
  return (
    <div className={cn("px-4 py-4", compact && "px-3 py-3")}>
      <div className="rounded-md border border-dashed border-border-hair bg-bg px-4 py-6 text-center text-[13px] text-fg-muted">
        {copy}
      </div>
    </div>
  );
}

function buildSvgModel(points: PayoffPoint[], summary: PayoffSummary) {
  if (points.length < 2) return null;
  const width = 720;
  const height = 220;
  const padding = 28;
  const innerWidth = width - padding * 2;
  const yTop = 16;
  const yBottom = height - 28;
  const innerHeight = yBottom - yTop;
  const xMin = summary.priceRange.min;
  const xMax = summary.priceRange.max;
  const pnlValues = [...points.map((point) => point.pnl), 0];
  const rawMin = Math.min(...pnlValues);
  const rawMax = Math.max(...pnlValues);
  const span = Math.max(Math.abs(rawMin), Math.abs(rawMax), 1);
  const yMin = -span * 1.12;
  const yMax = span * 1.12;
  const x = (price: number) => padding + ((price - xMin) / Math.max(1, xMax - xMin)) * innerWidth;
  const y = (pnl: number) => yBottom - ((pnl - yMin) / Math.max(1, yMax - yMin)) * innerHeight;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.underlyingPrice).toFixed(2)} ${y(point.pnl).toFixed(2)}`).join(" ");
  const gridYs = [0.25, 0.5, 0.75].map((ratio) => yTop + innerHeight * ratio);
  const gridXs = [0.25, 0.5, 0.75].map((ratio) => padding + innerWidth * ratio);
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
  };
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
