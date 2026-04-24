import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import EarningsDetailPanel from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel";
import type { EarningsDetail } from "@/types";

const detail: EarningsDetail = {
  symbol: "NVDA", company: "Nvidia", sector: "Semis",
  reportDate: "2026-04-23", reportTime: "AMC",
  quote: { last: 201.7, change: -1.4, changePct: -0.007 },
  metrics: { ivRank: 78, ivPercentile: 82, currentIv: 0.79, hv20: 0.42, hv50: null, hv100: null, hvIvRatio: 0.71, expectedMovePct: 0.064, expectedMoveDollars: 12.8, histAvgAbsMovePct: 0.052, beatRate: 0.87, daysToEarnings: 1, daysToExpiry: 3 },
  strikeLadder: null, claudeStructured: null, claudeFullResearch: null,
  ivTermStructure: null, skew: null,
  news: [], partial: false, generatedAt: new Date().toISOString(),
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
