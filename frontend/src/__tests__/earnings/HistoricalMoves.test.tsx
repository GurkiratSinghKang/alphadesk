import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import HistoricalMoves from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/HistoricalMoves";

describe("HistoricalMoves", () => {
  const historical = {
    quarters: [
      { report_date: "2025-01-22", surprise_pct: 0.08, next_day_move_pct: 0.042, five_day_move_pct: 0.053 },
      { report_date: "2024-10-22", surprise_pct: -0.02, next_day_move_pct: -0.081, five_day_move_pct: -0.023 },
      { report_date: "2024-07-22", surprise_pct: 0.05, next_day_move_pct: 0.034, five_day_move_pct: 0.041 },
      { report_date: "2024-04-22", surprise_pct: 0.12, next_day_move_pct: 0.090, five_day_move_pct: 0.110 },
    ],
    stats: { avg_abs_move_pct: 0.062, wins: 3, losses: 1, surprise_beat_rate: 1.0, iv_vs_hist_vol_points: 1.2 },
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
