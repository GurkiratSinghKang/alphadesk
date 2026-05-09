"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { ChartRange } from "@/components/composites/types";

/**
 * ChartToolbar — v2 trade-page chart strip per design `trade.jsx` lines 200–275.
 *
 * Sits above the chart canvas. Three controls:
 *   1. Range pills        — 1D / 5D / 1M / 3M / 6M / YTD / 1Y / ALL
 *   2. Mode pills         — Bars / Line
 *   3. Studies dropdown   — 5 overlay groups (MAs, VWAP, Bands, Oscillators, Layers)
 *
 * The studies dropdown is intentionally UI-only. The flags it toggles can
 * later route into PriceChartPanel's `smaSeries`, `regimeBands` and
 * `tradeOverlays` props — for the ones the chart engine doesn't yet support
 * the toggle persists state but produces no visual change. This matches the
 * design's editorial "no surprise overlays — opt in to what you need" voice.
 */

/** Re-exported alias so the trade page only has to import from `_v2/ChartToolbar`. */
export type ChartRangeId = ChartRange;
export type ChartModeId = "candle" | "line";

export interface OverlayItem {
  key: string;
  label: string;
  /** Color of the swatch shown left of the label when toggled on. */
  dot: string;
}

export interface OverlayGroup {
  group: string;
  items: OverlayItem[];
}

/** Five locked groups, mined verbatim from design `trade.jsx#OVERLAY_GROUPS`. */
export const OVERLAY_GROUPS: OverlayGroup[] = [
  {
    group: "Moving averages",
    items: [
      { key: "sma20", label: "SMA · 20", dot: "var(--ice-500)" },
      { key: "sma50", label: "SMA · 50", dot: "var(--gold-700)" },
      { key: "sma200", label: "SMA · 200", dot: "var(--ink-400)" },
      { key: "ema9", label: "EMA · 9", dot: "var(--brand)" },
      { key: "ema21", label: "EMA · 21", dot: "var(--gold-500)" },
    ],
  },
  {
    group: "Volume / VWAP",
    items: [
      { key: "vwap", label: "VWAP", dot: "var(--gold-300)" },
      { key: "anchoredVwap", label: "Anchored VWAP", dot: "var(--gold-700)" },
      { key: "volProfile", label: "Volume profile", dot: "var(--ink-400)" },
      { key: "avgPrice", label: "Avg cost", dot: "var(--brand)" },
    ],
  },
  {
    group: "Bands",
    items: [
      { key: "bollinger", label: "Bollinger · 20·2", dot: "var(--ice-500)" },
      { key: "keltner", label: "Keltner · 20·1.5", dot: "var(--gold-700)" },
      { key: "donchian", label: "Donchian · 20", dot: "var(--ink-400)" },
    ],
  },
  {
    group: "Oscillators · separate pane",
    items: [
      { key: "rsi", label: "RSI · 14", dot: "var(--brand)" },
      { key: "macd", label: "MACD · 12·26·9", dot: "var(--ice-500)" },
    ],
  },
  {
    group: "Layers",
    items: [
      { key: "levels", label: "Support · resistance", dot: "var(--down-500)" },
      { key: "signals", label: "Strategy signals", dot: "var(--brand)" },
      { key: "regime", label: "Regime bands", dot: "var(--ink-400)" },
      { key: "earnings", label: "Earnings markers", dot: "var(--gold-500)" },
      { key: "exDiv", label: "Ex-dividend dates", dot: "var(--ice-500)" },
    ],
  },
];

const ALL_OVERLAY_KEYS = OVERLAY_GROUPS.flatMap((g) => g.items.map((it) => it.key));

/** Build a fresh `{ key: false }` map covering every overlay key. */
export function makeEmptyOverlays(): Record<string, boolean> {
  return Object.fromEntries(ALL_OVERLAY_KEYS.map((k) => [k, false]));
}

const RANGES: ChartRangeId[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "ALL"];
const MODES: Array<{ id: ChartModeId; label: string }> = [
  { id: "candle", label: "Bars" },
  { id: "line", label: "Line" },
];

export interface ChartToolbarProps {
  range: ChartRangeId;
  onRangeChange: (r: ChartRangeId) => void;
  chartMode: ChartModeId;
  onChartModeChange: (m: ChartModeId) => void;
  overlays: Record<string, boolean>;
  onOverlaysChange: (next: Record<string, boolean>) => void;
  className?: string;
}

