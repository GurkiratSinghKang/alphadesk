"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import Mono from "@/components/typography/Mono";
import ChartPane, {
  type ChartOrderPlacement,
  type ChartTradeOverlay,
} from "@/components/charts/ChartPane";
import { useMarketDepth } from "@/hooks/useMarketDepth";
import { useShortcutHandler } from "@/hooks/useKeyboardShortcuts";
import type { ApiFetchOptions } from "@/lib/api";
import type {
  ChartBar,
  ChartPoint,
  ChartRange,
  MarketSymbol,
  MetaCells,
  Quote,
  RegimeBand,
} from "./types";
import type { OHLCVBar } from "@/types";

type MarketDepthFetchOptions = Pick<
  ApiFetchOptions,
  "signal" | "suppressAuthRedirect" | "suppressGlobalError" | "timeoutMs"
>;

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
  /** Execution mode trims header chrome so the chart owns the workspace. */
  density?: "standard" | "execution";
  tradeOverlays?: ChartTradeOverlay[];
  chartOrderPlacement?: ChartOrderPlacement | null;
  /** Forwarded to the underlying TradingChart — fires when the chart pans
   *  near the leftmost loaded bar so the parent can fetch older history. */
  onLoadMoreHistory?: () => void;
  /** True while a load-more fetch is in flight. */
  loadingMoreHistory?: boolean;
  /** Disable protected market-depth polling when the parent renders local preview data. */
  enableMarketDepth?: boolean;
  /** Forwarded to the market-depth fetcher for public routes that own 401 handling. */
  marketDepthOptions?: MarketDepthFetchOptions;
  /** When true, hide the built-in range button row. Set by callers that
   *  render their own external toolbar (e.g. v2 trade page → ChartToolbar)
   *  to avoid duplicate range UI. The chart still consumes `activeRange`
   *  so the keyboard shortcut handler keeps working. */
  hideRangeBar?: boolean;
  className?: string;
}

