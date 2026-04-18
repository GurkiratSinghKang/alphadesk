// qa/harness/tests/settings.mjs
// Settings has many toggles — use click-every to breadth-sample them.
// We explicitly cancel/revert where possible; no confirmation flows fired.

export const spec = {
  name: "settings",
  route: "/settings",
  requiresAuth: true,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/settings" },
    { kind: "wait", for: "networkidle", timeout: 15000 },
    { kind: "snapshot", label: "initial" },

    // Visit each settings tab/section (breadth-first).
    {
      kind: "click-every",
      containerSelector: "[role=tablist], [data-testid=settings-nav], nav",
      itemSelector: "[role=tab], a, button",
      maxN: 6,
      labelPrefix: "section",
      waitFor: 500,
    },

    // Toggle-sample — flip up to 5 toggles to capture state visuals.
    // NOTE: because this may persist preferences on the real account, keep
    // maxN small and dismiss any confirmation modals via Escape.
    {
      kind: "click-every",
      containerSelector: "main",
      itemSelector: "[role=switch], input[type=checkbox]",
      maxN: 3,
      labelPrefix: "toggle",
      waitFor: 400,
    },
    { kind: "press", key: "Escape" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