export default function ChartToolbar({
  range,
  onRangeChange,
  chartMode,
  onChartModeChange,
  overlays,
  onOverlaysChange,
  className,
}: ChartToolbarProps) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const onCount = React.useMemo(
    () => Object.values(overlays).filter(Boolean).length,
    [overlays],
  );

  // Click-outside closes the studies popover.
  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggleOverlay(key: string) {
    onOverlaysChange({ ...overlays, [key]: !overlays[key] });
  }
  function clearAll() {
    onOverlaysChange(makeEmptyOverlays());
  }

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 md:px-4",
        className,
      )}
    >
      {/* Left cluster — range pills + mode pills. */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedRow ariaLabel="Chart range">
          {RANGES.map((r) => (
            <SegmentButton
              key={r}
              active={range === r}
              variant="mono"
              onClick={() => onRangeChange(r)}
              minWidth={28}
            >
              {r}
            </SegmentButton>
          ))}
        </SegmentedRow>

        <SegmentedRow ariaLabel="Chart mode">
          {MODES.map((m) => (
            <SegmentButton
              key={m.id}
              active={chartMode === m.id}
              variant="label"
              onClick={() => onChartModeChange(m.id)}
            >
              {m.label}
            </SegmentButton>
          ))}
        </SegmentedRow>
      </div>

      {/* Right — studies dropdown trigger. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "inline-flex items-center gap-2 rounded-sm border border-border px-3 py-1.5",
          "font-ui text-[10px] font-semibold uppercase tracking-[0.16em]",
          "transition-colors",
          open
            ? "bg-bg-elev-2 text-ink-1000"
            : "bg-transparent text-fg-muted hover:bg-bg-elev-1 hover:text-fg",
        )}
      >
        <span
          aria-hidden
          className="size-1.5 rounded-full"
          style={{ background: "var(--brand)" }}
        />
        Studies
        <span className="font-mono text-[9.5px] text-fg-hint">{onCount}</span>
        <span aria-hidden className="ml-0.5 text-[8px] text-fg-hint">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-3 top-[calc(100%+6px)] z-30 w-[280px] overflow-auto rounded-md border border-border bg-bg-elev-2 shadow-2",
            "max-h-[360px]",
          )}
        >
          {OVERLAY_GROUPS.map((g) => (
            <div key={g.group} className="border-b border-border-hair last:border-b-0">
              <div className="t-label px-3 pb-1 pt-2.5 text-[8.5px] text-fg-hint">{g.group}</div>
              {g.items.map((it) => {
                const on = !!overlays[it.key];
                return (
                  <button
                    key={it.key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => toggleOverlay(it.key)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
                      on ? "bg-bg-elev-1" : "bg-transparent hover:bg-bg-elev-1/60",
                    )}
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-3 items-center justify-center rounded-[2px] text-[9px] leading-none"
                      style={{
                        border: `1px solid ${on ? it.dot : "var(--border)"}`,
                        background: on ? it.dot : "transparent",
                        color: "var(--bg)",
                      }}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span
                      className={cn(
                        "font-ui text-[11px]",
                        on ? "text-ink-1000" : "text-fg",
                      )}
                    >
                      {it.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-2 font-mono text-[10px]">
            <button
              type="button"
              onClick={clearAll}
              className="text-fg-muted transition-colors hover:text-fg"
            >
              clear all
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-brand transition-colors hover:opacity-80"
            >
              done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── primitives ────────────────────────────────────────────────────────

function SegmentedRow({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex gap-px rounded-sm border border-border-hair bg-bg-elev-1 p-0.5"
    >
      {children}
    </div>
  );
}

function SegmentButton({
  active,
  variant,
  onClick,
  minWidth,
  children,
}: {
  active: boolean;
  variant: "mono" | "label";
  onClick: () => void;
  minWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={minWidth ? { minWidth } : undefined}
      className={cn(
        "rounded-[2px] px-2.5 py-1 text-center transition-colors",
        variant === "mono"
          ? "font-mono text-[10.5px] tracking-[0.04em]"
          : "font-ui text-[10px] font-semibold uppercase tracking-[0.16em]",
        active
          ? "bg-bg text-ink-1000"
          : "bg-transparent text-fg-muted hover:bg-bg/40 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
