import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import HistoricalMoves from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/HistoricalMoves";

describe("HistoricalMoves", () => {
  const historical = {
    quarters: [
      { reportDate: "2025-01-22", surprisePct: 0.08, nextDayMovePct: 0.042, fiveDayMovePct: 0.053 },
      { reportDate: "2024-10-22", surprisePct: -0.02, nextDayMovePct: -0.081, fiveDayMovePct: -0.023 },
      { reportDate: "2024-07-22", surprisePct: 0.05, nextDayMovePct: 0.034, fiveDayMovePct: 0.041 },
      { reportDate: "2024-04-22", surprisePct: 0.12, nextDayMovePct: 0.090, fiveDayMovePct: 0.110 },
    ],
    stats: { avgAbsMovePct: 0.062, wins: 3, losses: 1, surpriseBeatRate: 1.0, ivVsHistVolPoints: 1.2 },
  };

  it("renders one bar per quarter + stats block", () => {
    const { container } = render(<HistoricalMoves historical={historical} />);
    const bars = container.querySelectorAll('[data-slot="hist-bar"]');
    expect(bars.length).toBe(4);
    expect(container.textContent).toMatch(/±6\.2%|6\.20%/);
    expect(container.textContent).toMatch(/3W \/ 1L|3 wins/i);
  });

  it("shows empty state when no historical", () => {
    const { container } = render(<HistoricalMoves historical={null} />);
    expect(container.textContent).toMatch(/unavailable|no history|—/i);
  });

  it("color-codes wins (pos) vs losses (neg) bars", () => {
    const { container } = render(<HistoricalMoves historical={historical} />);
    const positive = container.querySelectorAll('[data-sign="pos"]');
    const negative = container.querySelectorAll('[data-sign="neg"]');
    expect(positive.length).toBe(3);
    expect(negative.length).toBe(1);
  });
});
