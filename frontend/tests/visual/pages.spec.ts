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

async function gotoAndWait(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  // Pages bail to CSR (next/dynamic providers are ssr:false), so we wait for
  // the body to actually have content. 30s budget covers cold dev compile;
  // warm pages return in <500ms. The 800ms tail lets late-mounting strips
  // (status banner, ticker tape) settle before the snapshot.
  try {
    await page.waitForFunction(() => document.body.innerText.length > 30, undefined, {
      timeout: 60_000,
    });
  } catch {
    // Some routes (e.g. `/trade` with no backend) render an empty container
    // while data loads. Don't fail the test on that — capture what's there.
  }
  await page.waitForTimeout(800);
  await settle(page);
}

test.describe("v2 design parity", () => {
  test("dashboard / home", async ({ page }) => {
    await gotoAndWait(page, "/");
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
    await gotoAndWait(page, "/admin/control-center");
    await expect(page).toHaveScreenshot("admin-control-center.png", { fullPage: false });
  });

  test("admin · users", async ({ page }) => {
    await gotoAndWait(page, "/admin/users");
    await expect(page).toHaveScreenshot("admin-users.png", { fullPage: false });
  });
});
