import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusBar from "@/components/composites/StatusBar";

// BUG-02 / PR-5: StatusBar was refactored from a flat mono-pill rail
// to a single popover-pill trigger. Tests updated accordingly.

describe("StatusBar", () => {
  it("renders status-bar slot and ⌘K kbd", () => {
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
  });

  it("renders the collapsed popover trigger with build version", () => {
    render(
      <StatusBar
        pills={[{ label: "Alpaca paper · connected", tone: "profit" }]}
        buildVersion="2.4.1-edge"
      />,
    );
    // The trigger button text includes build version (lowercase "build" is intentional)
    expect(screen.getByText(/build 2\.4\.1-edge/)).toBeDefined();
  });

  it("shows System OK when all pills are healthy", () => {
    render(
      <StatusBar
        pills={[
          { label: "Alpaca paper · connected", tone: "profit" },
          { label: "Market · open", tone: "profit" },
        ]}
        buildVersion="1.0.0"
      />,
    );
    expect(screen.getByText(/System OK/)).toBeDefined();
  });

  it("shows Degraded when any pill has amber tone", () => {
    render(
      <StatusBar
        pills={[
          { label: "Alpaca paper · connected", tone: "profit" },
          { label: "Mode · PAPER", tone: "amber" },
        ]}
        buildVersion="1.0.0"
      />,
    );
    expect(screen.getByText(/Degraded/)).toBeDefined();
  });
});
