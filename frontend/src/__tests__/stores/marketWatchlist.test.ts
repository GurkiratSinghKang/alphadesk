import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the api module BEFORE the store is imported. The store captures
// these references at module-load time so the mocks must be in place
// first; vi.mock is hoisted to the top of the file by the vitest
// transformer so this ordering works regardless of import position.
vi.mock("@/lib/api", () => ({
  getUserWatchlist: vi.fn(),
  addToUserWatchlist: vi.fn(),
  removeFromUserWatchlist: vi.fn(),
}));

import { useMarketStore } from "@/stores/market";
import * as api from "@/lib/api";

const mockedGetUserWatchlist = vi.mocked(api.getUserWatchlist);
const mockedAddToUserWatchlist = vi.mocked(api.addToUserWatchlist);
const mockedRemoveFromUserWatchlist = vi.mocked(api.removeFromUserWatchlist);

beforeEach(() => {
  // Reset store state so each test starts with a known baseline.
  useMarketStore.setState({
    watchlist: [],
    quotes: {},
    selectedSymbol: "SPY",
    freshestTs: 0,
  });
  mockedGetUserWatchlist.mockReset();
  mockedAddToUserWatchlist.mockReset();
  mockedRemoveFromUserWatchlist.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Wait for any pending microtasks to flush so fire-and-forget promises settle. */
async function flushMicrotasks(): Promise<void> {
  // Two ticks — the store fires `then`/`catch` on the API promise and
  // each handler does a setState; both happen in microtasks.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("market store — watchlist optimistic + server sync (iter 17)", () => {
  it("addToWatchlist optimistically updates local state synchronously", () => {
    // Server sync resolves with the same symbol so the post-flush state
    // matches what the optimistic update wrote — but the SYNC effect
    // is what this test pins down.
    mockedAddToUserWatchlist.mockResolvedValue({
      symbols: ["NVDA"],
      asOf: "2026-05-07T12:00:00Z",
    });

    useMarketStore.getState().addToWatchlist("NVDA");

    // BEFORE any await — local state must already include NVDA so the
    // HeroCTAs button (which reads sync state right after click) sees
    // it. This is the core invariant iter 15 test depends on.
    expect(useMarketStore.getState().watchlist).toContain("NVDA");
    expect(mockedAddToUserWatchlist).toHaveBeenCalledWith("NVDA");
  });

  it("addToWatchlist falls back to local-only on server failure", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedAddToUserWatchlist.mockRejectedValue(new Error("offline"));

    useMarketStore.getState().addToWatchlist("NVDA");
    // Optimistic add lands synchronously.
    expect(useMarketStore.getState().watchlist).toContain("NVDA");

    await flushMicrotasks();

    // After the rejected promise resolves, the local state is preserved
    // (the optimistic add is NOT rolled back) and a console.warn fires
    // so the dev surfaces the sync failure.
    expect(useMarketStore.getState().watchlist).toContain("NVDA");
    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls[0][0]).toContain("[watchlist]");
  });

  it("addToWatchlist replaces local list with server's authoritative ordering on success", async () => {
    // Server returns a sorted list — the local optimistic copy should
    // be replaced with the server's ordering once the promise settles.
    mockedAddToUserWatchlist.mockResolvedValue({
      symbols: ["AAPL", "MSFT", "NVDA"],
      asOf: "2026-05-07T12:00:00Z",
    });

    // Pre-populate local state with an out-of-order list to detect
    // whether the post-resolve setState replaces it correctly.
    useMarketStore.setState({ watchlist: ["MSFT", "AAPL"] });

    useMarketStore.getState().addToWatchlist("NVDA");
    expect(useMarketStore.getState().watchlist).toEqual(["MSFT", "AAPL", "NVDA"]);

    await flushMicrotasks();

    // Server's sorted ordering wins.
    expect(useMarketStore.getState().watchlist).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("removeFromWatchlist optimistically updates + replaces with server state on success", async () => {
    mockedRemoveFromUserWatchlist.mockResolvedValue({
      symbols: ["AAPL"],
      asOf: "2026-05-07T12:00:00Z",
    });

    useMarketStore.setState({ watchlist: ["AAPL", "NVDA"] });

    useMarketStore.getState().removeFromWatchlist("NVDA");

    // Local optimistic removal is synchronous.
    expect(useMarketStore.getState().watchlist).toEqual(["AAPL"]);
    expect(mockedRemoveFromUserWatchlist).toHaveBeenCalledWith("NVDA");

    await flushMicrotasks();

    // Server's authoritative list wins after the round-trip.
    expect(useMarketStore.getState().watchlist).toEqual(["AAPL"]);
  });

  it("removeFromWatchlist keeps the local optimistic state on server failure", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedRemoveFromUserWatchlist.mockRejectedValue(new Error("offline"));

    useMarketStore.setState({ watchlist: ["AAPL", "NVDA"] });

    useMarketStore.getState().removeFromWatchlist("NVDA");
    expect(useMarketStore.getState().watchlist).toEqual(["AAPL"]);

    await flushMicrotasks();

    // The optimistic removal stays in place — we don't restore NVDA
    // even though the server didn't confirm.
    expect(useMarketStore.getState().watchlist).toEqual(["AAPL"]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("hydrateFromServer replaces local state when authenticated", async () => {
    mockedGetUserWatchlist.mockResolvedValue({
      symbols: ["AAPL", "NVDA", "TSLA"],
      asOf: "2026-05-07T12:00:00Z",
    });

    useMarketStore.setState({ watchlist: ["MSFT"] });

    await useMarketStore.getState().hydrateFromServer(true);

    expect(useMarketStore.getState().watchlist).toEqual([
      "AAPL",
      "NVDA",
      "TSLA",
    ]);
    expect(mockedGetUserWatchlist).toHaveBeenCalledTimes(1);
  });

  it("hydrateFromServer is a no-op when unauthenticated", async () => {
    useMarketStore.setState({ watchlist: ["MSFT", "AAPL"] });

    await useMarketStore.getState().hydrateFromServer(false);

    // Local state untouched, no server call.
    expect(useMarketStore.getState().watchlist).toEqual(["MSFT", "AAPL"]);
    expect(mockedGetUserWatchlist).not.toHaveBeenCalled();
  });

  it("hydrateFromServer keeps local copy on server failure", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedGetUserWatchlist.mockRejectedValue(new Error("503"));

    useMarketStore.setState({ watchlist: ["MSFT", "AAPL"] });

    await useMarketStore.getState().hydrateFromServer(true);

    // Local watchlist stays — we don't blank it on a transient outage.
    expect(useMarketStore.getState().watchlist).toEqual(["MSFT", "AAPL"]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("addToWatchlist normalizes lowercase to uppercase on the local optimistic add", () => {
    mockedAddToUserWatchlist.mockResolvedValue({
      symbols: ["NVDA"],
      asOf: "2026-05-07T12:00:00Z",
    });

    useMarketStore.getState().addToWatchlist("nvda");

    expect(useMarketStore.getState().watchlist).toContain("NVDA");
    // The api wrapper itself uppercases on its end, but the store's
    // optimistic copy must also be upper so consumers checking
    // ``watchlist.includes(SYMBOL.toUpperCase())`` work consistently
    // (this is what HeroCTAs does).
    expect(mockedAddToUserWatchlist).toHaveBeenCalledWith("NVDA");
  });
});
