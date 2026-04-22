import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import EarningsOptionsPlayPage from "@/app/(dashboard)/strategies/earnings-options-play/page";
import * as api from "@/lib/api";

describe("Earnings Options Play page", () => {
  it("fetches calendar on mount and auto-selects first symbol", async () => {
    vi.mocked(api.getEarningsCalendar).mockResolvedValueOnce({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis",
          report_date: "2026-04-23", report_time: "AMC", days_until: 1,
          price: 201.7, change: -1.4, change_pct: -0.007, iv_rank: 78,
          premium_yield_call_atm: 0.031, premium_yield_put_atm: 0.028,
          expected_move_pct: 0.064, hist_avg_abs_move_pct: 0.052,
          claude_verdict: "neutral-bull", claude_confidence: 0.62,
          top_setup: "short strangle" },
        { symbol: "TSLA", company: "Tesla", sector: "Auto",
          report_date: "2026-04-23", report_time: "AMC", days_until: 1,
          price: 392, change: -8.2, change_pct: -0.02, iv_rank: 84,
          premium_yield_call_atm: 0.042, premium_yield_put_atm: 0.039,
          expected_move_pct: 0.081, hist_avg_abs_move_pct: 0.078,
          claude_verdict: "neutral", claude_confidence: 0.55, top_setup: "iron condor" },
      ],
      generated_at: new Date().toISOString(), partial: false,
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
        { symbol: "NVDA", company: "Nvidia", sector: "Semis", report_date: "2026-04-23", report_time: "AMC", days_until: 1, price: null, change: null, change_pct: null, iv_rank: null, premium_yield_call_atm: null, premium_yield_put_atm: null, expected_move_pct: null, hist_avg_abs_move_pct: null, claude_verdict: null, claude_confidence: null, top_setup: null },
        { symbol: "TSLA", company: "Tesla", sector: "Auto", report_date: "2026-04-23", report_time: "AMC", days_until: 1, price: null, change: null, change_pct: null, iv_rank: null, premium_yield_call_atm: null, premium_yield_put_atm: null, expected_move_pct: null, hist_avg_abs_move_pct: null, claude_verdict: null, claude_confidence: null, top_setup: null },
      ],
      generated_at: new Date().toISOString(), partial: false,
    });
    render(<EarningsOptionsPlayPage />);
    await waitFor(() => {
      expect(api.getEarningsDetail).toHaveBeenCalledWith("TSLA");
    });
    Object.defineProperty(window, "location", { writable: true, value: original });
  });
});
