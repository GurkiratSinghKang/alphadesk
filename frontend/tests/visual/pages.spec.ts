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
    `,
  });
}

async function gotoAndWait(page: Page, route: string, settleMs = 2500) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  // Pages bail to CSR (next/dynamic providers are ssr:false), so we wait for
  // the body to actually have content. 60s budget covers cold dev compile;
  // warm pages return in <500ms. The settle tail lets late-mounting strips
  // (status banner, ticker tape, async data fetches) finish before the
  // snapshot. Per-route override allowed via `settleMs` for slow pages
  // like /alerts whose body has text quickly but main content keeps mounting.
  try {
    await page.waitForFunction(() => document.body.innerText.length > 200, undefined, {
      timeout: 60_000,
    });
  } catch {
    // Some routes (e.g. `/trade` with no backend) render an empty container
    // while data loads. Don't fail the test on that — capture what's there.
  }
  await page.waitForTimeout(settleMs);
  await settle(page);
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
    await gotoAndWait(page, "/trade");
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
    await gotoAndWait(page, "/settings");
    await expect(page).toHaveScreenshot("settings.png", { fullPage: false });
  });

  test("risk monitor", async ({ page }) => {
    await gotoAndWait(page, "/risk-dashboard");
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
});
