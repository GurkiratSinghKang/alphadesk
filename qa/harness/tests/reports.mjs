// qa/harness/tests/reports.mjs
export const spec = {
  name: "reports",
  route: "/reports",
  requiresAuth: true,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/reports" },
    { kind: "wait", for: "networkidle", timeout: 15000 },
    { kind: "snapshot", label: "initial" },
    {
      kind: "click-every",
      containerSelector: "main",
      itemSelector: "[role=tab], button:has-text('Daily'), button:has-text('Weekly'), button:has-text('Monthly')",
      maxN: 3,
      labelPrefix: "range",
      waitFor: 500,
    },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
