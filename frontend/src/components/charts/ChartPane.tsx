"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { TradingChart } from "@/components/charts/TradingChart";
import type { ChartType, Indicator, OHLCVBar } from "@/types";

/**
 * ChartPane — dashboard chart surface (2026-04-20 redesign)
 * ─────────────────────────────────────────────────────────
 * Wraps `TradingChart` with the three desktop-trading primitives owner
 * research said every competitor ships and we didn't:
 *
 *   1. Chart-type toggle — candle (default) / line / area. The toggle
 *      lives top-right of the chart, matching ThinkorSwim's "Style"
 *      button pattern. Candle is the default per Webull/ToS/TWS precedent.
 *   2. Indicator menu — small popover with VWAP/EMA/SMA/BB/RSI/MACD
 *      checkboxes. Same priority stack the research report recommended
 *      (VWAP first because it's the one prosumer tool most retail
 *      brokers skip).
 *   3. Drawing-tools rail slot — 44px vertical strip on the LEFT of the
 *      chart canvas where the drawing-primitives toolbar will mount
 *      in a follow-up task. This component renders the strip + tool
 *      buttons; the actual drawing render path lives in the chart
 *      drawing plugin (separate file).
 *
 * Volume histogram: already rendered by `TradingChart` when the OHLCV
 * bars include `volume`. No extra config needed.
 *
 * TV watermark: already hidden in `TradingChart.tsx` via the inline
 * `<style>` rule (`.tv-lightweight-charts .chart-watermark {display:none}`
 * at the bottom of that component). If a watermark ever re-appears after
 * a lightweight-charts upgrade, re-verify that rule.
 */

export interface ChartPaneProps {
  data: OHLCVBar[];
  /** Empty-state + error-state are handled by the parent so ChartPane
   *  stays focused on the live-data path. */
  isLoading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  className?: string;
}

const TYPES: { id: ChartType; label: string; icon: React.ReactNode }[] = [
  {
    id: "candle",
    label: "Candles",
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M4 2v2M4 10v2M10 3v3M10 9v2" stroke="currentColor" strokeWidth="1.4" />
        <rect x="2.75" y="4" width="2.5" height="6" fill="currentColor" />
        <rect x="8.75" y="3" width="2.5" height="8" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "line",
    label: "Line",
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 10l4-4 3 2 5-6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "area",
    label: "Area",
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 10l4-4 3 2 5-6v10H1z" fill="currentColor" opacity="0.45" />
        <path d="M1 10l4-4 3 2 5-6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
    ),
  },
];

const ALL_INDICATORS: Indicator[] = ["VWAP", "EMA", "SMA", "Bollinger", "RSI", "MACD"];

// Drawing tools: the toolbar renders a chrome rail; the actual drawing
// capture + render lives in the drawing plugin. We expose the tool state
// as a callback so the parent (or a future drawings-store hook) can wire
// click-to-draw. In this first cut the buttons only flip an "active tool"
// local state — actual primitives land in a follow-up.
type DrawingTool = "cursor" | "trend" | "horizontal" | "rect" | "fib" | "text";

const DRAWING_TOOLS: { id: DrawingTool; label: string; icon: React.ReactNode }[] = [
  {
    id: "cursor",
    label: "Select",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M2 2l4 9 1.8-3.6L11 7l-2-2.4L6 2 2 2z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "trend",
    label: "Trend line",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M1 11L11 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="1.5" cy="11" r="1.3" fill="currentColor" />
        <circle cx="11" cy="1.5" r="1.3" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "horizontal",
    label: "Horizontal line",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M1 6.5H12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="6.5" cy="6.5" r="1.3" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "rect",
    label: "Rectangle",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <rect x="1.5" y="3" width="10" height="7" stroke="currentColor" strokeWidth="1.4" fill="none" />
      </svg>
    ),
  },
  {
    id: "fib",
    label: "Fibonacci retracement",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M1 2h11M1 5h11M1 8h11M1 11h11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "text",
    label: "Text",
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M2 2h9v2h-3.5v8h-2V4H2z" fill="currentColor" />
      </svg>
    ),
  },
];

