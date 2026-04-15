import { chromium } from 'playwright';
import { join } from 'path';

const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/qa-loop-visual';
const URL = 'https://tradingalpha.net';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // ---- LOGIN ----
  console.log('=> Navigating to login...');
  await page.goto(URL + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(1000);
  await page.screenshot({ path: join(DIR, '00-login-page.png'), fullPage: true });

  // Fill login form
  try {
    await page.fill('input[name="username"], input[type="text"]', 'admin');
    await page.fill('input[name="password"], input[type="password"]', 'alphaDesk2025!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 }).catch(() => {});
    await sleep(2000);
  } catch (e) {
    console.log('Login form approach 1 failed, trying alternative...', e.message);
  }

  // Dismiss onboarding tour & welcome banner
  console.log('=> Dismissing tour & welcome...');
  await page.evaluate(() => {
    localStorage.setItem('alphadesk-tour-complete', '1');
    localStorage.setItem('alphadesk-welcomed', '1');
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);

  // Full dashboard screenshot
  console.log('=> Taking full dashboard screenshot...');
  await page.screenshot({ path: join(DIR, '01-dashboard-full.png'), fullPage: true });

  // ---- CLOSEUP: CORRELATION MATRIX ----
  console.log('=> Closeup: Correlation Matrix...');
  let el = await page.$('[class*="correlation"], [class*="Correlation"], [data-testid*="correlation"], text=Correlation');
  if (!el) el = await page.locator(':has-text("Correlation")').first().elementHandle().catch(() => null);
  if (el) {
    // Get the parent card/section
    const card = await page.evaluate(e => {
      let node = e;
      for (let i = 0; i < 8; i++) {
        if (node.parentElement) node = node.parentElement;
        const cl = node.className || '';
        if (cl.includes('card') || cl.includes('Card') || cl.includes('section') || cl.includes('widget') || cl.includes('grid-item') || node.getAttribute('data-grid')) break;
      }
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }, el);
    if (card.width > 10 && card.height > 10) {
      await page.screenshot({ path: join(DIR, '02-correlation-matrix.png'), clip: { x: Math.max(0, card.x - 10), y: Math.max(0, card.y - 10), width: card.width + 20, height: card.height + 20 } });
    }
  } else {
    console.log('   Correlation matrix not found by selector, will capture by scroll position');
  }

  // ---- Helper: find and screenshot a section by text ----
  async function screenshotSection(label, filename, scrollTo) {
    console.log(`=> Closeup: ${label}...`);
    try {
      // Try to find by text content
      const locs = page.locator(`text="${label}"`);
      const count = await locs.count();
      if (count > 0) {
        const target = locs.first();
        await target.scrollIntoViewIfNeeded();
        await sleep(500);
        // Walk up to find the card container
        const box = await target.evaluate(e => {
          let node = e;
          for (let i = 0; i < 10; i++) {
            if (node.parentElement) node = node.parentElement;
            const cl = (node.className || '').toLowerCase();
            const style = window.getComputedStyle(node);
            if (cl.includes('card') || cl.includes('widget') || cl.includes('section') || cl.includes('panel') ||
                cl.includes('grid-item') || cl.includes('MuiPaper') || cl.includes('muipaper') ||
                (style.borderRadius && parseInt(style.borderRadius) > 0 && node.offsetHeight > 100)) {
              break;
            }
          }
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });
        if (box.width > 50 && box.height > 30) {
          await page.screenshot({
            path: join(DIR, filename),
            clip: {
              x: Math.max(0, box.x - 5),
              y: Math.max(0, box.y - 5),
              width: Math.min(1440, box.width + 10),
              height: Math.min(2000, box.height + 10)
            }
          });
          return true;
        }
      }
    } catch (e) {
      console.log(`   Could not find "${label}": ${e.message}`);
    }
    return false;
  }

  // ---- Scroll down and capture sections ----
  // Strategy Cards
  await screenshotSection('Strategy', '03-strategy-cards.png');
  // Also try "Strategies"
  if (!(await screenshotSection('Strategies', '03-strategy-cards.png'))) {
    // Capture viewport area that might have strategies
  }

  // Risk Dashboard
  await screenshotSection('Risk', '04-risk-dashboard.png');

  // Market Movers
  await screenshotSection('Market Movers', '05-market-movers.png');
  if (!(await screenshotSection('Movers', '05-market-movers.png'))) {
    await screenshotSection('Gainers', '05-market-movers.png');
  }

  // Market Breadth
  await screenshotSection('Market Breadth', '06-market-breadth.png');
  if (!(await screenshotSection('Breadth', '06-market-breadth.png'))) {
    await screenshotSection('breadth', '06-market-breadth.png');
  }

  // Stress Test
  await screenshotSection('Stress Test', '07-stress-test.png');
  if (!(await screenshotSection('Stress', '07-stress-test.png'))) {
    await screenshotSection('stress', '07-stress-test.png');
  }

  // P&L Attribution
  await screenshotSection('P&L', '08-pnl-attribution.png');
  if (!(await screenshotSection('Attribution', '08-pnl-attribution.png'))) {
    await screenshotSection('PnL', '08-pnl-attribution.png');
  }

  // Sector Treemap
  await screenshotSection('Sector', '09-sector-treemap.png');
  await screenshotSection('Treemap', '09-sector-treemap.png');

  // Ticker Tape
  await screenshotSection('ticker', '10-ticker-tape.png');

  // Try to capture the ticker tape at top of page
  console.log('=> Capturing ticker tape area (top of page)...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await page.screenshot({ path: join(DIR, '10-ticker-tape-top.png'), clip: { x: 0, y: 0, width: 1440, height: 60 } });

  // Footer
  console.log('=> Scrolling to bottom for footer...');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1000);
  const pageHeight = await page.evaluate(() => document.body.scrollHeight);
  const vpHeight = 900;
  await page.screenshot({
    path: join(DIR, '11-footer.png'),
    clip: { x: 0, y: Math.max(0, pageHeight - 120), width: 1440, height: 120 }
  });
  // Also full page bottom
  await page.screenshot({ path: join(DIR, '11-footer-area.png'), fullPage: false });

  // ---- Scrolling screenshots of the full dashboard in segments ----
  console.log('=> Taking segmented dashboard screenshots...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  for (let i = 0; i < 6; i++) {
    await page.evaluate((offset) => window.scrollTo(0, offset), i * 800);
    await sleep(500);
    await page.screenshot({ path: join(DIR, `01-dashboard-segment-${i}.png`) });
  }

  // ---- TRADE PAGE ----
  console.log('=> Navigating to trade page...');
  // Try clicking Trade nav link
  const tradeLink = await page.locator('a:has-text("Trade"), [href*="trade"], button:has-text("Trade")').first();
  if (await tradeLink.count() > 0) {
    await tradeLink.click();
  } else {
    await page.goto(URL + '/trade', { waitUntil: 'networkidle', timeout: 20000 });
  }
  await sleep(3000);

  await page.screenshot({ path: join(DIR, '12-trade-full.png'), fullPage: true });

  // Chart closeup
  console.log('=> Trade page: Chart closeup...');
  await screenshotSection('Chart', '13-trade-chart.png');
  // Also try capturing canvas element (TradingView)
  const canvas = await page.$('canvas, [class*="chart"], [class*="Chart"], .tv-chart, iframe[src*="trading"]');
  if (canvas) {
    const cBox = await canvas.boundingBox();
    if (cBox) {
      await page.screenshot({
        path: join(DIR, '13-trade-chart-canvas.png'),
        clip: { x: Math.max(0, cBox.x - 5), y: Math.max(0, cBox.y - 5), width: cBox.width + 10, height: cBox.height + 10 }
      });
    }
  }

  // Options Chain
  console.log('=> Trade page: Options chain...');
  await screenshotSection('Options', '14-options-chain.png');
  await screenshotSection('Chain', '14-options-chain.png');

  // Quick Order (B key)
  console.log('=> Trade page: Testing B key for quick order...');
  await page.keyboard.press('b');
  await sleep(1500);
  await page.screenshot({ path: join(DIR, '15-quick-order-dialog.png'), fullPage: false });
  // Close dialog if open
  await page.keyboard.press('Escape');
  await sleep(500);

  // Multi-timeframe tab
  console.log('=> Trade page: Multi-timeframe tab...');
  const mtfTab = await page.locator('text="Multi-Timeframe", text="Multi Timeframe", text="Timeframes", [data-tab*="multi"], button:has-text("Multi")').first();
  if (await mtfTab.count() > 0) {
    await mtfTab.click();
    await sleep(2000);
    await page.screenshot({ path: join(DIR, '16-multi-timeframe.png'), fullPage: false });
  } else {
    console.log('   Multi-timeframe tab not found by text, trying tabs...');
    // Try clicking through tabs
    const tabs = await page.locator('[role="tab"], .MuiTab-root, button[class*="tab"]').all();
    for (const tab of tabs) {
      const text = await tab.textContent();
      console.log(`   Found tab: "${text}"`);
      if (text && (text.toLowerCase().includes('multi') || text.toLowerCase().includes('timeframe'))) {
        await tab.click();
        await sleep(2000);
        await page.screenshot({ path: join(DIR, '16-multi-timeframe.png'), fullPage: false });
        break;
      }
    }
  }

  // Take segmented trade page screenshots
  console.log('=> Taking segmented trade page screenshots...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  for (let i = 0; i < 4; i++) {
    await page.evaluate((offset) => window.scrollTo(0, offset), i * 800);
    await sleep(500);
    await page.screenshot({ path: join(DIR, `12-trade-segment-${i}.png`) });
  }

  // ---- RESPONSIVE 800px ----
  console.log('=> Testing 800px responsive...');
  await page.setViewportSize({ width: 800, height: 600 });

  // Dashboard at 800px
  await page.goto(URL + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);
  await page.screenshot({ path: join(DIR, '17-responsive-dashboard-800.png'), fullPage: true });

  // Segmented responsive dashboard
  await page.evaluate(() => window.scrollTo(0, 0));
  for (let i = 0; i < 8; i++) {
    await page.evaluate((offset) => window.scrollTo(0, offset), i * 550);
    await sleep(400);
    await page.screenshot({ path: join(DIR, `17-responsive-dash-seg-${i}.png`) });
  }

  // Trade page at 800px
  const tradeLink2 = await page.locator('a:has-text("Trade"), [href*="trade"]').first();
  if (await tradeLink2.count() > 0) {
    await tradeLink2.click();
  } else {
    await page.goto(URL + '/trade', { waitUntil: 'networkidle', timeout: 20000 });
  }
  await sleep(2000);
  await page.screenshot({ path: join(DIR, '18-responsive-trade-800.png'), fullPage: true });

  // Segmented responsive trade
  await page.evaluate(() => window.scrollTo(0, 0));
  for (let i = 0; i < 6; i++) {
    await page.evaluate((offset) => window.scrollTo(0, offset), i * 550);
    await sleep(400);
    await page.screenshot({ path: join(DIR, `18-responsive-trade-seg-${i}.png`) });
  }

  // ---- STRESS TEST EXPAND ----
  console.log('=> Going back to dashboard to test stress test expand...');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);

  // Try to click on stress test to expand
  const stressEl = await page.locator('text="Stress Test", text="Stress"').first();
  if (await stressEl.count() > 0) {
    await stressEl.scrollIntoViewIfNeeded();
    await sleep(300);
    await stressEl.click();
    await sleep(1500);
    await page.screenshot({ path: join(DIR, '07-stress-test-expanded.png'), fullPage: false });
  }

  // ---- MARKET MOVERS TABS ----
  console.log('=> Testing Market Movers tabs...');
  const moversSection = await page.locator('text="Market Movers"').first();
  if (await moversSection.count() > 0) {
    await moversSection.scrollIntoViewIfNeeded();
    await sleep(300);

    // Try Gainers tab
    const gainersTab = await page.locator('text="Gainers"').first();
    if (await gainersTab.count() > 0) {
      await gainersTab.click();
      await sleep(800);
      await page.screenshot({ path: join(DIR, '05-movers-gainers.png'), fullPage: false });
    }

    // Try Losers tab
    const losersTab = await page.locator('text="Losers"').first();
    if (await losersTab.count() > 0) {
      await losersTab.click();
      await sleep(800);
      await page.screenshot({ path: join(DIR, '05-movers-losers.png'), fullPage: false });
    }

    // Try Active tab
    const activeTab = await page.locator('text="Active", text="Most Active"').first();
    if (await activeTab.count() > 0) {
      await activeTab.click();
      await sleep(800);
      await page.screenshot({ path: join(DIR, '05-movers-active.png'), fullPage: false });
    }
  }

  console.log('=> Audit complete! Closing browser.');
  await browser.close();
})();
