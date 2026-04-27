"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { TradingChart } from "@/components/charts/TradingChart";
import type { ChartType, Indicator, OHLCVBar } from "@/types";
import type { Drawing, DrawingKind } from "@/components/charts/drawingPlugin";
import { useChartDrawings } from "@/hooks/useChartDrawings";
import { useMarketStore } from "@/stores/market";

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

/**
 * Map non-cursor tools to the concrete `DrawingKind` the plugin renders.
 * `text` is excluded — we surface it disabled in the rail until v2 so
 * the user can't enter a dead-end draw mode. `cursor` also has no entry
 * because it's the default pan/zoom state, not a draw target.
 */
const TOOL_TO_KIND: Partial<Record<DrawingTool, DrawingKind>> = {
  trend: "trend",
  horizontal: "horizontal",
  rect: "rect",
  fib: "fib",
};

const DRAWING_TOOLS: { id: DrawingTool; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
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
    label: "Text (coming soon)",
    disabled: true,
    icon: (
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M2 2h9v2h-3.5v8h-2V4H2z" fill="currentColor" />
      </svg>
    ),
  },
];

/**
 * Resolve a design-token color for the drawing currently being placed.
 * Runs lazily (each add) so the plugin renders with whatever tokens are
 * live at the moment of creation; persisted drawings keep their resolved
 * color verbatim so re-renders don't silently shift palette.
 */
