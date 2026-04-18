import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ClaudeStamp from "@/components/composites/ClaudeStamp";

describe("ClaudeStamp", () => {
  it("renders model + confidence + latency + approved when all supplied", () => {
    const { container } = render(
      <ClaudeStamp
        model="Haiku 4.5"
        confidence={0.72}
        latencyMs={180}
        approvedAt="14:28 ET"
        approved
      />,
    );
    const el = container.querySelector('[data-slot="claude-stamp"]') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute("data-approved")).toBe("true");
    const text = el.textContent ?? "";
    expect(text).toContain("Haiku 4.5");
    expect(text).toContain("confidence 0.72");
    expect(text).toContain("180 ms");
    expect(text).toContain("approved 14:28 ET");
  });

  it("omits optional fields when not passed", () => {
    const { container } = render(<ClaudeStamp model="Haiku 4.5" />);
    const el = container.querySelector('[data-slot="claude-stamp"]') as HTMLElement;
    expect(el.textContent).toContain("Haiku 4.5");
    expect(el.textContent).not.toContain("confidence");
    expect(el.textContent).not.toContain("ms");
    expect(el.getAttribute("data-approved")).toBeNull();
  });
});
