// qa/harness/tests/strategy-detail.mjs
// /strategies/momentum-quality — canonical strategy detail page.

export const spec = {
  name: "strategy-momentum-quality",
  route: "/strategies/momentum-quality",
  requiresAuth: true,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/strategies/momentum-quality" },
    { kind: "wait", for: "networkidle", timeout: 15000 },
    { kind: "snapshot", label: "initial" },

    // Hover a metric chip to reveal tooltip (first chip).
    {
      kind: "hover",
      selector: "[data-testid^=metric-]",
      waitFor: 400,
    },
    { kind: "snapshot", label: "metric-hover" },

    // Chart range switcher — try to click "1M" / "3M" buttons if present.
    {
      kind: "wait",
      for: "selector",
      selector: "[data-range='1M']",
      timeout: 5000,
    },
    {
      kind: "click",
      selector: "[data-range='1M']",
      label: "range-1M",
      options: { force: false },
    },
    { kind: "wait", for: "networkidle", timeout: 5000 },
    { kind: "snapshot", label: "chart-1m" },

    // Scroll to mid-page and bottom for each section.
    { kind: "scroll", y: 600 },
    { kind: "snapshot", label: "scrolled-mid" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },

    // Pause button — click but we will NOT confirm (cancel on any modal).
    {
      kind: "click",
      selector: "button:has-text('Pause'), [data-testid=strategy-pause]",
      options: { force: false },
    },
    { kind: "snapshot", label: "pause-click" },
    { kind: "press", key: "Escape" },
  ],
};
