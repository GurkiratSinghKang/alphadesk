import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import type { UseSymbolPageDataResult } from "../_hooks/useSymbolPageData";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("../_hooks/useSymbolPageData", () => ({
  useSymbolPageData: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  searchSymbols: vi.fn().mockResolvedValue([]),
}));

import { useSymbolPageData } from "../_hooks/useSymbolPageData";
import { SymbolPageClient } from "../_components/SymbolPageClient";

const mockUseSymbolPageData = vi.mocked(useSymbolPageData);

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

function makeBaseResult(overrides: Partial<UseSymbolPageDataResult>): UseSymbolPageDataResult {
  return {
    ctx: { data: undefined, isLoading: false, isError: false } as unknown as UseSymbolPageDataResult["ctx"],
    analysis: null,
    ivData: null,
    bars: null,
    earningsDetail: null,
    recommendedSetups: null,
    symbolMeta: null,
    isLoading: false,
    isError: false,
    isETF: false,
    isCryptoForex: false,
    timeframe: "D",
    setTimeframe: vi.fn(),
    ...overrides,
  };
}

describe("SymbolPageClient gates", () => {
  beforeEach(() => {
    mockUseSymbolPageData.mockReset();
  });

  it("renders UnsupportedAsset (no StickyBand) when isCryptoForex=true", () => {
    mockUseSymbolPageData.mockReturnValue(
      makeBaseResult({
        isCryptoForex: true,
        symbolMeta: { symbol: "BTC-USD", name: "Bitcoin USD", type: "CRYPTO", exchange: "Crypto", sector: "Crypto" },
      }),
    );

    const Wrapper = makeWrapper();
    render(
      createElement(Wrapper, null, <SymbolPageClient symbol="BTC-USD" />),
    );

    expect(screen.getByTestId("unsupported-asset")).toBeInTheDocument();
    expect(screen.getByText(/isn't supported yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Crypto and forex/i)).toBeInTheDocument();
    expect(screen.queryByTestId("symbol-page")).toBeNull();
    expect(screen.queryByTestId("sticky-band")).toBeNull();
  });

  it("renders NotFound when nothing resolved (symbolMeta=null, no quote, no bars, no analysis) and not loading", () => {
    // Audit fix: NotFound now requires every primary data source to be
    // empty AND the page to be done loading. A bare symbolMeta=null is
    // not sufficient — the search index doesn't always carry every valid
    // ticker (BRK.B, recently-listed names, dot-suffix symbols).
    mockUseSymbolPageData.mockReturnValue(
      makeBaseResult({ symbolMeta: null, isLoading: false }),
    );

    const Wrapper = makeWrapper();
    render(
      createElement(Wrapper, null, <SymbolPageClient symbol="ZZZZZ" />),
    );

    expect(screen.getByTestId("symbol-not-found")).toBeInTheDocument();
    expect(screen.getByText(/We don't have data for ZZZZZ/i)).toBeInTheDocument();
    expect(screen.getByTestId("not-found-search-form")).toBeInTheDocument();
    expect(screen.queryByTestId("symbol-page")).toBeNull();
    expect(screen.queryByTestId("sticky-band")).toBeNull();
  });

  it("renders the page (NOT NotFound) when symbolMeta is null but a quote resolved (BRK.B / dot-suffix path)", () => {
    // Audit fix: search index doesn't carry every valid ticker. As long
    // as the spine quote/bars/analysis came back, render the page so
    // operators don't get a misleading "Symbol not found" on a live name.
    const ctxWithQuote = {
      data: {
        generatedAt: "2026-05-06T12:00:00Z",
        symbols: {
          "BRK.B": { quote: { value: { last: 412.34 } }, warnings: [] },
        },
      },
      isLoading: false,
      isError: false,
    } as unknown as UseSymbolPageDataResult["ctx"];

    mockUseSymbolPageData.mockReturnValue(
      makeBaseResult({ symbolMeta: null, isLoading: false, ctx: ctxWithQuote }),
    );

    const Wrapper = makeWrapper();
    render(
      createElement(Wrapper, null, <SymbolPageClient symbol="BRK.B" />),
    );

    expect(screen.queryByTestId("symbol-not-found")).toBeNull();
    expect(screen.getByTestId("symbol-page")).toBeInTheDocument();
    // Inline note flags reduced metadata.
    expect(screen.getByTestId("limited-metadata-note")).toBeInTheDocument();
  });

  it("renders the page (NOT NotFound) when symbolMeta is null but bars came back", () => {
    mockUseSymbolPageData.mockReturnValue(
      makeBaseResult({
        symbolMeta: null,
        isLoading: false,
        bars: [
          {
            time: 1714400000,
            open: 100,
            high: 101,
            low: 99,
            close: 100.5,
            volume: 1000,
          },
        ],
      }),
    );

    const Wrapper = makeWrapper();
    render(
      createElement(Wrapper, null, <SymbolPageClient symbol="BRK.B" />),
    );

    expect(screen.queryByTestId("symbol-not-found")).toBeNull();
    expect(screen.getByTestId("symbol-page")).toBeInTheDocument();
  });

  it("does not gate to NotFound while still loading (symbolMeta=null but isLoading=true) — skeleton state", () => {
    // symbolMeta=null && quote=null && bars=null but isLoading=true: still
    // not NotFound, skeleton state until the queries settle.
    mockUseSymbolPageData.mockReturnValue(
      makeBaseResult({ symbolMeta: null, isLoading: true }),
    );

    const Wrapper = makeWrapper();
    render(
      createElement(Wrapper, null, <SymbolPageClient symbol="AAPL" />),
    );

    expect(screen.queryByTestId("symbol-not-found")).toBeNull();
    expect(screen.getByTestId("symbol-page")).toBeInTheDocument();
  });

  it("renders OptionsThesisBand with ETF empty-state thesis copy when isETF=true and no claude data", () => {
    mockUseSymbolPageData.mockReturnValue(
      makeBaseResult({
        isETF: true,
        symbolMeta: { symbol: "SPY", name: "SPDR S&P 500 ETF", type: "ETF", exchange: "NYSE", sector: "Index" },
      }),
    );

    const Wrapper = makeWrapper();
    render(
      createElement(Wrapper, null, <SymbolPageClient symbol="SPY" />),
    );

    expect(screen.getByTestId("symbol-page")).toBeInTheDocument();
    expect(screen.getByTestId("sticky-band")).toBeInTheDocument();
    expect(screen.getByTestId("decision-strip")).toBeInTheDocument();
    expect(screen.getByTestId("options-thesis-band")).toBeInTheDocument();
    expect(screen.queryByTestId("etf-thesis-placeholder")).toBeNull();
    const empty = screen.getByTestId("thesis-empty-state");
    expect(empty.textContent).toMatch(/AI thesis available for individual equities only/i);
  });

  it("renders full equity layout when isETF=false and a known equity ticker resolves", () => {
    mockUseSymbolPageData.mockReturnValue(
      makeBaseResult({
        symbolMeta: { symbol: "AAPL", name: "Apple Inc.", type: "CS", exchange: "NASDAQ", sector: "Technology" },
      }),
    );

    const Wrapper = makeWrapper();
    render(
      createElement(Wrapper, null, <SymbolPageClient symbol="AAPL" />),
    );

    expect(screen.getByTestId("symbol-page")).toBeInTheDocument();
    expect(screen.getByTestId("sticky-band")).toBeInTheDocument();
    expect(screen.getByTestId("options-thesis-band")).toBeInTheDocument();
    expect(screen.queryByTestId("etf-thesis-placeholder")).toBeNull();
    expect(screen.queryByTestId("symbol-not-found")).toBeNull();
    expect(screen.queryByTestId("unsupported-asset")).toBeNull();
  });
});
