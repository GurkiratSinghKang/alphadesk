import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Live (3000) ↔ design HTML (4000) side-by-side compare.
 *
 * The design ships as a babel-in-the-browser SPA at port 4000 with a
 * shared TweakPanel that sets `?page=…`. We hit each page on both servers,
 * snapshot, then write a 2-up `compare.html` per route.
 *
 * Run via: `npm run test:visual -- compare.spec.ts`
 */

interface Route {
  name: string;
  live: string;
  /** TweakPanel page id; bombs out into the design's <App page=…/> picker. */
  designPage: string;
  /** Some pages wait extra for hydration of v2 chrome. */
  liveSettleMs?: number;
  designSettleMs?: number;
}

const ROUTES: Route[] = [
  { name: "dashboard",     live: "/",                   designPage: "dashboard",   liveSettleMs: 6500 },
  { name: "trade",         live: "/trade",              designPage: "trade",       liveSettleMs: 12000 },
  { name: "symbol",        live: "/symbols/NVDA",       designPage: "ticker",      liveSettleMs: 6500 },
  { name: "watchlists",    live: "/watchlists",         designPage: "watchlists",  liveSettleMs: 7000 },
  { name: "strategies",    live: "/strategies",         designPage: "strategies",  liveSettleMs: 6000 },
  { name: "reports",       live: "/reports",            designPage: "reports",     liveSettleMs: 12000 },
  { name: "settings",      live: "/settings",           designPage: "settings",    liveSettleMs: 8000 },
  { name: "risk",          live: "/risk-dashboard",     designPage: "risk",        liveSettleMs: 6500 },
  { name: "admin-cc",      live: "/admin/control-center", designPage: "admin",     liveSettleMs: 6500 },
  { name: "admin-users",   live: "/admin/users",        designPage: "admin-users", liveSettleMs: 5000 },
  { name: "agents-roster", live: "/agents",             designPage: "agents",      liveSettleMs: 9000, designSettleMs: 4000 },
  { name: "playbook",      live: "/strategies/momentum-quality/playbook", designPage: "playbook", liveSettleMs: 7000 },
  { name: "backtest",      live: "/strategies/momentum-quality/backtest", designPage: "backtest", liveSettleMs: 7000 },
  { name: "marketing",     live: "/welcome",            designPage: "marketing",   liveSettleMs: 4000 },
  { name: "auth",          live: "/login",              designPage: "auth",        liveSettleMs: 4000 },
  { name: "onboarding",    live: "/onboarding",         designPage: "onboarding",  liveSettleMs: 4000 },
];

async function settle(page: Page, ms: number) {
  await page.waitForTimeout(ms);
  await page.addStyleTag({
    content: `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}[data-testid="onboarding-tour"],[data-testid="onboarding-tour-backdrop"]{display:none!important}`,
  });
}

for (const route of ROUTES) {
  test(`compare ${route.name}`, async ({ browser }, testInfo) => {
    // Two SEPARATE contexts — live and design have nothing to share, and
    // running them concurrently in one context starves the dev server when
    // the design's babel-in-the-browser kicks off mid-compile.
    // CSS-only tour suppression in `settle()`. Playwright's
    // addInitScript triggers an "Invalid or unexpected token" runtime
    // error in Next 16 RSC mode that kills client-side hydration on
    // /trade and the dashboard root.
    const liveCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const liveTab = await liveCtx.newPage();
    await liveTab.goto(`http://localhost:3000${route.live}`, { waitUntil: "domcontentloaded" });
    await settle(liveTab, route.liveSettleMs ?? 4000);
    // Sacrificial first screenshot — see pages.spec.ts gotoAndWait.
    await liveTab.screenshot({ fullPage: false });
    await liveTab.waitForTimeout(300);
    const liveBuf = await liveTab.screenshot({ fullPage: false });
    await liveCtx.close();

    const designCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const designTab = await designCtx.newPage();

    // Design — overlay window.TWEAK_DEFAULTS BEFORE any inline script
    // runs so the App's `useTweaks(window.TWEAK_DEFAULTS || ...)` falls
    // through to our chosen page. This is the only mechanism that picks
    // a page reliably; the design's `useTweaks` postMessages tweak
    // changes to a host that isn't there, so direct setTweak() calls
    // would only mutate React state without surviving a reload.
    await designTab.addInitScript((p) => {
      (window as unknown as { TWEAK_DEFAULTS: Record<string, unknown> }).TWEAK_DEFAULTS = {
        page: p, theme: "dark", density: "dense",
        dashboardLayout: "market", tickerLayout: "split",
        showAI: true, showRail: true, tradeLayout: "right-rail",
        accent: "#c9a66b",
      };
    }, route.designPage);
    await designTab.goto("http://localhost:4000/AlphaDesk.html", { waitUntil: "domcontentloaded" });
    await settle(designTab, route.designSettleMs ?? 4000);
    const designBuf = await designTab.screenshot({ fullPage: false });

    const outDir = join(testInfo.outputDir, "compare", route.name);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "live.png"), liveBuf);
    writeFileSync(join(outDir, "design.png"), designBuf);
    writeFileSync(
      join(outDir, "compare.html"),
      `<!doctype html><meta charset="utf-8"><title>${route.name}</title>
<style>html,body{margin:0;background:#0b0a09;color:#ece6d2;font:13px system-ui;padding:16px}h1{font:italic 28px Georgia,serif;margin:0 0 16px}h2{margin:0 0 8px;font:600 11px system-ui;letter-spacing:0.16em;text-transform:uppercase;color:#a8a08d}figure{margin:0 0 24px}img{max-width:100%;border:1px solid #3a3628;display:block}.split{display:grid;grid-template-columns:1fr 1fr;gap:16px}</style>
<h1>${route.name} — design ↔ live</h1>
<div class="split"><figure><h2>design</h2><img src="design.png"></figure><figure><h2>live</h2><img src="live.png"></figure></div>`,
    );

    await designCtx.close();

    // We don't assert pixel equality — the goal is to surface diffs by eye.
    // Each test always passes; failures are visual.
    expect(liveBuf.byteLength).toBeGreaterThan(5000);
  });
}
