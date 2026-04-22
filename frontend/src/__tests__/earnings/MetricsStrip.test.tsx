import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MetricsStrip from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/MetricsStrip";

describe("MetricsStrip", () => {
  it("renders IV rank, IV %ile, HV/IV, expected move, hist |move|, beat rate, DTE", () => {
    const { container } = render(
      <MetricsStrip metrics={{
        iv_rank: 78, iv_percentile: 82, current_iv: 0.79,
        hv_20: 0.42, hv_50: null, hv_100: null, hv_iv_ratio: 0.71,
        expected_move_pct: 0.064, expected_move_dollars: 12.8,
        hist_avg_abs_move_pct: 0.052, beat_rate: 0.87,
        days_to_earnings: 1, days_to_expiry: 3,
      }} />,
    );
    expect(container.textContent).toContain("78");
    expect(container.textContent).toContain("82");
    expect(container.textContent).toContain("0.71");
    expect(container.textContent).toMatch(/±6\.4%|6\.40%/);
    expect(container.textContent).toMatch(/±5\.2%|5\.20%/);
    expect(container.textContent).toMatch(/87/);
    expect(container.textContent).toContain("3"); // DTE
  });

  it("renders em-dash for missing metrics", () => {
    const { container } = render(<MetricsStrip metrics={null} />);
    expect(container.textContent).toContain("—");
  });
});
