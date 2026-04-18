// qa/harness/config.mjs
// Shared config for the AlphaDesk QA harness.
// Type annotations are expressed via JSDoc so editors can still hint.

/** @typedef {{ name: string, width: number, height: number, deviceScaleFactor: number, isMobile: boolean }} Viewport */

/** @type {Record<string, Viewport>} */
export const VIEWPORTS = {
  "desktop-1440": {
    name: "desktop-1440",
    width: 1440,
    height: 900,
    deviceScaleFactor: 3,
    isMobile: false,
  },
  "tablet-820": {
    name: "tablet-820",
    width: 820,
    height: 1180,
    deviceScaleFactor: 3,
    isMobile: false,
  },
  "mobile-390": {
    name: "mobile-390",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
  },
};

export const DEFAULT_BASE = process.env.ALPHADESK_BASE || "https://tradingalpha.net";

export const TIMEOUTS = {
  navigation: 30_000,
  action: 10_000,
  networkIdle: 15_000,
  hydration: 8_000,
  perStep: 20_000,
};

export const AUTH = {
  usernameEnv: "ALPHADESK_TEST_USER",
  passwordEnv: "ALPHADESK_TEST_PASS",
  loginRoute: "/login",
  usernameSelector: "#login-username",
  passwordSelector: "#login-password",
  submitSelector: "button[type=submit]",
  // Path we should land on after successful login.
  postLoginPath: "/",
};

// Optional hydration marker. The app does not currently emit one; if we add
// `data-hydrated="true"` to the body/root later, waitForReady will pick it up.
export const HYDRATION_MARKER = "[data-hydrated='true']";

// Quiet console noise — classes of messages we filter from the console.jsonl
// to keep signal high. Regexes.
export const CONSOLE_IGNORE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
];
