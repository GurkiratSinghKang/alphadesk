import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StatusBar from "@/components/composites/StatusBar";

describe("StatusBar", () => {
  it("renders all pills plus build hint and kbd", () => {
    const { container } = render(
      <StatusBar
        pills={[
          { label: "Alpaca paper · connected", tone: "profit" },
          { label: "Market · open", tone: "profit" },
          { label: "Claude · healthy", tone: "muted" },
          { label: "Last tick 0.04s", tone: "muted" },
        ]}
        buildVersion="2.4.1-edge"
      />,
    );
    expect(container.querySelector('[data-slot="status-bar"]')).not.toBeNull();
    expect(container.querySelector("kbd")?.textContent).toBe("⌘K");
    expect(container.textContent).toContain("Build 2.4.1-edge");
    expect(container.textContent).toContain("Alpaca paper");
  });
});
