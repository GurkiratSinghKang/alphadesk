import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { AboutAnalystPeersStub } from "../_sections/AboutAnalystPeersStub";
import { AgentsDebateStub } from "../_sections/AgentsDebateStub";

// T11: StrategyReverseLookupStub was deleted along with its assertions;
// the section is now wired to a real backend via StrategyReverseLookup.
// See StrategyReverseLookup.test.tsx for the live coverage.

describe("AgentsDebateStub", () => {
  it("anchors at id='agents' with scroll-mt-24", () => {
    const { getByTestId } = render(<AgentsDebateStub />);
    const stub = getByTestId("agents-debate-stub");
    expect(stub.getAttribute("id")).toBe("agents");
    expect(stub.className).toContain("scroll-mt-24");
  });

  it("renders exactly 1 ghost card with h-72", () => {
    const { container } = render(<AgentsDebateStub />);
    const ghosts = container.querySelectorAll('[data-slot="ghost-card"]');
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].className).toContain("h-72");
  });

  it("renders the 'Coming soon' eyebrow", () => {
    const { getByTestId } = render(<AgentsDebateStub />);
    expect(getByTestId("agents-debate-stub").textContent).toContain("Coming soon");
  });
});

describe("AboutAnalystPeersStub", () => {
  it("anchors at id='about' with scroll-mt-24", () => {
    const { getByTestId } = render(<AboutAnalystPeersStub />);
    const stub = getByTestId("about-analyst-peers-stub");
    expect(stub.getAttribute("id")).toBe("about");
    expect(stub.className).toContain("scroll-mt-24");
  });

  it("renders 3 panels each with an h-40 ghost card", () => {
    const { container } = render(<AboutAnalystPeersStub />);
    const panels = container.querySelectorAll('[data-slot="about-panel"]');
    expect(panels).toHaveLength(3);
    const ghosts = container.querySelectorAll('[data-slot="ghost-card"]');
    expect(ghosts).toHaveLength(3);
    ghosts.forEach((g) => expect(g.className).toContain("h-40"));
  });

  it("renders the 'Coming soon' eyebrow on each panel", () => {
    const { getByTestId } = render(<AboutAnalystPeersStub />);
    const matches = getByTestId("about-analyst-peers-stub").textContent?.match(/Coming soon/g) ?? [];
    expect(matches).toHaveLength(3);
  });
});
