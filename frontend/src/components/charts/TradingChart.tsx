"use client";

import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type CandlestickData,
  type SingleValueData,
  type HistogramData,
  type Time,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import type { OHLCVBar, ChartType, Indicator } from "@/types";

// ─── Types ───────────────────────────────────────────────────

export interface TradingChartHandle {
  chart: IChartApi | null;
  updateBar: (bar: OHLCVBar) => void;
  setData: (bars: OHLCVBar[]) => void;
  fitContent: () => void;
}

interface TradingChartProps {
  data?: OHLCVBar[];
  chartType?: ChartType;
  indicators?: Indicator[];
  onCrosshairMove?: (price: number | null, time: Time | null) => void;
  onTimeRangeChange?: (from: Time | null, to: Time | null) => void;
  positionLines?: {
    entry: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
  } | null;
}

// ─── Helpers ─────────────────────────────────────────────────

/** Ensure time is a valid Unix timestamp in seconds for LWC v5. */
function normalizeTime(t: number): number {
  if (!t || !isFinite(t)) return Math.floor(Date.now() / 1000);
  // If time looks like milliseconds (> year 2100 in seconds), convert
  if (t > 4_102_444_800) return Math.floor(t / 1000);
  return Math.floor(t);
}

function toChartCandle(bar: OHLCVBar): CandlestickData<Time> {
  return {
    time: normalizeTime(bar.time) as unknown as Time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
}

function toLineData(bar: OHLCVBar): SingleValueData<Time> {
  return { time: normalizeTime(bar.time) as unknown as Time, value: bar.close };
}

function toChartVolume(bar: OHLCVBar): HistogramData<Time> {
  return {
    time: normalizeTime(bar.time) as unknown as Time,
    value: bar.volume,
    color:
      bar.close >= bar.open
        ? "rgba(34, 197, 94, 0.25)"
        : "rgba(239, 68, 68, 0.25)",
  };
}

// ─── Indicator calculations ─────────────────────────────────

function computeSMA(bars: OHLCVBar[], period: number): SingleValueData<Time>[] {
  const result: SingleValueData<Time>[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += bars[i - j].close;
    result.push({ time: normalizeTime(bars[i].time) as unknown as Time, value: sum / period });
  }
  return result;
}

function computeEMA(bars: OHLCVBar[], period: number): SingleValueData<Time>[] {
  const result: SingleValueData<Time>[] = [];
  if (bars.length < period) return result;

  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += bars[i].close;
  ema /= period;
  result.push({ time: normalizeTime(bars[period - 1].time) as unknown as Time, value: ema });

  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    result.push({ time: normalizeTime(bars[i].time) as unknown as Time, value: ema });
  }
  return result;
}

function computeBollinger(
  bars: OHLCVBar[],
  period = 20,
  mult = 2
): {
  upper: SingleValueData<Time>[];
  middle: SingleValueData<Time>[];
  lower: SingleValueData<Time>[];
} {
  const upper: SingleValueData<Time>[] = [];
  const middle: SingleValueData<Time>[] = [];
  const lower: SingleValueData<Time>[] = [];

  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += bars[i - j].close;
    const sma = sum / period;
    let variance = 0;
    for (let j = 0; j < period; j++) variance += (bars[i - j].close - sma) ** 2;
    const std = Math.sqrt(variance / period);
    const time = normalizeTime(bars[i].time) as unknown as Time;
    middle.push({ time, value: sma });
    upper.push({ time, value: sma + mult * std });
    lower.push({ time, value: sma - mult * std });
  }
  return { upper, middle, lower };
}

// ─── Component ───────────────────────────────────────────────

