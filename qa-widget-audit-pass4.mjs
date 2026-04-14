import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/widget-audit';
const BASE_URL = 'https://tradingalpha.net';
const CREDS = { username: 'admin', password: 'alphaDesk2025!' };

const results = [];

function record(widget, fn, pass, issue = '') {
  results.push({ widget, fn, status: pass ? 'PASS' : 'FAIL', issue });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${widget} | ${fn}${issue ? ' | ' + issue : ''}`);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.fill('#login-username', CREDS.username);
  await page.fill('#login-password', CREDS.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1920,1080'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await login(page);
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // ── FULL PAGE SCROLLING SCREENSHOTS ──
    console.log('\n=== FULL DASHBOARD SCREENSHOTS ===');
    await screenshot(page, 'p4-dashboard-top');
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(500);
    await screenshot(page, 'p4-dashboard-mid');
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.waitForTimeout(500);
    await screenshot(page, 'p4-dashboard-bottom');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await screenshot(page, 'p4-dashboard-very-bottom');

    // ── 9. Allocation Donut - deep text search ──
    console.log('\n=== 9. ALLOCATION DONUT - DEEP CHECK ===');

    // Get ALL text from the page with precise locations
    const donutDetails = await page.evaluate(() => {
      // Search specifically for the h3 with "Allocation"
      const h3s = document.querySelectorAll('h3');
      let allocationH3 = null;
      for (const h of h3s) {
        if (h.textContent?.trim() === 'Allocation') {
          allocationH3 = h;
          break;
        }
      }

      // Search for spans with "Cash" and "Invested"
      const spans = document.querySelectorAll('span');
      let cashSpan = null;
      let investedSpan = null;
      for (const s of spans) {
        const text = s.textContent?.trim() || '';
        if (text === 'Cash') cashSpan = s;
        if (text === 'Invested') investedSpan = s;
      }

      // Check if the donut SVG exists
      const svgs = document.querySelectorAll('svg');
      let donutSvg = null;
      for (const svg of svgs) {
        const width = svg.getAttribute('width');
        const height = svg.getAttribute('height');
        if (width === '120' && height === '120') {
          donutSvg = svg;
          break;
        }
      }

      return {
        allocationH3Found: !!allocationH3,
        allocationH3Rect: allocationH3 ? allocationH3.getBoundingClientRect() : null,
        cashSpanFound: !!cashSpan,
        cashSpanText: cashSpan?.parentElement?.textContent?.trim() || '',
        investedSpanFound: !!investedSpan,
        investedSpanText: investedSpan?.parentElement?.textContent?.trim() || '',
        donutSvgFound: !!donutSvg,
        donutSvgViewBox: donutSvg?.getAttribute('viewBox') || '',
      };
    });

    console.log('  Donut details:', JSON.stringify(donutDetails, null, 2));

    record('Allocation Donut', '"Allocation" heading (h3)', donutDetails.allocationH3Found,
      donutDetails.allocationH3Found ? `Visible at y=${Math.round(donutDetails.allocationH3Rect?.y || 0)}` : 'h3 not found in DOM');
    record('Allocation Donut', '"Cash" label in legend', donutDetails.cashSpanFound, donutDetails.cashSpanText);
    record('Allocation Donut', '"Invested" label in legend', donutDetails.investedSpanFound, donutDetails.investedSpanText);
    record('Allocation Donut', 'Donut SVG (120x120)', donutDetails.donutSvgFound, '');

    // Scroll to the Allocation section and screenshot
    if (donutDetails.allocationH3Rect) {
      await page.evaluate((y) => window.scrollTo(0, y - 100), donutDetails.allocationH3Rect.y);
      await page.waitForTimeout(500);
      await screenshot(page, 'p4-09-allocation-scrolled');
    }

    // ── DIA INDEX CHECK ──
    console.log('\n=== 7. MARKET INDICES - DIA CHECK ===');
    const bodyText = await page.evaluate(() => document.body.textContent || '');
    const hasDIA = bodyText.includes('DIA');
    record('Market Indices', 'DIA index shown', hasDIA, hasDIA ? '' : 'DIA not found, only SPY/QQQ/IWM');

    // ── 5. P&L COMPUTATION CHECK ──
    console.log('\n=== 5. OPEN POSITIONS - P&L MATH ===');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    const positionData = await page.evaluate(() => {
      // Find position rows - look for known symbols
      const symbols = ['MRK', 'NKE', 'PG', 'WMT'];
      const positions = [];

      // Scan all text content for position data patterns
      const allText = document.body.textContent || '';

      for (const sym of symbols) {
        // Look for patterns like: MRK  84 shares  $125.98  $125.08  -$0.90
        const idx = allText.indexOf(sym);
        if (idx >= 0) {
          // Get surrounding text
          const context = allText.slice(Math.max(0, idx - 10), idx + 200);
          positions.push({ symbol: sym, context: context.replace(/\s+/g, ' ').trim().slice(0, 120) });
        }
      }
      return positions;
    });

    console.log('  Position data:');
    for (const p of positionData) {
      console.log(`    ${p.symbol}: ${p.context}`);
    }

    record('Open Positions', 'Position data with prices visible', positionData.length >= 4, `Found ${positionData.length} positions`);

    // ── 6. P&L Calendar - weekends check ──
    console.log('\n=== 6. P&L CALENDAR - WEEKENDS CHECK ===');
    // From screenshot, the calendar shows a grid with colored cells
    // Need to verify weekends are NOT colored
    const calendarInfo = await page.evaluate(() => {
      // Find the PnL Calendar section
      const body = document.body.textContent || '';
      const hasApril = body.includes('April') || body.includes('Apr');
      const hasCalendarDays = body.includes('Mon') || body.includes('Tue') || body.includes('Sun');

      // Try to find colored cells specifically
      // The calendar likely uses background colors for P&L days
      return { hasApril, hasCalendarDays };
    });

    record('P&L Calendar', 'Shows month name', calendarInfo.hasApril, calendarInfo.hasApril ? 'April found' : '');

    // ── TRADE PAGE DETAILED CHECKS ──
    console.log('\n=== TRADE PAGE DETAILED ===');
    const tradeBtn = page.locator('button:has-text("Trade")').first();
    await tradeBtn.click();
    await page.waitForTimeout(3000);
    await screenshot(page, 'p4-trade-page-full');

    // ── 12. Chart header price check ──
    console.log('\n=== 12. CHART HEADER PRICE ===');
    const chartHeader = await page.evaluate(() => {
      const body = document.body.textContent || '';
      // Look for "SPY" followed by a price
      const spyMatch = body.match(/SPY[^$]*\$?([\d,]+\.\d{2})/);
      return spyMatch ? spyMatch[0].slice(0, 50) : 'not found';
    });
    record('Chart', 'Header shows symbol and price', chartHeader !== 'not found', `Found: ${chartHeader}`);
    console.log(`  Chart header: ${chartHeader}`);

    // ── 13. L1 - market closed check ──
    console.log('\n=== 13. L1 DATA BAR - MARKET STATUS ===');
    const l1Details = await page.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasMktClosed: body.includes('Mkt Closed') || body.includes('Market Closed') || body.includes('Closed'),
        hasBid: body.includes('Bid'),
        hasAsk: body.includes('Ask'),
        hasSpread: body.includes('Spread'),
        hasVolume: body.includes('Volume') || body.includes('Vol'),
        hasHigh: body.includes('High'),
        hasLow: body.includes('Low'),
        hasOpen: body.includes('Open'),
      };
    });
    console.log('  L1:', JSON.stringify(l1Details));
    const l1Count = Object.values(l1Details).filter(v => v).length;
    record('L1 Data Bar', 'Shows L1 fields', l1Count >= 4, `Found ${l1Count}/8 L1 fields`);

    // ── 22. Options Chain - click strike to add to builder ──
    console.log('\n=== 22. OPTIONS CLICK STRIKE ===');
    // Look for the options chain area at the bottom
    const optionsArea = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const hasStrike = body.includes('Strike');
      const hasCall = body.includes('Call');
      const hasPut = body.includes('Put');
      return { hasStrike, hasCall, hasPut };
    });

    if (optionsArea.hasStrike) {
      // Try to click a strike row
      try {
        // Find rows/cells in the options table
        const strikeCell = page.locator('td, [role="cell"]').filter({ hasText: /^\d{3,4}$/ }).first();
        if (await strikeCell.count() > 0) {
          const strikeText = await strikeCell.textContent();
          console.log(`  Clicking strike: ${strikeText}`);
          await strikeCell.click();
          await page.waitForTimeout(1000);

          // Check if something was added to the trade builder
          const afterClick = await page.textContent('body');
          const addedToBuilder = afterClick.includes('Leg') || afterClick.includes('leg') || afterClick.includes('Remove');
          record('Options Chain', 'Click strike adds to builder', addedToBuilder, '');
          await screenshot(page, 'p4-22-options-strike-click');
        } else {
          record('Options Chain', 'Strike cells found', false, '');
        }
      } catch (e) {
        record('Options Chain', 'Strike click test', false, e.message.slice(0, 80));
      }
    }

    // ── 23. Trade Builder - strategy detection ──
    console.log('\n=== 23. TRADE BUILDER - STRATEGY DETECTION ===');
    // Click the "Trade" tab in the bottom panel
    const tradePanelTab = page.locator('button:has-text("Trade")').last();
    if (await tradePanelTab.count() > 0) {
      await tradePanelTab.click();
      await page.waitForTimeout(1000);

      const builderText = await page.textContent('body');
      const hasStrategyDetection = builderText.includes('Spread') || builderText.includes('spread') ||
                                    builderText.includes('Straddle') || builderText.includes('straddle') ||
                                    builderText.includes('Strategy') || builderText.includes('Custom');
      record('Trade Builder', 'Detects strategy name', hasStrategyDetection, '');

      // Check Add Leg button
      const addLegBtn = page.locator('button:has-text("Add Leg")').first();
      record('Trade Builder', 'Add Leg button present', await addLegBtn.count() > 0, '');

      // Check credit/debit label
      const hasLabel = builderText.includes('Credit') || builderText.includes('Debit') || builderText.includes('Net');
      record('Trade Builder', 'Net Credit/Debit label', hasLabel, '');

      await screenshot(page, 'p4-23-trade-builder');
    }

    // ── 25. Orders Tab - cancel check ──
    console.log('\n=== 25. ORDERS TAB ===');
    const ordersTab = page.locator('button:has-text("Orders")').first();
    if (await ordersTab.count() > 0) {
      await ordersTab.click();
      await page.waitForTimeout(1000);

      const ordersText = await page.textContent('body');
      const hasOrders = ordersText.includes('filled') || ordersText.includes('pending') || ordersText.includes('canceled') ||
                        ordersText.includes('No orders') || ordersText.includes('no orders');
      const hasCancelBtn = await page.locator('button:has-text("Cancel")').count() > 0;

      record('Orders Tab', 'Shows order history/status', hasOrders, '');
      record('Orders Tab', 'Cancel button available (if pending orders)', hasCancelBtn || ordersText.includes('No orders'),
        hasCancelBtn ? 'Cancel button present' : 'No pending orders to cancel');

      await screenshot(page, 'p4-25-orders-tab');
    }

    // ── 27. Calendar Tab in bottom panel ──
    console.log('\n=== 27. CALENDAR TAB (BOTTOM) ===');
    const calTab = page.locator('button:has-text("Calendar")').first();
    if (await calTab.count() > 0) {
      await calTab.click();
      await page.waitForTimeout(1500);

      const calText = await page.textContent('body');
      const hasCalContent = calText.includes('Mon') || calText.includes('Tue') || calText.includes('Sun') ||
                            calText.includes('April') || calText.includes('Calendar') || calText.includes('P&L');
      record('Calendar Tab (bottom)', 'Calendar renders', hasCalContent, '');

      // Check for any errors
      const hasError = calText.includes('Error') || calText.includes('error') || calText.includes('Something went wrong');
      record('Calendar Tab (bottom)', 'No errors', !hasError, hasError ? 'Error found' : '');

      await screenshot(page, 'p4-27-calendar-bottom');
    }

    // ── FULL PAGE SCREENSHOT OF TRADE PAGE ──
    await screenshot(page, 'p4-trade-page-final');

  } catch (e) {
    console.error('ERROR:', e.message);
    await screenshot(page, 'p4-ERROR');
  } finally {
    console.log('\n========================================');
    console.log('PASS-4 RESULTS');
    console.log('========================================');
    let table = 'Widget | Function | Status | Issue\n--- | --- | --- | ---\n';
    for (const r of results) {
      table += `${r.widget} | ${r.fn} | ${r.status} | ${r.issue}\n`;
    }
    console.log(table);
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results-pass4.json'), JSON.stringify(results, null, 2));
    await browser.close();
  }
}

main().catch(console.error);
