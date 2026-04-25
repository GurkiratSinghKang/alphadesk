import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import EarningsOptionsPlayPage from "@/app/(dashboard)/strategies/earnings-options-play/page";
import * as api from "@/lib/api";

// B-97: page uses useQuery; tests need a QueryClientProvider. retry=false
// so failures surface immediately (no hanging retries mid-waitFor).
function withQueryClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("Earnings Options Play page", () => {
  it("fetches calendar on mount and auto-selects first symbol", async () => {
    vi.mocked(api.getEarningsCalendar).mockResolvedValueOnce({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis",
          reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1,
          price: 201.7, change: -1.4, changePct: -0.007, ivRank: 78,
          premiumYieldCallAtm: 0.031, premiumYieldPutAtm: 0.028,
          expectedMovePct: 0.064, histAvgAbsMovePct: 0.052,
          claudeVerdict: "neutral-bull", claudeConfidence: 0.62,
          topSetup: "short strangle" },
        { symbol: "TSLA", company: "Tesla", sector: "Auto",
          reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1,
          price: 392, change: -8.2, changePct: -0.02, ivRank: 84,
          premiumYieldCallAtm: 0.042, premiumYieldPutAtm: 0.039,
          expectedMovePct: 0.081, histAvgAbsMovePct: 0.078,
          claudeVerdict: "neutral", claudeConfidence: 0.55, topSetup: "iron condor" },
      ],
      generatedAt: new Date().toISOString(), partial: false,
    });

    const { container } = render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(api.getEarningsCalendar).toHaveBeenCalled();
      // getEarningsDetail now takes (symbol, { signal }) per B-97. Assert on the
      // symbol arg; ignore the options bag.
      expect(api.getEarningsDetail).toHaveBeenCalledWith("NVDA", expect.anything());
      expect(container.textContent).toContain("NVDA");
      expect(container.textContent).toContain("TSLA");
    });
  });

  it("announces calendar count via aria-live region (B-37)", async () => {
    vi.mocked(api.getEarningsCalendar).mockResolvedValueOnce({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: null, change: null, changePct: null, ivRank: null, premiumYieldCallAtm: null, premiumYieldPutAtm: null, expectedMovePct: null, histAvgAbsMovePct: null, claudeVerdict: null, claudeConfidence: null, topSetup: null },
      ],
      generatedAt: new Date().toISOString(), partial: false,
    });
    const { container } = render(withQueryClient(<EarningsOptionsPlayPage />));
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute("role")).toBe("status");
  });

  it("rejects invalid minIvRank from URL rather than coercing NaN (B-58)", async () => {
    const original = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...original, search: "?minIvRank=abc", pathname: "/strategies/earnings-options-play" },
    });
    vi.mocked(api.getEarningsCalendar).mockResolvedValueOnce({
      earnings: [], generatedAt: new Date().toISOString(), partial: false,
    });
    render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(api.getEarningsCalendar).toHaveBeenCalled();
    });
    // The mock was called with filters — minIvRank should be 50 (default),
    // not NaN (which would coerce to the string "NaN" downstream).
    const firstCall = vi.mocked(api.getEarningsCalendar).mock.calls[0][0];
    expect(firstCall?.minIvRank).toBe(50);
    expect(Number.isNaN(firstCall?.minIvRank as number)).toBe(false);
    Object.defineProperty(window, "location", { writable: true, value: original });
  });

  it("title reflects active window filter (B-102)", async () => {
    const original = window.location;
    // Start with window=current
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...original, search: "?window=current", pathname: "/strategies/earnings-options-play" },
    });
    vi.mocked(api.getEarningsCalendar).mockResolvedValue({
      earnings: [], generatedAt: new Date().toISOString(), partial: false,
    });
    const { container } = render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(container.querySelector("h1")?.textContent).toMatch(/this week/i);
    });
    Object.defineProperty(window, "location", { writable: true, value: original });
  });

  it("title shows 'Next week' for window=next (B-102)", async () => {
    const original = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...original, search: "?window=next", pathname: "/strategies/earnings-options-play" },
    });
    vi.mocked(api.getEarningsCalendar).mockResolvedValue({
      earnings: [], generatedAt: new Date().toISOString(), partial: false,
    });
    const { container } = render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(container.querySelector("h1")?.textContent).toMatch(/next week/i);
    });
    Object.defineProperty(window, "location", { writable: true, value: original });
  });

  it("title shows 'This + next week' for window=both (B-102)", async () => {
    const original = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...original, search: "?window=both", pathname: "/strategies/earnings-options-play" },
    });
    vi.mocked(api.getEarningsCalendar).mockResolvedValue({
      earnings: [], generatedAt: new Date().toISOString(), partial: false,
    });
    const { container } = render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(container.querySelector("h1")?.textContent).toMatch(/this \+ next/i);
    });
    Object.defineProperty(window, "location", { writable: true, value: original });
  });

  it("re-reads URL state on popstate (B-98)", async () => {
    const original = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...original, search: "?symbol=NVDA", pathname: "/strategies/earnings-options-play" },
    });
    vi.mocked(api.getEarningsCalendar).mockResolvedValue({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: null, change: null, changePct: null, ivRank: null, premiumYieldCallAtm: null, premiumYieldPutAtm: null, expectedMovePct: null, histAvgAbsMovePct: null, claudeVerdict: null, claudeConfidence: null, topSetup: null },
        { symbol: "TSLA", company: "Tesla", sector: "Auto", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: null, change: null, changePct: null, ivRank: null, premiumYieldCallAtm: null, premiumYieldPutAtm: null, expectedMovePct: null, histAvgAbsMovePct: null, claudeVerdict: null, claudeConfidence: null, topSetup: null },
      ],
      generatedAt: new Date().toISOString(), partial: false,
    });
    render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(api.getEarningsDetail).toHaveBeenCalledWith("NVDA", expect.anything());
    });

    // Simulate the browser back-button moving URL to TSLA.
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...original, search: "?symbol=TSLA", pathname: "/strategies/earnings-options-play" },
    });
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => {
      expect(api.getEarningsDetail).toHaveBeenCalledWith("TSLA", expect.anything());
    });

    Object.defineProperty(window, "location", { writable: true, value: original });
  });

  it("advances selection on alphadesk:earnings-select-next/prev (B-60)", async () => {
    vi.mocked(api.getEarningsCalendar).mockResolvedValue({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: null, change: null, changePct: null, ivRank: null, premiumYieldCallAtm: null, premiumYieldPutAtm: null, expectedMovePct: null, histAvgAbsMovePct: null, claudeVerdict: null, claudeConfidence: null, topSetup: null },
        { symbol: "TSLA", company: "Tesla", sector: "Auto", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: null, change: null, changePct: null, ivRank: null, premiumYieldCallAtm: null, premiumYieldPutAtm: null, expectedMovePct: null, histAvgAbsMovePct: null, claudeVerdict: null, claudeConfidence: null, topSetup: null },
        { symbol: "META", company: "Meta", sector: "Tech", reportDate: "2026-04-24", reportTime: "AMC", daysUntil: 2, price: null, change: null, changePct: null, ivRank: null, premiumYieldCallAtm: null, premiumYieldPutAtm: null, expectedMovePct: null, histAvgAbsMovePct: null, claudeVerdict: null, claudeConfidence: null, topSetup: null },
      ],
      generatedAt: new Date().toISOString(), partial: false,
    });
    render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(api.getEarningsDetail).toHaveBeenCalledWith("NVDA", expect.anything());
    });
    // Next → TSLA
    act(() => {
      window.dispatchEvent(new CustomEvent("alphadesk:earnings-select-next"));
    });
    await waitFor(() => {
      expect(api.getEarningsDetail).toHaveBeenCalledWith("TSLA", expect.anything());
    });
    // Next → META
    act(() => {
      window.dispatchEvent(new CustomEvent("alphadesk:earnings-select-next"));
    });
    await waitFor(() => {
      expect(api.getEarningsDetail).toHaveBeenCalledWith("META", expect.anything());
    });
    // Prev → TSLA (wraps back)
    act(() => {
      window.dispatchEvent(new CustomEvent("alphadesk:earnings-select-prev"));
    });
    await waitFor(() => {
      expect(api.getEarningsDetail).toHaveBeenCalledWith("TSLA", expect.anything());
    });
  });

  it("rejects out-of-range minIvRank (B-58)", async () => {
    const original = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...original, search: "?minIvRank=250", pathname: "/strategies/earnings-options-play" },
    });
    vi.mocked(api.getEarningsCalendar).mockResolvedValueOnce({
      earnings: [], generatedAt: new Date().toISOString(), partial: false,
    });
    render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(api.getEarningsCalendar).toHaveBeenCalled();
    });
    const firstCall = vi.mocked(api.getEarningsCalendar).mock.calls[0][0];
    expect(firstCall?.minIvRank).toBe(50);
    Object.defineProperty(window, "location", { writable: true, value: original });
  });

  it("uses replaceState on first mount and pushState on subsequent changes (B-39)", async () => {
    vi.mocked(api.getEarningsCalendar).mockResolvedValue({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: null, change: null, changePct: null, ivRank: null, premiumYieldCallAtm: null, premiumYieldPutAtm: null, expectedMovePct: null, histAvgAbsMovePct: null, claudeVerdict: null, claudeConfidence: null, topSetup: null },
        { symbol: "TSLA", company: "Tesla", sector: "Auto", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: null, change: null, changePct: null, ivRank: null, premiumYieldCallAtm: null, premiumYieldPutAtm: null, expectedMovePct: null, histAvgAbsMovePct: null, claudeVerdict: null, claudeConfidence: null, topSetup: null },
      ],
      generatedAt: new Date().toISOString(), partial: false,
    });
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    pushSpy.mockClear();
    replaceSpy.mockClear();

    const { container } = render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(container.textContent).toContain("TSLA");
    });

    // Initial sync → replaceState, zero pushes.
    expect(replaceSpy).toHaveBeenCalled();
    const pushesAfterMount = pushSpy.mock.calls.length;

    // User-initiated change → pushState.
    const tslaBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("TSLA"),
    ) as HTMLButtonElement;
    fireEvent.click(tslaBtn);
    await waitFor(() => {
      expect(pushSpy.mock.calls.length).toBeGreaterThan(pushesAfterMount);
    });

    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it("reads ?symbol= from URL on mount to restore selection", async () => {
    // Mock window.location to simulate ?symbol=TSLA
    const original = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...original, search: "?symbol=TSLA", pathname: "/strategies/earnings-options-play" },
    });
    vi.mocked(api.getEarningsCalendar).mockResolvedValueOnce({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: null, change: null, changePct: null, ivRank: null, premiumYieldCallAtm: null, premiumYieldPutAtm: null, expectedMovePct: null, histAvgAbsMovePct: null, claudeVerdict: null, claudeConfidence: null, topSetup: null },
        { symbol: "TSLA", company: "Tesla", sector: "Auto", reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1, price: null, change: null, changePct: null, ivRank: null, premiumYieldCallAtm: null, premiumYieldPutAtm: null, expectedMovePct: null, histAvgAbsMovePct: null, claudeVerdict: null, claudeConfidence: null, topSetup: null },
      ],
      generatedAt: new Date().toISOString(), partial: false,
    });
    render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(api.getEarningsDetail).toHaveBeenCalledWith("TSLA", expect.anything());
    });
    Object.defineProperty(window, "location", { writable: true, value: original });
  });
});

