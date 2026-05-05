import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StrategyCard from "@/components/composites/StrategyCard";

function expectZeroTracking(container: HTMLElement) {
  const tracked = Array.from(container.querySelectorAll<HTMLElement>("[style*='letter-spacing']"));
  expect(tracked.length).toBeGreaterThan(0);
  for (const node of tracked) {
    expect(["0", "0px"]).toContain(node.style.letterSpacing);
  }
}

describe("StrategyCard", () => {
  it("renders as an anchor with profit accent", () => {
    const { container } = render(
      <StrategyCard
        name="Momentum & Quality"
        subtitle="Strategy 01 · swing"
        returnPct={3.42}
        isLoss={false}
        positions={4}
        winRatePct={62}
        invested="$18.2K"
        sparkline={[1, 2, 3, 4, 5, 6]}
        href="/strategies/mq"
      />,
    );
    const anchor = container.querySelector("a[data-slot='strategy-card']");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/strategies/mq");
    expect(anchor?.className).toContain("before:bg-primary");
    expect(container.textContent).toContain("Momentum");
    expect(container.textContent).toContain("+3.42%");
    expect(container.textContent).toContain("4 positions");
    expectZeroTracking(container);
  });

  it("loss variant uses coral accent and minus sign", () => {
    const { container } = render(
      <StrategyCard
        name="Claude Alpha"
        subtitle="Strategy 06 · AI opp."
        returnPct={-1.18}
        isLoss
        positions={2}
        winRatePct={48}
        invested="$6.4K"
        sparkline={[6, 5, 4, 3, 2]}
        href="/strategies/claude-alpha"
      />,
    );
    const anchor = container.querySelector("a[data-slot='strategy-card']");
    expect(anchor?.className).toContain("before:bg-down-500");
    expect(container.textContent).toContain("−1.18%");
    expectZeroTracking(container);
  });
});
