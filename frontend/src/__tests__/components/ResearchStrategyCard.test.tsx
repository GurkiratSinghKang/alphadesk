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
        metrics={[
          { label: "THIS WEEK", value: 12, hint: "earnings" },
          { label: "AVG IV RANK", value: 68, hint: "across set" },
          { label: "TOP SETUP", value: "NVDA", hint: "recommended" },
        ]}
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
        metrics={[
          { label: "THIS WEEK", value: 0, hint: "earnings" },
          { label: "AVG IV RANK", value: "-", hint: "across set" },
          { label: "TOP SETUP", value: "-", hint: "recommended" },
        ]}
      />,
    );
    const link = container.querySelector('a[href="/strategies/earnings-options-play"]');
    expect(link).not.toBeNull();
  });

  it("links to TradingAgents research", () => {
    const { container } = render(
      <ResearchStrategyCard
        id="trading-agents-research"
        name="TradingAgents Research"
        subtitle="Multi-agent thesis desk - read-only research"
        metrics={[
          { label: "MODE", value: "Read-only", hint: "no orders" },
          { label: "AGENTS", value: "6+", hint: "debate stack" },
          { label: "OUTPUT", value: "Memo", hint: "saved run" },
        ]}
      />,
    );
    const link = container.querySelector('a[href="/strategies/trading-agents-research"]');
    expect(link).not.toBeNull();
    expect(container.textContent).toContain("MODE");
    expect(container.textContent).toContain("Read-only");
  });
});
