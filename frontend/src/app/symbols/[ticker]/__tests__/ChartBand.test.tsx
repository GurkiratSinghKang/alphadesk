import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import type { OHLCVBar, TickerFundamentals } from "@/types";

vi.mock("@/components/composites/PriceChartPanel", () => ({
  __esModule: true,
  default: ({ symbol, series }: { symbol: { ticker: string }; series: unknown[] }) =>
    createElement("div", {
      "data-testid": "mock-chart",
      "data-bars-count": series?.length ?? 0,
      "data-symbol": symbol?.ticker ?? "",
    }),
}));

vi.mock("@/lib/api", () => ({
  getBars: vi.fn().mockResolvedValue([]),
  getTickerFundamentals: vi.fn().mockResolvedValue({
    symbol: "NVDA",
    name: null,
    sector: null,
    industry: null,
    marketCap: null,
    sharesOutstanding: null,
    peRatio: null,
    epsTtm: null,
    dividendYield: null,
    beta: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    avgVolume30d: null,
    description: null,
    fetchedAt: null,
    isDemo: true,
  } satisfies TickerFundamentals),
}));

import { ChartBand } from "../_sections/ChartBand";

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

describe("ChartBand", () => {
  it("passes the seeded bars to PriceChartPanel", () => {
    const bars: OHLCVBar[] = [
      { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
    ];
    const Wrapper = makeWrapper();
    const { getByTestId } = render(
      createElement(Wrapper, null, <ChartBand symbol="NVDA" bars={bars} />),
    );
    expect(getByTestId("mock-chart").getAttribute("data-bars-count")).toBe("1");
    expect(getByTestId("mock-chart").getAttribute("data-symbol")).toBe("NVDA");
  });

  it("renders the live KeyStats panel alongside the chart", () => {
    const Wrapper = makeWrapper();
    const { container } = render(
      createElement(Wrapper, null, <ChartBand symbol="NVDA" bars={null} />),
    );
    const cells = container.querySelectorAll('[data-slot="key-stats-cell"]');
    expect(cells).toHaveLength(8);
  });

  it("anchors itself with id='chart' and scroll-mt for sticky-band offset", () => {
    const Wrapper = makeWrapper();
    const { getByTestId } = render(
      createElement(Wrapper, null, <ChartBand symbol="NVDA" bars={[]} />),
    );
    const band = getByTestId("chart-band");
    expect(band.getAttribute("id")).toBe("chart");
    expect(band.className).toContain("scroll-mt-24");
  });
});
