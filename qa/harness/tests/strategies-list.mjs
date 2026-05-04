// qa/harness/tests/strategies-list.mjs
// /strategies — strategies catalogue. Covers initial render, the readiness
// filter radiogroup, hovering a strategy card, and full-page scroll.
export const spec = {
  name: "strategies-list",
  route: "/strategies",
  requiresAuth: true,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/strategies" },
    // Strategies has long-poll/SSE that blocks true networkidle — give the
    // page a fixed grace period (waitForReady already ran inside navigate).
    { kind: "wait", timeout: 2000 },
    { kind: "snapshot", label: "initial" },

    // Readiness filter radiogroup (e.g. Active / Paused / Paper).
    {
      kind: "click-if-present",
      selector: "[role=radiogroup][aria-label='Filter strategies by readiness'] [role=radio]:nth-child(2)",
      label: "filter-second-option",
    },
    { kind: "wait", timeout: 1500 },
    { kind: "snapshot", label: "filtered" },

    // Hover the first strategy card to reveal hover state.
    {
      kind: "hover-first-if-present",
      selector: "[data-testid=strategy-card]",
      waitFor: 300,
    },
    { kind: "snapshot", label: "card-hover" },

    { kind: "scroll", y: 800 },
    { kind: "snapshot", label: "scrolled-mid" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
