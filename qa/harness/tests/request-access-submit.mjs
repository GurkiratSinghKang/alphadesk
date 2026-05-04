// qa/harness/tests/request-access-submit.mjs
// Fills + submits the /request-access form as a "Claude-test" account so we
// capture the full submission flow (initial → filled → trading-mode selected
// → instruments selected → submit-loading → confirmation/error).
//
// This is intentionally a separate spec from `request-access.mjs` so the
// static layout regression baseline stays unmodified.
//
// The email uses a per-run timestamp suffix so re-runs aren't dedup'd by the
// backend.
const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const email = `claude-test+${stamp}@example.com`;

export const spec = {
  name: "request-access-submit",
  route: "/request-access",
  requiresAuth: false,
  viewports: ["desktop-1440"],
  steps: [
    { kind: "navigate", to: "/request-access" },
    { kind: "wait", for: "selector", selector: "#request-name", timeout: 10000 },
    { kind: "snapshot", label: "initial" },

    // Fill required fields.
    { kind: "type", selector: "#request-name", value: "Claude Test" },
    { kind: "type", selector: "#request-email", value: email },
    { kind: "type", selector: "#request-firm", value: "Anthropic QA" },
    { kind: "type", selector: "#request-role", value: "Automated visual QA" },
    { kind: "type", selector: "#request-jurisdiction", value: "United States" },
    { kind: "snapshot", label: "filled-identity" },

    // Trading mode — radio input is sr-only, click its visible label.
    { kind: "click", selector: "label:has-text('Paper')" },
    { kind: "snapshot", label: "trading-mode-paper" },

    // Pick first instrument checkbox (also sr-only — click its label).
    {
      kind: "click-if-present",
      selector: "fieldset:has(legend:has-text('Instruments')) label",
      label: "first-instrument",
    },
    { kind: "snapshot", label: "instrument-selected" },

    // Book context textarea (>= 20 chars required).
    {
      kind: "type",
      selector: "#request-note",
      value:
        "Automated screenshot capture run by Claude Code QA harness. Validating the request-access submission flow end to end against production. No human follow-up required — please ignore or delete.",
    },
    { kind: "snapshot", label: "filled-complete" },

    // Submit and capture loading + post-submit state.
    { kind: "click", selector: "button[type=submit]" },
    { kind: "wait", for: "networkidle", timeout: 15000 },
    { kind: "snapshot", label: "after-submit" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "after-submit-bottom" },
  ],
};
