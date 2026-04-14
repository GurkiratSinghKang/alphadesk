import { chromium } from 'playwright';
const BASE = 'https://tradingalpha.net';
const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round8';

let shotNum = 80;
async function shot(page, name) {
  shotNum++;
  const path = `${DIR}/${String(shotNum).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`SHOT: ${path}`);
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Login
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);
  const inputs = await page.$$('input:not([type="hidden"])');
  await inputs[0].fill('admin');
  await inputs[1].fill('alphaDesk2025!');
  await page.click('button[type="submit"], button:has-text("Sign")');
  await sleep(5000);

  // ===== 1. CHART PRICE MATCH =====
  console.log('\n=== CHART PRICE vs HEADER ===');
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(6000);

  // Get chart header price
  const chartData = await page.evaluate(() => {
    // Get the visible chart header text
    const allText = document.body.innerText;
    // Find "SPY  $XXX.XX" pattern
    const headerMatch = allText.match(/SPY\s+\$(\d+\.\d{2})/);
    // Also find the price line on chart info - often shows spread and other data
    const priceInfoMatch = allText.match(/(\d{3}\.\d{2})\s*\/\s*(\d{3}\.\d{2})/); // bid/ask spread
    const lastPriceMatch = allText.match(/last:\s*\$?(\d{3}\.\d{2})/i);
    return {
      headerPrice: headerMatch ? headerMatch[1] : null,
      spreadPrices: priceInfoMatch ? { bid: priceInfoMatch[1], ask: priceInfoMatch[2] } : null,
      lastPrice: lastPriceMatch ? lastPriceMatch[1] : null,
      // Get prices from sub-header area
      subText: allText.substring(0, 300)
    };
  });
  console.log(`Chart data: ${JSON.stringify(chartData)}`);

  // Zoom into chart header area
  await page.evaluate(() => window.scrollTo(0, 0));
  const headerClip = { x: 0, y: 40, width: 900, height: 80 };
  await page.screenshot({ path: `${DIR}/81-chart-header-zoom.png`, clip: headerClip });
  console.log('SHOT: chart-header-zoom');

  // ===== 2. BUY/SELL BUTTON DETAIL =====
  console.log('\n=== BUY/SELL BUTTONS ===');
  // Click on Trade tab in right panel first
  const tradeTab = await page.$('button:has-text("Trade")');
  if (tradeTab) await tradeTab.click();
  await sleep(1500);

  const buySellDetail = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const buys = buttons.filter(b => b.textContent.trim().toUpperCase() === 'BUY');
    const sells = buttons.filter(b => b.textContent.trim().toUpperCase() === 'SELL');

    // Get all canvases (chart)
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const chartCanvas = canvases.find(c => {
      const r = c.getBoundingClientRect();
      return r.width > 400 && r.height > 200;
    });

    return {
      buyButtons: buys.map(b => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      }),
      sellButtons: sells.map(b => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      }),
      chartBounds: chartCanvas ? (() => {
        const r = chartCanvas.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      })() : null
    };
  });
  console.log(`Buy/Sell detail: ${JSON.stringify(buySellDetail)}`);

  // Check for overlap
  if (buySellDetail.buyButtons.length > 0 && buySellDetail.chartBounds) {
    const buy = buySellDetail.buyButtons[0];
    const chart = buySellDetail.chartBounds;
    const buyOverlapsChart = buy.x < chart.right && buy.right > chart.x && buy.y < chart.bottom && buy.bottom > chart.y;
    console.log(`BUY overlaps chart: ${buyOverlapsChart}`);
    // BUY at x=1032, chart ends at x=240+834=1074 -- BUY IS INSIDE chart horizontally!
    console.log(`  BUY x=${buy.x}, Chart right=${chart.right}`);
  }

  // Screenshot of right panel area
  await page.screenshot({ path: `${DIR}/82-buy-sell-area.png`, clip: { x: 970, y: 60, width: 470, height: 500 } });
  console.log('SHOT: buy-sell-area');

  // ===== 3. DASHBOARD P&L DETAIL =====
  console.log('\n=== DASHBOARD P&L VISIBILITY ===');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);

  // Zoom into hero section
  await page.screenshot({ path: `${DIR}/83-dash-hero-zoom.png`, clip: { x: 0, y: 40, width: 500, height: 100 } });
  console.log('SHOT: dash-hero-zoom');

  const heroDetail = await page.evaluate(() => {
    const results = [];
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      const t = el.textContent.trim();
      // Look for portfolio value, P&L value, P&L percentage
      if (/^\$[\d,]+\.\d{2}$/.test(t) || /^-?\$[\d,]+\.\d{2}$/.test(t) || /^\(?-?\d+\.\d+%\)?$/.test(t)) {
        const s = window.getComputedStyle(el);
        if (s.display !== 'none' && s.visibility !== 'hidden') {
          results.push({
            text: t,
            fontSize: s.fontSize,
            color: s.color,
            opacity: s.opacity,
            fontWeight: s.fontWeight
          });
        }
      }
    }
    return results;
  });
  console.log(`Hero financial elements: ${JSON.stringify(heroDetail)}`);

  // ===== 4. STRATEGY CARDS - RETURNS MISSING? =====
  console.log('\n=== STRATEGY CARDS RETURNS ===');
  const stratCards = await page.evaluate(() => {
    const cards = [];
    // Find the "Strategies" section
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      const t = el.textContent.trim();
      if (t.length > 10 && t.length < 200 &&
          (t.includes('Momentum') || t.includes('PEAD') || t.includes('VRP') || t.includes('Earnings') ||
           t.includes('Mean Reversion') || t.includes('Breakout') || t.includes('Harvesting') ||
           t.includes('Regime') || t.includes('Claude') || t.includes('Pairs') || t.includes('Dividend') ||
           t.includes('Sector') || t.includes('Gap Fill')) &&
          el.children.length < 8) {
        const hasReturn = /[+-]?\d+\.\d+%/.test(t);
        const hasNoPos = t.includes('No positions');
        cards.push({
          text: t.substring(0, 100),
          hasReturn,
          hasNoPos,
          classes: el.className?.substring(0, 60)
        });
      }
    }
    return cards;
  });
  console.log(`Strategy cards (${stratCards.length}):`);
  stratCards.forEach((c, i) => console.log(`  ${i}: ${JSON.stringify(c)}`));

  // Zoom into strategies grid
  await page.screenshot({ path: `${DIR}/84-strategies-grid.png`, clip: { x: 700, y: 80, width: 740, height: 600 } });
  console.log('SHOT: strategies-grid');

  // ===== 5. INTERMITTENT CRASH - Multiple rapid trade page loads =====
  console.log('\n=== INTERMITTENT CRASH TEST (10 attempts) ===');
  let crashCount = 0;
  for (let i = 1; i <= 10; i++) {
    await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await sleep(3000);
    const crashed = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
    if (crashed) {
      crashCount++;
      await shot(page, `crash-attempt-${i}`);
      console.log(`  Attempt ${i}: CRASHED`);
      // Get error detail
      const errDetail = await page.evaluate(() => {
        const el = document.querySelector('p, [class*="error" i]');
        return el ? el.textContent.trim() : 'unknown';
      });
      console.log(`    Error: ${errDetail}`);
    } else {
      console.log(`  Attempt ${i}: OK`);
    }
  }
  console.log(`Crash rate: ${crashCount}/10 (${crashCount * 10}%)`);

  // ===== 6. OPTIONS CHAIN DETAIL =====
  console.log('\n=== OPTIONS CHAIN DETAIL ===');
  // Make sure we're on trade page without crash
  if (crashCount < 10) {
    await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(5000);
    const ok = !(await page.evaluate(() => document.body.textContent.includes('Something went wrong')));
    if (ok) {
      // Look at the bottom panel for options
      const optionsDetail = await page.evaluate(() => {
        const body = document.body.textContent;
        return {
          hasSPYOptions: body.includes('SPY Options'),
          hasExpDates: body.includes('Apr 17') || body.includes('Apr 14') || body.includes('May'),
          hasGreeks: body.includes('Delta') || body.includes('Gamma') || body.includes('IV'),
          hasCallPut: body.includes('Call') || body.includes('Put'),
          bottomAreaText: body.substring(body.indexOf('SPY Options'), body.indexOf('SPY Options') + 300)
        };
      });
      console.log(`Options: ${JSON.stringify(optionsDetail)}`);

      // Zoom into options area
      await page.screenshot({ path: `${DIR}/85-options-detail.png`, clip: { x: 0, y: 580, width: 1000, height: 320 } });
      console.log('SHOT: options-detail');
    }
  }

  // ===== 7. SPARKLINE UNIQUENESS VISUAL =====
  console.log('\n=== SPARKLINE VISUAL CHECK ===');
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(5000);
  const nocrash = !(await page.evaluate(() => document.body.textContent.includes('Something went wrong')));
  if (nocrash) {
    // Click watchlist tab
    const wlTab = await page.$('button:has-text("Watchlist")');
    if (wlTab) await wlTab.click();
    await sleep(1500);
    // Zoom into watchlist area
    await page.screenshot({ path: `${DIR}/86-watchlist-sparklines.png`, clip: { x: 0, y: 55, width: 240, height: 500 } });
    console.log('SHOT: watchlist-sparklines');
  }

  // ===== 8. KEYBOARD SHORTCUTS OVERLAY TEST =====
  console.log('\n=== KEYBOARD SHORTCUTS OVERLAY ===');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);

  // Try profile menu -> Keyboard Shortcuts
  const avatarElements = await page.$$('button');
  for (const btn of avatarElements) {
    const rect = await btn.boundingBox();
    if (rect && rect.x > 1380 && rect.y < 50) {
      await btn.click();
      await sleep(1500);
      break;
    }
  }

  // Look for "Keyboard Shortcuts" menu item
  const kbShortcut = await page.$('button:has-text("Keyboard Shortcuts"), a:has-text("Keyboard Shortcuts"), [role="menuitem"]:has-text("Keyboard")');
  if (kbShortcut) {
    console.log('Found Keyboard Shortcuts menu item');
    await kbShortcut.click();
    await sleep(2000);
    await shot(page, 'keyboard-shortcuts-dialog');

    const dialogContent = await page.evaluate(() => {
      const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="dialog" i]');
      for (const d of dialogs) {
        const s = window.getComputedStyle(d);
        if (s.display !== 'none' && s.visibility !== 'hidden') {
          return d.textContent.trim().substring(0, 500);
        }
      }
      return 'NO DIALOG VISIBLE';
    });
    console.log(`Shortcuts dialog: ${dialogContent.substring(0, 300)}`);
    await page.keyboard.press('Escape');
  } else {
    console.log('Keyboard Shortcuts menu item NOT found');
  }

  // ===== 9. SETTINGS PAGE =====
  console.log('\n=== SETTINGS ===');
  // Open profile menu again
  for (const btn of avatarElements) {
    const rect = await btn.boundingBox();
    if (rect && rect.x > 1380 && rect.y < 50) {
      await btn.click();
      await sleep(1500);
      break;
    }
  }
  const settingsBtn = await page.$('button:has-text("Settings"), a:has-text("Settings"), [role="menuitem"]:has-text("Settings")');
  if (settingsBtn) {
    console.log('Found Settings menu item');
    await settingsBtn.click();
    await sleep(2000);
    await shot(page, 'settings-page');
    console.log(`Settings URL: ${page.url()}`);
  }

  // ===== 10. DASHBOARD PORTFOLIO HERO VALUE =====
  console.log('\n=== PORTFOLIO VALUE IN HERO ===');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);

  // Take a big hero area screenshot
  await page.screenshot({ path: `${DIR}/87-hero-full.png`, clip: { x: 0, y: 40, width: 700, height: 80 } });

  const allFinancialValues = await page.evaluate(() => {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      const t = node.textContent.trim();
      if (/^\$[\d,]+\.\d{2}$/.test(t) || /^-\$[\d,]+\.\d{2}$/.test(t) || /^[+-]?\d+\.\d+%$/.test(t) || /^\(-?\d+\.\d+%\)$/.test(t)) {
        const el = node.parentElement;
        const s = window.getComputedStyle(el);
        results.push({ text: t, fontSize: s.fontSize, color: s.color, opacity: s.opacity, tag: el.tagName });
      }
    }
    return results;
  });
  console.log(`All financial text nodes: ${JSON.stringify(allFinancialValues)}`);

  await browser.close();
  console.log('\n=== TARGETED TESTS COMPLETE ===');
})();
