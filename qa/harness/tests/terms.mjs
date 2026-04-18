// qa/harness/tests/terms.mjs
export const spec = {
  name: "terms",
  route: "/terms",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/terms" },
    { kind: "snapshot", label: "initial" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
