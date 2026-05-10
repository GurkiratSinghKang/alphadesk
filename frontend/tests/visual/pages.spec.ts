import { test, expect, type Page } from "@playwright/test";

/**
 * One snapshot per ported page. Snapshots feed two complementary checks:
 *   1. `npm run test:visual` — snapshot diff vs the previous commit's baseline.
 *      Catches structural regressions in the v2 port over time.
 *   2. `diff.spec.ts` — writes a side-by-side `compare.html` against the
 *      design comp from `tests/visual/baseline/desktop-dark/`. That's the
 *      "looks similar to design" check.
 *
 * Caveat: local dev has no backend, so the live app shows "data unavailable"
 * banners and empty cards. Structure matches design, but pixel-level
 * content does not until a backend mock (msw or similar) is wired in.
 * The diff helper is the right tool to eyeball "are we visually close."
 */

// Pre-warm every route the suite snapshots. Cold dev compile on a
// route can take 30-50s — the per-test waitForFunction would otherwise
// catch a half-rendered page. One hit per route during beforeAll
// triggers compile so all subsequent test runs are warm.
const ROUTES_TO_WARM = [
  "/", "/trade", "/symbols/AAPL", "/strategies", "/reports", "/settings",
  "/risk-dashboard", "/admin/control-center", "/admin/users",
  "/watchlists", "/pipeline", "/analytics", "/alerts",
  "/login", "/onboarding", "/agents", "/agents/research-regime",
  "/about", "/contact", "/terms", "/privacy",
  "/positions/NVDA", "/positions/AAPL",
];
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const r of ROUTES_TO_WARM) {
    try {
      await page.goto(`http://localhost:3000${r}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(800);
    } catch { /* no-op — best-effort warming */ }
  }
  await ctx.close();
}, 300_000);

// Hide the onboarding tour via CSS instead of localStorage. Playwright's
// `addInitScript` (in any form) interferes with one of the dashboard
// chunks in Next 16 RSC mode and yields "Invalid or unexpected token"
// at runtime, killing hydration. Pure CSS is the safe escape hatch.
async function settle(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      /* Suppress the OnboardingTour modal so it doesn't cover the
         dashboard snapshot. localStorage-based suppression isn't
         available because Playwright's addInitScript breaks Next 16
         RSC hydration (see docstring above). */
      [data-testid="onboarding-tour"],
      [data-testid="onboarding-tour-backdrop"] {
        display: none !important;
      }
    `,
  });
}

async function gotoAndWait(page: Page, route: string, settleMs = 8000) {
  // waitForFunction-based gating raced hydration on every (dashboard) route
  // — it returned `true` on the SSR shell (which has innerText from the
  // banner CSS) before the client tree mounted, then settle ran on the
  // empty body. Plain timed wait is more predictable.
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(settleMs);
  await settle(page);
  // Sacrificial first screenshot — kicks the Chromium rendering
  // pipeline into committing pending paint frames before the real
  // screenshot below reads pixels. Without this the first screenshot
  // in a fresh context routinely captures a black viewport even when
  // innerText shows the page is fully hydrated.
  await page.screenshot();
  await page.waitForTimeout(300);
}

