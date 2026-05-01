import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TopBar from "@/components/composites/TopBar";

const baseRegime = { regime: "bull", vol: "low" } as const;

function expectZeroTracking(container: HTMLElement) {
  const tracked = Array.from(container.querySelectorAll<HTMLElement>("[style*='letter-spacing']"));
  expect(tracked.length).toBeGreaterThan(0);
  for (const node of tracked) {
    expect(["0", "0px"]).toContain(node.style.letterSpacing);
  }
}

describe("TopBar", () => {
  it("renders with data-slot and the logo", () => {
    const { container } = render(
      <TopBar
        currentRoute="/"
        routes={[{ label: "Desk", href: "/", active: true }]}
        regime={baseRegime}
        clockEt="14:32:08 ET"
        avatarInitial="α"
      />,
    );
    const el = container.querySelector('[data-slot="top-bar"]');
    expect(el).not.toBeNull();
    expect(container.textContent).toContain("AlphaDesk");
    expect(container.textContent).toContain("Desk");
    expect(container.textContent).toContain("14:32:08");
    expectZeroTracking(container);
  });

  it("marks the active route with data-active", () => {
    const { container } = render(
      <TopBar
        currentRoute="/desk"
        routes={[
          { label: "Overview", href: "/" },
          { label: "Desk", href: "/desk" },
        ]}
        regime={baseRegime}
        clockEt="—"
        avatarInitial="α"
      />,
    );
    const active = container.querySelectorAll("a[data-active]");
    expect(active.length).toBe(1);
    expect(active[0].textContent).toBe("Desk");
  });

  it("keeps the theme toggle available in the dashboard top bar", () => {
    const { getByRole } = render(
      <TopBar
        currentRoute="/"
        routes={[{ label: "Desk", href: "/", active: true }]}
        regime={baseRegime}
        clockEt="14:32:08 ET"
        avatarInitial="α"
      />,
    );

    expect(getByRole("button", { name: /switch to .* mode/i })).toBeDefined();
  });
});
