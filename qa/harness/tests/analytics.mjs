// qa/harness/tests/analytics.mjs
export const spec = {
  name: "analytics",
  route: "/analytics",
  requiresAuth: true,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/analytics" },
    { kind: "wait", for: "networkidle", timeout: 15000 },
    { kind: "snapshot", label: "initial" },
    {
      kind: "click-every",
      containerSelector: "[role=tablist], [data-testid=analytics-tabs]",
      itemSelector: "[role=tab], button",
      maxN: 4,
      labelPrefix: "tab",
      waitFor: 600,
    },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