function MetaCell({ k, value, tone }: { k: string; value: string; tone?: "profit" | "loss" }) {
  const isDash = value === "\u2014" || value === "—";
  return (
    <div className="flex flex-col">
      <span className="t-label uppercase tracking-wider text-fg-hint mb-0.5">{k}</span>
      {isDash ? (
        <span className="font-display italic text-body-sm text-fg-hint">{value}</span>
      ) : (
        <Mono
          size="body"
          className={cn(
            "text-base font-medium",
            tone === "profit" ? "text-profit" : tone === "loss" ? "text-down-500" : "text-fg"
          )}
        >{value}</Mono>
      )}
    </div>
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
  symbol, quote, meta, series,
  activeRange, onRangeChange, isLoading, error, onRetry, density = "standard", tradeOverlays, chartOrderPlacement, onLoadMoreHistory, loadingMoreHistory, enableMarketDepth = true, marketDepthOptions, hideRangeBar, className,
}: PriceChartPanelProps) {
  const last = numberOrNull(quote.last);
  const change = numberOrNull(quote.change);
  const changePct = numberOrNull(quote.changePct);
  const regimeFit = numberOrNull(meta.regimeFit);
  // a11y: SR-friendly debounced last price (every 2s) so screen readers
  // are not flooded by ticker updates while still hearing meaningful
  // changes via the aria-live wrapper below.
  const debouncedLast = React.useDeferredValue(last);
  const debouncedChange = React.useDeferredValue(change);
  const debouncedChangePct = React.useDeferredValue(changePct);
  const hasChartSeries = series.length > 0;
  const marketDepth = useMarketDepth(
    symbol.ticker,
    quote,
    hasChartSeries && enableMarketDepth,
    marketDepthOptions,
  );
  const handleRangeShortcut = React.useCallback((action: string) => {
    const range = action.slice("chart:set-range:".length) as ChartRange;
    if (RANGES.includes(range)) {
      onRangeChange(range);
    }
  }, [onRangeChange]);
  useShortcutHandler("chart:set-range", handleRangeShortcut);

  const deltaSign = (debouncedChange ?? 0) >= 0 ? "+" : "\u2212";
  const deltaTone = (debouncedChange ?? 0) >= 0 ? "text-profit" : "text-down-500";

  // Round-15 / persona-10 P0: the ``data`` prop was being recomputed
  // from a fresh ``series.map(...)`` literal inline in JSX every parent
  // render. ChartPane.data → TradingChart.setChartData useEffect dep,
  // so each desk re-render (and there are many — pipeline pill, ticks,
  // store updates) tore down + rebuilt every overlay/marker/indicator.
  // Memoise on series identity so the chart only refreshes when bars
  // actually change.
  const chartData = React.useMemo<OHLCVBar[]>(
    () =>
      series.map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume ?? 0,
      })),
    [series],
  );
  const executionDensity = density === "execution";

  return (
    <section data-slot="price-chart-panel" className={cn("flex flex-col overflow-hidden", className)}>
      {!executionDensity ? (
        <>
      {/* Viewport audit r5 #8: header is single-row flex with hero (name +
          ticker), price, and 5 meta cells. At 500-700px center-column widths
          (tablet with rail + right) the row overflowed and was clipped by
          md:overflow-hidden on desk-main. Allow wrap so meta cells drop to
          a second line rather than clip; each cell already has shrink-0. */}
      {/* Wave 29 persona-5 #1: hero was text-[40px] name + text-[36px] price
          with `px-7` (28px gutters) — that consumed ~280px of a 390px viewport
          and overflowed every time. Step down the type ladder on mobile so the
          header fits, then restore at sm/md. */}
      {/* 2026-04-20 r2: the hero serif NAME (40px) + mono PRICE (48px)
          were visually over-dominant — they dwarfed the meta cells and
          the rest of the page. Trader dashboards (TV, ToS, Webull)
          prioritise a chart canvas that fills the space; the header is
          a dense strip, not a magazine hero. Stepped both down to a
          sensible size (name 24px serif italic; price 32px mono
          tabular) and tightened vertical padding from pt-5 to pt-3.5
          so the chart gets ~40 more vertical pixels. */}
      <header className="flex flex-wrap items-baseline gap-4 md:gap-6 px-4 md:px-6 pt-3 md:pt-3.5 pb-3 border-b border-border-hair">
        <div className="flex items-baseline gap-3">
          <span
            className="font-display italic text-h2 md:text-h1 text-ink-1000"
            style={{ letterSpacing: 0, lineHeight: 1 }}
          >{symbol.name}</span>
          <span
            className="font-sans font-semibold text-label text-fg-muted uppercase"
            style={{ letterSpacing: 0 }}
          >{symbol.ticker}{symbol.venue ? ` · ${symbol.venue}` : ""}</span>
        </div>

        <div className="flex items-baseline gap-2" aria-live="polite" aria-atomic="true">
          <span
            className="font-mono tabular-nums text-h2 md:text-display-sm font-light text-ink-1000"
            style={{ letterSpacing: 0, lineHeight: 1 }}
          >
            {debouncedLast == null ? <DashSpan size={32} /> : debouncedLast.toFixed(2)}
          </span>
          <span className={cn("font-mono tabular-nums text-body md:text-body", debouncedChange == null ? "text-fg-hint" : deltaTone)}>
            {debouncedChange == null || debouncedChangePct == null ? (
              <DashSpan size={14} />
            ) : (
              <>
                {deltaSign}{Math.abs(debouncedChange).toFixed(2)} · {deltaSign}{Math.abs(debouncedChangePct).toFixed(2)}%
              </>
            )}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 md:gap-x-5 ml-auto font-mono text-body-sm text-fg-muted">
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
        </>
      ) : null}

      {/* Slice-4 / CH-2A (chart audit 2026-04-26): the per-row legend chips
          (`Price · 20-SMA · Regime bands`) used to live HERE on the toolbar,
          divorced from the chart. Per TradingView convention the indicator
          legend belongs INSIDE the chart canvas, top-left, fused with the
          OHLC overlay so they form a single block. ``OHLCReadout`` (rendered
          by ``ChartPane`` inside the canvas) already shows the active
          indicators with their periods (EMA 20, EMA 50, SMA 20, …) tracking
          actual user-toggled state — so this toolbar copy was both
          redundant AND lying (always rendering "Price · 20-SMA · Regime
          bands" regardless of indicator-menu toggles). Removed.

          Range buttons stay on the toolbar (they're a navigation primitive,
          not a legend). The legend now lives entirely inside the chart.
          v2 trade page renders its own ChartToolbar above this panel; pass
          `hideRangeBar` to suppress this row in that scenario. */}
      {!hideRangeBar && <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border-hair",
          executionDensity
            ? "border-border-hair bg-bg px-4 py-3"
            : "px-4 py-2.5 md:px-7",
        )}
      >
        <div className="flex flex-wrap gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRangeChange(r)}
              data-active={r === activeRange || undefined}
              className={cn(
                "inline-flex items-center justify-center min-h-touch min-w-touch md:min-h-[36px] md:min-w-[36px] md:px-3",
                "font-mono text-body-sm px-2.5 py-1 rounded-xs transition-colors",
                executionDensity
                  ? r === activeRange
                    ? "bg-primary text-primary-foreground"
                    : "text-fg-muted hover:bg-primary/10 hover:text-fg"
                  : r === activeRange ? "text-ink-1000 bg-bg-elev-1" : "text-fg-muted hover:text-fg"
              )}
              style={{ letterSpacing: 0 }}
            >{r}</button>
          ))}
        </div>
      </div>}

      {/* Chart canvas height: standard density doubled from the prior
          220px (which only fit ~10 candles vertically and looked like
          a sparkline) to 540px so bars get vertical breathing room and
          the indicator/volume overlays don't overlap the price axis.
          Execution density bumped from 420px → 620px so the trade
          workspace chart owns the page like a desktop terminal. */}
      <div
        className={cn(
          "relative flex flex-1 flex-col",
          executionDensity
            ? "min-h-[620px] bg-bg px-3 py-3 text-fg md:px-4 md:py-4"
            : "min-h-[480px] px-4 py-4 md:min-h-[540px] md:px-7",
        )}
      >
        {error ? (
          <div
            role={executionDensity ? "status" : "alert"}
            className="flex flex-col items-center justify-center gap-2.5 h-full min-h-[440px]"
          >
            <span
              className={cn("font-sans text-body-sm font-medium", executionDensity ? "text-fg" : "italic text-fg-muted")}
              style={{ letterSpacing: 0 }}
            >
              {executionDensity ? "Chart data is temporarily limited." : "Failed to load chart data."}
            </span>
            {executionDensity ? (
              <span className="max-w-sm text-center text-body-sm leading-relaxed text-fg-muted">
                Quote and ticket checks remain visible while historical bars recover.
              </span>
            ) : null}
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className={cn(
                  "rounded-xs border px-3 py-1.5 font-sans text-label font-semibold uppercase tracking-normal transition-colors",
                  executionDensity
                    ? "border-border-hair bg-bg-elev-1 text-primary hover:bg-primary/10"
                    : "border-border bg-bg-elev-1 text-primary hover:text-gold-300",
                )}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : isLoading ? (
          <div
            role="status"
            aria-label="Loading chart data"
            className={cn(
              "w-full animate-pulse rounded-md",
              executionDensity ? "h-[600px] bg-bg-elev-2" : "h-[440px] md:h-[500px] bg-bg-elev-1",
            )}
          >
            <span className="sr-only">Loading chart data…</span>
          </div>
        ) : series.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 text-center h-full min-h-[440px]">
            <span
              className={cn("font-display text-body", executionDensity ? "text-fg-muted" : "italic text-fg-muted")}
              style={{ letterSpacing: 0 }}
            >
              Not enough price data.
            </span>
            <span className="font-sans text-body-sm text-fg-hint">
              Try a wider range or check back once bars arrive.
            </span>
          </div>
        ) : (
          // 2026-04-20 dashboard redesign: the line-only ChartCanvas is
          // replaced by ChartPane (candle-default + volume histogram +
          // chart-type toggle + drawing-tools rail + indicator menu).
          // ChartCanvas remains exported below for any caller that still
          // wants the minimal line-only version; the dashboard does not.
          <ChartPane
            data={chartData}
            topOfBook={quote}
            marketDepth={marketDepth}
            tradeOverlays={tradeOverlays}
            chartOrderPlacement={chartOrderPlacement}
            onLoadMoreHistory={onLoadMoreHistory}
            loadingMoreHistory={loadingMoreHistory}
          />
        )}
      </div>
    </section>
  );
}
