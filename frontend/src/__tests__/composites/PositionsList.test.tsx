import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PositionsList from "@/components/composites/PositionsList";

const rows = [
  {
    id: "1",
    symbol: "NVDA",
    quantity: 250,
    entryPrice: 128.41,
    strategyName: "Momentum & Quality",
    progress: 0.72,
    pnl: 1602,
    pnlPct: 5.0,
  },
  {
    id: "2",
    symbol: "UNH",
    quantity: 40,
    entryPrice: 588.2,
    strategyName: "Claude Alpha",
    progress: 0.38,
    pnl: -258,
    pnlPct: -1.1,
  },
];

describe("PositionsList", () => {
  it("renders one row per position with tabs", () => {
    const { container } = render(
      <PositionsList positions={rows} activeTab="positions" />,
    );
    expect(container.querySelector('[data-slot="positions-list"]')).not.toBeNull();
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toContain("UNH");
    // count label
    expect(container.textContent).toContain("2");
  });

  it("sets aria-selected on the active tab", () => {
    const { container } = render(
      <PositionsList positions={rows} activeTab="orders" />,
    );
    const selected = container.querySelector('[role="tab"][aria-selected="true"]');
    // Wave 28: tab labels are title-cased ("Orders" not "orders") and
    // include the per-tab count when non-zero — assert on the visible
    // prefix to stay resilient to that formatting.
    expect(selected?.textContent?.toLowerCase()).toContain("orders");
  });
});
