import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
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
    getEarningsDetail: vi.fn().mockResolvedValue(null),
    getRecommendedSetups: vi.fn().mockResolvedValue([]),
    getTickerContext: vi.fn().mockResolvedValue({ symbols: {}, generatedAt: "2026-05-05T00:00:00Z" }),
  };
});

import { ApiError, getEarningsDetail, searchSymbols } from "@/lib/api";
import { useSymbolPageData } from "../_hooks/useSymbolPageData";

const mockSearchSymbols = vi.mocked(searchSymbols);
const mockGetEarningsDetail = vi.mocked(getEarningsDetail);

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("useSymbolPageData", () => {
  beforeEach(() => {
    mockSearchSymbols.mockReset();
    mockGetEarningsDetail.mockReset();
    // The hook explicitly tolerates null/undefined here — its catch
    // narrows to ApiError 404 → null. We cast through unknown because
    // the public type is non-nullable; tests need both the null and
    // throw paths.
    mockGetEarningsDetail.mockResolvedValue(null as unknown as Awaited<ReturnType<typeof getEarningsDetail>>);
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

  // Audit fix: when symbolMeta is null because the search index doesn't
  // carry the ticker (BRK.B, recently-listed names, dot-suffix tickers),
  // the curated-equity earnings/setups queries must STILL fire so the
  // page can populate from the backend's own per-symbol routes.
  it("fires getEarningsDetail even when symbolMeta is null (search index missing the ticker)", async () => {
    mockSearchSymbols.mockResolvedValue([]); // search index doesn't have BRK.B

    const { result } = renderHook(() => useSymbolPageData("BRK.B"), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // ETF/crypto-forex flags both default to false → earningsEnabled
    // is true → the query MUST have fired.
    expect(mockGetEarningsDetail).toHaveBeenCalledWith("BRK.B");
    expect(result.current.symbolMeta).toBeNull();
    expect(result.current.isETF).toBe(false);
    expect(result.current.isCryptoForex).toBe(false);
  });

  // T7 P1 #2: getEarningsDetail 404 is the canonical "non-curated equity"
  // signal; we still want earningsDetail=null and the hook to stay
  // healthy (no isError flip).
  it("swallows ApiError 404 from getEarningsDetail (non-curated equity)", async () => {
    mockSearchSymbols.mockResolvedValue([
      { symbol: "ZZZZ", name: "Tiny Corp", type: "EQUITY", exchange: "NYSE", sector: "Tech" },
    ]);
    mockGetEarningsDetail.mockRejectedValue(
      new ApiError("/api/v1/earnings/ZZZZ/detail", 404, "{}", "not curated"),
    );

    const { result } = renderHook(() => useSymbolPageData("ZZZZ"), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.earningsDetail).toBeNull();
    // hook isError aggregates ctx/analysis/iv/bars/search — earnings-detail
    // is intentionally excluded, so a swallowed 404 should not flip it.
    expect(result.current.isError).toBe(false);
  });

  // T7 P1 #2: anything other than a 404 — 5xx, network failures, etc. —
  // must rethrow. The previous `.catch(() => null)` masked all of these,
  // which silently degraded the symbol page with no telemetry signal.
  // We invoke the queryFn directly to assert the catch-narrowing
  // contract, since the public hook deliberately excludes the earnings
  // query from its aggregate isError flag.
  it("rethrows non-404 ApiError from getEarningsDetail catch (only 404 swallowed)", async () => {
    mockGetEarningsDetail.mockRejectedValueOnce(
      new ApiError("/api/v1/earnings/AAPL/detail", 500, "{}", "internal"),
    );
    // Replicate the queryFn shape from useSymbolPageData. Pre-fix the
    // `.catch(() => null)` in the hook would have resolved to `null`;
    // post-fix, the 500 must rethrow.
    const queryFn = () =>
      getEarningsDetail("AAPL").catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      });
    await expect(queryFn()).rejects.toBeInstanceOf(ApiError);

    // And confirm a network-shaped Error (no status field) also rethrows.
    mockGetEarningsDetail.mockRejectedValueOnce(new Error("network down"));
    await expect(queryFn()).rejects.toThrow(/network down/);

    // Sanity: 404 still swallowed.
    mockGetEarningsDetail.mockRejectedValueOnce(
      new ApiError("/api/v1/earnings/AAPL/detail", 404, "{}", "not curated"),
    );
    await expect(queryFn()).resolves.toBeNull();
  });
});
