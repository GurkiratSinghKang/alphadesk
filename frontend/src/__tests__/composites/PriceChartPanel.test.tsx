import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PriceChartPanel from "@/components/composites/PriceChartPanel";

// Slice-9 / CH-3C: ChartPane (mounted by PriceChartPanel) uses
// react-query for compare-symbol bars; tests must wrap in
// QueryClientProvider even though no compare symbols are added here.
const _testClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

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
      subscribeVisibleLogicalRangeChange: () => {},
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

vi.mock("@/lib/api", () => ({
  getBars: vi.fn().mockResolvedValue([]),
  getMarketDepth: vi.fn().mockResolvedValue({
    symbol: "NVDA",
    kind: "top_of_book",
    provider: "test",
    bids: [{ price: 134.8, size: 100 }],
    asks: [{ price: 134.85, size: 100 }],
    timestamp: Date.now(),
    isL2: false,
    isDemo: false,
    notes: [],
  }),
}));

function expectZeroInlineTracking(container: HTMLElement) {
  const tracked = Array.from(container.querySelectorAll<HTMLElement>("[style*='letter-spacing']"));
  expect(tracked.length).toBeGreaterThan(0);
  for (const node of tracked) {
    expect(["0", "0px"]).toContain(node.style.letterSpacing);
  }
}

describe("PriceChartPanel", () => {
  it("renders header with symbol name, ticker, price, delta and meta cells", () => {
    const { container } = render(
      <QueryClientProvider client={_testClient}><PriceChartPanel
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
      /></QueryClientProvider>,
    );
    expect(container.querySelector('[data-slot="price-chart-panel"]')).not.toBeNull();
    expect(container.textContent).toContain("Nvidia");
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toContain("134.82");
    expect(container.textContent).toContain("Vol");
    expect(container.textContent).toContain("28.4M");
    expectZeroInlineTracking(container);
  });
});
