/**
 * Regression test for BUG-059 — shared 5s response cache.
 *
 * `apiFetchShared` in `lib/api.ts` dedups in-flight requests + caches
 * resolved responses for 5 seconds for a curated allow-list of GET
 * endpoints (`/api/v1/portfolio/summary`, `/api/v1/trades/positions`,
 * `/api/v1/trades/orders`).
 *
 * Without these tests, a future refactor of `apiFetchShared` could
 * silently re-introduce the cross-page price/P&L drift (BUG-001
 * regression family) that the cache was added to kill.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { __clearSharedGetCacheForTests, getPortfolioSummary, getPositions } from "@/lib/api";

describe("BUG-059 — shared response cache for portfolio endpoints", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    __clearSharedGetCacheForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    __clearSharedGetCacheForTests();
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("getPortfolioSummary dedups concurrent callers within the window", async () => {
    let calls = 0;
    const fakePayload = {
      equity: 100_000,
      cash: 50_000,
      buying_power: 200_000,
      total_market_value: 50_000,
      unrealized_pnl: 0,
      unrealized_pnl_pct: 0,
      realized_pnl_today: 0,
      positions_count: 0,
    };
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify(fakePayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    // Two concurrent callers — should hit fetch ONCE thanks to
    // in-flight dedup.
    const [a, b] = await Promise.all([
      getPortfolioSummary(),
      getPortfolioSummary(),
    ]);
    expect(calls).toBe(1);
    // Both callers get the same logical snapshot.
    expect(a.equity).toBe(b.equity);
    expect(a.equity).toBe(100_000);
  });

  it("getPortfolioSummary serves cached value to a third caller within 5s", async () => {
    let calls = 0;
    let nextEquity = 100_000;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      const payload = {
        equity: nextEquity,
        cash: 50_000,
        buying_power: 200_000,
        total_market_value: 50_000,
        unrealized_pnl: 0,
        unrealized_pnl_pct: 0,
        realized_pnl_today: 0,
        positions_count: 0,
      };
      nextEquity += 1_000; // each network call gives a different value
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const first = await getPortfolioSummary();
    expect(calls).toBe(1);
    // 1 second later — still within the 5s TTL.
    vi.advanceTimersByTime(1_000);
    const second = await getPortfolioSummary();
    // The cache should serve the same value; no second network call.
    expect(calls).toBe(1);
    expect(second.equity).toBe(first.equity);
  });

  it("getPositions also dedups (same cache, different path)", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await Promise.all([getPositions(), getPositions(), getPositions()]);
    // Three concurrent calls → still ONE network call thanks to dedup.
    expect(calls).toBe(1);
  });
});
