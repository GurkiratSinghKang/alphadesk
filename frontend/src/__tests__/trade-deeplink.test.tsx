/**
 * Tests for /trade query-param pre-population.
 *
 * Task 22 — single-leg: symbol/contract/side/qty params pre-fill the order ticket.
 * Task 23 — multi-leg: ?legs= param pre-stages a strangle.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TradePage from "@/app/(dashboard)/trade/page";
import { barsRequestForRange } from "@/lib/chartRange";

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Temporarily override window.location.search. Restored in afterEach. */
let _origLocation: Location;
function setSearch(search: string) {
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: { ...window.location, search },
  });
}

// ─── Task 22 — single-leg pre-fill ────────────────────────────────────────────

describe("Trade page deep-link pre-fill", () => {
  beforeEach(() => {
    _origLocation = window.location;
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: _origLocation,
    });
  });

  it("pre-fills order ticket when single-leg query params are present", async () => {
    setSearch(
      "?symbol=NVDA&contract=NVDA260425C00205000&side=sell&qty=1"
    );
    const { container } = render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      // Symbol should be visible somewhere in the ticket area.
      expect(container.textContent).toContain("NVDA");

      // The order side attribute must be set to "sell".
      const sideEl = container.querySelector("[data-order-side]");
      expect(sideEl).not.toBeNull();
      expect(sideEl!.getAttribute("data-order-side")).toBe("sell");

      // The active contract slot must be rendered and include the strike "205".
      const contractEl = container.querySelector("[data-slot='active-contract']");
      expect(contractEl).not.toBeNull();
      expect(contractEl!.textContent).toMatch(/205/);
    });
  });

  it("renders no active-contract slot when no query params are present", async () => {
    setSearch("");
    const { container } = render(<TradePage />, { wrapper: makeWrapper() });

    // Give the component a tick to settle.
    await waitFor(() => {
      const contractEl = container.querySelector("[data-slot='active-contract']");
      expect(contractEl).toBeNull();
    });
  });

  it("pre-fills a plain equity limit ticket from chart deep-links", async () => {
    setSearch("?symbol=AAPL&side=sell&qty=3&type=limit&limit=123.45&strategy=earnings-options-play");
    const { getByLabelText, getByRole } = render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect((getByLabelText("Symbol") as HTMLInputElement).value).toBe("AAPL");
      expect((getByLabelText("Quantity") as HTMLInputElement).value).toBe("3");
      expect((getByLabelText("Order type") as HTMLSelectElement).value).toBe("limit");
      expect((getByLabelText("Price") as HTMLInputElement).value).toBe("123.45");
      expect((getByLabelText("Strategy") as HTMLSelectElement).value).toBe("earnings-options-play");
      expect(getByRole("radio", { name: "Sell" })).toHaveAttribute("aria-checked", "true");
    });
  });

  // ─── Task 23 — multi-leg / strangle pre-staging ───────────────────────────

  describe("multi-leg ?legs= param pre-staging", () => {
    it("renders two [data-slot='active-leg'] elements for a strangle param", async () => {
      setSearch(
        "?symbol=NVDA&legs=NVDA260425P00195000:sell:1,NVDA260425C00210000:sell:1"
      );
      const { container } = render(<TradePage />, { wrapper: makeWrapper() });

      await waitFor(() => {
        const legsEl = container.querySelector("[data-slot='active-legs']");
        expect(legsEl).not.toBeNull();

        const legEls = container.querySelectorAll("[data-slot='active-leg']");
        expect(legEls.length).toBe(2);

        // First leg should include the put strike 195.
        expect(legEls[0].textContent).toMatch(/195/);
        // Second leg should include the call strike 210.
        expect(legEls[1].textContent).toMatch(/210/);
      });
    });

    it("locks summary ticket fields for combo deep-links", async () => {
      setSearch(
        "?symbol=NVDA&legs=NVDA260425P00195000:sell:1,NVDA260425C00210000:sell:1"
      );
      const { getByLabelText } = render(<TradePage />, { wrapper: makeWrapper() });

      await waitFor(() => {
        expect(getByLabelText("Symbol")).toBeDisabled();
        expect(getByLabelText("Quantity")).toBeDisabled();
        expect(getByLabelText("Order type")).toBeDisabled();
      });
    });
  });
});

describe("Trade page chart range data requests", () => {
  it("uses intraday bars for short ranges so structure overlays have enough data", () => {
    expect(barsRequestForRange("1D")).toEqual({ timeframe: "5m", limit: 100 });
    expect(barsRequestForRange("5D")).toEqual({ timeframe: "15m", limit: 160 });
    expect(barsRequestForRange("1M")).toEqual({ timeframe: "1H", limit: 180 });
    expect(barsRequestForRange("ALL")).toEqual({ timeframe: "W", limit: 520 });
  });
});
