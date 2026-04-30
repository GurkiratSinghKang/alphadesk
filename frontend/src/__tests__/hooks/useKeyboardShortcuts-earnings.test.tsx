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
  const onNext = () => {
    nextFired += 1;
  };
  const onPrev = () => {
    prevFired += 1;
  };

  beforeEach(() => {
    nextFired = 0;
    prevFired = 0;
    window.addEventListener("alphadesk:earnings-select-next", onNext);
    window.addEventListener("alphadesk:earnings-select-prev", onPrev);
  });

  afterEach(() => {
    window.removeEventListener("alphadesk:earnings-select-next", onNext);
    window.removeEventListener("alphadesk:earnings-select-prev", onPrev);
    currentPath = "/";
  });

  it("on /strategies/earnings-options-play, j dispatches earnings-select-next", () => {
    currentPath = "/strategies/earnings-options-play";
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });
    expect(nextFired).toBe(1);
  });

  it("on /strategies/earnings-options-play, k dispatches earnings-select-prev", () => {
    currentPath = "/strategies/earnings-options-play";
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    });
    expect(prevFired).toBe(1);
  });

  it("on /strategies/earnings-options-play, ArrowDown dispatches earnings-select-next", () => {
    currentPath = "/strategies/earnings-options-play";
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(nextFired).toBe(1);
  });

  it("on /strategies/earnings-options-play, ArrowUp dispatches earnings-select-prev", () => {
    currentPath = "/strategies/earnings-options-play";
    renderHook(() => useKeyboardShortcuts());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    });
    expect(prevFired).toBe(1);
  });

  it("does not steal ArrowDown from a focused select on the earnings page", () => {
    currentPath = "/strategies/earnings-options-play";
    renderHook(() => useKeyboardShortcuts());
    const select = document.createElement("select");
    document.body.appendChild(select);
    select.focus();
    act(() => {
      select.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(nextFired).toBe(0);
    select.remove();
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
