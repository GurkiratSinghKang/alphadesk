import type { ChartRange } from "@/components/composites";
import type { TimeFrame } from "@/types";

/**
 * Map a range chip to the (timeframe, limit) tuple the bars API expects.
 *
 * Limits intentionally exceed the visible-range bar count so users can
 * pan/zoom backwards through ~2x the labelled window before hitting the
 * leftmost bar. The `loadMore` extension on the chart paginates further
 * back when the user scrolls past that buffer (see `useChartHistory`).
 *
 * 1D — 5min bars; 78 cover one regular session. 200 ≈ 2 full RTH days
 *      including extended-hours coverage.
 * 5D — 15min bars; 26 cover one regular session. 250 ≈ 9 RTH days
 *      so the user can compare today against the prior week.
 * 1M — 1H bars; 7 per day × 22 trading days ≈ 154. 350 ≈ 50 trading days
 *      so the chip frames a month but loads ~2.5 months for context.
 * 3M — daily bars; 63 cover one quarter. 200 ≈ 9 months for trend reads.
 * 6M — daily bars; 126 cover six months. 365 ≈ ~17 months.
 * YTD/1Y — daily bars; 252 cover one year. 500 ≈ two years.
 * ALL — weekly bars; 520 covered ~10 yrs. 1300 ≈ 25 yrs (covers full
 *      history for almost every listed equity).
 */
export function barsRequestForRange(r: ChartRange): { timeframe: TimeFrame; limit: number } {
  switch (r) {
    case "1D":
      return { timeframe: "5m", limit: 200 };
    case "5D":
      return { timeframe: "15m", limit: 250 };
    case "1M":
      return { timeframe: "1H", limit: 350 };
    case "3M":
      return { timeframe: "D", limit: 200 };
    case "6M":
      return { timeframe: "D", limit: 365 };
    case "YTD":
    case "1Y":
      return { timeframe: "D", limit: 500 };
    case "ALL":
      return { timeframe: "W", limit: 1300 };
  }
}

/**
 * The number of bars the user sees when a given range chip is active —
 * used to decide when the visible window has scrolled past the loaded
 * range and we should fetch older bars. This is approximate (the chart
 * lib applies its own auto-fit margins), but good enough for the
 * "are we near the leftmost bar?" prefetch check.
 */
export function visibleBarsForRange(r: ChartRange): number {
  switch (r) {
    case "1D":
      return 78;   // one RTH session of 5m bars
    case "5D":
      return 130;  // five RTH sessions of 15m bars
    case "1M":
      return 154;  // ~22 trading days × 7 1H bars
    case "3M":
      return 63;
    case "6M":
      return 126;
    case "YTD":
    case "1Y":
      return 252;
    case "ALL":
      return 520;
  }
}
