import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock @/lib/api BEFORE the store is imported. The store captures these
// references at module-load time so the mocks must be in place first;
// vi.mock is hoisted to the top of the file by the vitest transformer
// so this ordering works regardless of import position.
vi.mock("@/lib/api", () => ({
  getUserWatchlist: vi.fn(),
  addToUserWatchlist: vi.fn(),
  removeFromUserWatchlist: vi.fn(),
}));

import { DEFAULT_WATCHLIST, useMarketStore } from "@/stores/market";
import * as api from "@/lib/api";

const mockedGetUserWatchlist = vi.mocked(api.getUserWatchlist);

// Reset the store to a clean, pre-hydration baseline before each test.
// Mirrors the canonical initial state of the persisted slice so we
// exercise the same `hydrated: false` starting point a fresh browser
// session would see.
beforeEach(() => {
  useMarketStore.setState({
    watchlist: DEFAULT_WATCHLIST,
    quotes: {},
    selectedSymbol: "SPY",
    freshestTs: 0,
    hydrated: false,
  });
  mockedGetUserWatchlist.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("market store — watchlist hydration flag (iter 23)", () => {
  it("initial state has hydrated: false", () => {
    // The factory inside create() seeds hydrated=false; we set it
    // explicitly in beforeEach to defend against bleed from prior tests
    // in the same vitest worker.
    expect(useMarketStore.getState().hydrated).toBe(false);
  });

  it("successful hydrateFromServer(true) flips hydrated to true and replaces watchlist", async () => {
    mockedGetUserWatchlist.mockResolvedValue({
      symbols: ["AAPL", "NVDA", "TSLA"],
      asOf: "2026-05-11T12:00:00Z",
    });

    expect(useMarketStore.getState().hydrated).toBe(false);

    await useMarketStore.getState().hydrateFromServer(true);

    const after = useMarketStore.getState();
    expect(after.hydrated).toBe(true);
    expect(after.watchlist).toEqual(["AAPL", "NVDA", "TSLA"]);
    expect(mockedGetUserWatchlist).toHaveBeenCalledTimes(1);
  });

  it("server returns empty list → watchlist becomes empty (server authoritative, not stale local)", async () => {
    // Power-user scenario: the user removed every symbol via another
    // device. Server reply is `symbols: []`. The pre-iter-23 store
    // happily assigned through, but if the server-empty case were ever
    // gated on `symbols.length > 0` the user would see stale local
    // data. Pin the empty-wins behaviour with an explicit test.
    mockedGetUserWatchlist.mockResolvedValue({
      symbols: [],
      asOf: "2026-05-11T12:00:00Z",
    });

    useMarketStore.setState({
      watchlist: ["MSFT", "GOOGL", "STALE"],
      hydrated: false,
    });

    await useMarketStore.getState().hydrateFromServer(true);

    const after = useMarketStore.getState();
    expect(after.watchlist).toEqual([]);
    expect(after.hydrated).toBe(true);
  });

  it("server failure preserves local watchlist but still flips hydrated to true (no infinite loading)", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedGetUserWatchlist.mockRejectedValue(new Error("503"));

    useMarketStore.setState({
      watchlist: ["MSFT", "AAPL"],
      hydrated: false,
    });

    await useMarketStore.getState().hydrateFromServer(true);

    const after = useMarketStore.getState();
    // Local list is preserved on transient outage.
    expect(after.watchlist).toEqual(["MSFT", "AAPL"]);
    // But the hydrated flag flips so consumers come out of the
    // skeleton — an infinite loading state on a 5xx is a worse UX
    // than showing the persisted list.
    expect(after.hydrated).toBe(true);
    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls[0][0]).toContain("[watchlist]");
  });

  it("hydrateFromServer(false) (unauthenticated) flips hydrated immediately, watchlist unchanged", async () => {
    useMarketStore.setState({
      watchlist: ["LOCAL-ONLY"],
      hydrated: false,
    });

    await useMarketStore.getState().hydrateFromServer(false);

    const after = useMarketStore.getState();
    // No server call expected on the unauth path; the local /
    // persisted copy is kept as a per-browser fallback.
    expect(after.watchlist).toEqual(["LOCAL-ONLY"]);
    expect(mockedGetUserWatchlist).not.toHaveBeenCalled();
    // Crucially: hydrated flips to true so the public/login surfaces
    // don't sit forever in the loading skeleton.
    expect(after.hydrated).toBe(true);
  });
});
