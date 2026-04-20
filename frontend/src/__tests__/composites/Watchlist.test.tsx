import "../setup-mocks";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { Watchlist } from "@/components/composites/Watchlist";
import { useMarketStore } from "@/stores/market";
import type { Quote } from "@/types";

const SYMBOLS = [
  "SPY", "QQQ", "AAPL", "NVDA", "TSLA",
  "MSFT", "META", "AMZN", "GOOGL", "AMD",
];

function mkQuote(symbol: string, last: number, changePct: number): Quote {
  return {
    symbol, last, changePct, change: 0,
    bid: last - 0.05, ask: last + 0.05,
    volume: 1_000_000, high: last, low: last,
    open: last, close: last, timestamp: Date.now(),
  };
}

beforeEach(() => {
  useMarketStore.setState({ selectedSymbol: "SPY", quotes: {}, watchlist: SYMBOLS });
});

describe("Watchlist", () => {
  it("renders one row per default symbol (10)", () => {
    const { container } = render(<Watchlist />);
    const rows = container.querySelectorAll('[data-slot="watchlist"] ul > li');
    expect(rows.length).toBe(10);
    for (const sym of SYMBOLS) {
      expect(container.textContent).toContain(sym);
    }
  });

  it("renders em-dash placeholders when a quote is missing", () => {
    const { container } = render(<Watchlist />);
    // No quotes were seeded → every row should show at least one em-dash.
    const dashes = container.textContent?.match(/—/g) ?? [];
    expect(dashes.length).toBeGreaterThanOrEqual(10);
  });

  it("clicking a row calls setSelectedSymbol", () => {
    const spy = vi.spyOn(useMarketStore.getState(), "setSelectedSymbol");
    // Re-set so the spied function is what the component reads.
    useMarketStore.setState({ setSelectedSymbol: spy as unknown as (s: string) => void });
    const { getByText } = render(<Watchlist />);
    fireEvent.click(getByText("NVDA"));
    expect(spy).toHaveBeenCalledWith("NVDA");
  });

  it("highlights the currently selected symbol", () => {
    const { container, rerender } = render(<Watchlist />);
    const spyBtn = container.querySelector('button[data-selected="true"]');
    expect(spyBtn?.textContent).toContain("SPY");
    act(() => {
      useMarketStore.setState({ selectedSymbol: "TSLA" });
    });
    rerender(<Watchlist />);
    const tslaBtn = container.querySelector('button[data-selected="true"]');
    expect(tslaBtn?.textContent).toContain("TSLA");
  });

  it("renders a price when a quote is present", () => {
    act(() => {
      useMarketStore.getState().updateQuote(mkQuote("SPY", 482.91, 1.31));
    });
    const { container } = render(<Watchlist />);
    expect(container.textContent).toContain("482.91");
  });
});
