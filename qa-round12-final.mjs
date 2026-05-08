import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round12';
const BASE_URL = 'https://tradingalpha.net';

function log(msg) { console.log(`[INFO] ${msg}`); }

async function ss(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Login
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  const inputs = await page.$$('input');
  await inputs[0].fill(QA_USERNAME);
  await inputs[1].fill(getQaPassword());
  await page.click('button:has-text("Sign In")');
  await page.waitForTimeout(5000);
  log(`Logged in: ${page.url()}`);

  // ===== 1: Command palette -> NVDA -> does chart change? =====
  log('\n=== Command Palette NVDA Test ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Get current symbol
  const beforeSymbol = await page.evaluate(() => {
    const header = document.body.innerText.match(/^([A-Z]{2,5})\s*[\$·]/m);
    return header ? header[1] : 'unknown';
  });
  log(`Before command palette, chart shows: ${beforeSymbol}`);

  // Open command palette (the search bar in header shows "Search symbols, commands... Cmd+K")
  // Click the search bar directly
  try {
    const searchBar = await page.$('[placeholder*="Search" i], [class*="command-trigger"], [class*="search-trigger"]');
    if (searchBar) {
      await searchBar.click();
      await page.waitForTimeout(1000);
    } else {
      await page.keyboard.press('Meta+k');
      await page.waitForTimeout(1000);
    }

    await ss(page, 'final-01-palette-open');

    // Type NVDA in the command palette
    const paletteInput = await page.$('[role="combobox"] input, [class*="command"] input, [class*="dialog"] input, [role="dialog"] input');
    if (paletteInput) {
      await paletteInput.fill('NVDA');
      await page.waitForTimeout(1500);
      await ss(page, 'final-02-palette-nvda-typed');

      // Look for NVDA in results
      const nvdaResult = await page.$('[role="option"]:has-text("NVDA"), [class*="item"]:has-text("NVDA"), [class*="result"]:has-text("NVDA")');
      if (nvdaResult) {
        // Click the overlay first to dismiss it, then click the result
        await nvdaResult.click({ force: true });
        await page.waitForTimeout(3000);
        log(`After NVDA select, URL: ${page.url()}`);
        await ss(page, 'final-03-after-nvda');

        // Check if chart updated
        const afterText = await page.evaluate(() => document.body.innerText.substring(0, 500));
        log(`After NVDA: ${afterText.substring(0, 200)}`);
      } else {
        log('NVDA result not found in command palette');
        // Just press Enter
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
        await ss(page, 'final-03-after-nvda-enter');
      }
    } else {
      log('Command palette input not found');
    }
  } catch (e) {
    log(`Command palette NVDA: ${e.message}`);
    await page.keyboard.press('Escape');
  }

  // ===== 2: Order entry deep check =====
  log('\n=== Order Entry Deep Check ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Click on "Order" tab in right panel
  try {
    const orderTab = await page.$('button:has-text("Order")');
    if (orderTab) {
      await orderTab.click();
      await page.waitForTimeout(1000);
      await ss(page, 'final-04-order-tab');

      // Now check what's visible in the order panel
      const orderContent = await page.evaluate(() => {
        const body = document.body.innerText;
        // Find the order section after "Order" heading
        const orderIdx = body.indexOf('Order');
        return body.substring(orderIdx, orderIdx + 500);
      });
      log(`Order panel content: ${orderContent.substring(0, 300)}`);

      // Look for order form inputs now
      const formInputs = await page.$$('input');
      const formInfo = await Promise.all(formInputs.map(i => i.evaluate(el => ({
        id: el.id, type: el.type, placeholder: el.placeholder, name: el.name, visible: el.offsetParent !== null,
        rect: el.getBoundingClientRect(),
      }))));
      const visibleInputs = formInfo.filter(i => i.visible && i.rect.width > 0);
      log(`Visible inputs after Order tab: ${JSON.stringify(visibleInputs)}`);
    }

    // Try clicking BUY button
    const buyBtn = await page.$('button:has-text("BUY")');
    if (buyBtn) {
      await buyBtn.click();
      await page.waitForTimeout(1000);
      await ss(page, 'final-05-after-buy-click');

      // Check for order form now
      const afterBuyInputs = await page.$$('input');
      const afterBuyInfo = await Promise.all(afterBuyInputs.map(i => i.evaluate(el => ({
        id: el.id, type: el.type, placeholder: el.placeholder, visible: el.offsetParent !== null,
        rect: el.getBoundingClientRect(),
      }))));
      const visibleAfterBuy = afterBuyInfo.filter(i => i.visible && i.rect.width > 0);
      log(`Visible inputs after BUY click: ${JSON.stringify(visibleAfterBuy)}`);
    }
  } catch (e) {
    log(`Order entry: ${e.message}`);
  }

  // ===== 3: Dashboard P&L calendar zoomed =====
  log('\n=== P&L Calendar Zoomed ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Look for the April P&L section and take a focused screenshot
  const calArea = await page.evaluate(() => {
    const allText = document.body.innerText;
    // Extract the calendar section text
    const calStart = allText.indexOf('April P&L');
    const calEnd = allText.indexOf('Economic Calendar');
    if (calStart >= 0 && calEnd >= 0) {
      return allText.substring(calStart, calEnd);
    }
    return 'Calendar section not found';
  });
  log(`Calendar text: ${calArea}`);

  // ===== 4: Check if WMT shows different avg on dashboard vs API =====
  log('\n=== WMT Price Discrepancy Check ===');
  const wmtData = await page.evaluate(async () => {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    const resp = await fetch('/api/v1/trades/positions', { headers });
    const positions = await resp.json();
    const wmt = positions.find(p => p.symbol === 'WMT');

    // Also get dashboard display
    const body = document.body.innerText;
    const wmtMatch = body.match(/WMT\s+(\d+)\s+shares?\s+\$([\d,.]+)\s+avg\s+\$([\d,.]+)\s+([+-]?\$[\d,.]+)/);

    return {
      api: wmt ? { qty: wmt.quantity, avg: wmt.avg_cost, current: wmt.current_price, pnl: wmt.unrealized_pl } : null,
      display: wmtMatch ? { qty: wmtMatch[1], current: wmtMatch[2], avg: wmtMatch[3], pnl: wmtMatch[4] } : null,
    };
  });

  log(`WMT API: ${JSON.stringify(wmtData.api)}`);
  log(`WMT Display: ${JSON.stringify(wmtData.display)}`);

  if (wmtData.api && wmtData.display) {
    const apiAvg = wmtData.api.avg;
    const displayAvg = parseFloat(wmtData.display.avg);
    log(`WMT avg cost: API=${apiAvg}, Display=${displayAvg}, diff=${Math.abs(apiAvg - displayAvg).toFixed(4)}`);
    // Dashboard shows avg $124.19 but API returns 124.186721
    // Display rounds to 2 decimals = 124.19, which is correct rounding
    // P&L calc: (124.69 - 124.186721) * 61 = 30.70 (API math)
    // But display shows (124.69 - 124.19) * 61 = 30.50 displayed, yet shows +$30.70
    // Actually wait - let me recheck. Current price may have changed between tests.
  }

  // ===== 5: Check all strategy detail pages have breadcrumb back to dashboard =====
  log('\n=== Strategy Breadcrumb Navigation ===');
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  const breadcrumb = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    const dashLinks = [];
    links.forEach(l => {
      const href = l.getAttribute('href') || '';
      const text = l.textContent.trim();
      if (href === '/' || text === 'Dashboard' || text.includes('Back')) {
        dashLinks.push({ href, text });
      }
    });
    return dashLinks;
  });
  log(`Strategy page breadcrumbs/back links: ${JSON.stringify(breadcrumb)}`);

  // ===== 6: Check Settings page =====
  log('\n=== Settings Page ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Click profile button (the "A" initial)
  try {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = (await btn.textContent()).trim();
      if (text === 'A' && (await btn.evaluate(el => el.getBoundingClientRect().width)) < 50) {
        await btn.click();
        await page.waitForTimeout(500);
        break;
      }
    }

    // Click Settings
    const settingsItem = await page.$('[role="menuitem"]:has-text("Settings")');
    if (settingsItem) {
      await settingsItem.click();
      await page.waitForTimeout(2000);
      await ss(page, 'final-06-settings');
      log(`Settings page URL: ${page.url()}`);

      const settingsContent = await page.evaluate(() => document.body.innerText.substring(0, 500));
      log(`Settings content: ${settingsContent.substring(0, 300)}`);
    }
  } catch (e) {
    log(`Settings page: ${e.message}`);
  }

  // ===== 7: Keyboard shortcuts overlay =====
  log('\n=== Keyboard Shortcuts Overlay ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Click profile -> Keyboard Shortcuts
  try {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = (await btn.textContent()).trim();
      if (text === 'A' && (await btn.evaluate(el => el.getBoundingClientRect().width)) < 50) {
        await btn.click();
        await page.waitForTimeout(500);
        break;
      }
    }

    const kbItem = await page.$('[role="menuitem"]:has-text("Keyboard")');
    if (kbItem) {
      await kbItem.click();
      await page.waitForTimeout(1500);
      await ss(page, 'final-07-keyboard-shortcuts');

      const overlayContent = await page.evaluate(() => {
        const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="overlay"]');
        if (dialogs.length > 0) {
          return dialogs[dialogs.length - 1].textContent.substring(0, 500);
        }
        return 'No dialog found';
      });
      log(`Keyboard shortcuts overlay: ${overlayContent.substring(0, 300)}`);

      // Press Escape to close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  } catch (e) {
    log(`Keyboard shortcuts: ${e.message}`);
  }

  // ===== 8: Pipeline MRK shares mismatch =====
  log('\n=== Pipeline vs Dashboard MRK shares ===');
  // Dashboard shows MRK 86 shares, Pipeline shows MRK 43 shares
  // API portfolio shows qty=86, pipeline API shows shares=43
  // This is because pipeline tracks its own position (43 shares it bought)
  // while broker shows total (86 shares, including other sources)
  // Is this correct by design?
  log('Dashboard: MRK 86 shares (from Alpaca broker)');
  log('Pipeline: MRK 43 shares (from pipeline-tracked position)');
  log('This discrepancy MAY indicate that the pipeline only tracks its own trades,');
  log('while the broker has additional MRK shares from manual/other trading.');
  log('Verify: Is this by design or a bug?');

  // ===== 9: Check the SPY quote ask=0 root cause =====
  log('\n=== SPY Ask=0 Root Cause Analysis ===');
  // The Alpaca API returns ask=0 for SPY when market is closed (weekend)
  // The latestQuote.ap (ask price) is 0 because there's no current ask on weekends
  // Frontend should handle this gracefully
  log('Root cause: Alpaca latestQuote returns ap=0 when market is closed');
  log('SPY is fetched from Alpaca (real data), others from demo fallback');
  log('Fix: Frontend should detect ask=0 and show "Mkt Closed" or use last price');

  // Confirm by checking which symbols use Alpaca vs demo
  const sourceCheck = await page.evaluate(async () => {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const results = {};
    for (const s of ['SPY', 'AAPL', 'MSFT', 'NVDA', 'QQQ']) {
      const resp = await fetch(`/api/v1/market/quotes/${s}`, { headers });
      const data = await resp.json();
      results[s] = { bid: data.bid, ask: data.ask, last: data.last, volume: data.volume };
    }
    return results;
  });

  for (const [sym, data] of Object.entries(sourceCheck)) {
    const isLikelyReal = data.volume > 0 && data.volume < 100000000;
    log(`${sym}: bid=${data.bid}, ask=${data.ask}, last=${data.last}, vol=${data.volume} ${data.ask === 0 ? '** ASK=0 **' : ''}`);
  }

  // ===== 10: Check if horizontal scrollbar appears on dashboard =====
  log('\n=== Horizontal Overflow Check ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const overflow = await page.evaluate(() => {
    return {
      bodyScrollWidth: document.body.scrollWidth,
      windowWidth: window.innerWidth,
      hasOverflow: document.body.scrollWidth > window.innerWidth,
    };
  });
  log(`Body scroll width: ${overflow.bodyScrollWidth}, Window width: ${overflow.windowWidth}, Overflow: ${overflow.hasOverflow}`);

  await browser.close();
  log('\nFinal verification complete.');
})();
