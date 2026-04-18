// qa/harness/tests/privacy.mjs
export const spec = {
  name: "privacy",
  route: "/privacy",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/privacy" },
    { kind: "snapshot", label: "initial" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
