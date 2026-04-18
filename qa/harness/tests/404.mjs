// qa/harness/tests/404.mjs
// Arbitrary unknown route → Next.js not-found page.

export const spec = {
  name: "not-found",
  route: "/this-route-does-not-exist-qa-harness",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/this-route-does-not-exist-qa-harness" },
    { kind: "snapshot", label: "initial" },
  ],
};
