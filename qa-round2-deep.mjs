import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'https://tradingalpha.net';
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round2/deep';
const USERNAME = 'admin';
const PASSWORD = 'alphaDesk2025!';

mkdirSync(SCREENSHOT_DIR, { recursive: true });

let idx = 0;
function nextName(label) {
  return join(SCREENSHOT_DIR, `${String(idx++).padStart(2, '0')}-${label}.png`);
}

async function ss(page, label, opts = {}) {
  const path = nextName(label);
  await page.screenshot({ path, fullPage: opts.fullPage ?? false, ...opts });
  console.log(`  [SS] ${path}`);
  return path;
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const inputs = await page.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].fill(USERNAME);
    await inputs[1].fill(PASSWORD);
  }
  const btn = await page.$('button[type="submit"], button:has-text("Sign In")');
  if (btn) await btn.click();
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('  Logged in. URL:', page.url());
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await login(page);

  // === DASHBOARD DEEP INSPECTION ===
  console.log('\n=== Dashboard Deep ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Inspect strategy cards - get all card info
  const stratCards = await page.$$eval('[class*="card"], [class*="Card"]', els => els.map(e => ({
    text: e.textContent?.substring(0, 100),
    class: e.className?.toString().substring(0, 80),
    rect: e.getBoundingClientRect(),
  })).filter(e => e.rect.height > 50));
  console.log(`  Found ${stratCards.length} card-like elements`);

  // Check the top bar content
  const topBar = await page.evaluate(() => {
    const nav = document.querySelector('nav, header, [class*="navbar"], [class*="header"]');
    return nav ? {
      text: nav.textContent?.substring(0, 200),
      height: nav.getBoundingClientRect().height,
    } : null;
  });
  console.log('  Top bar:', JSON.stringify(topBar));

  // Screenshot strategy cards close up - just the right section
  await ss(page, 'dashboard-strategies-section', { fullPage: true });

  // Check for "0 days" and "0 pos" on cards
  const cardTexts = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="card"], [class*="Card"]');
    return Array.from(cards).map(c => c.textContent?.trim().substring(0, 200));
  });
  console.log('  Card texts sample:', cardTexts.slice(0, 3));

  // Check the P&L calendar section
  const calArea = await page.$('text=April P&L');
  if (calArea) {
    await calArea.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await ss(page, 'dashboard-pnl-calendar');
  }

  // Check "Open Positions" section
  const openPos = await page.$('text=Open Positions');
  if (openPos) {
    await openPos.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await ss(page, 'dashboard-open-positions');
  }

  // Check "Economic Calendar"
  const econ = await page.$('text=Economic Calendar');
  if (econ) {
    await econ.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await ss(page, 'dashboard-economic-calendar');
  }

  // Get all text on page looking for "Awaiting", "null", "NaN", placeholders
  const dashText = await page.evaluate(() => document.body?.innerText || '');
  const awaiting = dashText.match(/Awaiting[^\n]*/gi);
  console.log('  "Awaiting" items:', awaiting);

  // === TRADE PAGE DEEP INSPECTION ===
  console.log('\n=== Trade Page Deep ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Enumerate ALL buttons and tabs visible
  const allBtns = await page.$$eval('button', els => els.map(e => ({
    text: e.textContent?.trim().substring(0, 50),
    rect: { x: Math.round(e.getBoundingClientRect().x), y: Math.round(e.getBoundingClientRect().y) },
    visible: e.offsetParent !== null,
  })).filter(e => e.visible && e.text));
  console.log('  All visible buttons:');
  for (const b of allBtns) {
    console.log(`    "${b.text}" at (${b.rect.x}, ${b.rect.y})`);
  }

  // Find tabs
  const allTabs = await page.$$eval('[role="tab"]', els => els.map(e => ({
    text: e.textContent?.trim(),
    selected: e.getAttribute('aria-selected'),
    rect: { x: Math.round(e.getBoundingClientRect().x), y: Math.round(e.getBoundingClientRect().y) },
  })));
  console.log('  All tabs:', JSON.stringify(allTabs));

  // Right panel - look for Analysis/News/Indicators tabs
  // The right panel header area
  const rightPanelBtns = allBtns.filter(b => b.rect.x > 800);
  console.log('  Right-side buttons:');
  for (const b of rightPanelBtns) {
    console.log(`    "${b.text}" at (${b.rect.x}, ${b.rect.y})`);
  }

  // Try clicking "News" tab in right panel
  for (const tabName of ['News', 'Analysis', 'Indicators', 'Screener', 'Signals', 'Watchlist']) {
    const btn = await page.$(`button:has-text("${tabName}")`);
    if (btn) {
      const box = await btn.boundingBox();
      if (box) {
        console.log(`  Found "${tabName}" at (${box.x}, ${box.y})`);
        await btn.click();
        await page.waitForTimeout(1000);
        await ss(page, `trade-tab-${tabName.toLowerCase()}`);
      }
    }
  }

  // Click the left panel tabs: Watchlist, Screener, Signals
  for (const tabName of ['Watchlist', 'Screener', 'Signals']) {
    const btn = await page.$(`button:has-text("${tabName}")`);
    if (btn) {
      const box = await btn.boundingBox();
      if (box && box.x < 200) {
        console.log(`  Clicking left tab "${tabName}" at (${box.x}, ${box.y})`);
        await btn.click();
        await page.waitForTimeout(1000);
        await ss(page, `trade-left-${tabName.toLowerCase()}`);
      }
    }
  }

  // Now click the right side panel tabs near top-right
  // Look for "News", "Fund", "Sent", "Chat", "Order" -- abbreviated names maybe
  for (const tabName of ['News', 'Fund', 'Sent', 'Chat', 'Order']) {
    for (const b of rightPanelBtns) {
      if (b.text.includes(tabName) || b.text === tabName) {
        const btn = await page.locator(`button:has-text("${b.text}")`).first();
        await btn.click().catch(() => {});
        await page.waitForTimeout(1000);
        await ss(page, `trade-right-${tabName.toLowerCase()}`);
        break;
      }
    }
  }

  // Bottom panel - click each tab and capture the content
  const bottomTabs = ['Trade', 'Positions', 'Orders', 'Journal', 'Calendar'];
  for (const tabName of bottomTabs) {
    // Find tab buttons that are low on the page (y > 600)
    const matchingBtns = allBtns.filter(b => b.text.includes(tabName) && b.rect.y > 500);
    if (matchingBtns.length > 0) {
      const btnText = matchingBtns[0].text;
      const btn = await page.locator(`button:has-text("${btnText}")`).last();
      try {
        await btn.click();
        await page.waitForTimeout(1500);
        // Clip just the bottom panel area
        await ss(page, `trade-bottom-${tabName.toLowerCase()}-content`);
      } catch (e) {
        console.log(`    Error clicking bottom ${tabName}: ${e.message.substring(0, 80)}`);
      }
    }
  }

  // Check the options chain section
  const optionsArea = await page.$('text=SPY Options');
  if (optionsArea) {
    await optionsArea.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await ss(page, 'trade-options-chain');
  }

  // === PIPELINE DEEP ===
  console.log('\n=== Pipeline Deep ===');
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);
  await ss(page, 'pipeline-full', { fullPage: true });

  // Check for "API 404" error
  const pipeText = await page.evaluate(() => document.body?.innerText || '');
  if (pipeText.includes('404')) {
    console.log('  FOUND: API 404 error on pipeline page');
  }
  if (pipeText.includes('API')) {
    const apiLines = pipeText.split('\n').filter(l => l.includes('API'));
    console.log('  API mentions:', apiLines);
  }

  // Check strategy builder section
  const stratBuilder = await page.$('text=Strategy Builder');
  if (stratBuilder) {
    await stratBuilder.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await ss(page, 'pipeline-strategy-builder');
  }

  // Check backtesting section
  const backtest = await page.$('text=BACKTESTING');
  if (backtest) {
    await backtest.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await ss(page, 'pipeline-backtest-section');
  }

  // === STRATEGY DETAIL DEEP ===
  console.log('\n=== Strategy Detail Deep ===');
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);
  await ss(page, 'strategy-pead-top');

  // Check the stats boxes
  const statsText = await page.evaluate(() => {
    const boxes = document.querySelectorAll('[class*="stat"], [class*="metric"]');
    return Array.from(boxes).map(b => b.textContent?.trim().substring(0, 80));
  });
  console.log('  Stats:', statsText);

  // Get all text looking for "Awaiting" placeholders
  const stratText = await page.evaluate(() => document.body?.innerText || '');
  const awaitingStrat = stratText.match(/Awaiting[^\n]*/gi);
  console.log('  "Awaiting" items:', awaitingStrat);

  // Click through the strategy sub-tabs
  const stratSubTabs = ['About', 'Positions', 'Sector Exposure', 'Correlation', 'Analytics'];
  for (const tabName of stratSubTabs) {
    const tab = await page.$(`button:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`);
    if (tab) {
      await tab.click();
      await page.waitForTimeout(1500);
      await ss(page, `strategy-tab-${tabName.toLowerCase().replace(/\s+/g, '-')}`);

      // Scroll down to see full tab content
      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForTimeout(500);
      await ss(page, `strategy-tab-${tabName.toLowerCase().replace(/\s+/g, '-')}-scrolled`);
      await page.evaluate(() => window.scrollTo(0, 0));
    } else {
      console.log(`  Strategy tab "${tabName}" not found`);
    }
  }

  // === PROFILE MENU ===
  console.log('\n=== Profile Menu ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Click the user avatar/icon - it's in the top-right corner
  // Look for the rightmost button in the header
  const headerBtns = await page.$$('button');
  let profileBtn = null;
  let maxX = 0;
  for (const btn of headerBtns) {
    const box = await btn.boundingBox().catch(() => null);
    if (box && box.y < 50 && box.x > maxX) {
      maxX = box.x;
      profileBtn = btn;
    }
  }
  if (profileBtn) {
    console.log(`  Clicking profile button at x=${maxX}`);
    await profileBtn.click();
    await page.waitForTimeout(1500);
    await ss(page, 'profile-dropdown');

    // Check what appeared
    const dropdownText = await page.evaluate(() => {
      const menus = document.querySelectorAll('[role="menu"], [class*="dropdown"], [class*="popover"], [class*="modal"]');
      return Array.from(menus).map(m => m.textContent?.trim().substring(0, 200));
    });
    console.log('  Dropdown content:', dropdownText);
  }

  // Try the bell/notification icon
  const bellBtn = await page.$('button:has(svg[class*="bell"]), button[aria-label*="notification" i], button[aria-label*="alert" i]');
  if (bellBtn) {
    await bellBtn.click();
    await page.waitForTimeout(1000);
    await ss(page, 'notifications-panel');
  }

  // === Check all strategy pages ===
  console.log('\n=== Other strategies ===');
  for (const strat of ['momentum-quality', 'mean-reversion', 'vrp-harvesting', 'earnings-vol', 'regime-adaptive', 'claude-alpha', 'vcp-breakout']) {
    try {
      await page.goto(`${BASE_URL}/strategies/${strat}`, { waitUntil: 'networkidle', timeout: 10000 });
      await page.waitForTimeout(2000);
      const title = await page.evaluate(() => document.querySelector('h1, h2')?.textContent?.trim() || '');
      const body = await page.evaluate(() => document.body?.innerText?.substring(0, 100) || '');
      if (body.includes('404') || body.includes('error') || !title) {
        console.log(`  ${strat}: ERROR or 404`);
      } else {
        console.log(`  ${strat}: OK - "${title}"`);
        await ss(page, `strategy-${strat}`);
      }
    } catch (e) {
      console.log(`  ${strat}: FAILED - ${e.message.substring(0, 60)}`);
    }
  }

  console.log('\nDone. Screenshots in', SCREENSHOT_DIR);
  await browser.close();
}

main().catch(e => { console.error('Failed:', e); process.exit(1); });
