import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { Quote } from "@/types";

import { StickyBand } from "../_sections/StickyBand";

const NOW = new Date("2026-05-05T20:30:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "NVDA",
    last: 935.42,
    bid: 935.4,
    ask: 935.45,
    change: 12.13,
    changePct: 1.31,
    volume: 38_125_000,
    high: 940.0,
    low: 928.5,
    open: 930.0,
    close: 923.29,
    timestamp: NOW.getTime(),
    ...overrides,
  };
}

describe("StickyBand", () => {
  it("renders the TickerPriceDisplay primitive with the regular-session price + delta", () => {
    const quote = makeQuote();
    const { container, getByTestId } = render(
      <StickyBand symbol="NVDA" quote={quote} />,
    );

    expect(getByTestId("sticky-band")).toBeInTheDocument();

    const priceWrapper = container.querySelector(
      "[data-slot='ticker-price-display']",
    );
    expect(priceWrapper).not.toBeNull();
    expect(priceWrapper?.textContent).toContain("$935.42");
  });

  it("links the Trade button to /trade?symbol={sym}", () => {
    const quote = makeQuote({ symbol: "AAPL", last: 250.11 });
    const { getByTestId } = render(
      <StickyBand symbol="AAPL" quote={quote} />,
    );

    const trade = getByTestId("hero-cta-trade");
    expect(trade.tagName.toLowerCase()).toBe("a");
    expect(trade.getAttribute("href")).toBe("/trade?symbol=AAPL");
    expect(trade.textContent).toContain("Trade AAPL");
  });

  it("encodes the symbol in the Trade href so dot/dash tickers stay URL-safe", () => {
    const { getByTestId } = render(
      <StickyBand symbol="BRK.B" quote={makeQuote({ symbol: "BRK.B" })} />,
    );
    expect(getByTestId("hero-cta-trade").getAttribute("href")).toBe(
      "/trade?symbol=BRK.B",
    );
  });

  it("renders the skeleton state when no quote is passed (loading)", () => {
    const { getByTestId, container } = render(
      <StickyBand symbol="NVDA" quote={null} />,
    );

    expect(getByTestId("sticky-band-skeleton")).toBeInTheDocument();
    expect(
      container.querySelector("[data-slot='ticker-price-display']"),
    ).toBeNull();
    expect(getByTestId("sticky-band-skeleton").getAttribute("aria-busy")).toBe(
      "true",
    );
  });

  it("treats undefined quote the same as null (defensive — pre-fetch first paint)", () => {
    const { getByTestId } = render(
      <StickyBand symbol="NVDA" quote={undefined} />,
    );
    expect(getByTestId("sticky-band-skeleton")).toBeInTheDocument();
  });

  it("links the 'Run agents' CTA to the trading-agents-research page with ?symbol", () => {
    // iter 15: was disabled in MVP; now navigates to the trading-agents
    // research workflow that shipped in iter 12 (PR #76), pre-filling
    // the symbol via query param so the landing page lands ready-to-run.
    const { getByTestId } = render(
      <StickyBand symbol="NVDA" quote={makeQuote()} />,
    );
    const runAgents = getByTestId("hero-cta-run-agents");
    expect(runAgents).not.toBeDisabled();
    expect(runAgents.tagName.toLowerCase()).toBe("a");
    expect(runAgents.getAttribute("href")).toBe(
      "/strategies/trading-agents-research?symbol=NVDA",
    );
    expect(runAgents.textContent).toContain("Run agents");
  });

  it("uses a sticky positioning class on the host element", () => {
    const { getByTestId } = render(
      <StickyBand symbol="NVDA" quote={makeQuote()} />,
    );
    const band = getByTestId("sticky-band");
    expect(band.className).toContain("sticky");
    expect(band.className).toContain("top-0");
    expect(band.className).toContain("backdrop-blur-md");
    expect(band.className).toContain("z-30");
  });

  it("renders the AH/PM secondary line when the embedded extended-hours data is fresh", () => {
    const ahTradeIso = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
    const quote = makeQuote({
      extended_price: 940.5,
      extended_change: 5.08,
      extended_change_pct: 0.54,
      extended_session: "post",
      last_trade_time: ahTradeIso,
    });
    const { container } = render(
      <StickyBand symbol="NVDA" quote={quote} />,
    );
    const secondary = container.querySelector(
      "[data-slot='extended-hours-secondary']",
    );
    expect(secondary).not.toBeNull();
    expect(secondary?.textContent).toContain("After Hours");
  });
});
