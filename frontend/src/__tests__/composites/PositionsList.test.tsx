import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

function expectZeroTracking(container: HTMLElement) {
  const tracked = Array.from(container.querySelectorAll<HTMLElement>("[style*='letter-spacing']"));
  expect(tracked.length).toBeGreaterThan(0);
  for (const node of tracked) {
    expect(["0", "0px"]).toContain(node.style.letterSpacing);
  }
}

describe("PositionsList", () => {
  it("renders one row per position with tabs", () => {
    const { container } = render(
      <PositionsList positions={rows} activeTab="positions" />,
    );
    expect(container.querySelector('[data-slot="positions-list"]')).not.toBeNull();
    // Wave E refactored the list to a real <table>; count body rows.
    const items = container.querySelectorAll("tbody tr");
    expect(items.length).toBe(2);
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toContain("UNH");
    // count label
    expect(container.textContent).toContain("2");
    expectZeroTracking(container);
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

  it("allows submitted and open orders to be cancelled", () => {
    render(
      <PositionsList
        positions={[]}
        activeTab="orders"
        onCancelOrder={() => {}}
        orders={[
          {
            id: "submitted-1",
            symbol: "AAPL",
            side: "buy",
            type: "limit",
            quantity: 1,
            status: "submitted",
          },
          {
            id: "open-1",
            symbol: "MSFT",
            side: "sell",
            type: "limit",
            quantity: 2,
            status: "open",
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("button", { name: /^Cancel .* order / })).toHaveLength(2);
  });
});