function readDrawingColor(): string {
  if (typeof window === "undefined") return "#c9a66b";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--gold-300");
  return (v && v.trim()) || "#e0c070";
}

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

  // Slice-8 / CH-3D (2026 chart audit, TradingView signature): Bar Replay.
  //   ``replayEnabled`` — toggles the entire replay UX
  //   ``replayCursor`` — bar index up to which the chart is shown
  //   ``replaySpeed``  — playback speed multiplier (1×, 2×, 5×, 10×)
  //   ``replayPlaying``— whether the auto-advance interval is running
  // When ``replayEnabled`` is on we slice ``data`` before passing it to
  // TradingChart, so the chart shows ONLY bars up to ``replayCursor``.
  // Auto-advance uses setInterval at ``1000 / replaySpeed`` ms cadence.
  const [replayEnabled, setReplayEnabled] = React.useState(false);
  const [replayCursor, setReplayCursor] = React.useState(0);
  const [replaySpeed, setReplaySpeed] = React.useState<1 | 2 | 5 | 10>(2);
  const [replayPlaying, setReplayPlaying] = React.useState(false);

  // Initialize cursor to a sensible position when replay is first enabled.
  // Default to ~60% of history so the user immediately sees motion.
  React.useEffect(() => {
    if (replayEnabled && replayCursor === 0 && data.length > 10) {
      setReplayCursor(Math.floor(data.length * 0.6));
    }
    if (!replayEnabled) {
      setReplayPlaying(false);
    }
  }, [replayEnabled, data.length, replayCursor]);

  // Auto-advance loop. Stops when we reach the end of the data.
  React.useEffect(() => {
    if (!replayEnabled || !replayPlaying) return;
    const intervalMs = Math.max(50, 1000 / replaySpeed);
    const id = setInterval(() => {
      setReplayCursor((c) => {
        const next = c + 1;
        if (next >= data.length) {
          setReplayPlaying(false);
          return data.length;
        }
        return next;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [replayEnabled, replayPlaying, replaySpeed, data.length]);

  // Slice the data passed to the chart when replay is on. When off,
  // this is the identity — full data. ``React.useMemo`` keeps the
  // reference stable so TradingChart's didFitRef logic isn't broken.
  const visibleData = React.useMemo(
    () =>
      replayEnabled
        ? data.slice(0, Math.min(Math.max(replayCursor, 1), data.length))
        : data,
    [data, replayEnabled, replayCursor],
  );

  // Drawing state machine: `firstPoint` is set on the first click of a
  // two-click drawing (trend/rect/fib). The second click commits via
  // `add(...)` and clears. `hoverPoint` trails the crosshair so we can
  // render the in-progress preview without re-querying the chart API.
  const [firstPoint, setFirstPoint] = React.useState<{ time: number; price: number } | null>(null);
  const [hoverPoint, setHoverPoint] = React.useState<{ time: number; price: number } | null>(null);

  // Round-12 / CH-2: live OHLC from the chart's crosshair. Used by the
  // top-left overlay to give a TradingView-style readout when the user
  // hovers a bar.
  const [ohlcHover, setOhlcHover] = React.useState<
    | { open: number; high: number; low: number; close: number; volume?: number }
    | null
  >(null);

  // Slice-4 / CH-3B (TradingView pattern): the floating "+" alert
  // affordance follows the crosshair along the right edge of the
  // chart canvas — one click adds a price alert at the exact axis
  // price the user is pointing at.
  const [alertHover, setAlertHover] = React.useState<
    { price: number; y: number } | null
  >(null);

  // Slice-5 / CH-3A (NinjaTrader pattern): track Shift modifier so
  // the affordance switches mode — Shift held = "place limit" target
  // (B above mid, S below); no modifier = "add alert". One axis,
  // two affordances, distinguished by keyboard.
  const [shiftHeld, setShiftHeld] = React.useState(false);
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      setShiftHeld(e.shiftKey);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // Last-bar close used to decide buy-limit-below-mid vs sell-limit-above-mid.
  // Falls back to the most recent OHLC hover if the data prop is empty.
  const lastClose = data && data.length > 0
    ? data[data.length - 1].close
    : ohlcHover?.close ?? null;

  const symbol = useMarketStore((s) => s.selectedSymbol);
  const { drawings, add } = useChartDrawings(symbol);

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

  // Global Esc handler for the draw state machine: cancels in-progress
  // draw and falls back to the cursor tool. Scoped at window level so it
  // fires even when focus is on the chart canvas (which isn't focusable
  // by default in lightweight-charts v5).
  React.useEffect(() => {
    if (activeTool === "cursor" && firstPoint == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setFirstPoint(null);
      setActiveTool("cursor");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, firstPoint]);

  // Clicking a new tool mid-draw should abandon the in-progress draw so
  // the user doesn't end up with a half-committed shape bridging tools.
  const selectTool = React.useCallback((t: DrawingTool) => {
    setActiveTool(t);
    setFirstPoint(null);
  }, []);

  // Handle a click on the chart canvas. `horizontal` finalizes on the
  // FIRST click (single-point tool); other tools need two points. Text
  // is disabled at the button level, so this branch is defensive.
  const handleChartClick = React.useCallback(
    (pt: { time: number; price: number }) => {
      if (activeTool === "cursor") return;
      if (activeTool === "text") {
        console.warn("text drawing coming in v2");
        return;
      }
      const kind = TOOL_TO_KIND[activeTool];
      if (!kind) return;
      const color = readDrawingColor();
      if (kind === "horizontal") {
        add({ kind, points: [pt], color });
        // Drop back to cursor so the user doesn't accidentally line-flood
        // the chart — matches TradingView's single-shot-tool behaviour.
        setFirstPoint(null);
        setActiveTool("cursor");
        return;
      }
      if (firstPoint == null) {
        setFirstPoint(pt);
        return;
      }
      add({ kind, points: [firstPoint, pt], color });
      setFirstPoint(null);
      setActiveTool("cursor");
    },
    [activeTool, firstPoint, add],
  );

  // Compose the drawings array with a transient preview entry whenever
  // the user has placed firstPoint and the crosshair is over the canvas.
  // The preview is a real Drawing object so the plugin renders it with
  // the same code path as persisted shapes — no preview-only renderer.
  const drawingsWithPreview = React.useMemo<Drawing[]>(() => {
    const kind = TOOL_TO_KIND[activeTool];
    if (!kind || activeTool === "cursor") return drawings;
    if (kind === "horizontal" && hoverPoint) {
      return [
        ...drawings,
        {
          id: "__preview",
          kind,
          points: [hoverPoint],
          color: "rgba(224, 192, 112, 0.6)",
          createdAt: 0,
        },
      ];
    }
    if (firstPoint && hoverPoint) {
      return [
        ...drawings,
        {
          id: "__preview",
          kind,
          points: [firstPoint, hoverPoint],
          color: "rgba(224, 192, 112, 0.6)",
          createdAt: 0,
        },
      ];
    }
    return drawings;
  }, [drawings, activeTool, firstPoint, hoverPoint]);

  const drawMode = activeTool !== "cursor";

  const toggleIndicator = (i: Indicator) => {
    setIndicators((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i],
    );
  };

  return (
    <div
      data-slot="chart-pane"
      className={cn("relative flex-1 min-h-0 flex flex-col", className)}
    >
      {/* Top chrome: chart-type toggle (left) + indicator button (right).
          40px tall (h-10, WCAG 2.5.5 hit target). Rendered OUTSIDE the
          inner rail+canvas flex-row so it spans full width — previously
          the drawing rail sat alongside this bar and the first tool
          button's top edge clipped into the chrome's border, making it
          appear half-hidden. With the chrome above and the rail below,
          every drawing button is fully visible and unambiguously
          clickable. */}
      <div className="flex items-center justify-between gap-2 h-10 px-3 border-b border-border-hair bg-bg-elev-1/30 shrink-0">
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

          {/* Slice-8 / CH-3D: Bar Replay toggle. Off → button is muted;
              on → button is brand-tinted and the canvas shows the
              ⏮⏯⏭ control strip. TradingView signature. */}
          <button
            type="button"
            onClick={() => setReplayEnabled((v) => !v)}
            aria-pressed={replayEnabled}
            title={
              replayEnabled
                ? "Exit Bar Replay"
                : "Enter Bar Replay — scrub through historical bars"
            }
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-xs transition-colors mr-1",
              "font-sans text-xs font-medium uppercase tracking-[0.08em]",
              replayEnabled
                ? "text-[color:var(--brand)] bg-[color:var(--brand)]/15 hover:bg-[color:var(--brand)]/25"
                : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
            )}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <polygon points="3,2 3,10 10,6" fill="currentColor" />
            </svg>
            <span>Replay</span>
          </button>

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

      {/* Below-chrome row: drawing-tools rail (left, md+) + canvas area. */}
      <div className="flex-1 min-h-0 flex">
        {/* Drawing-tools rail (left). 44px wide — each button hits the
            WCAG 2.5.5 40×40 minimum on desktop. Mobile (<md) hides the
            rail; a follow-up will surface it as a popover. */}
        <div
          data-slot="chart-tools"
          role="toolbar"
          aria-label="Drawing tools"
          aria-orientation="vertical"
          className="hidden md:flex flex-col gap-px w-11 shrink-0 bg-bg-elev-1/40 border-r border-border-hair py-1"
        >
          {DRAWING_TOOLS.map((t) => {
            const active = activeTool === t.id;
            const disabled = Boolean(t.disabled);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { if (!disabled) selectTool(t.id); }}
                title={t.label}
                aria-label={t.label}
                aria-pressed={active}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                className={cn(
                  "w-11 h-10 inline-flex items-center justify-center rounded-xs transition-colors",
                  disabled
                    ? "text-fg-hint/50 cursor-not-allowed"
                    : active
                      ? "text-gold-300 bg-bg-elev-2"
                      : "text-fg-muted hover:text-fg hover:bg-bg-elev-1",
                )}
              >
                {t.icon}
              </button>
            );
          })}
        </div>

        {/* Canvas */}
        <div className="flex-1 relative min-h-[260px] min-w-0">
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
            // Wrapper carries the draw-mode cursor so the chart canvas
            // (which is inside TradingChart) visually telegraphs that a
            // click will drop a point instead of panning.
            <div className={cn("absolute inset-0", drawMode && "cursor-crosshair")}>
              <TradingChart
                data={visibleData}
                chartType={chartType}
                indicators={indicators}
                drawMode={drawMode}
                drawings={drawingsWithPreview}
                onChartClick={handleChartClick}
                onDrawCrosshair={setHoverPoint}
                // Round-12 / CH-2 (P1): wire OHLC hover to the overlay below.
                onCrosshairMove={(_p, _t, ohlcv) => setOhlcHover(ohlcv ?? null)}
                // Slice-4 / CH-3B: wire alert-hover to the floating "+" overlay.
                onAlertHover={(price, y) =>
                  setAlertHover(price != null && y != null ? { price, y } : null)
                }
              />
              {/* Round-12 / CH-2: TradingView-style OHLC + indicator legend
                  overlay. Renders top-left so it never overlaps with the
                  toolbars on the top-right. Always visible (shows last bar
                  when crosshair isn't active) so the user can see the
                  current bar's values at a glance.

                  Round-12 / CH-4: pill is intentionally translucent
                  (40% bg + medium backdrop-blur) so the price bars
                  underneath stay legible. Border alpha matches so a
                  dark-mode chart isn't bordered with an opaque hairline. */}
              <div
                data-slot="chart-ohlc-overlay"
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-3 z-10 rounded border border-[color:var(--border)]/40 bg-[color:var(--bg-card)]/40 px-2.5 py-1.5 t-mono text-[11px] backdrop-blur-md"
              >
                <OHLCReadout
                  hover={ohlcHover}
                  lastBar={visibleData[visibleData.length - 1] ?? null}
                  indicators={indicators}
                />
              </div>
              {/* Slice-8 / CH-3D: Bar Replay control strip — appears at
                  the bottom-right of the canvas when replay mode is on.
                  Mirrors TradingView's playback controls: ⏮ rewind 10
                  bars, ⏯ play/pause, ⏭ step forward 1 bar, then a
                  speed picker (1× 2× 5× 10×) and an exit X. The cursor
                  position is reflected in the bar count "324 / 500".
                  TradingView gates this behind their paid tier; we
                  ship it free per the design brief. */}
              {replayEnabled && (
                <div
                  data-slot="chart-replay-controls"
                  className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded border border-[color:var(--border)]/60 bg-[color:var(--bg-card)]/90 px-2 py-1 t-mono text-[11px] backdrop-blur-md shadow-sm"
                >
                  <button
                    type="button"
                    aria-label="Rewind 10 bars"
                    title="Rewind 10 bars"
                    onClick={() => setReplayCursor((c) => Math.max(1, c - 10))}
                    className="px-1.5 py-0.5 rounded hover:bg-[color:var(--bg-elev-1)] transition-colors"
                  >
                    ⏮
                  </button>
                  <button
                    type="button"
                    aria-label={replayPlaying ? "Pause replay" : "Play replay"}
                    title={replayPlaying ? "Pause" : "Play"}
                    onClick={() => setReplayPlaying((p) => !p)}
                    className="px-1.5 py-0.5 rounded hover:bg-[color:var(--brand)] hover:text-[color:var(--bg-base)] transition-colors text-[color:var(--brand)]"
                  >
                    {replayPlaying ? "⏸" : "▶"}
                  </button>
                  <button
                    type="button"
                    aria-label="Step forward one bar"
                    title="Forward one bar"
                    onClick={() =>
                      setReplayCursor((c) => Math.min(data.length, c + 1))
                    }
                    className="px-1.5 py-0.5 rounded hover:bg-[color:var(--bg-elev-1)] transition-colors"
                  >
                    ⏭
                  </button>
                  <select
                    aria-label="Replay speed"
                    title="Playback speed"
                    value={replaySpeed}
                    onChange={(e) =>
                      setReplaySpeed(Number(e.target.value) as 1 | 2 | 5 | 10)
                    }
                    className="bg-transparent border-none outline-none px-1 py-0.5 text-[color:var(--fg)] cursor-pointer"
                  >
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={5}>5×</option>
                    <option value={10}>10×</option>
                  </select>
                  <span className="px-1 u-muted tabular-nums" aria-live="polite">
                    {replayCursor} / {data.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Exit replay mode"
                    title="Exit replay"
                    onClick={() => {
                      setReplayEnabled(false);
                      setReplayPlaying(false);
                      setReplayCursor(0);
                    }}
                    className="px-1.5 py-0.5 rounded hover:bg-[color:var(--loss)] hover:text-[color:var(--bg-base)] transition-colors"
                  >
                    ×
                  </button>
                </div>
              )}
              {/* Slice-4 / CH-3B + Slice-5 / CH-3A: floating chart-axis
                  affordance. Two modes, switched by the Shift key:

                  · No modifier: "+" → adds a price alert at the axis
                    price (TradingView pattern).
                  · Shift held:  "B" or "S" → places a buy/sell limit
                    order at the axis price (NinjaTrader pattern). B
                    when the cursor is BELOW current close, S when
                    ABOVE.

                  Tooltip teaches the modifier. Color tracks side
                  (buy = profit, sell = loss) when in trade mode.
                  Same single button — one affordance, two roles. */}
              {alertHover && (() => {
                const tradeMode = shiftHeld && lastClose != null;
                const side: "buy" | "sell" =
                  tradeMode && alertHover.price < lastClose! ? "buy" : "sell";
                const label = tradeMode ? (side === "buy" ? "B" : "S") : "+";
                const ariaLabel = tradeMode
                  ? `Place ${side} limit at ${alertHover.price.toFixed(2)}`
                  : `Add price alert at ${alertHover.price.toFixed(2)}`;
                const titleCopy = tradeMode
                  ? `${side === "buy" ? "Buy" : "Sell"} limit @ $${alertHover.price.toFixed(2)} · click to stage`
                  : `Add alert @ $${alertHover.price.toFixed(2)} · Shift-click for limit order`;
                const tone = tradeMode
                  ? side === "buy"
                    ? "border-[color:var(--profit)]/60 text-[color:var(--profit)] hover:bg-[color:var(--profit)] hover:text-[color:var(--bg-base)]"
                    : "border-[color:var(--loss)]/60 text-[color:var(--loss)] hover:bg-[color:var(--loss)] hover:text-[color:var(--bg-base)]"
                  : "border-[color:var(--brand)]/60 text-[color:var(--brand)] hover:bg-[color:var(--brand)] hover:text-[color:var(--bg-base)]";
                return (
                  <button
                    type="button"
                    data-slot="chart-axis-affordance"
                    data-mode={tradeMode ? "trade" : "alert"}
                    aria-label={ariaLabel}
                    title={titleCopy}
                    onClick={(e) => {
                      if (typeof window === "undefined") return;
                      // Re-read modifier from the click event itself —
                      // the keydown listener can lag if the user holds
                      // Shift after the cursor lands on the button.
                      const isTrade = e.shiftKey && lastClose != null;
                      if (isTrade) {
                        const orderSide: "buy" | "sell" =
                          alertHover.price < lastClose! ? "buy" : "sell";
                        window.dispatchEvent(
                          new CustomEvent("alphadesk:place-limit-from-chart", {
                            detail: {
                              symbol,
                              price: alertHover.price,
                              side: orderSide,
                              source: "chart-axis-shift-click",
                            },
                          }),
                        );
                      } else {
                        window.dispatchEvent(
                          new CustomEvent("alphadesk:add-price-alert", {
                            detail: {
                              symbol,
                              price: alertHover.price,
                              source: "chart-axis-hover",
                            },
                          }),
                        );
                      }
                    }}
                    className={cn(
                      "absolute z-20 -translate-y-1/2 right-1 inline-flex items-center justify-center h-5 w-5 rounded-full bg-[color:var(--bg-card)] text-[12px] leading-none shadow-sm transition-colors",
                      tone,
                    )}
                    style={{ top: alertHover.y }}
                  >
                    {label}
                  </button>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── OHLC + indicator legend overlay ──────────────────────────────────────────

/**
 * Round-12 / CH-2 + CH-3: TradingView-style OHLC + indicator readout.
 * Renders top-left of the chart and shows:
 *
 *   - Open / High / Low / Close / Volume for the bar under the crosshair
 *     (or the latest bar if the crosshair isn't active).
 *   - Net change vs Open with a profit/loss tint so the user can read
 *     direction at a glance.
 *   - The active indicators with their PERIODS expanded — "SMA 20",
 *     "EMA 50" instead of bare "SMA"/"EMA". CH-3: ``TradingChart``
 *     hard-codes EMA(20)/EMA(50) and SMA(20)/SMA(50) when the user
 *     toggles those indicators on; this legend reflects those.
 */
function OHLCReadout({
  hover,
  lastBar,
  indicators,
}: {
  hover: { open: number; high: number; low: number; close: number; volume?: number } | null;
  lastBar: OHLCVBar | null;
  indicators: Indicator[];
}) {
  const bar = hover ?? (lastBar ? {
    open: lastBar.open,
    high: lastBar.high,
    low: lastBar.low,
    close: lastBar.close,
    volume: lastBar.volume,
  } : null);
  const changeAbs = bar ? bar.close - bar.open : 0;
  const changePct = bar && bar.open ? (changeAbs / bar.open) * 100 : 0;
  const changeTint =
    !bar ? "" : changeAbs >= 0 ? "text-[color:var(--profit)]" : "text-[color:var(--loss)]";
  // Compose the indicator legend with periods. TradingChart draws:
  //   EMA → EMA(20, amber) + EMA(50, blue)
  //   SMA → SMA(20, gold)  + SMA(50, fg-dim)
  //   VWAP, Bollinger, RSI, MACD: single instances; show plain.
  const indicatorLegend = indicators
    .filter((i) => i !== "Volume")
    .flatMap((i) => {
      if (i === "EMA") return ["EMA 20", "EMA 50"];
      if (i === "SMA") return ["SMA 20", "SMA 50"];
      if (i === "Bollinger") return ["Bollinger 20"];
      return [i];
    });
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      {bar ? (
        <>
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className="u-muted">O</span>
            <span>{bar.open.toFixed(2)}</span>
            <span className="u-muted">H</span>
            <span>{bar.high.toFixed(2)}</span>
            <span className="u-muted">L</span>
            <span>{bar.low.toFixed(2)}</span>
            <span className="u-muted">C</span>
            <span>{bar.close.toFixed(2)}</span>
            <span className={cn("ml-1", changeTint)}>
              {changeAbs >= 0 ? "+" : ""}
              {changeAbs.toFixed(2)} ({changePct >= 0 ? "+" : ""}
              {changePct.toFixed(2)}%)
            </span>
          </div>
          {bar.volume != null && (
            <div className="flex items-baseline gap-2 u-muted tabular-nums">
              <span>VOL</span>
              <span>{formatVolume(bar.volume)}</span>
            </div>
          )}
        </>
      ) : (
        <span className="u-muted">— no bar</span>
      )}
      {indicatorLegend.length > 0 && (
        <div className="flex items-baseline gap-2 u-muted text-[10px] mt-0.5">
          {indicatorLegend.map((label) => (
            <span key={label} className="rounded border border-[color:var(--border)] px-1 py-px">
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + "B";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return String(v);
}
