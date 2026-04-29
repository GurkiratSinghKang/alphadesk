import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StrategyRail from "@/components/composites/StrategyRail";

const items = [
  { id: "mq", name: "Momentum & Quality", subtitle: "Swing · 5–20 day hold", status: "active" as const, returnPct: 3.42, indexLabel: "01" },
  { id: "ra", name: "Regime Adaptive", subtitle: "Long/short macro", status: "active" as const, returnPct: 1.84, indexLabel: "02" },
  { id: "mr", name: "Mean Reversion", subtitle: "1–3 day", status: "paused" as const, returnPct: null, indexLabel: "04" },
];

function expectZeroTracking(container: HTMLElement) {
  const tracked = Array.from(container.querySelectorAll<HTMLElement>("[style*='letter-spacing']"));
  expect(tracked.length).toBeGreaterThan(0);
  for (const node of tracked) {
    expect(["0", "0px"]).toContain(node.style.letterSpacing);
  }
}

describe("StrategyRail", () => {
  it("renders one button per item", () => {
    const { container } = render(
      <StrategyRail items={items} selectedId="mq" />,
    );
    expect(container.querySelector('[data-slot="strategy-rail"]')).not.toBeNull();
    const buttons = container.querySelectorAll("button[data-selected], button");
    // At least 3 buttons for 3 items
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    expectZeroTracking(container);
  });

  it("marks the selected item with data-selected", () => {
    const { container } = render(
      <StrategyRail items={items} selectedId="mq" />,
    );
    const selected = container.querySelector("button[data-selected]");
    expect(selected).not.toBeNull();
    expect(selected?.textContent).toContain("Momentum");
  });

  it("renders em-dash placeholder for paused items", () => {
    const { container } = render(<StrategyRail items={items} />);
    expect(container.textContent).toContain("—");
    expect(container.textContent).toContain("Paused");
  });
});
