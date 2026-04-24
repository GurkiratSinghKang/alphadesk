import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Re-mock next/navigation for this file so we control pathname per-case.
let currentPath = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => currentPath,
}));
vi.mock("@/stores/ui", () => ({
  useUIStore: () => ({ setCommandPaletteOpen: vi.fn() }),
}));
vi.mock("@/stores/market", () => ({
  useMarketStore: {
    getState: () => ({
      watchlist: ["AAPL", "MSFT", "GOOG"],
      selectedSymbol: "AAPL",
      setSelectedSymbol: vi.fn(),
    }),
  },
}));

import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

describe("useKeyboardShortcuts — B-60 earnings j/k routing", () => {
  let nextFired = 0;
  let prevFired = 0;

  beforeEach(() => {
    nextFired = 0;
    prevFired = 0;
    window.addEventListener("alphadesk:earnings-select-next", () => {
      nextFired += 1;
    });
    window.addEventListener("alphadesk:earnings-select-prev", () => {
      prevFired += 1;
    });
  });

  afterEach(() => {
    currentPath = "/";
  });

  it("on /strategies/earnings-options-play, j dispatches earnings-select-next", () => {
    currentPath = "/strategies/earnings-options-play";
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });
    expect(nextFired).toBeGreaterThanOrEqual(1);
  });

  it("on /strategies/earnings-options-play, k dispatches earnings-select-prev", () => {
    currentPath = "/strategies/earnings-options-play";
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    });
    expect(prevFired).toBeGreaterThanOrEqual(1);
  });

  it("on /strategies/earnings-options-play, ArrowDown dispatches earnings-select-next", () => {
    currentPath = "/strategies/earnings-options-play";
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(nextFired).toBeGreaterThanOrEqual(1);
  });

  it("on /strategies/earnings-options-play, ArrowUp dispatches earnings-select-prev", () => {
    currentPath = "/strategies/earnings-options-play";
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    });
    expect(prevFired).toBeGreaterThanOrEqual(1);
  });

  it("on other routes, j does NOT dispatch earnings-select-next", () => {
    currentPath = "/";
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });
    expect(nextFired).toBe(0);
  });
});
