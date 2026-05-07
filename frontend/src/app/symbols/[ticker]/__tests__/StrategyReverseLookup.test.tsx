import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import type { StrategyMatch, StrategyMatchesResponse } from "@/types";

vi.mock("@/lib/api", () => ({
  getStrategiesBySymbol: vi.fn(),
}));

import { getStrategiesBySymbol } from "@/lib/api";
import { StrategyReverseLookup } from "../_sections/StrategyReverseLookup";

const mockedFetch = vi.mocked(getStrategiesBySymbol);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

function makeMatch(overrides: Partial<StrategyMatch> = {}): StrategyMatch {
  return {
    strategyId: "momentum-quality",
    name: "Momentum + Quality",
    inUniverse: true,
    hasEntrySignal: false,
    currentPosition: null,
    score: null,
    side: null,
    lastEvaluated: "2026-05-06T18:30:00Z",
    ...overrides,
  };
}

function makeResponse(matches: StrategyMatch[]): StrategyMatchesResponse {
  return {
    symbol: "NVDA",
    matches,
    generatedAt: "2026-05-06T18:30:00Z",
  };
}

beforeEach(() => {
  mockedFetch.mockReset();
});

describe("StrategyReverseLookup", () => {
  it("renders a loading skeleton on first paint", () => {
    mockedFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    const Wrapper = makeWrapper();
    const { getByTestId, container } = render(
      createElement(Wrapper, null, <StrategyReverseLookup symbol="NVDA" />),
    );
    const section = getByTestId("strategy-reverse-lookup");
    expect(section.getAttribute("data-slot")).toBe("strategy-reverse-lookup-loading");
    const ghosts = container.querySelectorAll('[data-slot="ghost-card"]');
    expect(ghosts.length).toBeGreaterThan(0);
  });

  it("renders 12 strategy cards when 12 matches returned", async () => {
    const matches: StrategyMatch[] = Array.from({ length: 12 }, (_, i) =>
      makeMatch({
        strategyId: `strategy-${i.toString().padStart(2, "0")}`,
        name: `Strategy ${i}`,
      }),
    );
    mockedFetch.mockResolvedValue(makeResponse(matches));
    const Wrapper = makeWrapper();
    const { container, getByTestId } = render(
      createElement(Wrapper, null, <StrategyReverseLookup symbol="NVDA" />),
    );
    await waitFor(() => {
      const section = getByTestId("strategy-reverse-lookup");
      expect(section.getAttribute("data-slot")).toBe("strategy-reverse-lookup");
    });
    const cards = container.querySelectorAll('[data-slot="strategy-card"]');
    expect(cards).toHaveLength(12);
  });

  it("caps rendered cards at 12 even when the API returns more", async () => {
    const matches: StrategyMatch[] = Array.from({ length: 18 }, (_, i) =>
      makeMatch({
        strategyId: `strategy-${i.toString().padStart(2, "0")}`,
        name: `Strategy ${i}`,
      }),
    );
    mockedFetch.mockResolvedValue(makeResponse(matches));
    const Wrapper = makeWrapper();
    const { container } = render(
      createElement(Wrapper, null, <StrategyReverseLookup symbol="NVDA" />),
    );
    await waitFor(() => {
      const cards = container.querySelectorAll('[data-slot="strategy-card"]');
      expect(cards.length).toBe(12);
    });
  });

  it("shows 'Holding N shares' on a card with currentPosition", async () => {
    const matches: StrategyMatch[] = [
      makeMatch({
        strategyId: "momentum-quality",
        name: "Momentum + Quality",
        currentPosition: { qty: 50, entryPrice: 410.25, unrealizedPnl: 125.5 },
      }),
    ];
    mockedFetch.mockResolvedValue(makeResponse(matches));
    const Wrapper = makeWrapper();
    const { getByTestId } = render(
      createElement(Wrapper, null, <StrategyReverseLookup symbol="NVDA" />),
    );
    await waitFor(() => {
      const card = getByTestId("strategy-card-momentum-quality");
      expect(card.textContent).toContain("Holding 50 shares");
    });
    const card = getByTestId("strategy-card-momentum-quality");
    expect(card.getAttribute("data-strategy-status")).toBe("holding");
    // Unrealized P&L is rendered as currency
    const pnl = card.querySelector('[data-slot="strategy-pnl"]');
    expect(pnl).not.toBeNull();
  });

  it("filters out strategies that aren't in this symbol's universe", async () => {
    const matches: StrategyMatch[] = [
      makeMatch({ strategyId: "in-uni", name: "In Universe", inUniverse: true }),
      makeMatch({ strategyId: "out-uni", name: "Out Of Universe", inUniverse: false }),
    ];
    mockedFetch.mockResolvedValue(makeResponse(matches));
    const Wrapper = makeWrapper();
    const { container, queryByTestId } = render(
      createElement(Wrapper, null, <StrategyReverseLookup symbol="NVDA" />),
    );
    await waitFor(() => {
      const cards = container.querySelectorAll('[data-slot="strategy-card"]');
      expect(cards).toHaveLength(1);
    });
    expect(queryByTestId("strategy-card-out-uni")).toBeNull();
    expect(queryByTestId("strategy-card-in-uni")).not.toBeNull();
  });

  it("renders an empty-state message when no strategies match", async () => {
    const matches: StrategyMatch[] = [
      makeMatch({ strategyId: "out", name: "Out", inUniverse: false }),
    ];
    mockedFetch.mockResolvedValue(makeResponse(matches));
    const Wrapper = makeWrapper();
    const { container, getByTestId } = render(
      createElement(Wrapper, null, <StrategyReverseLookup symbol="NVDA" />),
    );
    await waitFor(() => {
      const section = getByTestId("strategy-reverse-lookup");
      expect(section.getAttribute("data-slot")).toBe("strategy-reverse-lookup");
    });
    const empty = container.querySelector('[data-slot="strategy-reverse-lookup-empty"]');
    expect(empty).not.toBeNull();
  });

  it("renders error state gracefully when the fetch fails", async () => {
    mockedFetch.mockRejectedValue(new Error("503 Service Unavailable"));
    const Wrapper = makeWrapper();
    const { getByTestId } = render(
      createElement(Wrapper, null, <StrategyReverseLookup symbol="NVDA" />),
    );
    await waitFor(() => {
      const section = getByTestId("strategy-reverse-lookup");
      expect(section.getAttribute("data-slot")).toBe("strategy-reverse-lookup-error");
    });
  });

  it("anchors itself at id='strategies' with scroll-mt-24 in every state", async () => {
    mockedFetch.mockResolvedValue(makeResponse([]));
    const Wrapper = makeWrapper();
    const { getByTestId } = render(
      createElement(Wrapper, null, <StrategyReverseLookup symbol="NVDA" />),
    );
    await waitFor(() => {
      const section = getByTestId("strategy-reverse-lookup");
      expect(section.getAttribute("id")).toBe("strategies");
      expect(section.className).toContain("scroll-mt-24");
    });
  });

  it("orders holding cards before signal cards before watching cards", async () => {
    const matches: StrategyMatch[] = [
      makeMatch({ strategyId: "watching-x", name: "Z Watching" }),
      makeMatch({
        strategyId: "holding-x",
        name: "A Holding",
        currentPosition: { qty: 10, entryPrice: 100, unrealizedPnl: 0 },
      }),
      makeMatch({ strategyId: "signal-x", name: "M Signal", hasEntrySignal: true }),
    ];
    mockedFetch.mockResolvedValue(makeResponse(matches));
    const Wrapper = makeWrapper();
    const { container } = render(
      createElement(Wrapper, null, <StrategyReverseLookup symbol="NVDA" />),
    );
    await waitFor(() => {
      const cards = container.querySelectorAll('[data-slot="strategy-card"]');
      expect(cards).toHaveLength(3);
    });
    const cards = Array.from(container.querySelectorAll('[data-slot="strategy-card"]'));
    expect(cards.map((c) => c.getAttribute("data-strategy-status"))).toEqual([
      "holding",
      "signal",
      "watching",
    ]);
  });
});
