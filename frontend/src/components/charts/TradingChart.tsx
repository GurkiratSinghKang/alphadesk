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
import {
  attachDrawingPane,
  type Drawing,
  type DrawingPaneHandle,
} from "@/components/charts/drawingPlugin";

// ─── Types ───────────────────────────────────────────────────

export interface TradingChartHandle {
  chart: IChartApi | null;
  updateBar: (bar: OHLCVBar) => void;
  updateLastClose: (close: number) => void;
  setData: (bars: OHLCVBar[]) => void;
  fitContent: () => void;
}

interface TradingChartProps {
  data?: OHLCVBar[];
  chartType?: ChartType;
  indicators?: Indicator[];
  onCrosshairMove?: (price: number | null, time: Time | null, ohlcv?: { open: number; high: number; low: number; close: number; volume?: number } | null) => void;
  /**
   * Slice-4 / CH-3B (2026 chart audit, TradingView pattern): emits the
   * crosshair price + canvas-relative Y coordinate so the parent can
   * render a "+" alert affordance at the right edge of the chart at
   * the cursor's height. Fires ``null, null`` when the cursor leaves
   * the plot area. Cheap to wire — separate from ``onCrosshairMove``
   * so callers that don't want the alert UI don't subscribe to it.
   */
  onAlertHover?: (price: number | null, y: number | null) => void;
  /**
   * Slice-9 / CH-3C (2026 chart audit, TradingView "+ Compare" pattern):
   * an array of symbols to overlay on the main chart for comparison.
   * Each entry carries its OHLCV series so the chart can auto-rescale
   * to percent-change-from-first-bar. The main symbol stays in price
   * units (right axis); compare series render as percent on a left
   * axis. Limited to 4 compare symbols to keep the overlay readable.
   */
  compareSeries?: Array<{
    symbol: string;
    bars: OHLCVBar[];
    color?: string;
  }>;
  /**
   * Slice-14 / AVWAP-1: anchored-VWAP bar index. When set, an additional
   * VWAP series renders starting at this bar (cumulative volume-weighted
   * mean from anchor → present). Power-trader pattern: anchor to an
   * earnings bar or FOMC release to see "what's the volume-weighted
   * mean since the catalyst?"
   */
  anchoredVwapIndex?: number | null;
  onTimeRangeChange?: (from: Time | null, to: Time | null) => void;
  positionLines?: {
    entry: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
  } | null;
  drawingPriceLines?: Array<{ price: number; color: string; label?: string }>;
  /**
   * Fired when the user clicks on the chart canvas with a time+price the
   * drawing state machine can consume. Skipped when the click lands outside
   * the plot area (no `time` or `point` on the event).
   */
  onChartClick?: (pt: { time: number; price: number }) => void;
  /**
   * Fired on crosshair movement with a time+price point the drawing preview
   * can track, or null when the pointer leaves the canvas. Narrower shape
   * than `onCrosshairMove` which also ships OHLCV — this path stays cheap.
   */
  onDrawCrosshair?: (pt: { time: number; price: number } | null) => void;
  /**
   * When true, pan + zoom are disabled so the draw click doesn't fight the
   * scroll handlers. Toggle on when entering any non-cursor tool.
   */
  drawMode?: boolean;
  /**
   * Persisted drawings to render on top of the main series via the drawing
   * plugin's series primitive. Whenever this reference changes the plugin
   * repaints — diff happens at the caller.
   */
  drawings?: Drawing[];
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Read a CSS variable off :root with a fallback. Mirrors the helper in
 * `components/composites/PriceChartPanel.tsx` so TradingView reads the F0
 * design tokens (chartreuse `--up-500` / coral `--down-500` / gold brand)
 * instead of the pre-overhaul SaaS-green/red/blue hexes.
 */
function getTokenVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v ? v.trim() : fallback;
}

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
  // Design-token aware volume histogram — reads chartreuse (--up-500) /
  // coral (--down-500) so F0 identity applies to this chart. Fallback
  // colors match the tokens' hex values.
  const upFill = getTokenVar("--up-500", "#a8d04d");
  const downFill = getTokenVar("--down-500", "#e07856");
  const rgb = (hex: string): string => {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  };
  const isUp = bar.close >= bar.open;
  return {
    time: normalizeTime(bar.time) as unknown as Time,
    value: bar.volume,
    color: `rgba(${rgb(isUp ? upFill : downFill)}, 0.25)`,
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

function computeVWAP(bars: OHLCVBar[]): SingleValueData<Time>[] {
  return computeAnchoredVWAP(bars, 0);
}

/**
 * Slice-14 / AVWAP-1 (2026 design brief, Quantower / TradingView power-tool):
 * Anchored VWAP. Same math as cumulative VWAP, but cumulative running
 * total starts from the anchor bar instead of bar 0. A trader anchors
 * to an earnings bar / FOMC bar / breakout bar to see "what's the
 * volume-weighted mean since the anchor event?"
 */
function computeAnchoredVWAP(
  bars: OHLCVBar[],
  anchorIndex: number,
): SingleValueData<Time>[] {
  const result: SingleValueData<Time>[] = [];
  if (anchorIndex < 0 || anchorIndex >= bars.length) return result;
  let cumPV = 0;
  let cumVol = 0;
  for (let i = anchorIndex; i < bars.length; i++) {
    const typicalPrice = (bars[i].high + bars[i].low + bars[i].close) / 3;
    cumPV += typicalPrice * bars[i].volume;
    cumVol += bars[i].volume;
    if (cumVol > 0) {
      result.push({
        time: normalizeTime(bars[i].time) as unknown as Time,
        value: cumPV / cumVol,
      });
    }
  }
  return result;
}

function computeStochastic(
  bars: OHLCVBar[],
  kPeriod = 14,
  dPeriod = 3
): { k: SingleValueData<Time>[]; d: SingleValueData<Time>[] } {
  const kValues: SingleValueData<Time>[] = [];
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let lowestLow = Infinity;
    let highestHigh = -Infinity;
    for (let j = 0; j < kPeriod; j++) {
      lowestLow = Math.min(lowestLow, bars[i - j].low);
      highestHigh = Math.max(highestHigh, bars[i - j].high);
    }
    const range = highestHigh - lowestLow;
    const kVal = range > 0 ? ((bars[i].close - lowestLow) / range) * 100 : 50;
    kValues.push({
      time: normalizeTime(bars[i].time) as unknown as Time,
      value: kVal,
    });
  }

  // %D = 3-period SMA of %K
  const dValues: SingleValueData<Time>[] = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    let sum = 0;
    for (let j = 0; j < dPeriod; j++) sum += kValues[i - j].value;
    dValues.push({ time: kValues[i].time, value: sum / dPeriod });
  }

  return { k: kValues, d: dValues };
}

