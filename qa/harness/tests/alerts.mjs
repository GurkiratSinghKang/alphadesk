// qa/harness/tests/alerts.mjs
export const spec = {
  name: "alerts",
  route: "/alerts",
  requiresAuth: true,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/alerts" },
    { kind: "wait", for: "networkidle", timeout: 15000 },
    { kind: "snapshot", label: "initial" },
    {
      kind: "click-every",
      containerSelector: "main",
      itemSelector: "[role=tab], button:has-text('Unread'), button:has-text('All')",
      maxN: 3,
      labelPrefix: "filter",
      waitFor: 400,
    },
    // Hover first alert row to show inline actions — skip cleanly when empty.
    {
      kind: "hover-first-if-present",
      selector: "[data-testid=alert-row]",
      label: "hover-first-alert",
      waitFor: 300,
    },
    { kind: "snapshot", label: "row-hover" },
  ],
};
