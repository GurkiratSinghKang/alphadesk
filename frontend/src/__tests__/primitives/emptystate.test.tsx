import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import EmptyState from "@/components/primitives/EmptyState";

describe("EmptyState", () => {
  it("renders title", () => {
    const { container } = render(<EmptyState title="No equity curve yet" />);
    const el = container.querySelector('[data-slot="empty-state"]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("No equity curve yet");
  });

  it("renders description when provided", () => {
    const { container } = render(
      <EmptyState title="No alerts set" description="Define a trigger above to start watching." />,
    );
    expect(container.textContent).toContain("Define a trigger above");
  });

  it("does not render description when omitted", () => {
    const { container } = render(<EmptyState title="No data" />);
    const p = container.querySelector("p");
    expect(p).toBeNull();
  });

  it("renders action button and calls onClick", () => {
    const onClick = vi.fn();
    const { getByText } = render(
      <EmptyState
        title="Pipeline hasn't run today"
        action={{ label: "Run now", onClick }}
      />,
    );
    const btn = getByText("Run now");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders icon slot when icon is provided", () => {
    const { container } = render(
      <EmptyState
        title="No positions"
        icon={<svg data-testid="icon" />}
      />,
    );
    expect(container.querySelector("[data-testid='icon']")).not.toBeNull();
  });

  it("applies custom className to wrapper", () => {
    const { container } = render(
      <EmptyState title="Test" className="h-[280px]" />,
    );
    const el = container.querySelector('[data-slot="empty-state"]');
    expect(el?.className).toContain("h-[280px]");
  });

  it("has role=status and aria-live=polite for accessibility", () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    const el = container.querySelector('[data-slot="empty-state"]');
    expect(el?.getAttribute("role")).toBe("status");
    expect(el?.getAttribute("aria-live")).toBe("polite");
  });
});