/**
 * Slice-12 / RSI-1 (2026 design brief, CH-3J): RSI(14) — Wilder's
 * relative strength index. Returns the smoothed 14-period RSI as a
 * 0-100 series. Renders on a dedicated lower pane via priceScaleId.
 */
function computeRSI(bars: OHLCVBar[], period = 14): SingleValueData<Time>[] {
  if (bars.length <= period) return [];
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    gains.push(Math.max(0, change));
    losses.push(Math.max(0, -change));
  }
  const result: SingleValueData<Time>[] = [];
  // Initial average uses simple mean over the first ``period`` values.
  let avgGain = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < bars.length; i++) {
    if (i > period) {
      // Wilder's smoothing: ((prev × (n-1)) + curr) / n
      avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    result.push({
      time: normalizeTime(bars[i].time) as unknown as Time,
      value: rsi,
    });
  }
  return result;
}

/**
 * Slice-12 / MACD-1: MACD line + signal line + histogram. The line is
 * EMA(12) − EMA(26); the signal is EMA(9) of the line; the histogram
 * is the line minus the signal. Returns three series so the chart
 * can render line + signal as two lines and the histogram as bars.
 */
function computeMACD(
  bars: OHLCVBar[],
): {
  line: SingleValueData<Time>[];
  signal: SingleValueData<Time>[];
  hist: SingleValueData<Time>[];
} {
  if (bars.length < 35) return { line: [], signal: [], hist: [] };
  const ema12 = computeEMA(bars, 12);
  const ema26 = computeEMA(bars, 26);
  // Align the two EMAs on common timestamps. EMA(26) starts later, so
  // we trim EMA(12) to match.
  const ema26Map = new Map(ema26.map((p) => [p.time as unknown as number, p.value]));
  const line: SingleValueData<Time>[] = [];
  for (const p12 of ema12) {
    const v26 = ema26Map.get(p12.time as unknown as number);
    if (v26 !== undefined) {
      line.push({ time: p12.time, value: p12.value - v26 });
    }
  }
  // Signal = EMA(9) of the MACD line. Compute inline (since computeEMA
  // takes OHLCVBar input).
  const signal: SingleValueData<Time>[] = [];
  if (line.length > 9) {
    const k = 2 / (9 + 1);
    let prev = line.slice(0, 9).reduce((s, p) => s + p.value, 0) / 9;
    signal.push({ time: line[8].time, value: prev });
    for (let i = 9; i < line.length; i++) {
      prev = line[i].value * k + prev * (1 - k);
      signal.push({ time: line[i].time, value: prev });
    }
  }
  // Histogram = line - signal at common timestamps.
  const sigMap = new Map(signal.map((p) => [p.time as unknown as number, p.value]));
  const hist: SingleValueData<Time>[] = line
    .filter((p) => sigMap.has(p.time as unknown as number))
    .map((p) => ({
      time: p.time,
      value: p.value - (sigMap.get(p.time as unknown as number) ?? 0),
    }));
  return { line, signal, hist };
}

