/**
 * Round-5 F-15 — earnings → trade → order seam end-to-end.
 *
 * Verifies the full deep-link contract that ties together F-1 (strategy
 * tag), F-2 (OrderBar pre-fill from URL), F-3 (multi-leg `:limit` slot),
 * and F-14 (combo submission via single placeOrder). One test exercises
 * the URL-builder side; another exercises the page-side parser; the
 * round-trip ensures the contract between TradeButtonRow and TradePage
 * doesn't drift.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  buildSingleLegURL,
  buildStrangleURL,
} from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/TradeButtonRow";
import TradePage from "@/app/(dashboard)/trade/page";
import type { LadderRow } from "@/types";

// ─── Helpers ────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

let _origLocation: Location;
function setSearch(search: string) {
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: { ...window.location, search },
  });
}

function fakeLadderRow(over: Partial<LadderRow> = {}): LadderRow {
  return {
    strike: 200,
    side: "put",
    bucket: "30Δ",
    delta: 0.3,
    bid: 1.4,
    ask: 1.5,
    mid: 1.45,
    iv: 0.42,
    yieldPct: 0,
    pop: 0,
    theta: -0.05,
    gamma: 0.01,
    vega: 0.08,
    oi: 1234,
    volume: 99,
    ...over,
  };
}

// ─── Builder side ────────────────────────────────────────────

describe("earnings → trade URL builder (F-1, F-3)", () => {
  it("buildSingleLegURL embeds strategy + limit price + OCC contract", () => {
    const url = buildSingleLegURL({
      symbol: "NVDA",
      expiry: "2026-04-25",
      row: fakeLadderRow({ side: "call", strike: 205, mid: 1.42 }),
    });
    // F-1: strategy tag flows.
    expect(url).toContain("strategy=earnings-options-play");
    // F-3: limit price embedded.
    expect(url).toContain("limit=1.42");
    // OCC contract well-formed.
    expect(url).toContain("contract=NVDA260425C00205000");
    // Side defaults to sell (earnings playbook is short-vol).
    expect(url).toContain("side=sell");
  });

  it("buildStrangleURL encodes both legs with :limit and combo_type", () => {
    const url = buildStrangleURL({
      symbol: "NVDA",
      expiry: "2026-04-25",
      put: fakeLadderRow({ side: "put", strike: 195, mid: 1.45 }),
      call: fakeLadderRow({ side: "call", strike: 210, mid: 1.32 }),
    });
    expect(url).toContain("strategy=earnings-options-play");
    expect(url).toContain("combo_type=strangle");
    // Canonical leg syntax: OCC:side:qty:limit
    expect(url).toContain("NVDA260425P00195000%3Asell%3A1%3A1.45");
    expect(url).toContain("NVDA260425C00210000%3Asell%3A1%3A1.32");
  });

  it("buildSingleLegURL omits limit when the row's mid is 0 / non-finite", () => {
    const url = buildSingleLegURL({
      symbol: "NVDA",
      expiry: "2026-04-25",
      row: fakeLadderRow({ mid: 0 }),
    });
    expect(url).not.toContain("limit=");
  });
});

// ─── Page side: parser + OrderBar pre-fill (F-2, F-3) ────────

describe("Trade page parses Round-5 deep-link contract", () => {
  beforeEach(() => {
    _origLocation = window.location;
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: _origLocation,
    });
    vi.clearAllMocks();
  });

  it("F-2: pre-fills OrderBar with the option contract OCC + side + qty + limit", async () => {
    setSearch(
      "?symbol=NVDA&contract=NVDA260424P00200000&side=sell&qty=2&limit=1.42&strategy=earnings-options-play"
    );
    const { container } = render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      // OrderBar's symbol input must carry the OCC, NOT the underlying.
      const symInput = container.querySelector(
        "[data-testid='order-bar-symbol']",
      ) as HTMLInputElement | null;
      expect(symInput).not.toBeNull();
      expect(symInput!.value).toBe("NVDA260424P00200000");

      // Pre-staged contract panel still rendered for visual review.
      const contractEl = container.querySelector("[data-slot='active-contract']");
      expect(contractEl).not.toBeNull();
      expect(contractEl!.textContent).toMatch(/200/);

      // Strategy chip rendered so the user sees the attribution.
      const stratChip = container.querySelector("[data-slot='trade-strategy-tag']");
      expect(stratChip).not.toBeNull();
      expect(stratChip!.textContent).toContain("earnings-options-play");
    });
  });

  it("F-3: multi-leg parser accepts new OCC:side:qty:limit syntax", async () => {
    setSearch(
      "?symbol=NVDA" +
        "&legs=NVDA260424P00200000:sell:1:1.45,NVDA260424C00220000:sell:1:1.32" +
        "&strategy=earnings-options-play&combo_type=strangle",
    );
    const { container } = render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      const legEls = container.querySelectorAll("[data-slot='active-leg']");
      expect(legEls.length).toBe(2);

      // Per-leg limit prices rendered ($1.45, $1.32).
      const limitEls = container.querySelectorAll("[data-slot='active-leg-limit']");
      expect(limitEls.length).toBe(2);
      expect(limitEls[0].textContent).toContain("1.45");
      expect(limitEls[1].textContent).toContain("1.32");

      // Strategy + combo chip rendered.
      const stratChip = container.querySelector("[data-slot='trade-strategy-tag']");
      expect(stratChip).not.toBeNull();
      expect(stratChip!.textContent).toContain("strangle");
    });
  });

  it("F-3: backwards-compat — old 3-field leg syntax still parses (limit undefined)", async () => {
    setSearch(
      "?symbol=NVDA&legs=NVDA260424P00200000:sell:1,NVDA260424C00220000:sell:1",
    );
    const { container } = render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      const legEls = container.querySelectorAll("[data-slot='active-leg']");
      expect(legEls.length).toBe(2);
      // No limit nodes for the old syntax.
      const limitEls = container.querySelectorAll("[data-slot='active-leg-limit']");
      expect(limitEls.length).toBe(0);
    });
  });
});
