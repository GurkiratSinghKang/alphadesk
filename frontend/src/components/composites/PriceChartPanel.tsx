"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import Mono from "@/components/typography/Mono";
import type {
  ChartBar,
  ChartPoint,
  ChartRange,
  MarketSymbol,
  MetaCells,
  Quote,
  RegimeBand,
} from "./types";

/**
 * PriceChartPanel (composite)
 * ───────────────────────────
 * Header: sym-name (italic serif 40px), sym-ticker (tracked caps),
 *         sym-price (mono 36px 300-weight), sym-delta (mono profit/loss),
 *         5 meta cells (Vol / AvgVol / Range / IV / Regime fit).
 * Then a chart-bar with range buttons and the legend chips.
 * Then a `<div>` wrapping `lightweight-charts` with the gold line,
 * optional regime bands, and 20-SMA dashed overlay.
 *
 * Presentation only. All data (OHLCV, meta, quote, current range)
 * is owned by the parent. The old `components/panels/ChartPanel.tsx`
 * is incompatible (1114 lines of stateful spaghetti) — this file is
 * the clean replacement; F3 chooses the wiring path.
 */

const RANGES: ChartRange[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "ALL"];

export interface PriceChartPanelProps {
  symbol: MarketSymbol;
  quote: Quote;
  meta: MetaCells;
  /** OHLCV bars in time-ascending order. */
  series: ChartBar[];
  /** Optional 20-SMA overlay (dashed chartreuse). */
  smaSeries?: ChartPoint[];
  /** Optional regime bands drawn as translucent background rectangles. */
  regimeBands?: RegimeBand[];
  activeRange: ChartRange;
  onRangeChange: (r: ChartRange) => void;
  /** Parent-controlled loading flag — true while bars are being fetched
   *  for the first time. Renders a pulse skeleton instead of an empty div. */
  isLoading?: boolean;
  /** Parent-controlled error state. When set, the canvas is replaced with
   *  a "Failed to load — retry" CTA wired to `onRetry`. */
  error?: boolean;
  /** Retry handler invoked from the error-state button. */
  onRetry?: () => void;
  className?: string;
}

function getVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v ? v.trim() : fallback;
}

function ChartCanvas({
  series,
  smaSeries,
  regimeBands,
}: Pick<PriceChartPanelProps, "series" | "smaSeries" | "regimeBands">) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!ref.current || series.length === 0) return;
    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any = null;

    (async () => {
      const mod = await import("lightweight-charts");
      if (disposed || !ref.current) return;

      const gold = getVar("--gold-300", "#e0c070");
      const up = getVar("--up-500", "#a8d04d");
      const fgHint = getVar("--fg-hint", "#5b5547");
      const bg = getVar("--bg", "#0b0a09");
      const border = getVar("--border", "#2a271d");

      chart = mod.createChart(ref.current, {
        layout: {
          background: { type: mod.ColorType.Solid, color: bg },
          textColor: fgHint,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: border, style: mod.LineStyle.Dotted },
          horzLines: { color: border, style: mod.LineStyle.Dotted },
        },
        rightPriceScale: { borderColor: border },
        timeScale: { borderColor: border, timeVisible: true },
        crosshair: { mode: mod.CrosshairMode.Normal },
        autoSize: true,
      });

      const line = chart.addSeries(mod.LineSeries, { color: gold, lineWidth: 2 });
      line.setData(series.map((b) => ({ time: b.time, value: b.close })));

      if (smaSeries && smaSeries.length > 1) {
        const sma = chart.addSeries(mod.LineSeries, {
          color: up,
          lineWidth: 1,
          lineStyle: mod.LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        sma.setData(smaSeries.map((p) => ({ time: p.time, value: p.value })));
      }

      if (regimeBands?.length) {
        // LWC has no native band-region API; render via price lines
        // at the band midpoint in tone-specific colors.
        const mid = (Math.max(...series.map((s) => s.high)) +
          Math.min(...series.map((s) => s.low))) / 2;
        regimeBands.forEach((b) => {
          line.createPriceLine({
            price: mid,
            color: b.tone === "bear"
              ? "rgba(224,120,86,0.18)"
              : "rgba(141,179,196,0.18)",
            lineWidth: 1,
            lineStyle: mod.LineStyle.Dotted,
            axisLabelVisible: false,
          });
        });
      }

      chart.timeScale().fitContent();
    })();

    return () => {
      disposed = true;
      try { chart?.remove(); } catch { /* no-op */ }
    };
  }, [series, smaSeries, regimeBands]);

  return (
    <div
      ref={ref}
      data-slot="price-chart-canvas"
      className="flex-1 min-h-[220px]"
    />
  );
}

