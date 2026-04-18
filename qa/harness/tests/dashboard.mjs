// qa/harness/tests/dashboard.mjs
// Authenticated root (/). Covers strategy-rail click, order-bar fill, command
// palette open, and mobile render. Order-bar fill does NOT submit a trade.

export const spec = {
  name: "dashboard",
  route: "/",
  requiresAuth: true,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/" },
    { kind: "wait", for: "networkidle", timeout: 15000 },
    { kind: "snapshot", label: "initial" },

    // Strategy rail — click the first visible item.
    {
      kind: "click",
      selector: "[data-testid=strategy-rail] [role=button], [data-testid^=strategy-card], a[href^='/strategies/']",
      options: { force: false },
    },
    { kind: "wait", for: "networkidle", timeout: 8000 },
    { kind: "snapshot", label: "after-strategy-click" },

    // Back to dashboard.
    { kind: "navigate", to: "/" },
    { kind: "wait", for: "networkidle", timeout: 8000 },

    // Order bar — fill symbol + qty but DO NOT submit.
    { kind: "type", selector: "[data-testid=order-bar-symbol], input[name=symbol]", value: "AAPL" },
    { kind: "type", selector: "[data-testid=order-bar-qty], input[name=qty], input[name=quantity]", value: "1" },
    { kind: "snapshot", label: "order-bar-filled" },

    // Command palette — Cmd+K / Ctrl+K.
    { kind: "press", key: "Meta+K" },
    { kind: "wait", for: "selector", selector: "[role=dialog], [data-testid=command-palette]", timeout: 3000 },
    { kind: "snapshot", label: "command-palette" },
    { kind: "press", key: "Escape" },
  ],
};
