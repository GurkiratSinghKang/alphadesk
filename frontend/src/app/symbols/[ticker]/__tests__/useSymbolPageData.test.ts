import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("@/lib/api", () => ({
  searchSymbols: vi.fn(),
  getAnalysis: vi.fn().mockResolvedValue({
    symbol: "TEST",
    technicalScore: 0,
    fundamentalScore: 0,
    sentimentScore: 0,
    composite: 0,
    summary: "",
    signals: [],
  }),
  getIVData: vi.fn().mockResolvedValue({
    ivRank: null,
    ivPctl: null,
    currentIV: null,
    hvRatio: null,
    fetchedAt: null,
    isDemo: false,
  }),
  getBars: vi.fn().mockResolvedValue([]),
  getTickerContext: vi.fn().mockResolvedValue({ symbols: {}, generatedAt: "2026-05-05T00:00:00Z" }),
}));

import { searchSymbols } from "@/lib/api";
import { useSymbolPageData } from "../_hooks/useSymbolPageData";

const mockSearchSymbols = vi.mocked(searchSymbols);

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("useSymbolPageData", () => {
  beforeEach(() => {
    mockSearchSymbols.mockReset();
  });

  it("returns isETF=true when searchSymbols reports type=ETF (e.g. SPY)", async () => {
    mockSearchSymbols.mockResolvedValue([
      { symbol: "SPY", name: "SPDR S&P 500 ETF", type: "ETF", exchange: "NYSE", sector: "Index" },
    ]);

    const { result } = renderHook(() => useSymbolPageData("SPY"), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.symbolMeta).not.toBeNull();
    });

    expect(result.current.isETF).toBe(true);
    expect(result.current.isCryptoForex).toBe(false);
    expect(result.current.symbolMeta?.symbol).toBe("SPY");
  });

  it("returns isCryptoForex=true when searchSymbols reports type=CRYPTO (e.g. BTC-USD)", async () => {
    mockSearchSymbols.mockResolvedValue([
      { symbol: "BTC-USD", name: "Bitcoin USD", type: "CRYPTO", exchange: "Crypto", sector: "Crypto" },
    ]);

    const { result } = renderHook(() => useSymbolPageData("BTC-USD"), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.symbolMeta).not.toBeNull();
    });

    expect(result.current.isCryptoForex).toBe(true);
    expect(result.current.isETF).toBe(false);
  });

  it("exposes symbolMeta=null and false flags when searchSymbols returns empty array (404 path)", async () => {
    mockSearchSymbols.mockResolvedValue([]);

    const { result } = renderHook(() => useSymbolPageData("ZZZZZ"), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.symbolMeta).toBeNull();
    expect(result.current.isETF).toBe(false);
    expect(result.current.isCryptoForex).toBe(false);
  });
});