function MetaCell({ k, value, tone }: { k: string; value: string; tone?: "profit" | "loss" }) {
  const isDash = value === "\u2014" || value === "—";
  return (
    <div className="flex flex-col">
      <span
        className="font-sans font-semibold text-[9.5px] uppercase text-fg-hint mb-0.5"
        style={{ letterSpacing: "0.14em" }}
      >{k}</span>
      {isDash ? (
        <span className="font-display italic text-[13px] text-fg-hint">{value}</span>
      ) : (
        <Mono
          size="body"
          className={cn(
            "font-medium",
            tone === "profit" ? "text-up-500" : tone === "loss" ? "text-down-500" : "text-fg"
          )}
        >{value}</Mono>
      )}
    </div>
  );
}

function LegendChip({ swatchColor, label, dashed, block }: { swatchColor: string; label: string; dashed?: boolean; block?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 10,
          height: block ? 10 : 2,
          background: swatchColor,
          borderTop: dashed ? `1px dashed ${swatchColor}` : undefined,
        }}
      />
      {label}
    </span>
  );
}

const EM_DASH = "\u2014";

/**
 * Render an em-dash when a numeric value is missing / not-a-number /
 * exactly zero. Matches the `formatOrDash` pattern used in
 * `strategies/[id]/_strategy/StrategyHero.tsx`. Returns `null` when
 * the caller should render the em-dash fallback JSX instead of the
 * real numeric string.
 */
function numberOrNull(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return null;
  // A literal zero coming from "no data" (e.g. `toQuote` on undefined)
  // should still render as a dash; real zero prices don't exist in
  // liquid markets.
  if (value === 0) return null;
  return value;
}

/** Pretty em-dash span — italic serif, fg-hint, matches StrategyHero. */
function DashSpan({ size = 13 }: { size?: number }) {
  return (
    <span
      className="font-display italic text-fg-hint"
      style={{ fontSize: `${size}px`, lineHeight: 1 }}
    >
      {EM_DASH}
    </span>
  );
}

