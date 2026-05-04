// qa/harness/tests/help-earnings-data.mjs
// /help/earnings-data — MarketingShell-wrapped help article on earnings data sources.
export const spec = {
  name: "help-earnings-data",
  route: "/help/earnings-data",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/help/earnings-data" },
    { kind: "snapshot", label: "initial" },
    { kind: "scroll", y: 800, waitFor: 200 },
    { kind: "snapshot", label: "scrolled-mid" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