export default function ChartPane({
  data,
  isLoading,
  error,
  onRetry,
  className,
}: ChartPaneProps) {
  const [chartType, setChartType] = React.useState<ChartType>("candle");
  const [activeTool, setActiveTool] = React.useState<DrawingTool>("cursor");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [indicators, setIndicators] = React.useState<Indicator[]>(["Volume"]);

  const menuRef = React.useRef<HTMLDivElement | null>(null);

  // Close indicator menu on outside click / escape. Declared before any
  // early return so the hooks order stays stable (rules-of-hooks).
  React.useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const toggleIndicator = (i: Indicator) => {
    setIndicators((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i],
    );
  };

  return (
    <div
      data-slot="chart-pane"
      className={cn("relative flex-1 min-h-0 flex", className)}
    >
      {/* Drawing-tools rail (left). 44px wide so each button hits the
          WCAG 2.5.5 40x40 minimum on desktop. Mobile (below md): the rail
          collapses into a popover; since this is a dashboard viewport
          target we render the full rail at md+. */}
      <div
        data-slot="chart-tools"
        role="toolbar"
        aria-label="Drawing tools"
        aria-orientation="vertical"
        className="hidden md:flex flex-col gap-px w-11 shrink-0 bg-bg-elev-1/40 border-r border-border-hair py-1"
      >
        {DRAWING_TOOLS.map((t) => {
          const active = activeTool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTool(t.id)}
              title={t.label}
              aria-label={t.label}
              aria-pressed={active}
              className={cn(
                "w-11 h-10 inline-flex items-center justify-center rounded-xs transition-colors",
                active
                  ? "text-gold-300 bg-bg-elev-2"
                  : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
              )}
            >
              {t.icon}
            </button>
          );
        })}
      </div>

      {/* Chart canvas area */}
      <div className="relative flex-1 min-w-0 flex flex-col">
        {/* Top chrome: chart-type toggle (left) + indicator button (right).
            36px tall to match h-9 hit targets. */}
        <div className="flex items-center justify-between gap-2 h-9 px-3 border-b border-border-hair bg-bg-elev-1/30">
          <div role="radiogroup" aria-label="Chart type" className="flex gap-0.5">
            {TYPES.map((t) => {
              const active = chartType === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChartType(t.id)}
                  title={t.label}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors",
                    "font-sans text-xs font-medium uppercase tracking-[0.08em]",
                    active
                      ? "text-ink-1000 bg-bg-elev-2"
                      : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
                  )}
                >
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors",
                "font-sans text-xs font-medium uppercase tracking-[0.08em]",
                indicators.length > 0
                  ? "text-gold-300 hover:bg-bg-elev-1"
                  : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
              )}
            >
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 9l3-4 2.5 2L11 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Indicators</span>
              {indicators.length > 0 ? (
                <span className="font-mono tabular-nums text-fg-muted">
                  {indicators.length}
                </span>
              ) : null}
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className={cn(
                  "absolute right-0 top-full mt-1 z-20",
                  "min-w-[180px] bg-bg-elev-2 border border-border rounded-sm shadow-lg",
                  "py-1",
                )}
              >
                {ALL_INDICATORS.map((i) => {
                  const on = indicators.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => toggleIndicator(i)}
                      className={cn(
                        "w-full flex items-center gap-2 h-9 px-3 text-sm text-left transition-colors",
                        "hover:bg-bg-elev-1",
                        on ? "text-ink-1000" : "text-fg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center justify-center w-3.5 h-3.5 rounded-xs border",
                          on ? "bg-gold-500 border-gold-500 text-bg" : "border-border-hair",
                        )}
                      >
                        {on ? (
                          <svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" fill="none">
                            <path d="M1 4.5l2.5 2.5L8 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <span className="font-mono font-medium">{i}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative min-h-[260px]">
          {error ? (
            <div
              role="alert"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2.5"
            >
              <span className="font-display italic text-[15px] text-fg-muted">
                Failed to load chart data.
              </span>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className={cn(
                    "font-sans font-semibold uppercase text-xs tracking-[0.12em]",
                    "text-brand hover:text-gold-300 border border-border bg-bg-elev-1",
                    "rounded-xs px-3 h-9 transition-colors",
                  )}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : isLoading ? (
            <div
              aria-hidden="true"
              className="absolute inset-3 rounded-md bg-bg-elev-1 animate-pulse"
            />
          ) : data.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center px-6">
              <span className="font-display italic text-[16px] text-fg-muted">
                Not enough price data.
              </span>
              <span className="font-sans text-[13px] text-fg-hint">
                Try a wider range or check back once bars arrive.
              </span>
            </div>
          ) : (
            <TradingChart
              data={data}
              chartType={chartType}
              indicators={indicators}
            />
          )}
        </div>
      </div>
    </div>
  );
}
