import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the api module so the market store's import surface is safe to
// touch at module load. The store captures these references at module-
// load time so the mocks must be registered before the import below.
vi.mock("@/lib/api", () => ({
  getUserWatchlist: vi.fn(),
  addToUserWatchlist: vi.fn(),
  removeFromUserWatchlist: vi.fn(),
}));

import {
  clearPersistedStores,
  PERSIST_KEYS_TO_CLEAR,
} from "@/lib/auth/clearPersistedStores";
import { useMarketStore, DEFAULT_WATCHLIST } from "@/stores/market";
import { useNotificationsStore } from "@/stores/notifications";
import { usePreferencesStore } from "@/stores/preferences";
import { useUIStore } from "@/stores/ui";

beforeEach(() => {
  // Each test starts with a known dirty state — pollute everything we
  // expect the helper to clean up. Tests then assert the cleanup landed.
  localStorage.clear();
  for (const key of PERSIST_KEYS_TO_CLEAR) {
    localStorage.setItem(key, "polluting-value");
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clearPersistedStores — cross-user data-leak fix", () => {
  it("removes all known persist keys from localStorage", () => {
    // Pre-condition: every key was just seeded by beforeEach.
    for (const key of PERSIST_KEYS_TO_CLEAR) {
      expect(localStorage.getItem(key)).toBe("polluting-value");
    }

    clearPersistedStores();

    for (const key of PERSIST_KEYS_TO_CLEAR) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("includes all 4 zustand persist keys in the cleared set", () => {
    // Belt-and-braces against typo regression: enumerate the canonical
    // names and prove each one appears in the helper's wipe list. If the
    // store renames its `name`, this test forces the helper update too.
    expect(PERSIST_KEYS_TO_CLEAR).toContain("alphadesk-watchlist");
    expect(PERSIST_KEYS_TO_CLEAR).toContain("alphadesk-notifications");
    expect(PERSIST_KEYS_TO_CLEAR).toContain("alphadesk-preferences");
    expect(PERSIST_KEYS_TO_CLEAR).toContain("alphadesk-ui");
  });

  it("key-set sanity: the canonical wipe list has the expected size", () => {
    // Sanity check: when someone adds or removes a key, this assertion
    // forces an explicit decision rather than silently accepting drift.
    // Current set: 4 zustand persist stores + 2 aux prefs + 6 high-
    // privacy per-user keys (iter 20 follow-up) = 12.
    expect(PERSIST_KEYS_TO_CLEAR).toHaveLength(12);
  });

  it("wipes trade journal on logout (highest-risk privacy)", () => {
    // The trade journal stores free-form user notes — by far the most
    // sensitive of the per-user localStorage keys. If a previous user's
    // notes survive logout on a shared browser, the next user can read
    // them on the next mount of TradePanel. Lock this in explicitly so a
    // future refactor can't silently drop the journal from the wipe list.
    localStorage.setItem("alphadesk-journal", JSON.stringify([
      { id: "j1", content: "private trade thesis from user A", ts: 1 },
    ]));
    localStorage.setItem("journal-notes", "private freeform notes");
    localStorage.setItem("journal-tags", JSON.stringify(["private-tag"]));

    // Pre-condition: all three journal keys present.
    expect(localStorage.getItem("alphadesk-journal")).not.toBeNull();
    expect(localStorage.getItem("journal-notes")).not.toBeNull();
    expect(localStorage.getItem("journal-tags")).not.toBeNull();

    clearPersistedStores();

    expect(localStorage.getItem("alphadesk-journal")).toBeNull();
    expect(localStorage.getItem("journal-notes")).toBeNull();
    expect(localStorage.getItem("journal-tags")).toBeNull();
  });

  it("wipes screener presets, strategy view, and workspace selection (per-user prefs)", () => {
    // Screener presets are saved filters per user; strategy view is a
    // per-user grid mode; workspace selection routes the whole layout.
    // None are catastrophic on their own but each fingerprints the
    // previous user, so we wipe them along with the journal.
    localStorage.setItem("alphadesk-screener-presets", JSON.stringify([{ name: "user-a-preset" }]));
    localStorage.setItem("alphadesk-strategy-view", "grid");
    localStorage.setItem("alphadesk-workspace", "user-a-workspace");

    clearPersistedStores();

    expect(localStorage.getItem("alphadesk-screener-presets")).toBeNull();
    expect(localStorage.getItem("alphadesk-strategy-view")).toBeNull();
    expect(localStorage.getItem("alphadesk-workspace")).toBeNull();
  });

  it("resets useMarketStore.watchlist to DEFAULT_WATCHLIST", () => {
    // Seed pollution: in-memory state for the previous user.
    useMarketStore.setState({
      watchlist: ["LEAK", "USERA-ONLY"],
      selectedSymbol: "LEAK",
      quotes: {
        LEAK: {
          symbol: "LEAK",
          last: 100,
          bid: 99,
          ask: 101,
          volume: 1,
          high: 100,
          low: 99,
          open: 100,
          close: 100,
          change: 0,
          changePct: 0,
          timestamp: Date.now(),
        },
      },
      groupSymbols: { 1: "LEAK", 2: "LEAK", 3: "LEAK", 4: "LEAK" },
      freshestTs: 9_999_999,
    });

    clearPersistedStores();

    const after = useMarketStore.getState();
    expect(after.watchlist).toEqual(DEFAULT_WATCHLIST);
    expect(after.selectedSymbol).toBe("SPY");
    expect(after.quotes).toEqual({});
    expect(after.freshestTs).toBe(0);
    expect(after.groupSymbols).toEqual({ 1: "SPY", 2: "SPY", 3: "SPY", 4: "SPY" });
  });

  it("resets useNotificationsStore to its zero state (no leaked unread alerts)", () => {
    // Seed pollution: an unread alert from the previous user. The bug
    // report calls these out explicitly — user A's unread alert messages
    // were flashing for user B before the hydrate replaced them.
    useNotificationsStore.setState({
      notifications: [
        {
          id: "n1",
          category: "alerts",
          title: "USER A PRIVATE ALERT",
          detail: "Should not leak to user B",
          timestamp: Date.now(),
          read: false,
        },
      ],
    });
    expect(useNotificationsStore.getState().notifications).toHaveLength(1);

    clearPersistedStores();

    expect(useNotificationsStore.getState().notifications).toEqual([]);
  });

  it("resets usePreferencesStore to its zero state (display + data + notifications)", () => {
    // Seed pollution: every persisted slice carries a non-default value.
    usePreferencesStore.setState({
      display: {
        tickerTapeOn: true,
        compactStrategyView: true,
        theme: "light",
        density: "dense",
      },
      data: { refreshInterval: 60 },
      notifications: {
        orderFills: false,
        alertsTriggered: false,
        pipelineCompleted: false,
        strategyEvents: false,
      },
    });

    clearPersistedStores();

    const after = usePreferencesStore.getState();
    // Match the canonical defaults declared in stores/preferences.ts.
    expect(after.display.theme).toBe("dark");
    expect(after.display.tickerTapeOn).toBe(false);
    expect(after.display.compactStrategyView).toBe(false);
    expect(after.data.refreshInterval).toBe(30);
    expect(after.notifications.orderFills).toBe(true);
    expect(after.notifications.alertsTriggered).toBe(true);
    expect(after.notifications.pipelineCompleted).toBe(true);
  });

  it("resets useUIStore.tradingMode and panel layout to canonical zero state", () => {
    useUIStore.setState({
      tradingMode: "live",
      sidebarCollapsed: true,
      commandPaletteOpen: true,
      theme: "light",
      activePanels: {
        left: "leak",
        center: "leak",
        right: "leak",
        bottom: "leak",
      },
    });

    clearPersistedStores();

    const after = useUIStore.getState();
    expect(after.tradingMode).toBe("paper");
    expect(after.sidebarCollapsed).toBe(false);
    expect(after.commandPaletteOpen).toBe(false);
    expect(after.theme).toBe("dark");
    expect(after.activePanels).toEqual({
      left: "watchlist",
      center: "chart",
      right: "technical",
      bottom: "trade",
    });
  });

  it("swallows storage-quota / SecurityError from removeItem so sign-out never throws", () => {
    // Mirror Safari Private Mode: every `removeItem` throws. The helper
    // must keep going rather than bubbling the error up to the caller —
    // the ProfileMenu logout flow ALWAYS needs to redirect, even if the
    // browser refuses to mutate localStorage.
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const removeSpy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      });

    expect(() => clearPersistedStores()).not.toThrow();

    // Each per-user key was attempted — proves we didn't abort on first throw.
    expect(removeSpy).toHaveBeenCalledTimes(PERSIST_KEYS_TO_CLEAR.length);
    // And we surfaced a warning per failure (one per key).
    expect(consoleSpy).toHaveBeenCalled();

    // In-memory reset still ran despite the storage failures — the same-
    // tab paint must not see stale state regardless of localStorage
    // mutability.
    useMarketStore.setState({ watchlist: ["LEAK"] });
    // Re-run after pollution to verify the in-memory path is independent.
    clearPersistedStores();
    expect(useMarketStore.getState().watchlist).toEqual(DEFAULT_WATCHLIST);
  });
});
