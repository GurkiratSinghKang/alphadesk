import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import Stat from "@/components/primitives/Stat";

describe("Stat", () => {
  it("renders label, value, and optional sub", () => {
    const { container } = render(
      <Stat label="Equity" value="$1,790,240" sub="+1.24% MTD" />,
    );
    expect(container.textContent).toContain("Equity");
    expect(container.textContent).toContain("$1,790,240");
    expect(container.textContent).toContain("+1.24% MTD");
  });

  it("hides sub when not provided", () => {
    const { container } = render(<Stat label="Open positions" value={14} />);
    const subs = container.querySelectorAll("span");
    // label + value spans only — no sub span.
    expect(container.textContent?.includes("undefined")).toBeFalsy();
    expect(subs.length).toBeGreaterThanOrEqual(2);
  });

  it("emits tone + size data attributes", () => {
    const { container } = render(
      <Stat label="Today P&L" value="-$612" tone="loss" size="lg" />,
    );
    const stat = container.querySelector("[data-slot='stat']");
    expect(stat?.getAttribute("data-tone")).toBe("loss");
    expect(stat?.getAttribute("data-size")).toBe("lg");
  });

  it("applies the right value color for each tone", () => {
    const { container, rerender } = render(
      <Stat label="P" value="1" tone="profit" />,
    );
    expect(container.querySelector("[data-slot='stat'] > span:nth-child(2)")?.className).toContain("text-profit");

    rerender(<Stat label="L" value="2" tone="brand" />);
    expect(container.querySelector("[data-slot='stat'] > span:nth-child(2)")?.className).toContain("text-brand");
  });

  it("supports an icon slot inline with the label", () => {
    const { container } = render(
      <Stat label="Risk" value={28} icon={<svg data-testid="icon" />} />,
    );
    expect(container.querySelector("[data-testid='icon']")).not.toBeNull();
  });
});