describe("Earnings Options Play — round-4 fixes", () => {
  it("Esc dispatches clear-selection event and the page resets selectedSymbol (B-NEW-2)", async () => {
    vi.mocked(api.getEarningsCalendar).mockResolvedValue({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis",
          reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1,
          price: 201.7, change: -1.4, changePct: -0.007, ivRank: 78,
          premiumYieldCallAtm: 0.031, premiumYieldPutAtm: 0.028,
          expectedMovePct: 0.064, histAvgAbsMovePct: 0.052,
          claudeVerdict: "neutral-bull", claudeConfidence: 0.62,
          topSetup: "short strangle" },
      ],
      generatedAt: new Date().toISOString(), partial: false,
    });
    const { container } = render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      // Auto-selected NVDA → detail panel mounted with detail-header.
      expect(container.querySelector('[data-slot="detail-header"]')).not.toBeNull();
    });

    // Hit Esc — the panel listens for keydown and dispatches the event
    // the page handles. The page resets selectedSymbol → empty state.
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => {
      expect(container.querySelector('[data-slot="detail-header"]')).toBeNull();
      expect(container.textContent).toMatch(/select a symbol/i);
    });
  });

  it("Esc-clear is sticky: subsequent calendar refetch does not auto-rehydrate (B-NEW-2)", async () => {
    vi.mocked(api.getEarningsCalendar).mockResolvedValue({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis",
          reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1,
          price: 201.7, change: -1.4, changePct: -0.007, ivRank: 78,
          premiumYieldCallAtm: 0.031, premiumYieldPutAtm: 0.028,
          expectedMovePct: 0.064, histAvgAbsMovePct: 0.052,
          claudeVerdict: "neutral-bull", claudeConfidence: 0.62,
          topSetup: "short strangle" },
      ],
      generatedAt: new Date().toISOString(), partial: false,
    });
    const { container } = render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="detail-header"]')).not.toBeNull();
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => {
      expect(container.querySelector('[data-slot="detail-header"]')).toBeNull();
    });
  });
});

