import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import AIMemoPanel from "@/components/composites/AIMemoPanel";

const memo = {
  text: "NVDA entry fits Momentum & Quality — 3-week high, regime bull/low-vol.",
  chips: [
    { label: "Regime fit 0.82", tone: "profit" as const },
    { label: "Risk ok", tone: "ice" as const },
    { label: "Earn 14d", tone: "muted" as const },
  ],
  confidence: 0.72,
  model: "Haiku 4.5",
  latencyMs: 180,
  timestamp: "14:32:08",
};

describe("AIMemoPanel", () => {
  it("renders the eyebrow, body and all chips", () => {
    const { container } = render(<AIMemoPanel memo={memo} />);
    expect(container.querySelector('[data-slot="ai-memo-panel"]')).not.toBeNull();
    expect(container.textContent).toContain("AI · Pre-trade memo");
    expect(container.textContent).toContain("NVDA entry fits");
    expect(container.textContent).toContain("Regime fit 0.82");
    expect(container.textContent).toContain("Haiku 4.5");
    expect(container.textContent).toContain("180 ms");
  });

  it("renders the pulsing brand StatusDot", () => {
    const { container } = render(<AIMemoPanel memo={memo} />);
    const dot = container.querySelector('[data-slot="status-dot"][data-tone="brand"]');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("data-pulse")).toBe("on");
  });
});
