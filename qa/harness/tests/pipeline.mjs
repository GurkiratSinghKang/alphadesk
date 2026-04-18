// qa/harness/tests/pipeline.mjs
export const spec = {
  name: "pipeline",
  route: "/pipeline",
  requiresAuth: true,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/pipeline" },
    { kind: "wait", for: "networkidle", timeout: 15000 },
    { kind: "snapshot", label: "initial" },
    {
      kind: "click-every",
      containerSelector: "[data-testid=pipeline-stages], main",
      itemSelector: "[data-testid^=pipeline-stage], [role=button]",
      maxN: 3,
      labelPrefix: "stage",
      waitFor: 500,
    },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
