// qa/harness/tests/about.mjs
// /about — StaticArticle + MarketingShell. Layout/scroll coverage only.
export const spec = {
  name: "about",
  route: "/about",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/about" },
    { kind: "snapshot", label: "initial" },
    { kind: "scroll", y: 600, waitFor: 200 },
    { kind: "snapshot", label: "scrolled-mid" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
