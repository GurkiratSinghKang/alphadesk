import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MetricsStrip from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/MetricsStrip";

describe("MetricsStrip", () => {
  it("renders IV rank, IV %ile, HV/IV, expected move, hist |move|, beat rate, DTE", () => {
    const { container } = render(
      <MetricsStrip metrics={{
        ivRank: 78, ivPercentile: 82, currentIv: 0.79,
        hv20: 0.42, hv50: null, hv100: null, hvIvRatio: 0.71,
        expectedMovePct: 0.064, expectedMoveDollars: 12.8,
        histAvgAbsMovePct: 0.052, beatRate: 0.87,
        daysToEarnings: 1, daysToExpiry: 3,
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