export default function PriceChartPanel({
  symbol, quote, meta, series, smaSeries, regimeBands,
  activeRange, onRangeChange, isLoading, error, onRetry, className,
}: PriceChartPanelProps) {
  const last = numberOrNull(quote.last);
  const change = numberOrNull(quote.change);
  const changePct = numberOrNull(quote.changePct);
  const regimeFit = numberOrNull(meta.regimeFit);

  const deltaSign = (change ?? 0) >= 0 ? "+" : "\u2212";
  const deltaTone = (change ?? 0) >= 0 ? "text-up-500" : "text-down-500";

  return (
    <section data-slot="price-chart-panel" className={cn("flex flex-col overflow-hidden", className)}>
      {/* Viewport audit r5 #8: header is single-row flex with hero (name +
          ticker), price, and 5 meta cells. At 500-700px center-column widths
          (tablet with rail + right) the row overflowed and was clipped by
          md:overflow-hidden on desk-main. Allow wrap so meta cells drop to
          a second line rather than clip; each cell already has shrink-0. */}
      {/* Wave 29 persona-5 #1: hero was text-[40px] name + text-[36px] price
          with `px-7` (28px gutters) — that consumed ~280px of a 390px viewport
          and overflowed every time. Step down the type ladder on mobile so the
          header fits, then restore at sm/md. */}
      <header className="flex flex-wrap items-end gap-4 md:gap-6 px-4 md:px-7 pt-4 md:pt-5 pb-3.5 border-b border-border-hair">
        <div>
          <div
            className="font-display italic text-[22px] sm:text-[32px] md:text-[40px] text-ink-1000"
            style={{ letterSpacing: "-0.025em", lineHeight: 1 }}
          >{symbol.name}</div>
          <div
            className="font-sans font-semibold text-[13px] text-fg-muted mt-1 uppercase"
            style={{ letterSpacing: "0.16em" }}
          >{symbol.ticker} · {symbol.venue}</div>
        </div>

        <div>
          <div
            className="font-mono tabular-nums text-[22px] sm:text-[28px] md:text-[36px] font-light text-ink-1000"
            style={{ letterSpacing: "-0.02em", lineHeight: 1 }}
          >
            {last == null ? <DashSpan size={36} /> : last.toFixed(2)}
          </div>
          <div className={cn("font-mono tabular-nums text-[13px] mt-1", change == null ? "text-fg-hint" : deltaTone)}>
            {change == null || changePct == null ? (
              <DashSpan size={13} />
            ) : (
              <>
                {deltaSign}{Math.abs(change).toFixed(2)} · {deltaSign}{Math.abs(changePct).toFixed(2)}%
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-2 md:gap-[18px] ml-auto font-mono text-[11px] text-fg-muted">
          <MetaCell k="Vol" value={meta.volume} />
          <MetaCell k="Avg Vol" value={meta.avgVolume} />
          <MetaCell k="Range" value={meta.range} />
          <MetaCell k="IV" value={meta.iv} />
          <MetaCell
            k="Regime fit"
            value={regimeFit == null ? EM_DASH : regimeFit.toFixed(2)}
            tone={regimeFit == null ? undefined : regimeFit >= 0.5 ? "profit" : "loss"}
          />
        </div>
      </header>

      {/* Wave 29 persona-5 #2: range row (8 buttons) + legend (3 chips) were
          both `flex` no-wrap inside `px-7`, which clipped at 390 viewport.
          `flex-wrap gap-1.5 md:gap-2` lets the legend drop to a second line
          and keeps every range button tappable. */}
      <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-1.5 px-4 md:px-7 py-2.5 border-b border-border-hair">
        <div className="flex flex-wrap gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRangeChange(r)}
              data-active={r === activeRange || undefined}
              className={cn(
                "font-mono text-[10.5px] px-2.5 py-1 rounded-xs transition-colors",
                r === activeRange ? "text-ink-1000 bg-bg-elev-1" : "text-fg-muted hover:text-fg"
              )}
              style={{ letterSpacing: "0.02em" }}
            >{r}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 md:gap-[14px] font-mono text-[10.5px] text-fg-muted">
          <LegendChip swatchColor="var(--gold-300)" label="Price" />
          <LegendChip swatchColor="var(--up-500)" dashed label="20-SMA" />
          <LegendChip swatchColor="rgba(141,179,196,0.25)" block label="Regime bands" />
        </div>
      </div>

      <div className="flex-1 relative px-4 md:px-7 py-4 min-h-[220px]">
        {error ? (
          <div
            role="alert"
            className="flex flex-col items-center justify-center gap-2.5 h-full min-h-[200px]"
          >
            <span
              className="font-display italic text-[13px] text-fg-muted"
              style={{ letterSpacing: "-0.005em" }}
            >
              Failed to load chart data.
            </span>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="font-sans font-semibold text-[10px] uppercase text-brand hover:text-gold-300 border border-border bg-bg-elev-1 rounded-xs px-3 py-1.5 transition-colors"
                style={{ letterSpacing: "0.14em" }}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : isLoading ? (
          <div
            aria-hidden="true"
            className="w-full h-[200px] rounded-md bg-bg-elev-1 animate-pulse"
          />
        ) : series.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 text-center h-full min-h-[200px]">
            <span
              className="font-display italic text-[14px] text-fg-muted"
              style={{ letterSpacing: "-0.005em" }}
            >
              Not enough price data.
            </span>
            <span className="font-sans text-[10.5px] text-fg-hint">
              Try a wider range or check back once bars arrive.
            </span>
          </div>
        ) : (
          <ChartCanvas series={series} smaSeries={smaSeries} regimeBands={regimeBands} />
        )}
      </div>
    </section>
  );
}
