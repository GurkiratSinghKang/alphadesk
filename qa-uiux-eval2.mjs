import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = "https://tradingalpha.net";
const DIR = "./qa-screenshots/eval-round3/uiux";
const CREDS = { user: "admin", pass: "alphaDesk2025!" };

async function main() {
  mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });

  const page = await ctx.newPage();

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.fill('input[placeholder="admin"]', CREDS.user);
  await page.fill('input[type="password"]', CREDS.pass);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  console.log("Logged in, url:", page.url());

  // Get all strategy links from dashboard
  const allLinks = await page.$$eval('a', links =>
    links.map(a => ({ href: a.getAttribute('href'), text: a.textContent?.trim().slice(0, 50) }))
  );
  console.log("All links on dashboard:", JSON.stringify(allLinks, null, 2));

  // Look for clickable strategy elements
  const clickables = await page.$$eval('[class*="strat"], [class*="Strat"], [data-strategy], [class*="grid"] > div', els =>
    els.map(e => ({ tag: e.tagName, class: e.className?.slice?.(0, 80), text: e.textContent?.trim().slice(0, 50) }))
  );
  console.log("Strategy-like elements:", JSON.stringify(clickables.slice(0, 10), null, 2));

  // Try navigating directly to a strategy detail page
  // Check the API for strategy IDs
  const cookies = await ctx.cookies();
  console.log("Cookies:", JSON.stringify(cookies.map(c => c.name)));

  // Try fetching strategies from API
  const strategiesResp = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/strategies');
      if (r.ok) return await r.json();
      return { error: r.status };
    } catch(e) {
      return { error: e.message };
    }
  });
  console.log("Strategies API:", JSON.stringify(strategiesResp)?.slice(0, 500));

  // Try known strategy IDs from the codebase
  const testIds = ['momentum-alpha', 'mean-reversion', 'trend-following', '1', '2'];
  for (const id of testIds) {
    await page.goto(`${BASE}/strategies/${id}`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(2000);
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body.textContent?.slice(0, 100));
    console.log(`Strategy ${id}: title="${title}", body="${bodyText}"`);
    if (!bodyText?.includes("404") && !bodyText?.includes("not found") && !bodyText?.includes("error")) {
      await page.screenshot({ path: `${DIR}/30-strategy-detail-${id}.png`, fullPage: true });
      await page.screenshot({ path: `${DIR}/31-strategy-detail-${id}-viewport.png`, fullPage: false });
      console.log(`  Captured strategy: ${id}`);

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${DIR}/32-strategy-detail-${id}-bottom.png`, fullPage: false });
      break;
    }
  }

  // Profile menu - try different selectors
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Look for profile/user button more broadly
  const headerBtns = await page.$$eval('header button, [class*="top"] button', btns =>
    btns.map(b => ({ text: b.textContent?.trim().slice(0, 30), class: b.className?.slice(0, 60) }))
  );
  console.log("Header buttons:", JSON.stringify(headerBtns));

  // Try clicking a user icon in the topbar
  const userBtns = await page.$$('header button');
  for (let i = 0; i < userBtns.length; i++) {
    const text = await userBtns[i].textContent();
    console.log(`Header btn ${i}: "${text?.trim().slice(0,30)}"`);
    if (text?.includes('A') || text?.includes('admin') || text?.length < 5) {
      await userBtns[i].click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${DIR}/41-profile-menu-attempt.png`, fullPage: false });
      console.log("Captured profile menu attempt");
      break;
    }
  }

  // Check for trade page watchlist/screener/signals tabs
  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Find actual tab buttons in the watchlist panel
  const tabBtns = await page.$$('button');
  const watchlistTabs = [];
  for (const btn of tabBtns) {
    const text = await btn.textContent();
    if (['Watchlist', 'Screener', 'Signals'].includes(text?.trim())) {
      watchlistTabs.push({ btn, text: text?.trim() });
    }
  }
  console.log(`Found ${watchlistTabs.length} watchlist tabs`);

  for (const { btn, text } of watchlistTabs) {
    try {
      await btn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${DIR}/15-trade-${text.toLowerCase()}-tab.png`, fullPage: false });
      console.log(`Captured ${text} tab`);
    } catch(e) {
      console.log(`Failed ${text} tab: ${e.message}`);
    }
  }

  // Check trade entry form interaction
  const symbolInput = await page.$('input[placeholder*="symbol" i], input[placeholder*="ticker" i], input[placeholder*="search" i]');
  if (symbolInput) {
    await symbolInput.fill('AAPL');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${DIR}/16-trade-symbol-search.png`, fullPage: false });
    console.log("Captured symbol search");
  }

  // Narrow viewport test (1280x720 - common laptop)
  const laptopCtx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });
  const laptopPage = await laptopCtx.newPage();
  await laptopPage.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await laptopPage.waitForTimeout(1000);
  await laptopPage.fill('input[placeholder="admin"]', CREDS.user);
  await laptopPage.fill('input[type="password"]', CREDS.pass);
  await laptopPage.click('button[type="submit"]');
  await laptopPage.waitForTimeout(4000);
  await laptopPage.screenshot({ path: `${DIR}/53-laptop-dashboard.png`, fullPage: false });
  console.log("53 laptop dashboard");
  await laptopPage.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await laptopPage.waitForTimeout(3000);
  await laptopPage.screenshot({ path: `${DIR}/54-laptop-trade.png`, fullPage: false });
  console.log("54 laptop trade");

  await browser.close();
  console.log("\nDone!");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
