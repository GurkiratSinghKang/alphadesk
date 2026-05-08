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
const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round2/deep2';
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

mkdirSync(DIR, { recursive: true });
let idx = 0;
const ss = async (page, label, opts = {}) => {
  const path = join(DIR, `${String(idx++).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path, fullPage: opts.fullPage ?? false, ...opts });
  console.log(`  [SS] ${path}`);
};

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const inputs = await page.$$('input');
  if (inputs.length >= 2) { await inputs[0].fill(USERNAME); await inputs[1].fill(PASSWORD); }
  const btn = await page.$('button[type="submit"], button:has-text("Sign In")');
  if (btn) await btn.click();
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function dismissModals(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page);

  // ===== TRADE PAGE: RIGHT PANEL TABS =====
  console.log('\n=== Trade: Right Panel Tabs ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Tech tab (Technical analysis)
  const techTab = await page.$('[role="tab"]:has-text("Tech")');
  if (techTab) { await techTab.click(); await page.waitForTimeout(1500); await ss(page, 'trade-right-tech'); }

  // Fund tab (Fundamental)
  const fundTab = await page.$('[role="tab"]:has-text("Fund")');
  if (fundTab) { await fundTab.click(); await page.waitForTimeout(1500); await ss(page, 'trade-right-fund'); }

  // Sent tab (Sentiment)
  const sentTab = await page.$('[role="tab"]:has-text("Sent")');
  if (sentTab) { await sentTab.click(); await page.waitForTimeout(1500); await ss(page, 'trade-right-sent'); }

  // Chat tab
  const chatTab = await page.$('[role="tab"]:has-text("Chat")');
  if (chatTab) { await chatTab.click(); await page.waitForTimeout(1500); await ss(page, 'trade-right-chat'); }

  // Order tab
  const orderTab = await page.$('[role="tab"]:has-text("Order")');
  if (orderTab) { await orderTab.click(); await page.waitForTimeout(1500); await ss(page, 'trade-right-order'); }

  // ===== TRADE PAGE: LEFT PANEL TABS =====
  console.log('\n=== Trade: Left Panel Tabs ===');
  await dismissModals(page);

  const watchTab = await page.$('[role="tab"]:has-text("Watchlist")');
  if (watchTab) { await watchTab.click(); await page.waitForTimeout(1500); await ss(page, 'trade-left-watchlist'); }

  const screenerTab = await page.$('[role="tab"]:has-text("Screener")');
  if (screenerTab) { await screenerTab.click(); await page.waitForTimeout(1500); await ss(page, 'trade-left-screener'); }

  const signalsTab = await page.$('[role="tab"]:has-text("Signals")');
  if (signalsTab) { await signalsTab.click(); await page.waitForTimeout(1500); await ss(page, 'trade-left-signals'); }

  // ===== TRADE PAGE: BOTTOM PANEL TABS =====
  console.log('\n=== Trade: Bottom Panel Tabs ===');
  const bottomTabNames = ['Trade', 'Positions', 'Orders', 'Journal', 'Calendar'];
  for (const name of bottomTabNames) {
    // Bottom tabs are at y > 600
    const tabs = await page.$$('[role="tab"]');
    for (const t of tabs) {
      const text = await t.textContent().catch(() => '');
      const box = await t.boundingBox().catch(() => null);
      if (text?.trim() === name && box && box.y > 600) {
        await t.click();
        await page.waitForTimeout(1500);
        await ss(page, `trade-bottom-${name.toLowerCase()}`);
        break;
      }
    }
  }

  // ===== STRATEGY DETAIL: ALL TABS =====
  console.log('\n=== Strategy Detail Tabs ===');
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);
  await ss(page, 'strategy-pead-top');

  // Scroll down to see the stats and tabs
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(500);
  await ss(page, 'strategy-pead-stats');

  // Click each strategy tab
  for (const tabName of ['About', 'Positions', 'Sector Exposure', 'Correlation', 'Analytics']) {
    const tab = await page.$(`button:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`);
    if (tab) {
      await tab.click();
      await page.waitForTimeout(1500);
      // Scroll to see tab content
      await page.evaluate(() => window.scrollTo(0, 400));
      await page.waitForTimeout(500);
      await ss(page, `strategy-tab-${tabName.toLowerCase().replace(/\s/g, '-')}`);
    } else {
      console.log(`  Tab "${tabName}" not found`);
    }
  }

  // Full page screenshot of strategy
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await ss(page, 'strategy-pead-fullpage', { fullPage: true });

  // ===== OTHER STRATEGY PAGES =====
  console.log('\n=== Other Strategy Pages ===');
  for (const strat of ['momentum-quality', 'vrp-harvesting', 'earnings-vol', 'regime-adaptive', 'claude-alpha', 'mean-reversion', 'vcp-breakout']) {
    try {
      await page.goto(`${BASE_URL}/strategies/${strat}`, { waitUntil: 'networkidle', timeout: 10000 });
      await page.waitForTimeout(2000);
      await ss(page, `strategy-${strat}`);
      // Check for error states
      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
      if (bodyText.includes('Awaiting')) {
        const awaiting = bodyText.match(/Awaiting[^\n]*/gi);
        console.log(`  ${strat} has Awaiting: ${awaiting?.join(', ')}`);
      }
    } catch (e) {
      console.log(`  ${strat}: ${e.message.substring(0, 60)}`);
    }
  }

  // ===== COMMAND PALETTE =====
  console.log('\n=== Command Palette ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Click the search box in top bar
  const searchBox = await page.$('button:has-text("Search symbols")');
  if (searchBox) {
    await searchBox.click();
    await page.waitForTimeout(1500);
    await ss(page, 'command-palette-open');

    // Type something to search
    await page.keyboard.type('AAPL');
    await page.waitForTimeout(1500);
    await ss(page, 'command-palette-search-aapl');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // ===== PROFILE/USER AREA =====
  console.log('\n=== User Profile Area ===');
  // The "A" button at top-right
  const avatarBtn = await page.$('button:has-text("A")');
  if (avatarBtn) {
    const box = await avatarBtn.boundingBox();
    if (box && box.x > 1300) {
      await avatarBtn.click();
      await page.waitForTimeout(1500);
      await ss(page, 'user-avatar-click');

      // Check what appeared
      const popupText = await page.evaluate(() => {
        const portal = document.querySelector('[data-base-ui-portal], [role="dialog"], [role="menu"], [class*="dropdown"], [class*="popover"]');
        return portal?.textContent?.trim().substring(0, 300) || 'No portal/dialog found';
      });
      console.log('  Avatar click result:', popupText);
    }
  }

  console.log('\nAll done.');
  await browser.close();
}

main().catch(e => { console.error('Failed:', e); process.exit(1); });
