import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import EarningsDetailPanel from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel";
import type { EarningsDetail } from "@/types";

const detail: EarningsDetail = {
  symbol: "NVDA", company: "Nvidia", sector: "Semis",
  report_date: "2026-04-23", report_time: "AMC",
  quote: { last: 201.7, change: -1.4, change_pct: -0.007 },
  metrics: { iv_rank: 78, iv_percentile: 82, current_iv: 0.79, hv_20: 0.42, hv_50: null, hv_100: null, hv_iv_ratio: 0.71, expected_move_pct: 0.064, expected_move_dollars: 12.8, hist_avg_abs_move_pct: 0.052, beat_rate: 0.87, days_to_earnings: 1, days_to_expiry: 3 },
  strike_ladder: null, claude_structured: null, claude_full_research: null,
  iv_term_structure: null, skew: null,
  news: [], partial: false, generated_at: new Date().toISOString(),
};

describe("EarningsDetailPanel", () => {
  it("renders header, metrics, and all sub-panels when detail present", () => {
    const { container } = render(
      <EarningsDetailPanel detail={detail} loading={false} error={null} runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.querySelector('[data-slot="detail-header"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="metrics-strip"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="claude-thesis"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="strike-ladder"]')).not.toBeNull();
    // B-63: historical-moves panel removed along with the stubbed backend
    // loader; restore this assertion when the FMP surprises join lands.
    expect(container.querySelector('[data-slot="news-feed"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="trade-button-row"]')).not.toBeNull();
  });

  it("renders empty state when detail is null and not loading", () => {
    const { container } = render(
      <EarningsDetailPanel detail={null} loading={false} error={null} runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.textContent).toMatch(/select|choose/i);
  });

  it("renders skeleton when loading", () => {
    const { container } = render(
      <EarningsDetailPanel detail={null} loading={true} error={null} runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.textContent).toMatch(/loading/i);
  });

  it("renders error message when error", () => {
    const { container } = render(
      <EarningsDetailPanel detail={null} loading={false} error="provider down" runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.textContent).toMatch(/provider down|error/i);
  });
});
