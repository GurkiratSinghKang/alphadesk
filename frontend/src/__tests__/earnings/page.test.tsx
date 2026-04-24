import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, act, fireEvent } from "@testing-library/react";
import EarningsOptionsPlayPage from "@/app/(dashboard)/strategies/earnings-options-play/page";
import * as api from "@/lib/api";

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

    const { container } = render(<EarningsOptionsPlayPage />);
    await waitFor(() => {
      expect(api.getEarningsCalendar).toHaveBeenCalled();
      expect(api.getEarningsDetail).toHaveBeenCalledWith("NVDA");
      expect(container.textContent).toContain("NVDA");
      expect(container.textContent).toContain("TSLA");
    });
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
    render(<EarningsOptionsPlayPage />);
    await waitFor(() => {
      expect(api.getEarningsDetail).toHaveBeenCalledWith("TSLA");
    });
    Object.defineProperty(window, "location", { writable: true, value: original });
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
      claudeFullResearch: null, historicalEarnings: null,
      ivTermStructure: null, skew: null, news: [], partial: false,
      generatedAt: new Date().toISOString(),
    };
    vi.mocked(api.getEarningsDetail).mockResolvedValue(fullNvdaDetail);

    const { container } = render(<EarningsOptionsPlayPage />);
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
    const btn = container.querySelector('[data-slot="claude-thesis"] button') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => {
      expect(api.postEarningsFullResearch).toHaveBeenCalledWith("NVDA");
      expect(container.querySelector('[data-slot="claude-full-research"]')).not.toBeNull();
    });
  });
});
