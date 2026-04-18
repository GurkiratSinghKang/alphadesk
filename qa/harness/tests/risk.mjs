// qa/harness/tests/risk.mjs
export const spec = {
  name: "risk",
  route: "/risk",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/risk" },
    { kind: "snapshot", label: "initial" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
