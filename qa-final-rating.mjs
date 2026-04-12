import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'https://tradingalpha.net';
const OUT = '/Users/GK/Downloads/alphadesk/qa-screenshots/final-rating';
const USERNAME = 'admin';
const PASSWORD = 'GK1355$$gk';

mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const inputs = await page.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].fill(USERNAME);
    await inputs[1].fill(PASSWORD);
  }
  // Screenshot login page before submitting
  await page.screenshot({ path: join(OUT, '00-login-page.png'), fullPage: true });
  console.log('  -> 00-login-page.png');

  const btn = await page.$('button:has-text("Sign In"), button:has-text("Log In"), button[type="submit"]');
  if (btn) await btn.click();
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('Logged in, URL:', page.url());
}

async function shot(page, name, opts = {}) {
  try {
    await page.screenshot({ path: join(OUT, name), ...opts });
    console.log(`  -> ${name}`);
  } catch (e) {
    console.log(`  !! ${name} failed: ${e.message}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // ─── LOGIN ───
  console.log('\n=== LOGIN ===');
  await login(page);

  // ─── DASHBOARD ───
  console.log('\n=== DASHBOARD ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await shot(page, '01-dashboard-viewport.png');
  await shot(page, '01-dashboard-full.png', { fullPage: true });

  // Scroll down to capture below-fold content
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await shot(page, '02-dashboard-scroll1.png');
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await shot(page, '03-dashboard-scroll2.png');
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await shot(page, '04-dashboard-scroll3.png');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // ─── HEADER INSPECTION ───
  console.log('\n=== HEADER ===');
  await shot(page, '05-header-detail.png', {
    clip: { x: 0, y: 0, width: 1920, height: 120 },
  });

  // ─── STRATEGY GRID ───
  console.log('\n=== STRATEGY GRID ===');
  // Try to locate the strategy grid area
  const stratGrid = await page.$('[class*="strategy"], [class*="Strategy"], [data-testid*="strategy"]');
  if (stratGrid) {
    const box = await stratGrid.boundingBox();
    if (box) {
      await shot(page, '06-strategy-grid.png', {
        clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(1920, box.width + 20), height: Math.min(2000, box.height + 20) },
      });
    }
  } else {
    console.log('  Strategy grid element not found by class, taking full page');
  }

  // ─── TRADE PAGE ───
  console.log('\n=== TRADE PAGE ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await shot(page, '10-trade-viewport.png');
  await shot(page, '10-trade-full.png', { fullPage: true });

  // Scroll trade page
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await shot(page, '11-trade-scroll1.png');
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await shot(page, '12-trade-scroll2.png');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // ─── CHART AREA ───
  console.log('\n=== CHART PANEL ===');
  const chartEl = await page.$('canvas, [class*="chart"], [class*="Chart"]');
  if (chartEl) {
    const box = await chartEl.boundingBox();
    if (box) {
      await shot(page, '13-chart-detail.png', {
        clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(1920, box.width + 20), height: Math.min(1080, box.height + 20) },
      });
    }
  }

  // ─── TRY INTERACTIONS: BUY/SELL BUTTONS ───
  console.log('\n=== BUY/SELL BUTTONS ===');
  const buyBtn = await page.$('button:has-text("BUY"), button:has-text("Buy")');
  const sellBtn = await page.$('button:has-text("SELL"), button:has-text("Sell")');
  if (buyBtn) {
    await buyBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, '14-buy-sell-area.png');
  }

  // ─── ORDER ENTRY / POSITION SIZER ───
  console.log('\n=== ORDER ENTRY ===');
  const orderPanel = await page.$('[class*="order"], [class*="Order"], [class*="position"], [class*="Position"]');
  if (orderPanel) {
    await orderPanel.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    const box = await orderPanel.boundingBox();
    if (box) {
      await shot(page, '15-order-entry.png', {
        clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(1920, box.width + 20), height: Math.min(1080, box.height + 20) },
      });
    }
  }

  // ─── WATCHLIST ───
  console.log('\n=== WATCHLIST ===');
  const watchlist = await page.$('[class*="watchlist"], [class*="Watchlist"]');
  if (watchlist) {
    await watchlist.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    const box = await watchlist.boundingBox();
    if (box) {
      await shot(page, '16-watchlist.png', {
        clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(1920, box.width + 20), height: Math.min(600, box.height + 20) },
      });
    }
  }

  // ─── PIPELINE PAGE ===
  console.log('\n=== PIPELINE PAGE ===');
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await shot(page, '20-pipeline-viewport.png');
  await shot(page, '20-pipeline-full.png', { fullPage: true });

  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await shot(page, '21-pipeline-scroll1.png');
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(1000);
  await shot(page, '22-pipeline-scroll2.png');
  await page.evaluate(() => window.scrollTo(0, 0));

  // ─── STRATEGY BUILDER ===
  console.log('\n=== STRATEGY BUILDER / BACKTESTING ===');
  const stratBuilder = await page.$('[class*="builder"], [class*="Builder"], button:has-text("Strategy Builder"), button:has-text("Backtest")');
  if (stratBuilder) {
    await stratBuilder.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, '23-strategy-builder.png');
  }

  // ─── SCREENER ===
  console.log('\n=== SCREENER ===');
  const screener = await page.$('[class*="screener"], [class*="Screener"], button:has-text("Screener")');
  if (screener) {
    await screener.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, '24-screener.png');
  }

  // ─── STRATEGY DETAIL PAGE ===
  console.log('\n=== STRATEGY DETAIL ===');
  // Try to navigate to a strategy detail page
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Click a strategy card to go to detail
  const stratCard = await page.$('a[href*="strategies"], [class*="strateg"] a, [class*="Strateg"] a');
  if (stratCard) {
    await stratCard.click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, '25-strategy-detail.png');
    await shot(page, '25-strategy-detail-full.png', { fullPage: true });
  } else {
    // Try direct URL
    await page.goto(`${BASE_URL}/strategies/1`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot(page, '25-strategy-detail.png');
    await shot(page, '25-strategy-detail-full.png', { fullPage: true });
  }

  // ─── AI JOURNAL ===
  console.log('\n=== AI JOURNAL ===');
  const journal = await page.$('[class*="journal"], [class*="Journal"], button:has-text("Journal"), button:has-text("AI")');
  if (journal) {
    await journal.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, '26-ai-journal.png');
  }

  // ─── TOAST NOTIFICATIONS ===
  console.log('\n=== TOAST TEST ===');
  // Trigger a potential toast by interacting
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Try clicking alert or some action button
  const alertBtn = await page.$('button:has-text("Alert"), button:has-text("alert")');
  if (alertBtn) {
    await alertBtn.click();
    await page.waitForTimeout(1500);
    await shot(page, '27-toast-notification.png');
  }

  // ─── KEYBOARD SHORTCUTS DIALOG ===
  console.log('\n=== KEYBOARD SHORTCUTS ===');
  await page.keyboard.press('?');
  await page.waitForTimeout(1500);
  const modal = await page.$('[class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [role="dialog"]');
  if (modal) {
    await shot(page, '28-keyboard-shortcuts.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // ─── RESPONSIVE TEST: Tablet ===
  console.log('\n=== RESPONSIVE: TABLET ===');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, '30-responsive-tablet-dashboard.png', { fullPage: true });

  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, '31-responsive-tablet-trade.png', { fullPage: true });

  // ─── RESPONSIVE TEST: Mobile ===
  console.log('\n=== RESPONSIVE: MOBILE ===');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, '32-responsive-mobile-dashboard.png', { fullPage: true });

  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, '33-responsive-mobile-trade.png', { fullPage: true });

  // Reset viewport
  await page.setViewportSize({ width: 1920, height: 1080 });

  // ─── EMPTY STATES TEST ===
  console.log('\n=== EMPTY STATES ===');
  // Check for empty state patterns in the DOM
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const emptyStates = await page.$$('[class*="empty"], [class*="Empty"], [class*="no-data"], [class*="placeholder"]');
  console.log(`  Found ${emptyStates.length} empty state elements`);

  // ─── COLLECT DOM METRICS ===
  console.log('\n=== DOM METRICS ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const dashMetrics = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const fontSizes = new Set();
    const fontFamilies = new Set();
    const colors = new Set();
    const bgColors = new Set();
    let buttonCount = 0;
    let inputCount = 0;
    let linkCount = 0;
    let imgCount = 0;
    let cardCount = 0;

    for (let i = 0; i < Math.min(all.length, 800); i++) {
      const el = all[i];
      const s = window.getComputedStyle(el);
      fontSizes.add(s.fontSize);
      fontFamilies.add(s.fontFamily.split(',')[0].trim());
      if (s.color !== 'rgba(0, 0, 0, 0)') colors.add(s.color);
      if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') bgColors.add(s.backgroundColor);
      if (el.tagName === 'BUTTON') buttonCount++;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT') inputCount++;
      if (el.tagName === 'A') linkCount++;
      if (el.tagName === 'IMG') imgCount++;
      if (el.className && typeof el.className === 'string' && (el.className.includes('card') || el.className.includes('Card'))) cardCount++;
    }

    return {
      totalElements: all.length,
      fontSizes: [...fontSizes].sort(),
      fontFamilies: [...fontFamilies],
      uniqueColors: colors.size,
      uniqueBgColors: bgColors.size,
      buttonCount,
      inputCount,
      linkCount,
      imgCount,
      cardCount,
      pageHeight: document.documentElement.scrollHeight,
      pageWidth: document.documentElement.scrollWidth,
    };
  });
  console.log('Dashboard metrics:', JSON.stringify(dashMetrics, null, 2));

  // Trade page metrics
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const tradeMetrics = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const panels = document.querySelectorAll('[class*="panel"], [class*="Panel"]');
    const tabs = document.querySelectorAll('[role="tab"], [class*="tab"], button[class*="Tab"]');
    const charts = document.querySelectorAll('canvas, [class*="chart"], [class*="Chart"]');
    return {
      totalElements: all.length,
      panelCount: panels.length,
      tabCount: tabs.length,
      chartCount: charts.length,
      pageHeight: document.documentElement.scrollHeight,
    };
  });
  console.log('Trade page metrics:', JSON.stringify(tradeMetrics, null, 2));

  // Pipeline page metrics
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const pipelineMetrics = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const tables = document.querySelectorAll('table, [class*="table"], [class*="Table"]');
    const rows = document.querySelectorAll('tr, [class*="row"], [role="row"]');
    return {
      totalElements: all.length,
      tableCount: tables.length,
      rowCount: rows.length,
      pageHeight: document.documentElement.scrollHeight,
    };
  });
  console.log('Pipeline page metrics:', JSON.stringify(pipelineMetrics, null, 2));

  // ─── FINAL: Full-page captures at 1920x1080 for all pages ===
  console.log('\n=== FINAL FULL-PAGE CAPTURES ===');
  await page.setViewportSize({ width: 1920, height: 1080 });

  for (const [route, name] of [
    ['/', 'final-dashboard'],
    ['/trade', 'final-trade'],
    ['/pipeline', 'final-pipeline'],
  ]) {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot(page, `${name}-1920x1080.png`);
    await shot(page, `${name}-fullpage.png`, { fullPage: true });
  }

  console.log('\n=== DONE ===');
  await browser.close();
})();
