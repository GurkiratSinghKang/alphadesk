import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ResearchStrategyCard from "@/components/strategies/ResearchStrategyCard";

describe("ResearchStrategyCard", () => {
  it("renders honest research metrics (not Sharpe/CAGR/MaxDD)", () => {
    const { container } = render(
      <ResearchStrategyCard
        id="earnings-options-play"
        name="Earnings Options Play"
        subtitle="Research screener · pick your own trade"
        metrics={{
          thisWeekCount: 12,
          avgIvRank: 68,
          topSetup: "NVDA",
        }}
      />,
    );
    expect(container.textContent).toContain("Earnings Options Play");
    expect(container.textContent).toContain("THIS WEEK");
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("AVG IV RANK");
    expect(container.textContent).toContain("68");
    expect(container.textContent).toContain("TOP SETUP");
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toMatch(/RESEARCH/i);
    // Must NOT leak autonomous metrics
    expect(container.textContent).not.toMatch(/SHARPE|CAGR|MAX DD/i);
  });

  it("links to /strategies/earnings-options-play", () => {
    const { container } = render(
      <ResearchStrategyCard
        id="earnings-options-play"
        name="Earnings Options Play"
        subtitle=""
        metrics={{ thisWeekCount: 0, avgIvRank: 0, topSetup: null }}
      />,
    );
    const link = container.querySelector('a[href="/strategies/earnings-options-play"]');
    expect(link).not.toBeNull();
  });
});
