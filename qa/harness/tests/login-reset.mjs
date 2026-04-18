// qa/harness/tests/login-reset.mjs
// /login/reset — password-reset landing page. Page is intentionally static
// (no form), so we just exercise layout + scroll without typing.

export const spec = {
  name: "login-reset",
  route: "/login/reset",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/login/reset" },
    { kind: "snapshot", label: "initial" },
    { kind: "scroll", y: 400, waitFor: 200 },
    { kind: "snapshot", label: "scrolled" },
    { kind: "scroll", waitFor: 200 },
    { kind: "snapshot", label: "bottom" },
  ],
};
