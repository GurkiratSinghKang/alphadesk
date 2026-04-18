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
  return (
    <div className="flex flex-col">
      <span
        className="font-sans font-semibold text-[9.5px] uppercase text-fg-hint mb-0.5"
        style={{ letterSpacing: "0.14em" }}
      >{k}</span>
      <Mono
        size="body"
        className={cn(
          "font-medium",
          tone === "profit" ? "text-up-500" : tone === "loss" ? "text-down-500" : "text-fg"
        )}
      >{value}</Mono>
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

export default function PriceChartPanel({
  symbol, quote, meta, series, smaSeries, regimeBands,
  activeRange, onRangeChange, className,
}: PriceChartPanelProps) {
  const deltaSign = quote.change >= 0 ? "+" : "−";
  const deltaTone = quote.change >= 0 ? "text-up-500" : "text-down-500";

  return (
    <section data-slot="price-chart-panel" className={cn("flex flex-col overflow-hidden", className)}>
      <header className="flex items-end gap-6 px-7 pt-5 pb-3.5 border-b border-border-hair">
        <div>
          <div
            className="font-display italic text-[40px] text-ink-1000"
            style={{ letterSpacing: "-0.025em", lineHeight: 1 }}
          >{symbol.name}</div>
          <div
            className="font-sans font-semibold text-[13px] text-fg-muted mt-1 uppercase"
            style={{ letterSpacing: "0.16em" }}
          >{symbol.ticker} · {symbol.venue}</div>
        </div>

        <div>
          <div
            className="font-mono tabular-nums text-[36px] font-light text-ink-1000"
            style={{ letterSpacing: "-0.02em", lineHeight: 1 }}
          >{quote.last.toFixed(2)}</div>
          <div className={cn("font-mono tabular-nums text-[13px] mt-1", deltaTone)}>
            {deltaSign}{Math.abs(quote.change).toFixed(2)} · {deltaSign}{Math.abs(quote.changePct).toFixed(2)}%
          </div>
        </div>

        <div className="flex gap-[18px] ml-auto font-mono text-[11px] text-fg-muted">
          <MetaCell k="Vol" value={meta.volume} />
          <MetaCell k="Avg Vol" value={meta.avgVolume} />
          <MetaCell k="Range" value={meta.range} />
          <MetaCell k="IV" value={meta.iv} />
          <MetaCell
            k="Regime fit"
            value={meta.regimeFit.toFixed(2)}
            tone={meta.regimeFit >= 0.5 ? "profit" : "loss"}
          />
        </div>
      </header>

      <div className="flex justify-between items-center px-7 py-2.5 border-b border-border-hair">
        <div className="flex gap-0.5">
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
        <div className="flex gap-[14px] font-mono text-[10.5px] text-fg-muted">
          <LegendChip swatchColor="var(--gold-300)" label="Price" />
          <LegendChip swatchColor="var(--up-500)" dashed label="20-SMA" />
          <LegendChip swatchColor="rgba(141,179,196,0.25)" block label="Regime bands" />
        </div>
      </div>

      <div className="flex-1 relative px-7 py-4 min-h-[220px]">
        <ChartCanvas series={series} smaSeries={smaSeries} regimeBands={regimeBands} />
      </div>
    </section>
  );
}
