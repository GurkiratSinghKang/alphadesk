import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import type { OHLCVBar } from "@/types";

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
}));

import { ChartBand } from "../_sections/ChartBand";

// KeyStatsStub is hidden by default in ChartBand (production-default
// behaviour, see SHOW_PLACEHOLDER_STUBS in ChartBand.tsx). Force it on
// for these tests so the skeleton-cells assertion runs against a
// rendered stub. ChartBand reads the flag at render time, so toggling
// process.env in beforeAll is sufficient.
let _previousStubsFlag: string | undefined;
beforeAll(() => {
  _previousStubsFlag = process.env.NEXT_PUBLIC_SHOW_SYMBOL_PAGE_STUBS;
  process.env.NEXT_PUBLIC_SHOW_SYMBOL_PAGE_STUBS = "true";
});
afterAll(() => {
  if (_previousStubsFlag === undefined) {
    delete process.env.NEXT_PUBLIC_SHOW_SYMBOL_PAGE_STUBS;
  } else {
    process.env.NEXT_PUBLIC_SHOW_SYMBOL_PAGE_STUBS = _previousStubsFlag;
  }
});

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

  it("renders 8 KeyStats skeleton cells when bars are null", () => {
    const Wrapper = makeWrapper();
    const { container } = render(
      createElement(Wrapper, null, <ChartBand symbol="NVDA" bars={null} />),
    );
    const cells = container.querySelectorAll('[data-slot="key-stats-stub"] dl > div');
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
