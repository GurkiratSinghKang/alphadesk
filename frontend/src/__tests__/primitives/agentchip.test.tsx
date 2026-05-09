import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import AgentChip from "@/components/primitives/AgentChip";

describe("AgentChip", () => {
  it("renders the archetype label by default", () => {
    const { container } = render(<AgentChip archetype="research" />);
    expect(container.textContent).toContain("Research");
  });

  it("emits the archetype + status data attributes for analytics", () => {
    const { container } = render(
      <AgentChip archetype="signal" status="running" />,
    );
    const chip = container.querySelector("[data-slot='agent-chip']");
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-archetype")).toBe("signal");
    expect(chip?.getAttribute("data-status")).toBe("running");
  });

  it("renders an aria-label that includes status", () => {
    const { container } = render(
      <AgentChip archetype="risk" status="failed" />,
    );
    const chip = container.querySelector("[role='img']");
    expect(chip?.getAttribute("aria-label")).toBe("Risk agent failed");
  });

  it("hides the status dot when hideStatus is true", () => {
    const { container } = render(
      <AgentChip archetype="exec" status="running" hideStatus />,
    );
    expect(container.querySelector("[data-slot='status-dot']")).toBeNull();
  });

  it("renders a custom label override", () => {
    const { container } = render(
      <AgentChip archetype="research" label="Atlas" />,
    );
    expect(container.textContent).toContain("Atlas");
    expect(container.textContent).not.toContain("Research");
  });

  it("uses the lg size class when size='lg'", () => {
    const { container } = render(<AgentChip archetype="signal" size="lg" />);
    const chip = container.querySelector("[data-slot='agent-chip']");
    expect(chip?.className).toContain("h-7");
    expect(chip?.className).toContain("text-label");
  });
});
