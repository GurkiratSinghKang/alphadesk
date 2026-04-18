// qa/harness/tests/docs.mjs
// Public /docs page. Simple nav + scroll snapshots.

export const spec = {
  name: "docs",
  route: "/docs",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/docs" },
    { kind: "snapshot", label: "initial" },
    { kind: "scroll", y: 800 },
    { kind: "snapshot", label: "mid" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
