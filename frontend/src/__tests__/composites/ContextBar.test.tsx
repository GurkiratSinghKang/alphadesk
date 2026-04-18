import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ContextBar from "@/components/composites/ContextBar";

describe("ContextBar", () => {
  it("renders one cell per entry", () => {
    const { container } = render(
      <ContextBar
        cells={[
          { label: "Book equity", value: "$284,193.42", emphasis: true, delta: "+0.82%", deltaTone: "profit" },
          { label: "Day P&L", value: "+$2,341.18", deltaTone: "profit" },
          { label: "Cash", value: "$47,812" },
        ]}
      />,
    );
    expect(container.querySelector('[data-slot="context-bar"]')).not.toBeNull();
    const rows = container.querySelectorAll('[data-slot="context-bar"] > div');
    expect(rows.length).toBe(3);
  });

  it("marks the emphasis cell with data-emphasis", () => {
    const { container } = render(
      <ContextBar
        cells={[
          { label: "Book equity", value: "$284,193.42", emphasis: true },
          { label: "Cash", value: "$47,812" },
        ]}
      />,
    );
    const hero = container.querySelector("[data-emphasis]");
    expect(hero).not.toBeNull();
    expect(hero?.textContent).toContain("284,193");
  });
});
