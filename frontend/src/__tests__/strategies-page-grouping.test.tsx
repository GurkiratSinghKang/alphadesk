import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import StrategiesPage from "@/app/(dashboard)/strategies/page";

describe("/strategies design surface", () => {
  it("mounts the Claude strategy catalogue design surface", async () => {
    const { container } = render(<StrategiesPage />);
    await waitFor(() => {
      expect(container.querySelector('[data-design-surface="strategies"]')).not.toBeNull();
    });
  });

  it("does not show the old API fallback failure panel", async () => {
    const { container } = render(<StrategiesPage />);
    await waitFor(() => {
      expect(container.textContent).not.toMatch(/Couldn't load catalogue/i);
      expect(container.querySelector('[data-section="active"]')).toBeNull();
      expect(container.querySelector('[data-section="paused"]')).toBeNull();
    });
  });
});
