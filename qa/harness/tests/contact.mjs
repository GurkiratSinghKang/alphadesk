// qa/harness/tests/contact.mjs
// /contact — StaticArticle + MarketingShell. Layout/scroll coverage only.
export const spec = {
  name: "contact",
  route: "/contact",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/contact" },
    { kind: "snapshot", label: "initial" },
    { kind: "scroll", y: 600, waitFor: 200 },
    { kind: "snapshot", label: "scrolled-mid" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