test.describe("v2 design parity", () => {
  test("dashboard / home", async ({ page }) => {
    // Dashboard mounts a lot of dynamic chrome (TopBar, hero, briefing,
    // running-strip, body grid) — bump settle so the snapshot includes
    // every section after hydration.
    await gotoAndWait(page, "/", 6500);
    await expect(page).toHaveScreenshot("home.png", { fullPage: false });
  });

  test("trade terminal", async ({ page }) => {
    // Trade is the heaviest page: MetricRibbon, AssetTabs, PreTradeAgentStrip,
    // chart canvas, right-rail order ticket. Bump settle so all sections
    // finish hydrating before snapshot.
    await gotoAndWait(page, "/trade", 6500);
    await expect(page).toHaveScreenshot("trade.png", { fullPage: false });
  });

  test("symbol detail · AAPL", async ({ page }) => {
    await gotoAndWait(page, "/symbols/AAPL");
    await expect(page).toHaveScreenshot("symbols-AAPL.png", { fullPage: false });
  });

  test("strategies index", async ({ page }) => {
    await gotoAndWait(page, "/strategies");
    await expect(page).toHaveScreenshot("strategies.png", { fullPage: false });
  });

  test("reports", async ({ page }) => {
    await gotoAndWait(page, "/reports");
    await expect(page).toHaveScreenshot("reports.png", { fullPage: false });
  });

  test("settings", async ({ page }) => {
    // /settings has the heaviest dynamic-import tree (broker cards,
    // appearance, account sections); needs the longest settle.
    await gotoAndWait(page, "/settings", 8000);
    await expect(page).toHaveScreenshot("settings.png", { fullPage: false });
  });

  test("risk monitor", async ({ page }) => {
    await gotoAndWait(page, "/risk-dashboard", 6500);
    await expect(page).toHaveScreenshot("risk.png", { fullPage: false });
  });

  test("admin · control center", async ({ page }) => {
    await gotoAndWait(page, "/admin/control-center", 6500);
    await expect(page).toHaveScreenshot("admin-control-center.png", { fullPage: false });
  });

  test("admin · users", async ({ page }) => {
    await gotoAndWait(page, "/admin/users");
    await expect(page).toHaveScreenshot("admin-users.png", { fullPage: false });
  });

  test("watchlists", async ({ page }) => {
    await gotoAndWait(page, "/watchlists");
    await expect(page).toHaveScreenshot("watchlists.png", { fullPage: false });
  });

  test("pipeline", async ({ page }) => {
    await gotoAndWait(page, "/pipeline");
    await expect(page).toHaveScreenshot("pipeline.png", { fullPage: false });
  });

  test("analytics", async ({ page }) => {
    await gotoAndWait(page, "/analytics");
    await expect(page).toHaveScreenshot("analytics.png", { fullPage: false });
  });

  test("alerts", async ({ page }) => {
    // /alerts hydrates in two stages — header arrives <500ms, the create-alert
    // form + scope panel mount ~6s later. Bump settle so the snapshot includes
    // the form, not just the empty-state below it.
    await gotoAndWait(page, "/alerts", 6500);
    await expect(page).toHaveScreenshot("alerts.png", { fullPage: false });
  });

  test("login", async ({ page }) => {
    await gotoAndWait(page, "/login");
    await expect(page).toHaveScreenshot("login.png", { fullPage: false });
  });

  test("onboarding", async ({ page }) => {
    await gotoAndWait(page, "/onboarding");
    await expect(page).toHaveScreenshot("onboarding.png", { fullPage: false });
  });

  test("agents · roster", async ({ page }) => {
    await gotoAndWait(page, "/agents", 6500);
    await expect(page).toHaveScreenshot("agents.png", { fullPage: false });
  });

  test("agents · detail", async ({ page }) => {
    await gotoAndWait(page, "/agents/research-regime", 6500);
    await expect(page).toHaveScreenshot("agents-detail.png", { fullPage: false });
  });

  test("about", async ({ page }) => {
    await gotoAndWait(page, "/about");
    await expect(page).toHaveScreenshot("about.png", { fullPage: false });
  });

  test("contact", async ({ page }) => {
    await gotoAndWait(page, "/contact");
    await expect(page).toHaveScreenshot("contact.png", { fullPage: false });
  });

  test("terms", async ({ page }) => {
    await gotoAndWait(page, "/terms");
    await expect(page).toHaveScreenshot("terms.png", { fullPage: false });
  });

  test("privacy", async ({ page }) => {
    await gotoAndWait(page, "/privacy");
    await expect(page).toHaveScreenshot("privacy.png", { fullPage: false });
  });

  test("position · NVDA", async ({ page }) => {
    await gotoAndWait(page, "/positions/NVDA", 6500);
    await expect(page).toHaveScreenshot("position-NVDA.png", { fullPage: false });
  });

  test("position · flat (AAPL)", async ({ page }) => {
    // Flat-position empty state has only ~650 chars (less than the
    // gotoAndWait threshold). Use direct waitForTimeout to avoid the
    // 60s waitForFunction stall.
    await page.goto("/positions/AAPL", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);
    await page.addStyleTag({
      content: `*,*::before,*::after{animation:none!important;transition:none!important}`,
    });
    await expect(page).toHaveScreenshot("position-AAPL-flat.png", { fullPage: false });
  });
});
