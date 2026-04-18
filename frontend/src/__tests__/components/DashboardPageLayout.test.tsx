import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";

describe("DashboardPageLayout", () => {
  it("renders eyebrow, title, and children", () => {
    const { container } = render(
      <DashboardPageLayout eyebrow="§ ANALYTICS" title="Portfolio analytics">
        <p data-testid="body">body content</p>
      </DashboardPageLayout>
    );
    expect(container.textContent).toContain("§ ANALYTICS");
    expect(container.textContent).toContain("Portfolio analytics");
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "body content"
    );
  });

  it("renders the optional actions slot", () => {
    const { container } = render(
      <DashboardPageLayout
        eyebrow="§ PIPELINE"
        title="Daily pipeline"
        actions={<button data-testid="cta">Run now</button>}
      >
        <span>body</span>
      </DashboardPageLayout>
    );
    expect(container.querySelector('[data-testid="cta"]')?.textContent).toBe(
      "Run now"
    );
  });

  it("uses an h1 for the title", () => {
    const { container } = render(
      <DashboardPageLayout eyebrow="§ REPORTS" title="Reports">
        <span>body</span>
      </DashboardPageLayout>
    );
    expect(container.querySelector("h1")?.textContent).toBe("Reports");
  });
});
