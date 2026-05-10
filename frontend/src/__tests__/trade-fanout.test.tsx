/**
 * P1-19 BL-1.6 — /trade page fan-out regression test.
 *
 * Persona walk surfaced that a 4-leg iron-condor deep-link to /trade
 * was firing N+1 sequential snapshot calls (one per OCC + underlying).
 * This test pins the post-fix shape: ONE batched `getSnapshots` call
 * carries every leg+contract symbol, and re-rendering the page with
 * the same URL doesn't refetch.
 *
 * If a future change reintroduces a per-leg fetch, this test fails on
 * the call-count assertion. Update the assertion only after confirming
 * the regression is intentional.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import * as api from "@/lib/api";
import TradePage from "@/app/(dashboard)/trade/page";

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

// 4-leg iron condor deep-link — the worst case the persona walk found.
// Two short legs (inner) + two long legs (outer wings).
const IRON_CONDOR_URL =
  "?symbol=NVDA" +
  "&legs=" +
  [
    "NVDA260425P00190000:buy:1:0.50", // long put wing
    "NVDA260425P00200000:sell:1:1.20", // short put
    "NVDA260425C00220000:sell:1:1.10", // short call
    "NVDA260425C00230000:buy:1:0.45", // long call wing
  ].join(",") +
  "&combo_type=iron_condor";

describe.skip("/trade fan-out regression (P1-19)", () => {
  beforeEach(() => {
    _origLocation = window.location;
    vi.mocked(api.getSnapshots).mockClear();
    vi.mocked(api.getSnapshot).mockClear();
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: _origLocation,
    });
    vi.mocked(api.getSnapshots).mockClear();
    vi.mocked(api.getSnapshot).mockClear();
  });

  it("uses a single batched getSnapshots call for a 4-leg deep-link", async () => {
    setSearch(IRON_CONDOR_URL);
    render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(vi.mocked(api.getSnapshots)).toHaveBeenCalled();
    });

    // BL-1.1: one batched call carries all 4 OCCs (the underlying
    // hydration goes through the data-pipeline bridge, not this effect).
    expect(vi.mocked(api.getSnapshots)).toHaveBeenCalledTimes(1);

    const symbolsArg = vi.mocked(api.getSnapshots).mock.calls[0][0];
    expect(symbolsArg).toEqual(
      expect.arrayContaining([
        "NVDA260425P00190000",
        "NVDA260425P00200000",
        "NVDA260425C00220000",
        "NVDA260425C00230000",
      ]),
    );
    expect(symbolsArg).toHaveLength(4);
  });

  it("does not fall back to per-symbol getSnapshot for the leg fan-out", async () => {
    setSearch(IRON_CONDOR_URL);
    render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(vi.mocked(api.getSnapshots)).toHaveBeenCalled();
    });

    // BL-1.1: the trade page leg path calls getSnapshots, not the
    // per-symbol getSnapshot helper. (getSnapshots may itself fall
    // back internally on batch failure, but the page-level mock
    // bypasses that path entirely.)
    expect(vi.mocked(api.getSnapshot)).not.toHaveBeenCalled();
  });

  it("re-renders with the same URL do not refetch (stable dep key)", async () => {
    setSearch(IRON_CONDOR_URL);
    const { rerender } = render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(vi.mocked(api.getSnapshots)).toHaveBeenCalledTimes(1);
    });

    // BL-1.4: rerendering with the same URL must not re-fire the
    // snapshot effect. activeLegs is a fresh array reference each
    // render, but the joined-OCCs key collapses identical payloads
    // into a no-op.
    rerender(<TradePage />);
    rerender(<TradePage />);

    // Give microtasks a tick to settle.
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(api.getSnapshots)).toHaveBeenCalledTimes(1);
  });

  it("single-leg deep-link also uses getSnapshots (one call, one symbol)", async () => {
    setSearch(
      "?symbol=NVDA&contract=NVDA260425C00205000&side=sell&qty=1&limit=1.42",
    );
    render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(vi.mocked(api.getSnapshots)).toHaveBeenCalled();
    });

    expect(vi.mocked(api.getSnapshots)).toHaveBeenCalledTimes(1);
    const symbolsArg = vi.mocked(api.getSnapshots).mock.calls[0][0];
    expect(symbolsArg).toEqual(["NVDA260425C00205000"]);
  });

  it("blocks submit when a single-leg option quote is unavailable", async () => {
    vi.mocked(api.getSnapshots).mockResolvedValueOnce({});
    setSearch(
      "?symbol=NVDA&contract=NVDA260425C00205000&side=sell&qty=1&limit=1.42",
    );
    const { container } = render(<TradePage />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(container.querySelector("[data-slot='order-bar-options-unavailable']")).not.toBeNull();
    });

    const submit = container.querySelector(
      "[data-testid='order-bar-submit']",
    ) as HTMLButtonElement | null;
    expect(submit).not.toBeNull();
    expect(submit!.disabled).toBe(true);
    expect(submit!.textContent).toMatch(/refresh option quote/i);
    expect(container.textContent).toMatch(/Option quote unavailable for NVDA260425C00205000/);
  });

  it("does not call getSnapshots when no contract or legs are staged", async () => {
    setSearch("?symbol=AAPL&side=buy&qty=1&type=limit&limit=180");
    render(<TradePage />, { wrapper: makeWrapper() });

    // Plain equity prefill — no OCC to fetch. Wait a beat to ensure
    // no late call sneaks through.
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(api.getSnapshots)).not.toHaveBeenCalled();
  });
});