function computeATR(bars: OHLCVBar[], period = 14): SingleValueData<Time>[] {
  if (bars.length < 2) return [];
  const trValues: number[] = [];
  // TR for first bar uses high-low only (no previous close)
  trValues.push(bars[0].high - bars[0].low);
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prevClose),
      Math.abs(bars[i].low - prevClose)
    );
    trValues.push(tr);
  }

  // ATR = SMA of TR over `period`
  const result: SingleValueData<Time>[] = [];
  for (let i = period - 1; i < trValues.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += trValues[i - j];
    result.push({
      time: normalizeTime(bars[i].time) as unknown as Time,
      value: sum / period,
    });
  }
  return result;
}

// ─── Component ───────────────────────────────────────────────

export const TradingChart = forwardRef<TradingChartHandle, TradingChartProps>(
  function TradingChart(
    { data, chartType = "candle", indicators = [], onCrosshairMove, onAlertHover, compareSeries, anchoredVwapIndex, onTimeRangeChange, positionLines, drawingPriceLines, onChartClick, onDrawCrosshair, drawMode, drawings },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const mainSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
    const lastBarRef = useRef<OHLCVBar | null>(null);
    const overlaySeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
    const drawingPaneRef = useRef<DrawingPaneHandle | null>(null);
    // Round-12 / CH-1: gates ``timeScale().fitContent()`` so it runs
    // only once per (chartType, indicators) lifecycle, not on every
    // data refetch (which used to reset the user's zoom).
    const didFitRef = useRef<boolean>(false);
    // Keep the latest callbacks in refs so we can subscribe once inside the
    // chart-creation effect without re-subscribing on every render.
    const onChartClickRef = useRef(onChartClick);
    const onDrawCrosshairRef = useRef(onDrawCrosshair);
    useEffect(() => { onChartClickRef.current = onChartClick; }, [onChartClick]);
    useEffect(() => { onDrawCrosshairRef.current = onDrawCrosshair; }, [onDrawCrosshair]);

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
      updateLastClose: (close: number) => {
        try {
          const lastBar = lastBarRef.current;
          if (!lastBar || !mainSeriesRef.current) return;

          // Always update the LAST bar in place — don't create new bars
          // Creating bars with new timestamps causes LWC time format conflicts
          const updated = { ...lastBar, close, high: Math.max(lastBar.high, close), low: Math.min(lastBar.low, close) };
          lastBarRef.current = updated;
          if (chartType === "candle") {
            mainSeriesRef.current.update(toChartCandle(updated));
          } else {
            mainSeriesRef.current.update(toLineData(updated));
          }
        } catch {
          // Silently ignore chart update errors — don't crash the page
        }
      },
      setData: (bars: OHLCVBar[]) => {
        if (chartType === "candle") {
          mainSeriesRef.current?.setData(bars.map(toChartCandle));
        } else {
          mainSeriesRef.current?.setData(bars.map(toLineData));
        }
        volumeSeriesRef.current?.setData(bars.map(toChartVolume));
        lastBarRef.current = bars.length > 0 ? bars[bars.length - 1] : null;
        chartRef.current?.timeScale().fitContent();
      },
      fitContent: () => chartRef.current?.timeScale().fitContent(),
    }), [chartType]);

    // Create chart — recreate when chartType changes
    useEffect(() => {
      if (!containerRef.current) return;

      // F0 palette read from CSS tokens. Fallback hex values match the
      // tokens' literal values so the chart still renders sensibly if the
      // stylesheet hasn't applied yet (hydration window).
      const bg = getTokenVar("--bg", "#0b0a09");
      const textColor = getTokenVar("--fg-hint", "#5b5547");
      const border = getTokenVar("--border", "#2a271d");
      const up = getTokenVar("--up-500", "#a8d04d");
      const down = getTokenVar("--down-500", "#e07856");
      const brand = getTokenVar("--gold-500", "#c9a66b");

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: bg },
          textColor,
          fontSize: 11,
          fontFamily: getTokenVar("--font-ui", "Inter, sans-serif"),
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: border },
          horzLines: { color: border },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: brand,
            labelBackgroundColor: brand,
          },
          horzLine: {
            color: brand,
            labelBackgroundColor: brand,
          },
        },
        rightPriceScale: {
          borderColor: border,
          scaleMargins: { top: 0.05, bottom: 0.2 },
        },
        timeScale: {
          borderColor: border,
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true },
      });

      chartRef.current = chart;

      // Candles read chartreuse (`--up-500`) / coral (`--down-500`).
      // Line + area use the gold brand token to match PriceChartPanel's
      // gold price line (F2 reference).
      let mainSeries: ISeriesApi<SeriesType>;
      if (chartType === "candle") {
        mainSeries = chart.addSeries(CandlestickSeries, {
          upColor: up,
          downColor: down,
          borderUpColor: up,
          borderDownColor: down,
          wickUpColor: up,
          wickDownColor: down,
        });
      } else if (chartType === "line") {
        mainSeries = chart.addSeries(LineSeries, {
          color: brand,
          lineWidth: 2,
        });
      } else {
        // area
        const rgb = (hex: string): string => {
          const h = hex.replace("#", "");
          const r = parseInt(h.slice(0, 2), 16);
          const g = parseInt(h.slice(2, 4), 16);
          const b = parseInt(h.slice(4, 6), 16);
          return `${r}, ${g}, ${b}`;
        };
        const brandRgb = rgb(brand);
        mainSeries = chart.addSeries(AreaSeries, {
          topColor: `rgba(${brandRgb}, 0.35)`,
          bottomColor: `rgba(${brandRgb}, 0.02)`,
          lineColor: brand,
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
            onCrosshairMove(null, null, null);
            return;
          }
          const seriesData = param.seriesData.get(mainSeries);
          const volData = param.seriesData.get(volumeSeries);
          if (seriesData) {
            const vol = volData && "value" in volData ? (volData as HistogramData<Time>).value : undefined;
            if ("close" in seriesData) {
              const candle = seriesData as CandlestickData<Time>;
              onCrosshairMove(
                candle.close,
                param.time,
                { open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: vol }
              );
            } else if ("value" in seriesData) {
              const val = (seriesData as SingleValueData<Time>).value;
              onCrosshairMove(
                val,
                param.time,
                { open: val, high: val, low: val, close: val, volume: vol }
              );
            }
          }
        });
      }

      // Slice-4 / CH-3B: alert-hover callback. Tracks the crosshair's
      // canvas-relative Y so the parent can position a "+" affordance
      // at the right axis. Emits the price-axis price (not the bar's
      // close) so a click adds an alert at the EXACT axis price the
      // user pointed at. Fires ``null, null`` on pointer leave.
      if (onAlertHover) {
        chart.subscribeCrosshairMove((param) => {
          if (!param.point) {
            onAlertHover(null, null);
            return;
          }
          const price = mainSeries.coordinateToPrice(param.point.y);
          if (price == null) {
            onAlertHover(null, null);
            return;
          }
          onAlertHover(Number(price), param.point.y);
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

      // Drawing-path click: translates the mouse event into a {time, price}
      // pair for the state machine in ChartPane. LWC v5 fires subscribeClick
      // with .time undefined if the click lands outside the x-range of bars
      // and .point undefined if the click is off-canvas — guard both.
      chart.subscribeClick((param) => {
        const cb = onChartClickRef.current;
        if (!cb) return;
        if (!param.point || param.time == null) return;
        const price = mainSeries.coordinateToPrice(param.point.y);
        if (price == null) return;
        const t = typeof param.time === "number" ? param.time : Number(param.time);
        if (!Number.isFinite(t)) return;
        cb({ time: t, price: Number(price) });
      });

      // Crosshair tracking for in-progress drawing preview. Emits null on
      // leave so the preview overlay can hide. Kept separate from the
      // existing onCrosshairMove so OHLCV readouts and draw-preview stay
      // decoupled (and the ChartPane doesn't have to care about BarData).
      chart.subscribeCrosshairMove((param) => {
        const cb = onDrawCrosshairRef.current;
        if (!cb) return;
        if (!param.point || param.time == null) {
          cb(null);
          return;
        }
        const price = mainSeries.coordinateToPrice(param.point.y);
        if (price == null) {
          cb(null);
          return;
        }
        const t = typeof param.time === "number" ? param.time : Number(param.time);
        if (!Number.isFinite(t)) {
          cb(null);
          return;
        }
        cb({ time: t, price: Number(price) });
      });

      // Attach the drawing plugin to the main series so user-drawn shapes
      // render on the same canvas as the candles. The handle stays put even
      // when `drawings` is empty so adding the first one doesn't require
      // a re-attach.
      drawingPaneRef.current = attachDrawingPane(chart, mainSeries, []);

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
        try { drawingPaneRef.current?.detach(); } catch { /* noop */ }
        drawingPaneRef.current = null;
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

        // Design-token palette for indicator overlays. The F0 system
        // doesn't carry a rainbow of hues, so we cycle the available
        // semantic tokens: amber for the primary EMA / fast line,
        // ice for the slow line, gold-300 for SMA-fast, and `--fg-dim`
        // for SMA-slow. Two indicators of the same family look related
        // (fast = warmer, slow = cooler) instead of arbitrary rainbow.
        const amber = getTokenVar("--amber-500", "#d9a441");
        const ice = getTokenVar("--ice-500", "#8db3c4");
        const goldMid = getTokenVar("--gold-300", "#e0c070");
        const fgDim = getTokenVar("--fg-dim", "#a8a08d");

        // BUG #12: Add indicator overlays
        if (indicators.includes("EMA")) {
          const ema20 = computeEMA(bars, 20);
          const ema50 = computeEMA(bars, 50);
          if (ema20.length) {
            const s = chart.addSeries(LineSeries, {
              color: amber,
              lineWidth: 1,
              priceScaleId: "right",
            });
            s.setData(ema20);
            overlaySeriesRef.current.push(s);
          }
          if (ema50.length) {
            const s = chart.addSeries(LineSeries, {
              color: ice,
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
              color: goldMid,
              lineWidth: 1,
              priceScaleId: "right",
            });
            s.setData(sma20);
            overlaySeriesRef.current.push(s);
          }
          if (sma50.length) {
            const s = chart.addSeries(LineSeries, {
              color: fgDim,
              lineWidth: 1,
              priceScaleId: "right",
            });
            s.setData(sma50);
            overlaySeriesRef.current.push(s);
          }
        }

        if (indicators.includes("Bollinger")) {
          const bb = computeBollinger(bars);
          // BB upper band = overbought/resistance → coral (down-500);
          // BB lower band = oversold/support → chartreuse (up-500).
          // Middle band stays neutral (fg-hint).
          const bbColors = {
            upper: getTokenVar("--down-500", "#e07856"),
            middle: getTokenVar("--fg-hint", "#64748b"),
            lower: getTokenVar("--up-500", "#a8d04d"),
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

        // VWAP overlay — brand gold so it reads as the "canonical" mean
        const brandGold = getTokenVar("--gold-500", "#c9a66b");
        if (indicators.includes("VWAP")) {
          const vwap = computeVWAP(bars);
          if (vwap.length) {
            const s = chart.addSeries(LineSeries, {
              color: brandGold,
              lineWidth: 2,
              priceScaleId: "right",
            });
            s.setData(vwap);
            overlaySeriesRef.current.push(s);
          }
        }

        // Slice-14 / AVWAP-1: anchored VWAP overlay. Renders as a
        // dashed brand-gold line from the anchor bar forward — same
        // tone as the regular VWAP but dashed so the user can
        // distinguish "since anchor" from "session-cumulative."
        if (
          anchoredVwapIndex != null &&
          anchoredVwapIndex >= 0 &&
          anchoredVwapIndex < bars.length
        ) {
          const avwap = computeAnchoredVWAP(bars, anchoredVwapIndex);
          if (avwap.length >= 2) {
            const s = chart.addSeries(LineSeries, {
              color: brandGold,
              lineWidth: 2,
              lineStyle: 2, // dashed
              priceScaleId: "right",
              title: "AVWAP",
            });
            s.setData(avwap);
            overlaySeriesRef.current.push(s);
          }
        }

        // Slice-12 / RSI-1 (CH-3J): RSI(14) sub-pane, 0-100 axis.
        // Renders on a dedicated "rsi" priceScale so it sits below
        // the main price pane. Color: ice for the line; the standard
        // 30/70 reference levels are NOT drawn here (would clutter)
        // but the chart's crosshair label gives the user the exact
        // value at hover.
        if (indicators.includes("RSI")) {
          const rsi = computeRSI(bars, 14);
          if (rsi.length) {
            const s = chart.addSeries(LineSeries, {
              color: ice,
              lineWidth: 2,
              priceScaleId: "rsi",
              title: "RSI 14",
            });
            s.setData(rsi);
            overlaySeriesRef.current.push(s);
            chart.priceScale("rsi").applyOptions({
              scaleMargins: { top: 0.78, bottom: 0.02 },
            });
          }
        }

        // Slice-12 / MACD-1 (CH-3J): MACD line + signal + histogram.
        // Renders on a dedicated "macd" priceScale below the main pane.
        // Line = EMA(12)−EMA(26) in brand-gold; signal = EMA(9) of the
        // line in amber (dashed); histogram = line−signal as bars,
        // colored profit/loss by sign.
        if (indicators.includes("MACD")) {
          const macd = computeMACD(bars);
          if (macd.line.length) {
            const lineS = chart.addSeries(LineSeries, {
              color: brandGold,
              lineWidth: 2,
              priceScaleId: "macd",
              title: "MACD 12/26",
            });
            lineS.setData(macd.line);
            overlaySeriesRef.current.push(lineS);
            const sigS = chart.addSeries(LineSeries, {
              color: amber,
              lineWidth: 1,
              lineStyle: 2,
              priceScaleId: "macd",
              title: "Signal 9",
            });
            sigS.setData(macd.signal);
            overlaySeriesRef.current.push(sigS);
            const histS = chart.addSeries(HistogramSeries, {
              priceScaleId: "macd",
              title: "Histogram",
              priceFormat: { type: "price" as const },
            });
            histS.setData(
              macd.hist.map((p) => ({
                time: p.time,
                value: p.value,
                color: p.value >= 0 ? "#a8d04d" : "#e07856",
              })),
            );
            overlaySeriesRef.current.push(histS);
            chart.priceScale("macd").applyOptions({
              scaleMargins: { top: 0.78, bottom: 0.02 },
            });
          }
        }

        // Stochastic sub-panel (%K and %D, 0-100). %K uses ice (info),
        // %D uses amber as a warm companion — same fast/slow pairing
        // pattern as EMA above.
        if (indicators.includes("Stochastic")) {
          const stoch = computeStochastic(bars);
          if (stoch.k.length) {
            const sK = chart.addSeries(LineSeries, {
              color: ice,
              lineWidth: 1,
              priceScaleId: "stochastic",
            });
            sK.setData(stoch.k);
            overlaySeriesRef.current.push(sK);

            chart.priceScale("stochastic").applyOptions({
              scaleMargins: { top: 0.78, bottom: 0.02 },
            });
          }
          if (stoch.d.length) {
            const sD = chart.addSeries(LineSeries, {
              color: amber,
              lineWidth: 1,
              lineStyle: 2,
              priceScaleId: "stochastic",
            });
            sD.setData(stoch.d);
            overlaySeriesRef.current.push(sD);
          }
        }

        // ATR sub-panel — ice (neutral/info) since ATR is volatility, not direction.
        if (indicators.includes("ATR")) {
          const atr = computeATR(bars);
          if (atr.length) {
            const s = chart.addSeries(LineSeries, {
              color: ice,
              lineWidth: 1,
              priceScaleId: "atr",
            });
            s.setData(atr);
            overlaySeriesRef.current.push(s);

            chart.priceScale("atr").applyOptions({
              scaleMargins: { top: 0.78, bottom: 0.02 },
            });
          }
        }

        // Slice-9 / CH-3C: compare-symbol overlay. Each compare series
        // is rebased to percent-change from its first bar so AAPL @
        // $200 and SPY @ $500 land on the same axis. Renders on a
        // dedicated "compare" priceScale (left side), preserving the
        // main series' price scale on the right. Up to 4 compare
        // series; cycling palette so they're visually distinguishable.
        if (compareSeries && compareSeries.length > 0) {
          const palette = [
            "#5b8def", // ice
            "#a07550", // expected-move brown
            "#e07856", // coral / loss
            "#a8d04d", // chartreuse / profit (for the 4th series)
          ];
          compareSeries.slice(0, 4).forEach((cs, idx) => {
            if (!cs.bars || cs.bars.length < 2) return;
            const base = cs.bars[0]?.close;
            if (!base || base <= 0) return;
            const lineData = cs.bars
              .filter((b) => b.close > 0)
              .map((b) => ({
                time: (typeof b.time === "number"
                  ? b.time
                  : Math.floor(new Date(b.time).getTime() / 1000)) as Time,
                value: ((b.close - base) / base) * 100,
              }));
            const s = chart.addSeries(LineSeries, {
              color: cs.color ?? palette[idx % palette.length],
              lineWidth: 2,
              lineStyle: idx === 0 ? 0 : 2, // solid for first compare, dashed for the rest
              priceScaleId: "compare",
              title: `${cs.symbol} %`,
              lastValueVisible: true,
              priceLineVisible: false,
            });
            s.setData(lineData);
            overlaySeriesRef.current.push(s);
          });
          chart.priceScale("compare").applyOptions({
            scaleMargins: { top: 0.05, bottom: 0.25 },
            visible: true,
          });
        }

        // Round-12 / CH-1 (P1): only fit the visible range on the FIRST
        // setData call (and on a chartType change, which forces a fresh
        // mount via the effect below). Previously this fired on EVERY
        // data update — every WebSocket tick or refetch reset the user's
        // pan/zoom back to the full range, making zoom-in essentially
        // unusable. The flag resets when chartType / indicators change
        // (the dep array on this useCallback) so a new series-shape
        // genuinely re-fits.
        if (!didFitRef.current) {
          chart.timeScale().fitContent();
          didFitRef.current = true;
        }
      },
      [chartType, indicators, compareSeries, anchoredVwapIndex]
    );

    useEffect(() => {
      if (data?.length) setChartData(data);
    }, [data, setChartData]);

    // Round-12 / CH-1: reset the fit-once flag when the user changes
    // chartType or toggles indicators, so the next render re-fits to
    // the new shape.
    useEffect(() => {
      didFitRef.current = false;
    }, [chartType, indicators, compareSeries, anchoredVwapIndex]);

    // Position indicator lines (entry, stop loss, take profit)
    useEffect(() => {
      const series = mainSeriesRef.current;
      if (!series) return;

      const lines: ReturnType<typeof series.createPriceLine>[] = [];

      // Entry line uses the gold brand; SL uses coral (--down-500); TP uses
      // chartreuse (--up-500). Read lazily from the token system so dark /
      // light variants would carry through automatically.
      const entryColor = getTokenVar("--gold-500", "#c9a66b");
      const slColor = getTokenVar("--down-500", "#e07856");
      const tpColor = getTokenVar("--up-500", "#a8d04d");

      if (positionLines?.entry != null) {
        lines.push(series.createPriceLine({
          price: positionLines.entry,
          color: entryColor,
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `Entry $${(positionLines.entry ?? 0).toFixed(2)}`,
        }));
      }
      if (positionLines?.stopLoss != null) {
        lines.push(series.createPriceLine({
          price: positionLines.stopLoss,
          color: slColor,
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `SL $${(positionLines.stopLoss ?? 0).toFixed(2)}`,
        }));
      }
      if (positionLines?.takeProfit != null) {
        lines.push(series.createPriceLine({
          price: positionLines.takeProfit,
          color: tpColor,
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `TP $${(positionLines.takeProfit ?? 0).toFixed(2)}`,
        }));
      }

      return () => {
        lines.forEach((line) => {
          try { series.removePriceLine(line); } catch {}
        });
      };
    }, [positionLines, chartType]);

    // Push the drawings array into the attached pane whenever it changes.
    // The primitive diffs internally (setDrawings calls requestUpdate), so
    // reference-equal arrays produce a no-op repaint.
    useEffect(() => {
      drawingPaneRef.current?.setDrawings(drawings ?? []);
    }, [drawings]);

    // Draw-mode toggles pan/zoom. Without this, clicking on the chart to
    // place a draw point would also start a drag-pan, stealing the click.
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;
      if (drawMode) {
        chart.applyOptions({
          handleScroll: false,
          handleScale: false,
        });
      } else {
        chart.applyOptions({
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale: { mouseWheel: true, pinch: true },
        });
      }
    }, [drawMode]);

    // Drawing price lines (user-drawn horizontal lines)
    useEffect(() => {
      const series = mainSeriesRef.current;
      if (!series) return;
      const lines = (drawingPriceLines ?? []).map((d) =>
        series.createPriceLine({
          price: d.price,
          color: d.color,
          lineWidth: 1,
          lineStyle: 0, // Solid
          axisLabelVisible: true,
          title: d.label ?? `$${(d.price ?? 0).toFixed(2)}`,
        })
      );
      return () => lines.forEach((l) => { try { series.removePriceLine(l); } catch {} });
    }, [drawingPriceLines, chartType]);

    return (
      <>
        <style>{`#tv-attr-logo, .tv-lightweight-charts .chart-watermark { display: none !important; }`}</style>
        <div
          ref={containerRef}
          className="w-full h-full"
          role="img"
          aria-label="Interactive price chart with candlestick, line, and area views. Use mouse wheel to zoom and click-drag to pan."
        />
      </>
    );
  }
);
