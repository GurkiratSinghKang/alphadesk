import { defineConfig, devices } from "@playwright/test";

/**
 * Visual-regression suite for the v2 design port.
 *
 * Boots `next dev --webpack` once and snapshots each ported page at the same
 * viewport (1440×900) the design comps were exported at. Snapshots live under
 * `tests/visual/__snapshots__` next to each spec — diffs land in
 * `test-results/`. Design baselines live under `tests/visual/baseline/` so the
 * `diff.spec.ts` helper can write a 2-up `<page>.compare.png` for eyeballing.
 *
 * To run: `npm run test:visual`
 * To re-baseline after intentional UI changes: `npm run test:visual:update`
 */
export default defineConfig({
  testDir: "./tests/visual",
  outputDir: "./tests/visual/.results",
  reporter: [["list"], ["html", { outputFolder: "./tests/visual/.report", open: "never" }]],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Dev compile + WebSocket bridge dynamic imports per route can chew 20-40s
  // on first hit. Per-test budget is 120s so the wait-for-content + 800ms
  // settle + screenshot all fit even in cold runs.
  timeout: 120_000,
  expect: {
    toHaveScreenshot: {
      // Allow ~5% pixel diff to absorb font hinting + live data drift.
      // Structural mismatch (missing section, wrong grid) blows past this.
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // DEV_AUTH_BYPASS lets the proxy treat every request as authenticated so
    // the suite can snapshot protected dashboard routes without a real login.
    // Guarded by NODE_ENV !== production in proxy.ts; production never honors it.
    command: "DEV_AUTH_BYPASS=1 npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
