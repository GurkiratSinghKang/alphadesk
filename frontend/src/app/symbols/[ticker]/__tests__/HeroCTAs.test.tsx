import "../../../../__tests__/setup-mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { useMarketStore } from "@/stores/market";

import { HeroCTAs } from "../_sections/HeroCTAs";

// The market store is a zustand singleton. setup-mocks already mocks
// `useToast` to a no-op so we can render without a ToastProvider; we
// just need to seed/clear `watchlist` between tests so each test sees
// a known starting state.
beforeEach(() => {
  useMarketStore.setState({
    watchlist: [],
    quotes: {},
    selectedSymbol: "SPY",
    freshestTs: 0,
  });
});

afterEach(() => {
  useMarketStore.setState({
    watchlist: [],
    quotes: {},
    selectedSymbol: "SPY",
    freshestTs: 0,
  });
});

describe("HeroCTAs", () => {
  it("renders the ticker CTAs and the directory link", () => {
    const { getByTestId } = render(<HeroCTAs symbol="NVDA" />);
    expect(getByTestId("hero-cta-trade")).toBeInTheDocument();
    expect(getByTestId("hero-cta-watch")).toBeInTheDocument();
    expect(getByTestId("hero-cta-run-agents")).toBeInTheDocument();
    expect(getByTestId("hero-cta-all-symbols")).toBeInTheDocument();
  });

  it("Watch button starts as 'Watch' when the symbol is not in the watchlist", () => {
    const { getByTestId } = render(<HeroCTAs symbol="NVDA" />);
    const watch = getByTestId("hero-cta-watch");
    expect(watch.textContent).toContain("Watch");
    expect(watch.textContent).not.toContain("Watching");
    expect(watch.getAttribute("data-watching")).toBeNull();
    expect(watch.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking Watch adds the symbol to the watchlist and flips label to 'Watching'", () => {
    const { getByTestId } = render(<HeroCTAs symbol="NVDA" />);
    const watch = getByTestId("hero-cta-watch");

    fireEvent.click(watch);

    expect(useMarketStore.getState().watchlist).toContain("NVDA");
    expect(watch.textContent).toContain("Watching");
    expect(watch.getAttribute("data-watching")).toBe("true");
    expect(watch.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking Watching removes the symbol and flips label back to 'Watch'", () => {
    useMarketStore.setState({ watchlist: ["NVDA"] });
    const { getByTestId } = render(<HeroCTAs symbol="NVDA" />);
    const watch = getByTestId("hero-cta-watch");
    expect(watch.textContent).toContain("Watching");

    fireEvent.click(watch);

    expect(useMarketStore.getState().watchlist).not.toContain("NVDA");
    expect(watch.textContent).toContain("Watch");
    expect(watch.textContent).not.toContain("Watching");
    expect(watch.getAttribute("data-watching")).toBeNull();
  });

  it("starts in the 'Watching' state when the symbol is pre-seeded in the watchlist", () => {
    useMarketStore.setState({ watchlist: ["AAPL", "NVDA", "SPY"] });
    const { getByTestId } = render(<HeroCTAs symbol="NVDA" />);
    const watch = getByTestId("hero-cta-watch");
    expect(watch.textContent).toContain("Watching");
    expect(watch.getAttribute("data-watching")).toBe("true");
  });

  it("compares against the upper-cased ticker so lowercase props still match watchlist entries", () => {
    useMarketStore.setState({ watchlist: ["NVDA"] });
    const { getByTestId } = render(<HeroCTAs symbol="nvda" />);
    const watch = getByTestId("hero-cta-watch");
    expect(watch.textContent).toContain("Watching");
  });

  it("Run agents button is enabled and links to /strategies/trading-agents-research?symbol={SYMBOL}", () => {
    const { getByTestId } = render(<HeroCTAs symbol="NVDA" />);
    const runAgents = getByTestId("hero-cta-run-agents");
    expect(runAgents).not.toBeDisabled();
    expect(runAgents.tagName.toLowerCase()).toBe("a");
    expect(runAgents.getAttribute("href")).toBe(
      "/strategies/trading-agents-research?symbol=NVDA",
    );
    expect(runAgents.textContent).toContain("Run agents");
    expect(runAgents.textContent).not.toContain("coming v1");
  });

  it("Run agents href uses the upper-cased symbol even if the prop is lowercase", () => {
    const { getByTestId } = render(<HeroCTAs symbol="nvda" />);
    const runAgents = getByTestId("hero-cta-run-agents");
    expect(runAgents.getAttribute("href")).toBe(
      "/strategies/trading-agents-research?symbol=NVDA",
    );
  });

  it("All symbols links back to the symbols directory", () => {
    const { getByTestId } = render(<HeroCTAs symbol="NVDA" />);
    const allSymbols = getByTestId("hero-cta-all-symbols");
    expect(allSymbols.tagName.toLowerCase()).toBe("a");
    expect(allSymbols.getAttribute("href")).toBe("/symbols");
  });
});
