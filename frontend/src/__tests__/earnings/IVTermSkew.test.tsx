import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import IVTermSkew from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/IVTermSkew";

describe("IVTermSkew", () => {
  const term = [
    { expiry: "2026-04-25", dte: 3, atmIv: 0.79 },
    { expiry: "2026-05-02", dte: 10, atmIv: 0.58 },
    { expiry: "2026-05-16", dte: 24, atmIv: 0.48 },
  ];
  const skew = {
    putIv25d: 0.82, callIv25d: 0.77, skewPoints: 3.2,
    interpretation: "put-heavy skew" as const,
  };

  it("renders term structure plot points + labels", () => {
    const { container } = render(<IVTermSkew term={term} skew={skew} />);
    expect(container.textContent).toMatch(/IV term/i);
    expect(container.textContent).toMatch(/79|78|0\.79/);
    expect(container.textContent).toMatch(/skew/i);
    expect(container.textContent).toMatch(/put-heavy|put heavy/i);
  });

  it("renders empty state when both missing", () => {
    const { container } = render(<IVTermSkew term={null} skew={null} />);
    expect(container.textContent).toMatch(/unavailable|—/i);
  });

  // ── EOP-AUDIT 2026-05-06 / B1.4 additions ────────────────────
  it("adds margin between the IV term title and the bars (B1.4)", () => {
    const { container } = render(<IVTermSkew term={term} skew={skew} />);
    const title = container.querySelector("h3");
    expect(title).not.toBeNull();
    // ``mb-2`` puts vertical breathing room between title and bars.
    expect(title?.className).toMatch(/mb-2/);
  });

  it("renders a tooltip + aria-label on every term-structure bar (B1.4)", () => {
    const { container } = render(<IVTermSkew term={term} skew={skew} />);
    const bars = container.querySelectorAll('[data-slot="iv-term-bar"]');
    expect(bars.length).toBe(term.length);
    bars.forEach((bar, idx) => {
      const tt = bar.getAttribute("title") ?? "";
      // Each tooltip names expiry, DTE, ATM IV, and a "vs prior"
      // context (either the previous bar or "no prior session").
      expect(tt).toContain(term[idx].expiry);
      expect(tt).toContain(`${term[idx].dte} DTE`);
      expect(tt).toMatch(/ATM IV/i);
      expect(tt).toMatch(/prior/i);
    });
  });

  it("stamps min/max IV labels on the chart axis (B1.4)", () => {
    const { container } = render(<IVTermSkew term={term} skew={skew} />);
    const axisMax = container.querySelector('[data-slot="iv-term-axis-max"]');
    const axisMin = container.querySelector('[data-slot="iv-term-axis-min"]');
    expect(axisMax).not.toBeNull();
    expect(axisMin).not.toBeNull();
    // Both labels should render a percent (formatted with no decimals).
    expect(axisMax!.textContent).toMatch(/%/);
    expect(axisMin!.textContent).toMatch(/%/);
  });
});
