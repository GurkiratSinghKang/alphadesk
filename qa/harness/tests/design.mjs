// qa/harness/tests/design.mjs
// /_design — internal design-system page. The contract (qa/pages/design.md)
// requires this route to 404 in production. We capture the result either way
// so downstream agents can verify the gate is active.
export const spec = {
  name: "_design",
  route: "/_design",
  requiresAuth: false,
  viewports: ["desktop-1440"],
  steps: [
    { kind: "navigate", to: "/_design" },
    { kind: "snapshot", label: "initial" },
    { kind: "scroll", y: 800, waitFor: 200 },
    { kind: "snapshot", label: "scrolled-mid" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
