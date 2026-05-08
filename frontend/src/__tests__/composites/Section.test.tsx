import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import Section from "@/components/composites/Section";

describe("Section", () => {
  it("renders the title", () => {
    const { container } = render(
      <Section title="Risk dashboard">body</Section>,
    );
    expect(container.querySelector("[data-slot='section-title']")?.textContent).toBe(
      "Risk dashboard",
    );
  });

  it("renders the eyebrow when provided", () => {
    const { container } = render(
      <Section eyebrow="ADMIN · USERS" title="People & access" />,
    );
    expect(
      container.querySelector("[data-slot='section-eyebrow']")?.textContent,
    ).toBe("ADMIN · USERS");
  });

  it("hides the eyebrow when not provided", () => {
    const { container } = render(<Section title="Just a title" />);
    expect(container.querySelector("[data-slot='section-eyebrow']")).toBeNull();
  });

  it("hides the rule when rule={false}", () => {
    const { container } = render(
      <Section title="No rule" rule={false}>body</Section>,
    );
    expect(container.querySelector("[data-slot='section-rule']")).toBeNull();
  });

  it("renders the right slot", () => {
    const { container } = render(
      <Section title="With actions" right={<button>Apply</button>} />,
    );
    expect(container.querySelector("[data-slot='section-right']")).not.toBeNull();
  });

  it("emits the level data attribute", () => {
    const { container } = render(<Section title="t" level={1} />);
    expect(
      container.querySelector("[data-slot='section']")?.getAttribute("data-level"),
    ).toBe("1");
  });
});
