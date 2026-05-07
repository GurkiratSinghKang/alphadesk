import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import type { TickerFundamentals } from "@/types";

vi.mock("@/lib/api", () => ({
  getTickerFundamentals: vi.fn(),
}));

import { getTickerFundamentals } from "@/lib/api";
import { KeyStats } from "../_sections/KeyStats";

const mockedFetch = vi.mocked(getTickerFundamentals);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

function makeFundamentals(overrides: Partial<TickerFundamentals> = {}): TickerFundamentals {
  return {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    sector: "Semiconductors",
    industry: "CS",
    marketCap: 2_480_000_000_000,
    sharesOutstanding: 24_500_000_000,
    peRatio: 65.4,
    epsTtm: 12.5,
    dividendYield: 0.0003,
    beta: 1.85,
    fiftyTwoWeekHigh: 237.68,
    fiftyTwoWeekLow: 100.02,
    avgVolume30d: 7_060_268,
    description: null,
    fetchedAt: "2026-05-07T13:00:00Z",
    isDemo: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockedFetch.mockReset();
});

describe("KeyStats", () => {
  it("renders 8 cells with formatted values when fundamentals load", async () => {
    mockedFetch.mockResolvedValue(makeFundamentals());
    const Wrapper = makeWrapper();
    const { container, getByTestId } = render(
      createElement(Wrapper, null, <KeyStats symbol="NVDA" />),
    );
    await waitFor(() => {
      expect(getByTestId("key-stats").getAttribute("data-slot")).toBe("key-stats-ready");
    });
    const cells = container.querySelectorAll('[data-slot="key-stats-cell"]');
    expect(cells).toHaveLength(8);

    // Sanity-check a couple of formatted values.
    const peCell = container.querySelector('[data-cell-key="pe-ratio"] dd');
    expect(peCell?.textContent).toBe("65.4");

    const high = container.querySelector('[data-cell-key="fifty-two-w-high"] dd');
    expect(high?.textContent).toContain("237.68");

    const mktCap = container.querySelector('[data-cell-key="market-cap"] dd');
    // Compact currency in en-US is typically "$2.5T"; loose match in case
    // of locale-default trillion-suffix variations.
    expect(mktCap?.textContent).toMatch(/\$2\.5T|\$2,480/);
  });

  it("renders em-dash for null values", async () => {
    mockedFetch.mockResolvedValue(
      makeFundamentals({
        peRatio: null,
        epsTtm: null,
        dividendYield: null,
        beta: null,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
        avgVolume30d: null,
        marketCap: null,
      }),
    );
    const Wrapper = makeWrapper();
    const { container, getByTestId } = render(
      createElement(Wrapper, null, <KeyStats symbol="NVDA" />),
    );
    await waitFor(() => {
      expect(getByTestId("key-stats").getAttribute("data-slot")).toBe("key-stats-ready");
    });

    const dashCells = Array.from(container.querySelectorAll('[data-slot="key-stats-cell"] dd'))
      .map((el) => el.textContent)
      .filter((t) => t === "—");
    expect(dashCells).toHaveLength(8);
  });

  it("shows a loading skeleton on first paint", () => {
    mockedFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    const Wrapper = makeWrapper();
    const { getByTestId, container } = render(
      createElement(Wrapper, null, <KeyStats symbol="NVDA" />),
    );
    expect(getByTestId("key-stats").getAttribute("data-slot")).toBe("key-stats-loading");
    // Layout stays stable — 8 cells render with em-dashes.
    expect(container.querySelectorAll('[data-slot="key-stats-cell"]')).toHaveLength(8);
  });

  it("renders an error shell with em-dash cells when the fetch fails", async () => {
    mockedFetch.mockRejectedValue(new Error("network down"));
    const Wrapper = makeWrapper();
    const { getByTestId, container } = render(
      createElement(Wrapper, null, <KeyStats symbol="NVDA" />),
    );
    await waitFor(() => {
      expect(getByTestId("key-stats").getAttribute("data-slot")).toBe("key-stats-error");
    });
    expect(container.querySelectorAll('[data-slot="key-stats-cell"]')).toHaveLength(8);
    const dashes = Array.from(container.querySelectorAll('[data-slot="key-stats-cell"] dd'))
      .map((el) => el.textContent)
      .filter((t) => t === "—");
    expect(dashes).toHaveLength(8);
  });

  it("anchors at id='key-stats' with scroll-mt-24 (sticky-band offset)", async () => {
    mockedFetch.mockResolvedValue(makeFundamentals());
    const Wrapper = makeWrapper();
    const { getByTestId } = render(
      createElement(Wrapper, null, <KeyStats symbol="NVDA" />),
    );
    const section = getByTestId("key-stats");
    expect(section.getAttribute("id")).toBe("key-stats");
    expect(section.className).toContain("scroll-mt-24");
  });
});
