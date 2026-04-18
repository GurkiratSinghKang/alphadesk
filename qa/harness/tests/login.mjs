// qa/harness/tests/login.mjs
// Login page — unauthenticated. Covers:
//  - initial render
//  - filling invalid creds → submit error
//  - password show/hide toggle
//  - caps-lock warning hint
//  - responsive mobile render
// Does NOT submit real creds (covered by helpers.login() in authenticated specs).

export const spec = {
  name: "login",
  route: "/login",
  requiresAuth: false,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/login" },
    { kind: "wait", for: "selector", selector: "#login-username", timeout: 10000 },
    { kind: "snapshot", label: "initial" },

    // Filled with bogus creds.
    { kind: "type", selector: "#login-username", value: "bad@example.com" },
    { kind: "type", selector: "#login-password", value: "wrongpw123" },
    { kind: "snapshot", label: "filled-invalid" },

    // Submit and capture the error state.
    { kind: "click", selector: "button[type=submit]" },
    { kind: "wait", for: "networkidle", timeout: 10000 },
    { kind: "snapshot", label: "after-submit-invalid" },

    // Show/hide password toggle (aria-label attack, robust to copy drift).
    { kind: "click", selector: "[aria-label*='Show password' i], [aria-label*='password' i][aria-pressed]" },
    { kind: "snapshot", label: "password-visible" },

    // Caps-lock warning — press CapsLock then type one char.
    { kind: "type", selector: "#login-password", value: "", clear: true },
    { kind: "press", on: "#login-password", key: "CapsLock" },
    { kind: "type", selector: "#login-password", value: "X" },
    { kind: "snapshot", label: "caps-lock-warning" },
    { kind: "press", on: "#login-password", key: "CapsLock" },

    // Scroll to bottom to capture footer links (reset / request-access / risk).
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
