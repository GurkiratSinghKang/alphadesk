import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE_URL = 'https://tradingalpha.net';
const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round2/final';
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

mkdirSync(DIR, { recursive: true });
let idx = 0;
const ss = async (page, label) => {
  const path = join(DIR, `${String(idx++).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  [SS] ${path}`);
};

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const inputs = await page.$$('input');
  if (inputs.length >= 2) { await inputs[0].fill(USERNAME); await inputs[1].fill(PASSWORD); }
  const btn = await page.$('button[type="submit"]');
  if (btn) await btn.click();
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page);

  // === Strategy PEAD - scrolled down below tabs ===
  console.log('\n=== Strategy Detail Below-Fold ===');
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Click "About" tab and scroll down to see content
  const aboutTab = await page.$('button:has-text("About")');
  if (aboutTab) await aboutTab.click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await ss(page, 'strategy-about-content');
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForTimeout(500);
  await ss(page, 'strategy-about-content-deep');

  // Click "Positions" tab
  const posTab = await page.$('button:has-text("Positions")');
  if (posTab) await posTab.click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await ss(page, 'strategy-positions-content');

  // Click "Analytics" tab
  const analyticsTab = await page.$('button:has-text("Analytics")');
  if (analyticsTab) await analyticsTab.click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await ss(page, 'strategy-analytics-content');
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForTimeout(500);
  await ss(page, 'strategy-analytics-deep');

  // Click "Correlation" tab
  const corrTab = await page.$('button:has-text("Correlation")');
  if (corrTab) await corrTab.click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await ss(page, 'strategy-correlation-content');

  // Click "Sector Exposure" tab
  const sectorTab = await page.$('button:has-text("Sector Exposure")');
  if (sectorTab) await sectorTab.click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await ss(page, 'strategy-sector-content');

  // === Dashboard - full page  ===
  console.log('\n=== Dashboard Full Page ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Full page screenshot to see everything including Economic Calendar
  await ss(page, 'dashboard-viewport');

  // Get total page height
  const pageHeight = await page.evaluate(() => document.body.scrollHeight);
  console.log(`  Page height: ${pageHeight}`);

  // Try scrolling -- might be a fixed layout
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTo(0, main.scrollHeight);
  });
  await page.waitForTimeout(500);
  await ss(page, 'dashboard-main-scrolled');

  // Check the Earnings Vol with API 404
  console.log('\n=== Earnings Vol Detail ===');
  await page.goto(`${BASE_URL}/strategies/earnings-vol`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(4000);
  await ss(page, 'earnings-vol-with-errors');

  // Scroll down to see the toast/error detail
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(500);
  await ss(page, 'earnings-vol-scrolled');

  // Check if breadcrumb shows raw slug
  const breadcrumb = await page.evaluate(() => {
    const crumbs = document.querySelectorAll('a, span');
    return Array.from(crumbs)
      .filter(e => e.textContent?.includes('earnings-vol'))
      .map(e => ({ text: e.textContent?.trim(), tag: e.tagName }));
  });
  console.log('  Breadcrumb with slug:', breadcrumb);

  // === Pipeline - full page including backtesting ===
  console.log('\n=== Pipeline Full ===');
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(DIR, `${String(idx++).padStart(2, '0')}-pipeline-fullpage.png`), fullPage: true });

  // === User avatar/notification ===
  console.log('\n=== User Avatar / Alerts ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Find the avatar button (the "A" circle)
  const avatarBtns = await page.$$('button');
  for (const btn of avatarBtns) {
    const box = await btn.boundingBox().catch(() => null);
    if (box && box.y < 40 && box.x > 1380) {
      console.log(`  Clicking avatar at x=${Math.round(box.x)}, y=${Math.round(box.y)}`);
      await btn.click();
      await page.waitForTimeout(1500);
      await ss(page, 'avatar-dropdown');
      break;
    }
  }

  // Look for any notification bell
  const allIcons = await page.$$('svg');
  for (const icon of allIcons) {
    const box = await icon.boundingBox().catch(() => null);
    if (box && box.y < 40 && box.x > 1350 && box.x < 1400) {
      const parent = await icon.evaluateHandle(el => el.closest('button'));
      if (parent) {
        console.log(`  Found bell/icon at x=${Math.round(box.x)}`);
        await parent.asElement()?.click();
        await page.waitForTimeout(1000);
        await ss(page, 'notification-bell');
      }
    }
  }

  // === Trade page: check the "Chg%" column alignment ===
  console.log('\n=== Trade page details ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Check for truncated text in watchlist
  const watchlistText = await page.evaluate(() => {
    const items = document.querySelectorAll('[class*="watchlist"], [class*="Watchlist"]');
    return Array.from(items).map(i => ({
      text: i.textContent?.substring(0, 100),
      overflow: i.scrollWidth > i.clientWidth,
    }));
  });
  console.log('  Watchlist items:', watchlistText.length);

  // Check the ticker bar at top (P&L, Regime, VIX, etc.)
  const tickerBar = await page.evaluate(() => {
    const bar = document.querySelector('[class*="ticker"], [class*="status"]');
    return bar ? bar.textContent?.trim().substring(0, 200) : null;
  });
  console.log('  Ticker bar:', tickerBar);

  // Get detailed view of the sub-header/ticker bar
  // Clip just the top 50px
  const topBarClip = { x: 0, y: 25, width: 1440, height: 30 };
  await page.screenshot({ path: join(DIR, `${String(idx++).padStart(2, '0')}-trade-ticker-bar.png`), clip: topBarClip });

  console.log('\nDone.');
  await browser.close();
}

main().catch(e => { console.error('Failed:', e); process.exit(1); });
