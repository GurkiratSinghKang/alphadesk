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

  it("renders NotFound (no StickyBand) when symbolMeta is null and not loading", () => {
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

  it("does not gate to NotFound while still loading (symbolMeta=null but isLoading=true)", () => {
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
