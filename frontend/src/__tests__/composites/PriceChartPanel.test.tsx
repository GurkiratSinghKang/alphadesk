import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import PriceChartPanel from "@/components/composites/PriceChartPanel";

// Avoid loading the real chart library in the jsdom test runner.
// 2026-04-20 dashboard redesign: ChartPane (via TradingChart) imports
// CandlestickSeries / HistogramSeries / AreaSeries markers too, so the
// mock needs to export those identity sentinels.
vi.mock("lightweight-charts", () => ({
  createChart: () => ({
    addSeries: () => ({
      setData: () => {},
      createPriceLine: () => {},
      update: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      attachPrimitive: () => {},
      detachPrimitive: () => {},
    }),
    timeScale: () => ({
      fitContent: () => {},
      subscribeVisibleTimeRangeChange: () => {},
    }),
    priceScale: () => ({ applyOptions: () => {} }),
    applyOptions: () => {},
    subscribeCrosshairMove: () => {},
    subscribeClick: () => {},
    unsubscribeClick: () => {},
    resize: () => {},
    remove: () => {},
  }),
  CandlestickSeries: "candlestick",
  LineSeries: "line",
  AreaSeries: "area",
  HistogramSeries: "histogram",
  ColorType: { Solid: "solid" },
  LineStyle: { Dotted: 0, Dashed: 1, Solid: 2 },
  CrosshairMode: { Normal: 0, Magnet: 1 },
}));

describe("PriceChartPanel", () => {
  it("renders header with symbol name, ticker, price, delta and meta cells", () => {
    const { container } = render(
      <PriceChartPanel
        symbol={{ ticker: "NVDA", name: "Nvidia", venue: "Nasdaq · Semis" }}
        quote={{ last: 134.82, change: 1.74, changePct: 1.31 }}
        meta={{
          volume: "28.4M",
          avgVolume: "42.1M",
          range: "132.10 — 135.44",
          iv: "41.2%",
          regimeFit: 0.82,
        }}
        series={[
          { time: 1, open: 130, high: 131, low: 129, close: 130.5 },
          { time: 2, open: 130.5, high: 132, low: 130, close: 131.8 },
        ]}
        activeRange="1M"
        onRangeChange={() => {}}
      />,
    );
    expect(container.querySelector('[data-slot="price-chart-panel"]')).not.toBeNull();
    expect(container.textContent).toContain("Nvidia");
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toContain("134.82");
    expect(container.textContent).toContain("Vol");
    expect(container.textContent).toContain("28.4M");
  });
});
