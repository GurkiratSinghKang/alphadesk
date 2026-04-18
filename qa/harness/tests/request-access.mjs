// qa/harness/tests/request-access.mjs
// /request-access — currently a static landing page (no form). Exercise
// layout + scroll coverage only; avoid typing into inputs that don't exist.

export const spec = {
  name: "request-access",
  route: "/request-access",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/request-access" },
    { kind: "snapshot", label: "initial" },
    { kind: "scroll", y: 400, waitFor: 200 },
    { kind: "snapshot", label: "scrolled" },
    { kind: "scroll", waitFor: 200 },
    { kind: "snapshot", label: "bottom" },
  ],
};
