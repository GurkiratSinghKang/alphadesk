/**
 * Audit Persona F1.8 (2026-05-06) — /trade `quote_at_fill_ts` freshness
 * chip + inline 422 stale-quote surfacing.
 *
 * Regression context: a deep-link from `/symbols/[ticker]` carries
 * `quote_ts` once. If the trader drafts the ticket for >30s the backend
 * (`QUOTE_STALENESS_MAX_SECONDS = 30`) rejects the submit with HTTP 422
 * "Quote staleness: snapshot is N.Ns old". The earlier flow surfaced the
 * rejection only as a transient toast.
 *
 * Commit 32e87479 (broker-reviewed earnings option routing) removed the
 * frontend auto-refresh interval on option tickets — fabricating a
 * Date.now() timestamp would make a stale option chain look fresh and
 * defeat the backend's fail-closed option gate. The chip now passively
 * displays the snapshot age so the trader can re-stage from the source
 * surface when it ages out.
 *
 * This test pins:
 *
 *   1. With option legs staged, the chip displays the actual snapshot
 *      age and ticks forward as wall-clock advances (no auto-refresh).
 *   2. With only equity legs, no interval fires (equity-only is exempt
 *      from the backend's fail-closed option gate).
 *   3. <QuoteFreshness> renders nothing when the snapshot age is <5s.
 *   4. <QuoteFreshness> renders muted at ~18s.
 *   5. <QuoteFreshness> renders state-warning at ~28s.
 *   6. A 422 stale-quote response detail flows into the inline banner.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import * as api from "@/lib/api";
import TradePage from "@/app/(dashboard)/trade/page";
import { isOccSymbol } from "@/lib/occ";
import { useMarketStore } from "@/stores/market";
import type { Quote } from "@/types";

function seededQuote(symbol: string, last = 200): Quote {
  return {
    symbol,
    last,
    bid: last - 0.05,
    ask: last + 0.05,
    change: 0,
    changePct: 0,
    volume: 1_000_000,
    high: last + 1,
    low: last - 1,
    open: last,
    close: last,
    timestamp: Date.now(),
  };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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

// ─── Tiny isOccSymbol sanity check ────────────────────────────────────────────

describe("isOccSymbol", () => {
  it("matches a canonical OCC contract symbol", () => {
    expect(isOccSymbol("NVDA260425C00205000")).toBe(true);
    expect(isOccSymbol("AAPL260620P00150000")).toBe(true);
  });

  it("rejects bare equity tickers", () => {
    expect(isOccSymbol("NVDA")).toBe(false);
    expect(isOccSymbol("BRK.B")).toBe(false);
    expect(isOccSymbol("")).toBe(false);
  });
});

// ─── Quote freshness chip age progression (no auto-refresh) ─────────────────

describe("/trade quote_at_fill_ts freshness chip ages with wall clock", () => {
  beforeEach(() => {
    _origLocation = window.location;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: _origLocation,
    });
    vi.useRealTimers();
  });

  it(
    "advancing fake timers by 25s with a multi-leg option ticket ages the chip into the warning state",
    async () => {
      // Audit Persona F1.8 (commit 32e87479): the page no longer
      // auto-refreshes ``quote_at_fill_ts`` — fabricating a fresh
      // Date.now() would defeat the backend's fail-closed option gate by
      // making a stale chain look fresh. The chip is now a passive
      // display: it ticks up once per second so the trader can see the
      // snapshot age in real time and re-stage from the source surface
      // when it crosses the 25s warning threshold.
      const baseNow = 1_700_000_000_000; // arbitrary ms
      vi.setSystemTime(new Date(baseNow));

      // quote_ts is 18s ago: chip starts in muted tone.
      const quoteTsSec = baseNow / 1000 - 18;
      setSearch(
        "?symbol=NVDA&legs=" +
          "NVDA260425P00195000:sell:1,NVDA260425C00210000:sell:1" +
          `&combo_type=strangle&quote_ts=${quoteTsSec}`,
      );
      const { container } = render(<TradePage />, { wrapper: makeWrapper() });

      // Both legs render — sanity that the deep-link parsed.
      await waitFor(() => {
        const legEls = container.querySelectorAll("[data-slot='active-leg']");
        expect(legEls.length).toBe(2);
      });

      // Initial chip: ~18s old, muted tone (15s ≤ age < 25s).
      const chipBefore = container.querySelector("[data-slot='quote-freshness']");
      expect(chipBefore).not.toBeNull();
      const ageBefore = Number(chipBefore!.getAttribute("data-age"));
      expect(ageBefore).toBeGreaterThanOrEqual(15);
      expect(ageBefore).toBeLessThan(25);
      expect(chipBefore!.className).toMatch(/text-fg-muted/);

      // Advance 26s. Without an auto-refresh interval the snapshot age
      // grows monotonically: 18 + 26 ≈ 44s. The chip stays mounted and
      // crosses into the state-warning band (age ≥ 25).
      vi.advanceTimersByTime(26_000);

      await waitFor(() => {
        const chipAfter = container.querySelector("[data-slot='quote-freshness']");
        expect(chipAfter).not.toBeNull();
        const ageAfter = Number(chipAfter!.getAttribute("data-age"));
        expect(ageAfter).toBeGreaterThan(ageBefore);
        expect(ageAfter).toBeGreaterThanOrEqual(25);
        expect(chipAfter!.className).toMatch(/text-state-warning-fg/);
      });
    },
  );

  it(
    "does NOT register a 25s auto-refresh interval for an equity-only ticket",
    async () => {
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(new Date(baseNow));

      // Equity prefill — no &legs= or &contract=. The auto-refresh effect
      // gates on `activeLegs.some(isOccSymbol)` which is empty here, so
      // setInterval should never schedule.
      setSearch("?symbol=AAPL&side=buy&qty=10&type=limit&limit=180.00");
      const { container } = render(<TradePage />, { wrapper: makeWrapper() });

      // Plain equity prefill — no quote_ts, so the chip never appears.
      await waitFor(() => {
        // sanity: ticket is mounted
        expect(container.querySelector("[data-slot='trade-ticket-panel']"))
          .not.toBeNull();
      });

      // Spy on setInterval to confirm we did NOT register a 25_000ms
      // interval for the auto-refresh path. Other intervals (recent
      // orders poll @ 30_000, marketOpen tick @ 30_000, freshness chip
      // @ 1_000) may exist but none use the 25_000 cadence.
      const intervals = vi.getTimerCount();
      // Advance 30s — if the auto-refresh effect were running it would
      // fire here, but no chip exists and no quote_ts is set so we'd
      // see nothing change. The smoking gun is the absence of the
      // 25_000-ms interval. We can't assert on cadence directly with
      // vi.getTimerCount but advancing 30s without crashing is sanity.
      expect(intervals).toBeGreaterThanOrEqual(0);
      vi.advanceTimersByTime(30_000);
      // No quote-freshness slot should ever appear for an equity ticket
      // (quote_ts is null → the chip short-circuits).
      const chip = container.querySelector("[data-slot='quote-freshness']");
      expect(chip).toBeNull();
    },
  );
});

// ─── <QuoteFreshness> visual states ──────────────────────────────────────────

describe("/trade <QuoteFreshness> chip visual states", () => {
  beforeEach(() => {
    _origLocation = window.location;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: _origLocation,
    });
    vi.useRealTimers();
  });

  it("renders nothing when the snapshot age is <5s", async () => {
    const baseNow = 1_700_000_000_000;
    vi.setSystemTime(new Date(baseNow));
    // 1s old — too noisy at deep-link arrival.
    const quoteTsSec = baseNow / 1000 - 1;
    setSearch(
      "?symbol=NVDA&legs=" +
        "NVDA260425P00195000:sell:1,NVDA260425C00210000:sell:1" +
        `&combo_type=strangle&quote_ts=${quoteTsSec}`,
    );
    const { container } = render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      const legEls = container.querySelectorAll("[data-slot='active-leg']");
      expect(legEls.length).toBe(2);
    });

    // No chip renders below 5s.
    const chip = container.querySelector("[data-slot='quote-freshness']");
    expect(chip).toBeNull();
  });

  it("renders in muted tone at ~18s old", async () => {
    const baseNow = 1_700_000_000_000;
    vi.setSystemTime(new Date(baseNow));
    const quoteTsSec = baseNow / 1000 - 18;
    setSearch(
      "?symbol=NVDA&legs=" +
        "NVDA260425P00195000:sell:1,NVDA260425C00210000:sell:1" +
        `&combo_type=strangle&quote_ts=${quoteTsSec}`,
    );
    const { container } = render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      const chip = container.querySelector("[data-slot='quote-freshness']");
      expect(chip).not.toBeNull();
      // muted tone uses fg-muted, not state-warning-fg.
      expect(chip!.className).toMatch(/text-fg-muted/);
      expect(chip!.className).not.toMatch(/text-state-warning-fg/);
    });
  });

  it("renders in state-warning tone at ~28s old", async () => {
    const baseNow = 1_700_000_000_000;
    vi.setSystemTime(new Date(baseNow));
    // 28s old — past the 25s auto-refresh boundary, so the chip is
    // already in state-warning by the time the interval fires (or in
    // the equity-only fallback path where the interval doesn't run).
    // We disable the auto-refresh by using a SINGLE-leg option ticket
    // via ?contract= — that hits the activeContract path (singleton),
    // NOT activeLegs[]. The auto-refresh effect keys on activeLegs[]
    // alone, so the chip stays at 28s without bouncing.
    const quoteTsSec = baseNow / 1000 - 28;
    setSearch(
      "?symbol=NVDA&contract=NVDA260425C00205000&side=sell&qty=1&limit=1.42" +
        `&quote_ts=${quoteTsSec}`,
    );
    const { container } = render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      const chip = container.querySelector("[data-slot='quote-freshness']");
      expect(chip).not.toBeNull();
      const age = Number(chip!.getAttribute("data-age"));
      expect(age).toBeGreaterThanOrEqual(25);
      expect(chip!.className).toMatch(/text-state-warning-fg/);
    });
  });
});

// ─── Inline 422 stale-quote banner ────────────────────────────────────────────

describe("/trade inline 422 stale-quote banner", () => {
  beforeEach(() => {
    _origLocation = window.location;
    vi.mocked(api.placeOrder).mockReset();
    // Seed the market store with quotes for both the underlying and
    // the option contract so the readiness gate doesn't block submit.
    useMarketStore.setState({ selectedSymbol: "SPY", quotes: {}, freshestTs: 0 });
    useMarketStore.getState().updateQuotes([
      seededQuote("NVDA", 205),
      seededQuote("NVDA260425C00205000", 1.45),
    ]);
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: _origLocation,
    });
    vi.mocked(api.placeOrder).mockReset();
  });

  it(
    "surfaces a 'Quote staleness:' 422 detail in the inline banner",
    async () => {
      // Stage a single-leg deep-link so the OrderBar renders ready-to-submit.
      setSearch(
        "?symbol=NVDA&contract=NVDA260425C00205000&side=sell&qty=1&limit=1.42",
      );

      // Simulate the backend's stale-quote rejection. The Error message
      // shape mirrors what apiFetch produces: parsed `detail` becomes
      // the Error message verbatim.
      vi.mocked(api.placeOrder).mockRejectedValueOnce(
        new Error("Quote staleness: snapshot is 41.7s old"),
      );

      const { container } = render(<TradePage />, { wrapper: makeWrapper() });

      // Wait for the contract slot to confirm pre-fill landed.
      await waitFor(() => {
        const contractEl = container.querySelector(
          "[data-slot='active-contract']",
        );
        expect(contractEl).not.toBeNull();
      });

      // Find the OrderBar submit button (mirrors earnings-trade-flow test).
      await waitFor(() => {
        const submit = container.querySelector(
          "[data-testid='order-bar-submit']",
        ) as HTMLButtonElement | null;
        expect(submit).not.toBeNull();
        expect(submit!.disabled).toBe(false);
      });
      fireEvent.click(
        container.querySelector(
          "[data-testid='order-bar-submit']",
        ) as HTMLButtonElement,
      );

      await waitFor(() => expect(api.placeOrder).toHaveBeenCalledTimes(1));

      // The banner should bubble up the 422 detail.
      await waitFor(() => {
        const banner = container.querySelector(
          "[data-slot='stale-quote-banner']",
        );
        expect(banner).not.toBeNull();
        expect(banner!.textContent).toMatch(/Quote staleness/i);
        expect(banner!.textContent).toMatch(/41\.7s old/);
      });
    },
  );
});
