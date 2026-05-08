import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import StatusBanner from "@/components/composites/StatusBanner";

describe("StatusBanner", () => {
  it.each(["info", "warn", "crit"] as const)(
    "renders message at tone=%s",
    (tone) => {
      const { container } = render(
        <StatusBanner tone={tone} message={`a ${tone} message`} />,
      );
      const banner = container.querySelector("[data-slot='status-banner']");
      expect(banner).not.toBeNull();
      expect(banner?.getAttribute("data-tone")).toBe(tone);
      expect(banner?.textContent).toContain(`a ${tone} message`);
    },
  );

  it("uses aria-live=assertive on crit tone", () => {
    const { container } = render(
      <StatusBanner tone="crit" message="Pipeline halted" />,
    );
    expect(
      container.querySelector("[data-slot='status-banner']")?.getAttribute("aria-live"),
    ).toBe("assertive");
  });

  it("uses aria-live=polite on info tone", () => {
    const { container } = render(
      <StatusBanner tone="info" message="Heartbeat ok" />,
    );
    expect(
      container.querySelector("[data-slot='status-banner']")?.getAttribute("aria-live"),
    ).toBe("polite");
  });

  it("renders an action with onClick", () => {
    const onClick = vi.fn();
    const { getByText } = render(
      <StatusBanner
        tone="warn"
        message="Connection slow"
        action={{ label: "Reconnect", onClick }}
      />,
    );
    fireEvent.click(getByText("Reconnect"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders an action as a link when href provided", () => {
    const { container } = render(
      <StatusBanner
        tone="info"
        message="Demo data only"
        action={{ label: "Configure", href: "/admin/control-center" }}
      />,
    );
    const link = container.querySelector("a[href='/admin/control-center']");
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("Configure");
  });

  it("renders dismiss button when dismissable + onDismiss", () => {
    const onDismiss = vi.fn();
    const { getByLabelText } = render(
      <StatusBanner
        tone="info"
        message="Banner"
        dismissable
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(getByLabelText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
