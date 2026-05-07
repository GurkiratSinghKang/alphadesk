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
    // Batch E P0-04: real version strings render as "v{version}" so readers
    // can scan them as a deploy stamp. The legacy "build dev" placeholder
    // still renders that way for the dev-mode fallback (see "dev" test below).
    expect(screen.getByText(/v2\.4\.1-edge/)).toBeDefined();
  });

  it('renders "build dev" placeholder when buildVersion is "dev"', () => {
    render(
      <StatusBar
        pills={[{ label: "Alpaca paper · connected", tone: "profit" }]}
        buildVersion="dev"
      />,
    );
    // The dev fallback keeps the lowercase "build dev" copy so it doesn't
    // read as a fake semver "vdev" in local development.
    expect(screen.getByText(/build dev/)).toBeDefined();
  });

  it("shows Operational when all pills are healthy", () => {
    render(
      <StatusBar
        pills={[
          { label: "Alpaca paper · connected", tone: "profit" },
          { label: "Market · open", tone: "profit" },
        ]}
        buildVersion="1.0.0"
      />,
    );
    // Batch E P0-04: aggregate fallback says "Operational" when no amber,
    // matching the new explicit "operational" health state vocabulary.
    expect(screen.getByText(/Operational/)).toBeDefined();
  });

  it("shows Degraded when any pill has amber tone (legacy fallback)", () => {
    render(
      <StatusBar
        pills={[
          { label: "Alpaca paper · connected", tone: "profit" },
          { label: "Market data · delayed", tone: "amber" },
        ]}
        buildVersion="1.0.0"
      />,
    );
    expect(screen.getByText(/Degraded/)).toBeDefined();
  });

  it("does not treat paper mode as degraded in fallback aggregation", () => {
    render(
      <StatusBar
        pills={[
          { label: "Alpaca paper · connected", tone: "profit" },
          { label: "Mode · PAPER", tone: "amber" },
        ]}
        buildVersion="1.0.0"
      />,
    );
    expect(screen.getByText(/Operational/)).toBeDefined();
  });

  it("respects explicit healthState prop over pill aggregation", () => {
    // Batch E P0-04: deploy-controller-supplied health state wins. A PAPER
    // pill (amber tone) must NOT flip the bar to Degraded if the deploy
    // is actually operational — PAPER is a chosen mode, not a degradation.
    render(
      <StatusBar
        pills={[
          { label: "Alpaca paper · connected", tone: "profit" },
          { label: "Mode · PAPER", tone: "amber" },
        ]}
        buildVersion="2026.05.05-abc1234"
        healthState="operational"
      />,
    );
    expect(screen.getByText(/Operational/)).toBeDefined();
  });
});