export const TradingChart = forwardRef<TradingChartHandle, TradingChartProps>(
  function TradingChart(
    { data, chartType = "candle", indicators = [], onCrosshairMove, onTimeRangeChange, positionLines },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const mainSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
    const overlaySeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      chart: chartRef.current,
      updateBar: (bar: OHLCVBar) => {
        if (chartType === "candle") {
          mainSeriesRef.current?.update(toChartCandle(bar));
        } else {
          mainSeriesRef.current?.update(toLineData(bar));
        }
        volumeSeriesRef.current?.update(toChartVolume(bar));
      },
      setData: (bars: OHLCVBar[]) => {
        if (chartType === "candle") {
          mainSeriesRef.current?.setData(bars.map(toChartCandle));
        } else {
          mainSeriesRef.current?.setData(bars.map(toLineData));
        }
        volumeSeriesRef.current?.setData(bars.map(toChartVolume));
        chartRef.current?.timeScale().fitContent();
      },
      fitContent: () => chartRef.current?.timeScale().fitContent(),
    }));

    // Create chart — recreate when chartType changes
    useEffect(() => {
      if (!containerRef.current) return;

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "#0a0a0f" },
          textColor: "#71717a",
          fontSize: 11,
          fontFamily: "Inter, sans-serif",
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: "rgba(42, 42, 62, 0.4)" },
          horzLines: { color: "rgba(42, 42, 62, 0.4)" },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: "rgba(59, 130, 246, 0.4)",
            labelBackgroundColor: "#3b82f6",
          },
          horzLine: {
            color: "rgba(59, 130, 246, 0.4)",
            labelBackgroundColor: "#3b82f6",
          },
        },
        rightPriceScale: {
          borderColor: "#2a2a3e",
          scaleMargins: { top: 0.05, bottom: 0.2 },
        },
        timeScale: {
          borderColor: "#2a2a3e",
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true },
      });

      chartRef.current = chart;

      // BUG #11: Create main series based on chartType
      let mainSeries: ISeriesApi<SeriesType>;
      if (chartType === "candle") {
        mainSeries = chart.addSeries(CandlestickSeries, {
          upColor: "#22c55e",
          downColor: "#ef4444",
          borderUpColor: "#22c55e",
          borderDownColor: "#ef4444",
          wickUpColor: "#22c55e",
          wickDownColor: "#ef4444",
        });
      } else if (chartType === "line") {
        mainSeries = chart.addSeries(LineSeries, {
          color: "#3b82f6",
          lineWidth: 2,
        });
      } else {
        // area
        mainSeries = chart.addSeries(AreaSeries, {
          topColor: "rgba(59, 130, 246, 0.4)",
          bottomColor: "rgba(59, 130, 246, 0.02)",
          lineColor: "#3b82f6",
          lineWidth: 2,
        });
      }
      mainSeriesRef.current = mainSeries;

      // Volume series (always shown when Volume indicator active)
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      volumeSeriesRef.current = volumeSeries;

      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });

      // Crosshair callback
      if (onCrosshairMove) {
        chart.subscribeCrosshairMove((param) => {
          if (!param.time) {
            onCrosshairMove(null, null);
            return;
          }
          const seriesData = param.seriesData.get(mainSeries);
          if (seriesData) {
            if ("close" in seriesData) {
              onCrosshairMove(
                (seriesData as CandlestickData<Time>).close,
                param.time
              );
            } else if ("value" in seriesData) {
              onCrosshairMove(
                (seriesData as SingleValueData<Time>).value,
                param.time
              );
            }
          }
        });
      }

      // Time range callback
      if (onTimeRangeChange) {
        chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
          if (range) {
            onTimeRangeChange(range.from, range.to);
          }
        });
      }

      // ResizeObserver
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          chart.applyOptions({ width, height });
        }
      });
      observer.observe(containerRef.current);

      return () => {
        observer.disconnect();
        chart.remove();
        chartRef.current = null;
        mainSeriesRef.current = null;
        volumeSeriesRef.current = null;
        overlaySeriesRef.current = [];
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chartType]);

    // Set data when it changes
    const setChartData = useCallback(
      (bars: OHLCVBar[]) => {
        if (!bars.length || !chartRef.current) return;

        // Set main series data
        if (chartType === "candle") {
          mainSeriesRef.current?.setData(bars.map(toChartCandle));
        } else {
          mainSeriesRef.current?.setData(bars.map(toLineData));
        }
        volumeSeriesRef.current?.setData(bars.map(toChartVolume));

        // BUG #12: Remove old overlay series
        for (const s of overlaySeriesRef.current) {
          try {
            chartRef.current?.removeSeries(s);
          } catch {
            // series may already be removed
          }
        }
        overlaySeriesRef.current = [];

        const chart = chartRef.current;
        if (!chart) return;

        // BUG #12: Add indicator overlays
        if (indicators.includes("EMA")) {
          const ema20 = computeEMA(bars, 20);
          const ema50 = computeEMA(bars, 50);
          if (ema20.length) {
            const s = chart.addSeries(LineSeries, {
              color: "#f59e0b",
              lineWidth: 1,
              priceScaleId: "right",
            });
            s.setData(ema20);
            overlaySeriesRef.current.push(s);
          }
          if (ema50.length) {
            const s = chart.addSeries(LineSeries, {
              color: "#8b5cf6",
              lineWidth: 1,
              priceScaleId: "right",
            });
            s.setData(ema50);
            overlaySeriesRef.current.push(s);
          }
        }

        if (indicators.includes("SMA")) {
          const sma20 = computeSMA(bars, 20);
          const sma50 = computeSMA(bars, 50);
          if (sma20.length) {
            const s = chart.addSeries(LineSeries, {
              color: "#06b6d4",
              lineWidth: 1,
              priceScaleId: "right",
            });
            s.setData(sma20);
            overlaySeriesRef.current.push(s);
          }
          if (sma50.length) {
            const s = chart.addSeries(LineSeries, {
              color: "#ec4899",
              lineWidth: 1,
              priceScaleId: "right",
            });
            s.setData(sma50);
            overlaySeriesRef.current.push(s);
          }
        }

        if (indicators.includes("Bollinger")) {
          const bb = computeBollinger(bars);
          const bbColors = {
            upper: "#ef4444",
            middle: "#64748b",
            lower: "#22c55e",
          } as const;
          for (const key of ["upper", "middle", "lower"] as const) {
            if (bb[key].length) {
              const s = chart.addSeries(LineSeries, {
                color: bbColors[key],
                lineWidth: 1,
                lineStyle: key === "middle" ? 2 : 0,
                priceScaleId: "right",
              });
              s.setData(bb[key]);
              overlaySeriesRef.current.push(s);
            }
          }
        }

        chart.timeScale().fitContent();
      },
      [chartType, indicators]
    );

    useEffect(() => {
      if (data?.length) setChartData(data);
    }, [data, setChartData]);

    // Position indicator lines (entry, stop loss, take profit)
    useEffect(() => {
      const series = mainSeriesRef.current;
      if (!series) return;

      const lines: ReturnType<typeof series.createPriceLine>[] = [];

      if (positionLines?.entry != null) {
        lines.push(series.createPriceLine({
          price: positionLines.entry,
          color: "#3b82f6",
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `Entry $${positionLines.entry.toFixed(2)}`,
        }));
      }
      if (positionLines?.stopLoss != null) {
        lines.push(series.createPriceLine({
          price: positionLines.stopLoss,
          color: "#ef4444",
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `SL $${positionLines.stopLoss.toFixed(2)}`,
        }));
      }
      if (positionLines?.takeProfit != null) {
        lines.push(series.createPriceLine({
          price: positionLines.takeProfit,
          color: "#22c55e",
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `TP $${positionLines.takeProfit.toFixed(2)}`,
        }));
      }

      return () => {
        lines.forEach((line) => {
          try { series.removePriceLine(line); } catch {}
        });
      };
    }, [positionLines]);

    return (
      <>
        <style>{`#tv-attr-logo, .tv-lightweight-charts .chart-watermark { display: none !important; }`}</style>
        <div
          ref={containerRef}
          className="w-full h-full"
        />
      </>
    );
  }
);
