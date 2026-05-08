import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import ControlModule from "@/components/composites/ControlModule";

describe("ControlModule", () => {
  it("renders name + description", () => {
    const { container } = render(
      <ControlModule
        name="Trade halt"
        desc="Stop the order flow at the gate."
        control={<button>Toggle</button>}
      />,
    );
    expect(
      container.querySelector("[data-slot='control-module-name']")?.textContent,
    ).toContain("Trade halt");
    expect(container.textContent).toContain("Stop the order flow");
  });

  it("renders the supplied control surface", () => {
    const { container } = render(
      <ControlModule
        name="Cap"
        control={<input data-testid="ctrl" type="number" />}
      />,
    );
    expect(container.querySelector("[data-testid='ctrl']")).not.toBeNull();
  });

  it("applies critical styling when critical=true", () => {
    const { container } = render(
      <ControlModule name="Sector cap" control={<div />} critical />,
    );
    const card = container.querySelector("[data-slot='control-module']");
    expect(card?.getAttribute("data-critical")).toBe("true");
    expect(card?.className).toContain("border-loss");
  });

  it("renders the audit footer when lastBy + lastAt + auditHref present", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { container } = render(
      <ControlModule
        name="Capital cap"
        control={<div />}
        lastBy="operator"
        lastAt={oneHourAgo}
        auditHref="/admin/audit?focus=cap"
      />,
    );
    const footer = container.querySelector("[data-slot='control-module-footer']");
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain("by operator");
    expect(footer?.textContent).toContain("ago");
    expect(container.querySelector("a[href='/admin/audit?focus=cap']")).not.toBeNull();
  });

  it("renders scope label when scope != system", () => {
    const { container } = render(
      <ControlModule name="Daily budget" control={<div />} scope="user" />,
    );
    const scopeBadge = container.querySelector("[data-slot='control-module-scope']");
    expect(scopeBadge?.textContent?.trim()).toContain("user");
  });

  it("renders the inheritance hint when set by operator", () => {
    const { container } = render(
      <ControlModule
        name="Capital cap"
        control={<div />}
        scope="user"
        inheritedFrom="Set by operator · $25,000 · request change"
      />,
    );
    expect(
      container.querySelector("[data-slot='control-module-inheritance']")?.textContent,
    ).toContain("Set by operator");
  });

  it("emits the permission data attribute", () => {
    const { container } = render(
      <ControlModule name="Key" control={<div />} permission="write-secret" />,
    );
    expect(
      container.querySelector("[data-slot='control-module']")?.getAttribute("data-permission"),
    ).toBe("write-secret");
  });
});
