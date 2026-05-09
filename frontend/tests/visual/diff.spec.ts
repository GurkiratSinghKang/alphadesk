import { test, type Page } from "@playwright/test";
import { mkdirSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Side-by-side comparison helper. For each (route, baseline) pair this
 * captures the live app and writes both into `tests/visual/.results/<name>.compare/`
 * so a human can flip between them. Use when the snapshot threshold is too
 * tight to be useful (e.g. live-data pages where a small structural change
 * still passes the percentage gate but you want eyes on it anyway).
 *
 * Run via: `npm run test:visual -- diff`
 */

const PAGES: Array<{ route: string; baseline: string; name: string }> = [
  { route: "/", baseline: "home.png", name: "dashboard" },
  { route: "/trade", baseline: "trade.png", name: "trade" },
  { route: "/symbols/AAPL", baseline: "symbols-AAPL.png", name: "symbols-AAPL" },
  { route: "/strategies", baseline: "strategies.png", name: "strategies" },
  { route: "/reports", baseline: "reports.png", name: "reports" },
  { route: "/settings", baseline: "settings.png", name: "settings" },
  { route: "/risk-dashboard", baseline: "risk.png", name: "risk" },
];

async function settle(page: Page) {
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important}`,
  });
  await page.waitForTimeout(400);
}

for (const { route, baseline, name } of PAGES) {
  test(`compare ${name}`, async ({ page }, testInfo) => {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await settle(page);

    const outDir = join(testInfo.outputDir, "compare", name);
    mkdirSync(outDir, { recursive: true });

    // Live screenshot
    const liveBuf = await page.screenshot({ fullPage: false });
    writeFileSync(join(outDir, "live.png"), liveBuf);

    // Baseline (the design comp)
    const baselinePath = join(__dirname, "baseline", "desktop-dark", baseline);
    if (existsSync(baselinePath)) {
      copyFileSync(baselinePath, join(outDir, "design.png"));
    }

    // Trivial 2-up HTML so a human can flip between them
    const html = `<!doctype html><meta charset="utf-8"><title>${name} compare</title>
<style>html,body{margin:0;background:#111;color:#ddd;font:13px system-ui}h2{padding:8px 12px;margin:0;font-weight:500}figure{margin:0;padding:0 12px 16px}img{max-width:100%;display:block;border:1px solid #333}</style>
<h2>${name} — design ↔ live</h2>
<figure><figcaption>design baseline</figcaption><img src="design.png"></figure>
<figure><figcaption>live (port)</figcaption><img src="live.png"></figure>`;
    writeFileSync(join(outDir, "compare.html"), html);
  });
}
