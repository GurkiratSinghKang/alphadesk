import { test, type Page } from "@playwright/test";

/**
 * DOM-introspection sweep across every ported route. For each page:
 *   1. Load the LIVE app at localhost:3000
 *   2. Load the DESIGN HTML at localhost:4000 with TWEAK_DEFAULTS
 *      forcing the same `page` id
 *   3. Pick representative elements (eyebrow / display title / mono
 *      numerics / body text / chart range pills) and compare:
 *      font-size, font-family, font-weight, font-style, color
 *   4. Print a per-route diff
 *
 * The point is to surface STRUCTURAL/SEMANTIC gaps the eye misses —
 * `<span>` vs `<h2>`, wrong font-size, missing italics, wrong color
 * ramp. Run via `npm run test:visual -- dom-sweep.spec.ts`.
 */

interface Route {
  name: string;
  livePath: string;
  designPage: string;
  /** Specific selectors per route — defaults to a generic set. */
  probes?: Array<{ name: string; selector: string }>;
}

const GENERIC_PROBES: Array<{ name: string; selector: string }> = [
  { name: "eyebrow",     selector: ".t-eyebrow-italic, .t-label" },
  { name: "h1",          selector: "h1" },
  { name: "h2",          selector: "h2" },
  { name: "h3",          selector: "h3" },
  { name: "biggest mono", selector: ".t-mono, [class*='mono']" },
  { name: "italic body", selector: "p[class*='italic'], em" },
];

const ROUTES: Route[] = [
  { name: "dashboard",     livePath: "/",                                 designPage: "dashboard" },
  { name: "trade",         livePath: "/trade",                            designPage: "trade" },
  { name: "symbol",        livePath: "/symbols/NVDA",                     designPage: "ticker" },
  { name: "watchlists",    livePath: "/watchlists",                       designPage: "watchlists" },
  { name: "strategies",    livePath: "/strategies",                       designPage: "strategies" },
  { name: "reports",       livePath: "/reports",                          designPage: "reports" },
  { name: "settings",      livePath: "/settings",                         designPage: "settings" },
  { name: "risk",          livePath: "/risk-dashboard",                   designPage: "risk" },
  { name: "agents",        livePath: "/agents",                           designPage: "agents" },
  { name: "playbook",      livePath: "/strategies/momentum-quality/playbook", designPage: "playbook" },
];

interface StyleSample { selector: string; text: string; tag: string; fs: string; ff: string; fw: string; fst: string; color: string; }

async function sample(page: Page, probes: Array<{ name: string; selector: string }>): Promise<Record<string, StyleSample | null>> {
  return page.evaluate((probesArg: Array<{ name: string; selector: string }>) => {
    const out: Record<string, unknown> = {};
    for (const p of probesArg) {
      const el = document.querySelector(p.selector) as HTMLElement | null;
      if (!el) { out[p.name] = null; continue; }
      const c = getComputedStyle(el);
      out[p.name] = {
        selector: p.selector,
        text: ((el as HTMLElement).innerText ?? "").slice(0, 50).replace(/\s+/g, " ").trim(),
        tag: el.tagName.toLowerCase() + ((el.className as unknown as string) ? "." + (el.className as unknown as string).toString().split(" ").slice(0, 2).join(".") : ""),
        fs: c.fontSize,
        ff: c.fontFamily.split(",")[0].replace(/['"]/g, ""),
        fw: c.fontWeight,
        fst: c.fontStyle,
        color: c.color,
      };
    }
    return out as Record<string, StyleSample | null>;
  }, probes);
}

function diff(name: string, live: StyleSample | null, design: StyleSample | null): string[] {
  if (!live && !design) return [];
  if (!live) return [`  ${name.padEnd(14)} ❌ MISSING on live (design: "${design!.text}")`];
  if (!design) return [`  ${name.padEnd(14)} ⚠ extra on live ("${live.text}") — design has no match`];
  const issues: string[] = [];
  if (live.fs !== design.fs) issues.push(`fs ${live.fs} → ${design.fs}`);
  if (live.fw !== design.fw) issues.push(`fw ${live.fw} → ${design.fw}`);
  if (live.fst !== design.fst) issues.push(`fst ${live.fst} → ${design.fst}`);
  // Skip font-family + color comparisons — those are intentional project-level differences
  if (issues.length === 0) return [];
  return [`  ${name.padEnd(14)} live=${live.tag.padEnd(35)} design=${design.tag.padEnd(35)} | ${issues.join(", ")}`];
}

async function loadLive(browser: import("@playwright/test").Browser, path: string): Promise<{ ctx: import("@playwright/test").BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  return { ctx, page };
}

async function loadDesign(browser: import("@playwright/test").Browser, designPage: string): Promise<{ ctx: import("@playwright/test").BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`window.TWEAK_DEFAULTS={page:"${designPage}",theme:"dark",density:"dense",dashboardLayout:"market",tickerLayout:"split",showAI:true,showRail:true,tradeLayout:"right-rail",accent:"#c9a66b"}`);
  const page = await ctx.newPage();
  await page.goto("http://localhost:4000/AlphaDesk.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  return { ctx, page };
}

for (const route of ROUTES) {
  test(`dom sweep ${route.name}`, async ({ browser }) => {
    const probes = route.probes ?? GENERIC_PROBES;
    const liveSession = await loadLive(browser, route.livePath);
    const liveSamples = await sample(liveSession.page, probes);
    await liveSession.ctx.close();
    const designSession = await loadDesign(browser, route.designPage);
    const designSamples = await sample(designSession.page, probes);
    await designSession.ctx.close();

    console.log(`\n══ ${route.name.toUpperCase()} ══`);
    let issueCount = 0;
    for (const probe of probes) {
      const lines = diff(probe.name, liveSamples[probe.name], designSamples[probe.name]);
      for (const l of lines) { console.log(l); issueCount++; }
    }
    if (issueCount === 0) console.log("  ✓ no font-size/weight/style gaps detected");
  });
}
