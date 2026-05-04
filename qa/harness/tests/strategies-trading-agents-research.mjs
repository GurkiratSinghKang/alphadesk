// qa/harness/tests/strategies-trading-agents-research.mjs
// /strategies/trading-agents-research — TradingAgents memo workflow.
// Captures the run form, runs sidebar, refresh affordances, and memo sections.
export const spec = {
  name: "strategies-trading-agents-research",
  route: "/strategies/trading-agents-research",
  requiresAuth: true,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/strategies/trading-agents-research" },
    { kind: "wait", for: "networkidle", timeout: 20000 },
    { kind: "snapshot", label: "initial" },

    // Hover the runtime refresh button to surface tooltip.
    {
      kind: "hover-first-if-present",
      selector: "[aria-label='Refresh TradingAgents runtime']",
      waitFor: 300,
    },
    { kind: "snapshot", label: "runtime-refresh-hover" },

    // Click an existing run if any — to populate the memo view.
    {
      kind: "click-if-present",
      selector: "nav[aria-label='TradingAgents memo sections'] a, [data-testid^=tar-run]",
      label: "select-existing-run",
    },
    { kind: "wait", for: "networkidle", timeout: 8000 },
    { kind: "snapshot", label: "run-selected" },

    { kind: "scroll", y: 800 },
    { kind: "snapshot", label: "scrolled-mid" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
