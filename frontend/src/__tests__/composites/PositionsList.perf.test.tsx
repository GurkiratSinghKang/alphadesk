import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PositionsList from "@/components/composites/PositionsList";
import type { PositionRow } from "@/components/composites/types";

function makeRows(n: number): PositionRow[] {
  const rows: PositionRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `row-${i}`,
      symbol: `SYM${i}`,
      quantity: 100 + i,
      entryPrice: 100 + (i % 50),
      strategyName: `Strategy ${i % 5}`,
      progress: ((i % 200) - 100) / 100,
      pnl: (i % 400) - 200,
      pnlPct: ((i % 400) - 200) / 100,
    });
  }
  return rows;
}

describe("PositionsList 500-row stress", () => {
  it("renders 500 DOM body rows (NO virtualization)", () => {
    const rows = makeRows(500);
    const t0 = performance.now();
    const { container } = render(
      <PositionsList positions={rows} activeTab="positions" />,
    );
    const mountMs = performance.now() - t0;
    // Wave E refactored the list to a real <table>; count body rows.
    const items = container.querySelectorAll("tbody tr");
    // eslint-disable-next-line no-console
    console.log(`[perf] mount 500 rows: ${mountMs.toFixed(1)}ms  tr=${items.length}`);
    // If virtualized, items.length would be ~visible rows (20–30).
    // The non-virtualized implementation renders all 500.
    expect(items.length).toBe(500);
  });
});