describe("Earnings Options Play — full flow", () => {
  it("end-to-end: calendar → select → detail renders → run full research → trade deep-link", async () => {
    vi.mocked(api.getEarningsCalendar).mockResolvedValueOnce({
      earnings: [{
        symbol: "NVDA", company: "Nvidia", sector: "Semis",
        reportDate: "2026-04-23", reportTime: "AMC", daysUntil: 1,
        price: 201.7, change: -1.4, changePct: -0.007, ivRank: 78,
        premiumYieldCallAtm: 0.031, premiumYieldPutAtm: 0.028,
        expectedMovePct: 0.064, histAvgAbsMovePct: 0.052,
        claudeVerdict: "neutral-bull", claudeConfidence: 0.62,
        topSetup: "short strangle",
      }], generatedAt: new Date().toISOString(), partial: false,
    });
    const fullNvdaDetail: import("@/types").EarningsDetail = {
      symbol: "NVDA", company: "Nvidia", sector: "Semis",
      reportDate: "2026-04-23", reportTime: "AMC",
      quote: { last: 201.7, change: -1.4, changePct: -0.007 },
      metrics: null, strikeLadder: {
        expiry: "2026-04-25", underlyingPrice: 201.7,
        rows: [
          { strike: 205, side: "call", bucket: "ATM", delta: 0.5, bid: 6.1, ask: 6.3, mid: 6.2, iv: 0.78, yieldPct: 0.031, pop: 0.5, theta: -0.29, gamma: 0.021, vega: 0.41, oi: 1800, volume: 700 },
          { strike: 200, side: "put", bucket: "ATM", delta: -0.5, bid: 5.5, ask: 5.7, mid: 5.6, iv: 0.79, yieldPct: 0.028, pop: 0.5, theta: -0.3, gamma: 0.022, vega: 0.4, oi: 2000, volume: 900 },
          { strike: 210, side: "call", bucket: "30Δ", delta: 0.3, bid: 3.7, ask: 3.9, mid: 3.8, iv: 0.8, yieldPct: 0.019, pop: 0.68, theta: -0.23, gamma: 0.017, vega: 0.32, oi: 1200, volume: 400 },
          { strike: 195, side: "put", bucket: "30Δ", delta: -0.3, bid: 3.3, ask: 3.5, mid: 3.4, iv: 0.81, yieldPct: 0.017, pop: 0.68, theta: -0.22, gamma: 0.018, vega: 0.31, oi: 1000, volume: 500 },
        ],
      },
      claudeStructured: {
        verdict: "neutral-bull", directionMagnitude: { bullCasePct: 0.04, bearCasePct: -0.05 },
        thesis: "IV overpriced.", catalysts: ["Blackwell"], risks: ["Guide miss"],
        suggestedPlay: "short strangle", suggestedPlayReason: "IVR>75", confidence: 0.62,
        model: "claude-opus-4-7", generatedAt: new Date().toISOString(),
      },
      claudeFullResearch: null,
      ivTermStructure: null, skew: null, news: [], partial: false,
      generatedAt: new Date().toISOString(),
    };
    vi.mocked(api.getEarningsDetail).mockResolvedValue(fullNvdaDetail);

    const { container } = render(withQueryClient(<EarningsOptionsPlayPage />));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="claude-thesis"]')?.textContent).toMatch(/NEUTRAL-BULL/);
      expect(container.querySelector('[data-slot="strike-ladder"]')).not.toBeNull();
      expect(container.querySelector('[data-slot="trade-button-short-call"]')?.getAttribute("href")).toContain("205");
      expect(container.querySelector('[data-slot="trade-button-strangle"]')?.getAttribute("href")).toContain("legs=");
    });

    // Fire the "Run full research" flow
    vi.mocked(api.postEarningsFullResearch).mockResolvedValueOnce({
      thesisParagraph: "Full paragraph.", comparableSetups: [],
      postEarningsDriftPlaybook: "", sectorBackdrop: "",
      analystConsensusDelta: "", whatWouldChangeMyMind: "",
      confidence: 0.7, model: "claude-opus-4-7", generatedAt: new Date().toISOString(),
    });
    // Wait for the thesis card button to appear, then click. Under react-query
    // (B-97) the detail panel may momentarily re-render between the first
    // waitFor resolving and the next synchronous querySelector, so poll for
    // the button to be present.
    const btn = await waitFor(() => {
      const el = container.querySelector('[data-slot="claude-thesis"] button') as HTMLButtonElement | null;
      if (!el) throw new Error("thesis button not rendered yet");
      return el;
    });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(api.postEarningsFullResearch).toHaveBeenCalledWith("NVDA");
      expect(container.querySelector('[data-slot="claude-full-research"]')).not.toBeNull();
    });
  });
});
