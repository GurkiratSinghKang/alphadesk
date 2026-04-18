import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import EditorialNameplate from "@/components/composites/EditorialNameplate";

describe("EditorialNameplate", () => {
  it("renders all editorial fields", () => {
    const { container } = render(
      <EditorialNameplate
        volume="III"
        issue="04"
        title="Quiet money, loud math"
        date="2026-04-17"
      />,
    );
    expect(container.querySelector('[data-slot="editorial-nameplate"]')).not.toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain("AlphaDesk");
    expect(text).toContain("Vol. III");
    expect(text).toContain("Issue 04");
    expect(text).toContain("Quiet money");
    expect(text).toContain("2026-04-17");
  });
});
