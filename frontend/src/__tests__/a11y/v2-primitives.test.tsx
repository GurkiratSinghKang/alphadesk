/**
 * Phase 4 — v2 a11y audit (jest-axe equivalent via direct axe-core).
 *
 * Sweeps the v2 primitive surface for WCAG 2.1 AA violations using
 * axe-core directly (jest-axe isn't installed; axe-core is). The
 * suite renders each primitive in isolation, runs a synchronous
 * axe.run, and asserts no violations of impact ≥ "serious".
 *
 * Per the v2 plan §Phase 4: a11y is implicit through Phase 0a tokens
 * (LCH contrast, 44px touch-target floor, focus rings on warm gold,
 * prefers-reduced-motion, tabular-nums, aria-live banners). This
 * automated sweep catches regressions; manual screen-reader checks
 * remain a launch-readiness item.
 *
 * Color-contrast checks are disabled in jsdom because jsdom has no
 * layout engine and can't compute computed-style colors. Manual
 * contrast verification ships via the /_design page screenshots
 * captured in Phase 0e.
 */
import "../setup-mocks";

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import axe from "axe-core";

import AgentChip from "@/components/primitives/AgentChip";
import EmptyState from "@/components/primitives/EmptyState";
import Stat from "@/components/primitives/Stat";
import StatusDot from "@/components/primitives/StatusDot";
import Section from "@/components/composites/Section";
import StatusBanner from "@/components/composites/StatusBanner";
import ControlModule from "@/components/composites/ControlModule";

/**
 * Axe rules disabled per surface. Color-contrast is deferred to
 * the visual-regression pass on /_design (jsdom can't compute
 * actual colors). region rule complains when a fragment isn't
 * wrapped in a landmark — fine when the fragment is mounted in
 * a real <main> on the page; off here.
 */
const DISABLED_RULES = ["color-contrast", "region"];

async function runAxe(container: HTMLElement): Promise<axe.AxeResults> {
  return axe.run(container, {
    rules: Object.fromEntries(
      DISABLED_RULES.map((id) => [id, { enabled: false }]),
    ),
    resultTypes: ["violations"],
  });
}

function expectNoSeriousViolations(results: axe.AxeResults): void {
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  if (serious.length > 0) {
    const dump = serious
      .map(
        (v) =>
          `${v.id} (${v.impact}): ${v.help}\n  → ${v.nodes
            .map((n) => n.html.slice(0, 200))
            .join("\n  → ")}`,
      )
      .join("\n\n");
    throw new Error(`Axe violations:\n${dump}`);
  }
  expect(serious).toHaveLength(0);
}

describe("Phase 4 a11y audit — v2 primitives", () => {
  it("AgentChip is axe-clean across all archetypes + statuses", async () => {
    const { container } = render(
      <div>
        <AgentChip archetype="research" status="idle" />
        <AgentChip archetype="signal" status="running" />
        <AgentChip archetype="risk" status="failed" />
        <AgentChip archetype="exec" status="queued" />
      </div>,
    );
    expectNoSeriousViolations(await runAxe(container));
  });

  it("EmptyState is axe-clean with eyebrow + action", async () => {
    const { container } = render(
      <main>
        <EmptyState
          eyebrow="QUIET"
          title="Inbox is quiet."
          description="When fills, agent runs, or risk gates fire, they appear here."
          action={{ label: "Open dashboard", onClick: () => {} }}
        />
      </main>,
    );
    expectNoSeriousViolations(await runAxe(container));
  });

  it("Section is axe-clean at level 1 + level 2", async () => {
    const { container } = render(
      <main>
        <Section eyebrow="ADMIN · USERS" title="People & access" level={1}>
          <p>Body content.</p>
        </Section>
        <Section title="Sub-section" level={2}>
          <p>More content.</p>
        </Section>
      </main>,
    );
    expectNoSeriousViolations(await runAxe(container));
  });

  it("Stat is axe-clean across all tones", async () => {
    const { container } = render(
      <main>
        <Stat label="Equity" value="$1,790,240" sub="+1.24% MTD" tone="profit" />
        <Stat label="Day P&L" value="-$612" tone="loss" />
        <Stat label="Open positions" value={14} tone="brand" />
      </main>,
    );
    expectNoSeriousViolations(await runAxe(container));
  });

  it("StatusBanner is axe-clean for info/warn/crit tones with actions", async () => {
    const { container } = render(
      <main>
        <StatusBanner tone="info" message="Demo data only" action={{ label: "Configure", href: "/admin" }} />
        <StatusBanner tone="warn" message="Connection slow" action={{ label: "Reconnect", onClick: () => {} }} />
        <StatusBanner tone="crit" message="Pipeline halted" dismissable onDismiss={() => {}} />
      </main>,
    );
    expectNoSeriousViolations(await runAxe(container));
  });

  it("ControlModule is axe-clean (default + critical + scoped + footer)", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { container } = render(
      <main>
        <ControlModule
          name="Trade halt"
          desc="Stop the order flow at the gate."
          control={<button type="button">Toggle</button>}
          lastBy="operator"
          lastAt={oneHourAgo}
          auditHref="/admin/audit?focus=trade-halt"
        />
        <ControlModule
          name="Sector cap"
          desc="Maximum sector exposure."
          control={<input type="number" defaultValue={35} aria-label="Sector cap percentage" />}
          critical
          lastBy="system"
          lastAt={oneHourAgo}
        />
        <ControlModule
          name="Daily budget"
          control={<input type="number" defaultValue={500} aria-label="Daily budget" />}
          scope="user"
          inheritedFrom="Set by operator · $25,000 · request change"
        />
      </main>,
    );
    expectNoSeriousViolations(await runAxe(container));
  });

  it("StatusDot is axe-clean (every tone + pulse + size)", async () => {
    const { container } = render(
      <div>
        <StatusDot tone="profit" />
        <StatusDot tone="loss" pulse />
        <StatusDot tone="ice" size={5} />
        <StatusDot tone="amber" size={7} />
        <StatusDot tone="wine" />
        <StatusDot tone="brand" pulse size={8} />
        <StatusDot tone="muted" />
      </div>,
    );
    expectNoSeriousViolations(await runAxe(container));
  });
});
