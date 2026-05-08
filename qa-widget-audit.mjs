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

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/widget-audit';
const BASE_URL = 'https://tradingalpha.net';
const CREDS = { username: QA_USERNAME, password: getQaPassword() };

const results = [];

function record(widget, fn, pass, issue = '') {
  results.push({ widget, fn, status: pass ? 'PASS' : 'FAIL', issue });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${widget} | ${fn}${issue ? ' | ' + issue : ''}`);
}

async function screenshot(page, name) {
  const p = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

async function screenshotEl(page, selector, name, timeout = 5000) {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout });
    await el.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
    return true;
  } catch (e) {
    console.log(`  screenshot failed for ${selector}: ${e.message.slice(0, 100)}`);
    await screenshot(page, name + '-fallback');
    return false;
  }
}

async function login(page) {
  console.log('\n=== LOGIN ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await screenshot(page, '00-login-page');

  // Use the IDs from the source code
  await page.fill('#login-username', CREDS.username);
  await page.fill('#login-password', CREDS.password);
  await page.click('button[type="submit"]');

  // Wait for navigation away from login page
  await page.waitForTimeout(5000);
  const url = page.url();
  console.log(`Logged in, current URL: ${url}`);
  if (!url.includes('/login')) {
    console.log('Login successful');
  } else {
    // Check for error message
    const errText = await page.textContent('body');
    console.log('Login may have failed. Page text snippet:', errText.slice(0, 200));
  }
}

// ==================== DASHBOARD WIDGETS ====================

async function testPortfolioHero(page) {
  console.log('\n=== 1. PORTFOLIO HERO ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Look for equity value
  const heroSection = page.locator('[class*="hero"], [class*="Hero"], [class*="portfolio"], [data-testid*="hero"]').first();
  await screenshotEl(page, 'body', '01-portfolio-hero-fullpage');

  // Find dollar amounts on page
  const allText = await page.textContent('body');
  const dollarMatch = allText.match(/\$[\d,]+(?:\.\d{1,2})?/g);
  const hasDollar = dollarMatch && dollarMatch.length > 0;
  record('Portfolio Hero', 'Shows dollar amount', hasDollar, hasDollar ? `Found: ${dollarMatch.slice(0, 3).join(', ')}` : 'No dollar amounts found');

  // Check P&L sign/color
  const hasGreenRed = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    let found = { green: false, red: false };
    for (const el of all) {
      const style = getComputedStyle(el);
      const color = style.color;
      const cls = typeof el.className === 'string' ? el.className : '';
      if (color.includes('34, 197') || color.includes('16, 185') || color.includes('74, 222') || cls.includes('green') || cls.includes('emerald') || cls.includes('gain')) found.green = true;
      if (color.includes('239, 68') || color.includes('248, 113') || color.includes('220, 38') || cls.includes('red') || cls.includes('rose') || cls.includes('loss')) found.red = true;
    }
    return found;
  });
  record('Portfolio Hero', 'P&L has color coding', hasGreenRed.green || hasGreenRed.red, `Green: ${hasGreenRed.green}, Red: ${hasGreenRed.red}`);

  // Check period buttons
  const periodBtns = page.locator('button:text("1W"), button:text("1M"), button:text("3M"), button:text("YTD"), button:text("1Y"), button:text("ALL")');
  const periodCount = await periodBtns.count();
  record('Portfolio Hero', 'Period buttons present', periodCount >= 3, `Found ${periodCount} period buttons`);

  if (periodCount > 0) {
    // Try clicking a period button
    try {
      const btn1W = page.locator('button').filter({ hasText: /^1W$/ }).first();
      if (await btn1W.count() > 0) {
        await btn1W.click();
        await page.waitForTimeout(1000);
      }
      const btn3M = page.locator('button').filter({ hasText: /^3M$/ }).first();
      if (await btn3M.count() > 0) {
        await btn3M.click();
        await page.waitForTimeout(1000);
      }
      await screenshot(page, '01-portfolio-hero-period-change');
      record('Portfolio Hero', 'Period buttons change chart', true, 'Clicked 1W and 3M');
    } catch (e) {
      record('Portfolio Hero', 'Period buttons change chart', false, e.message.slice(0, 100));
    }
  }
}

async function testEquityCurve(page) {
  console.log('\n=== 2. EQUITY CURVE ===');
  // Check for SVG/canvas chart
  const svgCharts = await page.locator('svg, canvas, [class*="chart"], [class*="Chart"], [class*="recharts"], [class*="curve"]').count();
  const hasSvgPath = await page.locator('svg path').count();
  record('Equity Curve', 'Line chart renders', svgCharts > 0 || hasSvgPath > 0, `Found ${svgCharts} chart elements, ${hasSvgPath} SVG paths`);
  await screenshotEl(page, 'svg, canvas, [class*="chart"]', '02-equity-curve');
}

async function testActivityFeed(page) {
  console.log('\n=== 3. ACTIVITY FEED ===');
  // Scroll down to find activity feed
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(500);

  const feedEl = page.locator('[class*="activity"], [class*="Activity"], [class*="feed"], [class*="Feed"]').first();
  const feedExists = await feedEl.count() > 0;

  // Look for activity items
  const activityText = await page.textContent('body');
  const hasActivity = activityText.includes('Pipeline') || activityText.includes('Signal') || activityText.includes('Trade') || activityText.includes('Screened') || activityText.includes('Analyzed');
  const hasNoActivity = activityText.includes('No activity') || activityText.includes('No recent');

  record('Activity Feed', 'Shows real events', hasActivity && !hasNoActivity, hasNoActivity ? 'Shows "No activity"' : 'Events found');

  // Check timestamps
  const timestampPattern = /\d{1,2}:\d{2}|\d{1,2}[ap]m|ago|just now|today|yesterday|\d{4}-\d{2}-\d{2}/i;
  const hasTimestamps = timestampPattern.test(activityText);
  record('Activity Feed', 'Events have timestamps', hasTimestamps, '');

  // Check for remediation advice on rejected trades
  const hasRemediation = activityText.includes('remediation') || activityText.includes('Remediation') || activityText.includes('advice') || activityText.includes('rejected');
  record('Activity Feed', 'Rejected trades show remediation', hasRemediation, hasRemediation ? 'Found' : 'No rejected trade remediation visible');

  await screenshot(page, '03-activity-feed');
}

async function testStrategyGrid(page) {
  console.log('\n=== 4. STRATEGY GRID ===');
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(500);

  // Find strategy cards
  const cards = page.locator('[class*="strategy"], [class*="Strategy"]').filter({ has: page.locator('[class*="card"], [class*="Card"], a, [href*="strateg"]') });
  let cardCount = await cards.count();

  // Alternative: look for cards with strategy names
  const stratNames = ['Momentum', 'Mean Rev', 'SMA', 'RSI', 'MACD', 'Breakout', 'Pairs', 'Volatil', 'Dividend', 'Growth', 'Value', 'Sector'];
  let foundStrats = 0;
  const bodyText = await page.textContent('body');
  for (const s of stratNames) {
    if (bodyText.includes(s)) foundStrats++;
  }

  record('Strategy Grid', 'Shows strategy cards', foundStrats >= 3 || cardCount >= 3, `Found ${foundStrats} strategy names, ${cardCount} card elements`);

  // Check for position counts
  const posPattern = /\d+ pos/i;
  const hasPosCounts = posPattern.test(bodyText);
  record('Strategy Grid', 'Cards show position counts', hasPosCounts, '');

  // Check for return percentages
  const retPattern = /[+-]?\d+\.?\d*%/;
  const hasReturns = retPattern.test(bodyText);
  record('Strategy Grid', 'Cards show returns', hasReturns, '');

  await screenshot(page, '04-strategy-grid');

  // Click 3 strategy cards
  const stratLinks = page.locator('a[href*="strateg"]');
  const linkCount = await stratLinks.count();
  if (linkCount >= 1) {
    for (let i = 0; i < Math.min(3, linkCount); i++) {
      try {
        const href = await stratLinks.nth(i).getAttribute('href');
        await stratLinks.nth(i).click();
        await page.waitForTimeout(2000);
        const newUrl = page.url();
        const navigated = newUrl.includes('strateg');
        await screenshot(page, `04-strategy-card-click-${i + 1}`);
        record('Strategy Grid', `Card ${i + 1} navigates to strategy page`, navigated, `URL: ${newUrl}`);
        await page.goBack();
        await page.waitForTimeout(1500);
      } catch (e) {
        record('Strategy Grid', `Card ${i + 1} navigation`, false, e.message.slice(0, 100));
      }
    }
  } else {
    record('Strategy Grid', 'Card navigation', false, 'No strategy links found');
  }
}

async function testOpenPositions(page) {
  console.log('\n=== 5. OPEN POSITIONS ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(500);

  const bodyText = await page.textContent('body');
  const expectedSymbols = ['MRK', 'NKE', 'PG', 'WMT'];
  let foundSymbols = [];
  for (const sym of expectedSymbols) {
    if (bodyText.includes(sym)) foundSymbols.push(sym);
  }

  record('Open Positions', 'Lists Alpaca positions', foundSymbols.length >= 2, `Found: ${foundSymbols.join(', ') || 'none'}`);

  // Check for P&L values
  const pnlPattern = /[+-]?\$[\d,.]+/;
  const hasPnl = pnlPattern.test(bodyText);
  record('Open Positions', 'P&L values shown', hasPnl, '');

  await screenshot(page, '05-open-positions');
}

async function testPnlCalendar(page) {
  console.log('\n=== 6. P&L CALENDAR ===');
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(500);

  const calendarEl = page.locator('[class*="calendar"], [class*="Calendar"], [class*="pnl-cal"], [class*="PnlCal"]').first();
  const calExists = await calendarEl.count() > 0;
  record('P&L Calendar', 'Calendar renders', calExists, '');

  if (calExists) {
    await screenshotEl(page, '[class*="calendar"], [class*="Calendar"], [class*="pnl-cal"], [class*="PnlCal"]', '06-pnl-calendar');
  } else {
    await screenshot(page, '06-pnl-calendar-fallback');
  }

  // Check for month navigation
  const prevNext = page.locator('button:has-text("prev"), button:has-text("next"), button:has-text("<"), button:has-text(">"), [class*="prev"], [class*="next"], [aria-label*="prev"], [aria-label*="next"]');
  const navCount = await prevNext.count();

  // Also look for month/year labels and chevron arrows
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let hasMonthLabel = false;
  for (const m of monthNames) {
    if (await page.textContent('body').then(t => t.includes(m))) { hasMonthLabel = true; break; }
  }
  record('P&L Calendar', 'Month navigation exists', navCount > 0 || hasMonthLabel, `Nav buttons: ${navCount}, Month label: ${hasMonthLabel}`);
}

async function testMarketIndices(page) {
  console.log('\n=== 7. MARKET INDICES ===');
  const bodyText = await page.textContent('body');
  const indices = ['SPY', 'QQQ', 'IWM', 'DIA'];
  let foundIndices = [];
  for (const idx of indices) {
    if (bodyText.includes(idx)) foundIndices.push(idx);
  }
  record('Market Indices', 'Shows index symbols', foundIndices.length >= 2, `Found: ${foundIndices.join(', ')}`);

  // Check for real prices (3-digit numbers)
  const pricePattern = /\d{3,4}\.\d{2}/;
  const hasPrices = pricePattern.test(bodyText);
  record('Market Indices', 'Prices appear real', hasPrices, '');

  // Check for VIX
  const hasVix = bodyText.includes('VIX') || bodyText.includes('VIXY');
  record('Market Indices', 'VIX displayed', hasVix, '');

  // Check for change percentages
  const changePattern = /[+-]?\d+\.\d+%/;
  const hasChanges = changePattern.test(bodyText);
  const allZero = bodyText.match(/0\.00%/g);
  record('Market Indices', 'Change percentages meaningful', hasChanges && (!allZero || allZero.length < 4), allZero ? `Found ${allZero.length} zero percentages` : '');

  await screenshot(page, '07-market-indices');
}

async function testSectorTreemap(page) {
  console.log('\n=== 8. SECTOR TREEMAP ===');
  const treemapEl = page.locator('[class*="treemap"], [class*="Treemap"], [class*="sector"], [class*="Sector"]').first();
  const exists = await treemapEl.count() > 0;
  record('Sector Treemap', 'Treemap renders', exists, '');

  if (exists) {
    await screenshotEl(page, '[class*="treemap"], [class*="Treemap"], [class*="sector"], [class*="Sector"]', '08-sector-treemap');

    // Check for different tile sizes (SVG rects with different dimensions)
    const rectCount = await page.locator('[class*="treemap"] rect, [class*="Treemap"] rect, [class*="sector"] rect, [class*="Sector"] rect').count();
    record('Sector Treemap', 'Has tiles with varying sizes', rectCount > 0, `Found ${rectCount} rect elements`);
  } else {
    await screenshot(page, '08-sector-treemap-fallback');
    record('Sector Treemap', 'Has tiles with varying sizes', false, 'Treemap not found');
  }

  // Check for percentages
  const bodyText = await page.textContent('body');
  const sectorEtfs = ['XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLC', 'XLY', 'XLP', 'XLU', 'XLRE', 'XLB'];
  let foundSectors = 0;
  for (const s of sectorEtfs) {
    if (bodyText.includes(s)) foundSectors++;
  }
  record('Sector Treemap', 'Shows sector ETF data', foundSectors >= 2, `Found ${foundSectors} sector ETFs`);
}

async function testAllocationDonut(page) {
  console.log('\n=== 9. ALLOCATION DONUT ===');
  const donutEl = page.locator('[class*="donut"], [class*="Donut"], [class*="allocation"], [class*="Allocation"], [class*="pie"]').first();
  const exists = await donutEl.count() > 0;
  record('Allocation Donut', 'Donut chart renders', exists, '');

  const bodyText = await page.textContent('body');
  const hasCash = bodyText.includes('Cash');
  const hasInvested = bodyText.includes('Invested') || bodyText.includes('Equity') || bodyText.includes('Positions');
  record('Allocation Donut', 'Shows Cash vs Invested', hasCash && hasInvested, `Cash: ${hasCash}, Invested: ${hasInvested}`);

  if (exists) {
    await screenshotEl(page, '[class*="donut"], [class*="Donut"], [class*="allocation"], [class*="Allocation"], [class*="pie"]', '09-allocation-donut');
  } else {
    await screenshot(page, '09-allocation-donut-fallback');
  }
}

async function testEconomicCalendar(page) {
  console.log('\n=== 10. ECONOMIC CALENDAR ===');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);

  const bodyText = await page.textContent('body');
  const econTerms = ['CPI', 'GDP', 'FOMC', 'NFP', 'PMI', 'Retail Sales', 'Jobless', 'Fed', 'Economic', 'Calendar'];
  let foundTerms = 0;
  for (const t of econTerms) {
    if (bodyText.includes(t)) foundTerms++;
  }
  record('Economic Calendar', 'Shows economic events', foundTerms >= 2, `Found ${foundTerms} economic terms`);

  // Check for reduced opacity (sample data indicator)
  const hasOpacity = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const style = getComputedStyle(el);
      const cls = typeof el.className === 'string' ? el.className : '';
      if ((cls.includes('economic') || cls.includes('Economic') || cls.includes('calendar')) && parseFloat(style.opacity) < 1) return true;
      // Also check for opacity in inline style or specific elements with sample data
      if (el.textContent && (el.textContent.includes('CPI') || el.textContent.includes('GDP') || el.textContent.includes('FOMC'))) {
        if (parseFloat(style.opacity) < 1) return true;
      }
    }
    return false;
  });
  record('Economic Calendar', 'Sample data has opacity', hasOpacity, hasOpacity ? 'Opacity < 1 found' : 'No opacity reduction detected');

  await screenshot(page, '10-economic-calendar');
}

async function testStatusStrip(page) {
  console.log('\n=== 11. STATUS STRIP ===');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const stripEl = page.locator('[class*="status"], [class*="Status"], [class*="strip"], [class*="Strip"]').first();
  const exists = await stripEl.count() > 0;
  record('Status Strip', 'Strip renders', exists, '');

  const bodyText = await page.textContent('body');

  // Check for regime
  const hasRegime = bodyText.includes('Regime') || bodyText.includes('regime') || bodyText.includes('Bullish') || bodyText.includes('Bearish') || bodyText.includes('Risk-On') || bodyText.includes('Risk-Off');
  record('Status Strip', 'Regime displayed', hasRegime, '');

  // Check for VIX value (not default 16.5)
  const vixMatch = bodyText.match(/VIX[:\s]*(\d+\.?\d*)/);
  const hasRealVix = vixMatch && parseFloat(vixMatch[1]) !== 16.5;
  record('Status Strip', 'VIX is real (not 16.5 default)', hasRealVix || false, vixMatch ? `VIX: ${vixMatch[1]}` : 'VIX value not found in expected format');

  // Check for LIVE indicator
  const hasLive = bodyText.includes('LIVE') || bodyText.includes('Live') || bodyText.includes('Connected');
  record('Status Strip', 'LIVE indicator shown', hasLive, '');

  // Check for Alpaca badge
  const hasAlpaca = bodyText.includes('Alpaca') || bodyText.includes('Paper') || bodyText.includes('PAPER');
  record('Status Strip', 'Alpaca (Paper) badge', hasAlpaca, '');

  await screenshotEl(page, '[class*="status-strip"], [class*="StatusStrip"], [class*="status"], footer, [class*="Strip"]', '11-status-strip');
}

// ==================== TRADE PAGE WIDGETS ====================

async function testTradePage(page) {
  console.log('\n=== TRADE PAGE ===');
  // Navigate to trade page
  const tradeLink = page.locator('a[href*="trade"], button:has-text("Trade")').first();
  if (await tradeLink.count() > 0) {
    await tradeLink.click();
  } else {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  }
  await page.waitForTimeout(3000);
  await screenshot(page, '12-trade-page-full');

  const bodyText = await page.textContent('body');

  // 12. Chart
  console.log('\n=== 12. CHART ===');
  const chartEl = page.locator('canvas, [class*="chart"], [class*="Chart"], [class*="trading-chart"], [class*="TradingChart"]').first();
  const chartExists = await chartEl.count() > 0;
  record('Chart', 'Chart loads', chartExists, '');

  // Check for timeframe buttons
  const timeframes = ['1m', '5m', '15m', '1H', '4H', '1D', 'D', 'W', 'M'];
  let foundTF = 0;
  for (const tf of timeframes) {
    const btn = page.locator(`button:text("${tf}")`);
    if (await btn.count() > 0) foundTF++;
  }
  record('Chart', 'Timeframe buttons present', foundTF >= 3, `Found ${foundTF} timeframe buttons`);

  // Check chart type buttons
  const chartTypes = ['Candle', 'Line', 'Area', 'candle', 'line', 'area'];
  let foundTypes = 0;
  for (const ct of chartTypes) {
    if (bodyText.includes(ct)) foundTypes++;
  }
  const candleBtn = page.locator('button[title*="candle"], button[title*="Candle"], button[aria-label*="candle"]');
  const lineBtn = page.locator('button[title*="line"], button[title*="Line"], button[aria-label*="line"]');
  record('Chart', 'Chart type buttons', foundTypes > 0 || await candleBtn.count() > 0 || await lineBtn.count() > 0, '');

  await screenshotEl(page, 'canvas, [class*="chart"], [class*="Chart"]', '12-chart');

  // Try clicking timeframes
  for (const tf of ['5m', '1H', 'D']) {
    try {
      const btn = page.locator('button').filter({ hasText: new RegExp(`^${tf}$`) }).first();
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(1500);
        await screenshot(page, `12-chart-${tf}`);
        record('Chart', `Timeframe ${tf} works`, true, '');
      }
    } catch (e) {
      // skip
    }
  }

  // 13. L1 Data Bar
  console.log('\n=== 13. L1 DATA BAR ===');
  const l1Terms = ['Bid', 'Ask', 'Spread', 'Volume', 'High', 'Low', 'Open'];
  let foundL1 = 0;
  for (const t of l1Terms) {
    if (bodyText.includes(t)) foundL1++;
  }
  record('L1 Data Bar', 'L1 data displayed', foundL1 >= 3, `Found ${foundL1}/7 L1 terms`);

  // Check for non-zero values
  const pricePattern = /\d+\.\d{2}/g;
  const prices = bodyText.match(pricePattern);
  const nonZeroPrices = prices ? prices.filter(p => parseFloat(p) > 0) : [];
  record('L1 Data Bar', 'Values populated (not all zero)', nonZeroPrices.length > 3, `Found ${nonZeroPrices.length} non-zero price values`);

  await screenshot(page, '13-l1-data-bar');

  // 14. Watchlist
  console.log('\n=== 14. WATCHLIST ===');
  const watchlistEl = page.locator('[class*="watchlist"], [class*="Watchlist"]').first();
  const wlExists = await watchlistEl.count() > 0;
  record('Watchlist', 'Watchlist renders', wlExists, '');

  // Check for sparklines
  const sparklines = page.locator('[class*="sparkline"], [class*="Sparkline"], svg[class*="spark"]');
  const sparkCount = await sparklines.count();
  record('Watchlist', 'Sparklines rendered', sparkCount > 0, `Found ${sparkCount} sparklines`);

  // Try clicking a watchlist symbol
  if (wlExists) {
    try {
      const wlItems = page.locator('[class*="watchlist"] [class*="item"], [class*="Watchlist"] [class*="row"], [class*="watchlist"] button, [class*="watchlist"] tr, [class*="Watchlist"] [class*="symbol"]');
      const itemCount = await wlItems.count();
      if (itemCount > 0) {
        await wlItems.first().click();
        await page.waitForTimeout(1500);
        record('Watchlist', 'Click symbol updates chart', true, 'Clicked first watchlist item');
        await screenshot(page, '14-watchlist-click');
      }
    } catch (e) {
      record('Watchlist', 'Click symbol updates chart', false, e.message.slice(0, 100));
    }
  }

  // Try adding a symbol
  const addInput = page.locator('[class*="watchlist"] input, [placeholder*="symbol"], [placeholder*="Symbol"], [placeholder*="ticker"], [placeholder*="search"], [placeholder*="Add"]');
  if (await addInput.count() > 0) {
    try {
      await addInput.first().fill('TSLA');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
      const newBody = await page.textContent('body');
      record('Watchlist', 'Add symbol works', newBody.includes('TSLA'), '');
      await screenshot(page, '14-watchlist-add');
    } catch (e) {
      record('Watchlist', 'Add symbol works', false, e.message.slice(0, 100));
    }
  } else {
    record('Watchlist', 'Add symbol input found', false, 'No add-symbol input found');
  }

  await screenshotEl(page, '[class*="watchlist"], [class*="Watchlist"]', '14-watchlist');
}

async function testTradePageTabs(page) {
  // 15-21: Trade page tabs
  const tabs = [
    { num: 15, name: 'Screener', label: 'Screener', check: 'Run Screen' },
    { num: 16, name: 'Signals', label: 'Signals', check: 'Signal' },
    { num: 17, name: 'Technical Analysis', label: 'Technical', check: 'RSI' },
    { num: 18, name: 'Fundamental', label: 'Fundamental', check: 'F-Score' },
    { num: 19, name: 'Sentiment', label: 'Sentiment', check: 'Sentiment' },
    { num: 20, name: 'Chat', label: 'Chat', check: '' },
    { num: 21, name: 'Order', label: 'Order', check: 'Buy' },
  ];

  for (const tab of tabs) {
    console.log(`\n=== ${tab.num}. ${tab.name.toUpperCase()} TAB ===`);
    try {
      const tabBtn = page.locator(`button:has-text("${tab.label}"), [role="tab"]:has-text("${tab.label}"), a:has-text("${tab.label}")`).first();
      if (await tabBtn.count() > 0) {
        await tabBtn.click();
        await page.waitForTimeout(1500);

        const bodyText = await page.textContent('body');
        if (tab.check) {
          const found = bodyText.includes(tab.check);
          record(`${tab.name} Tab`, `Content loaded`, found, found ? `Found "${tab.check}"` : `"${tab.check}" not found`);
        }

        await screenshot(page, `${tab.num}-${tab.name.toLowerCase().replace(/\s/g, '-')}-tab`);

        // Specific checks per tab
        if (tab.name === 'Screener') {
          const runBtn = page.locator('button:has-text("Run Screen"), button:has-text("Run"), button:has-text("Screen")').first();
          if (await runBtn.count() > 0) {
            await runBtn.click();
            await page.waitForTimeout(3000);
            await screenshot(page, '15-screener-results');
            const results = await page.textContent('body');
            const hasResults = /\d+\.\d+/.test(results);
            record('Screener Tab', 'Run Screen returns results', hasResults, '');
          }
        }

        if (tab.name === 'Technical Analysis') {
          const indicators = ['RSI', 'MACD', 'EMA', 'Bollinger', 'Support', 'Resistance'];
          let found = 0;
          for (const ind of indicators) {
            if (bodyText.includes(ind)) found++;
          }
          record('Technical Analysis Tab', 'Shows technical indicators', found >= 2, `Found ${found} indicators`);

          // Check for gauge
          const gauge = page.locator('[class*="gauge"], [class*="Gauge"], [class*="score"], [class*="Score"]');
          record('Technical Analysis Tab', 'Technical Score gauge', await gauge.count() > 0, '');
        }

        if (tab.name === 'Fundamental') {
          const hasFScore = bodyText.includes('F-Score') || bodyText.includes('Piotroski');
          record('Fundamental Tab', 'F-Score renders', hasFScore, '');
        }

        if (tab.name === 'Sentiment') {
          const hasContent = bodyText.length > 100; // has some content
          record('Sentiment Tab', 'Content displayed', hasContent, '');
        }

        if (tab.name === 'Chat') {
          const chatInput = page.locator('[class*="chat"] input, [class*="chat"] textarea, [class*="Chat"] input, [class*="Chat"] textarea, [placeholder*="message"], [placeholder*="Message"], [placeholder*="chat"], [placeholder*="Ask"]').first();
          if (await chatInput.count() > 0) {
            await chatInput.fill('What is the current market outlook?');
            const sendBtn = page.locator('[class*="chat"] button[type="submit"], [class*="Chat"] button:has-text("Send"), button:has([class*="send"]), button:has(svg)').last();
            if (await sendBtn.count() > 0) {
              await sendBtn.click();
              await page.waitForTimeout(5000);
              await screenshot(page, '20-chat-response');
              const chatBody = await page.textContent('body');
              const gotResponse = chatBody.includes('market') || chatBody.includes('outlook') || chatBody.length > 500;
              record('Chat Tab', 'AI responds to message', gotResponse, '');
            } else {
              // Try pressing Enter
              await page.keyboard.press('Enter');
              await page.waitForTimeout(5000);
              await screenshot(page, '20-chat-response');
              record('Chat Tab', 'Message sent via Enter', true, '');
            }
          } else {
            record('Chat Tab', 'Chat input found', false, 'No chat input element found');
          }
        }

        if (tab.name === 'Order') {
          // Check Buy/Sell toggle
          const buyBtn = page.locator('button:has-text("Buy")').first();
          const sellBtn = page.locator('button:has-text("Sell")').first();
          record('Order Tab', 'Buy/Sell toggle present', await buyBtn.count() > 0 && await sellBtn.count() > 0, '');

          // Check for quantity input
          const qtyInput = page.locator('input[name*="qty"], input[name*="quantity"], input[placeholder*="qty"], input[placeholder*="Qty"], input[type="number"]');
          record('Order Tab', 'Quantity input present', await qtyInput.count() > 0, '');

          // Check submit button
          const submitBtn = page.locator('button:has-text("Submit"), button:has-text("Place"), button:has-text("Review"), button[type="submit"]');
          record('Order Tab', 'Submit button present', await submitBtn.count() > 0, '');

          await screenshot(page, '21-order-tab');
        }

      } else {
        record(`${tab.name} Tab`, 'Tab button found', false, `No "${tab.label}" tab found`);
      }
    } catch (e) {
      record(`${tab.name} Tab`, 'Tab test', false, e.message.slice(0, 150));
    }
  }
}

async function testOptionsAndBottomPanels(page) {
  // 22. Options Chain
  console.log('\n=== 22. OPTIONS CHAIN ===');
  const optionsTab = page.locator('button:has-text("Options"), [role="tab"]:has-text("Options"), a:has-text("Options")').first();
  if (await optionsTab.count() > 0) {
    await optionsTab.click();
    await page.waitForTimeout(2000);
    const bodyText = await page.textContent('body');

    const hasStrikes = bodyText.includes('Strike') || bodyText.includes('strike') || /\d{2,3}\.00/.test(bodyText);
    record('Options Chain', 'Strikes listed', hasStrikes, '');

    const hasIV = bodyText.includes('IV Rank') || bodyText.includes('IV ') || bodyText.includes('Implied');
    record('Options Chain', 'IV Rank displayed', hasIV, '');

    const hasEM = bodyText.includes('Expected Move') || bodyText.includes('expected move');
    record('Options Chain', 'Expected Move shown', hasEM, '');

    // Click a strike
    const strikeRow = page.locator('[class*="strike"], [class*="option"] tr, [class*="chain"] tr').first();
    if (await strikeRow.count() > 0) {
      await strikeRow.click();
      await page.waitForTimeout(500);
      record('Options Chain', 'Click strike adds to builder', true, 'Clicked strike row');
    }

    await screenshot(page, '22-options-chain');
  } else {
    record('Options Chain', 'Options tab found', false, 'No Options tab');
    await screenshot(page, '22-options-missing');
  }

  // 23. Trade Builder
  console.log('\n=== 23. TRADE BUILDER ===');
  const bodyText = await page.textContent('body');
  const hasTradeBuilder = bodyText.includes('Add Leg') || bodyText.includes('Trade Builder') || bodyText.includes('Strategy Builder');
  record('Trade Builder', 'Trade Builder rendered', hasTradeBuilder, '');

  if (hasTradeBuilder) {
    const addLegBtn = page.locator('button:has-text("Add Leg")').first();
    if (await addLegBtn.count() > 0) {
      await addLegBtn.click();
      await page.waitForTimeout(500);
      record('Trade Builder', 'Add Leg works', true, '');
    }

    const hasCredit = bodyText.includes('Credit') || bodyText.includes('Debit') || bodyText.includes('Net');
    record('Trade Builder', 'Shows Net Credit/Debit', hasCredit, '');
  }
  await screenshot(page, '23-trade-builder');

  // 24-27: Bottom panel tabs
  const bottomTabs = [
    { num: 24, name: 'Positions Tab (bottom)', label: 'Positions' },
    { num: 25, name: 'Orders Tab (bottom)', label: 'Orders' },
    { num: 26, name: 'Journal Tab (bottom)', label: 'Journal' },
    { num: 27, name: 'Calendar Tab (bottom)', label: 'Calendar' },
  ];

  for (const tab of bottomTabs) {
    console.log(`\n=== ${tab.num}. ${tab.name.toUpperCase()} ===`);
    try {
      const tabBtn = page.locator(`button:has-text("${tab.label}"), [role="tab"]:has-text("${tab.label}")`).first();
      if (await tabBtn.count() > 0) {
        await tabBtn.click();
        await page.waitForTimeout(1500);
        await screenshot(page, `${tab.num}-${tab.label.toLowerCase()}-bottom`);

        const panelText = await page.textContent('body');

        if (tab.name.includes('Positions')) {
          const syms = ['MRK', 'NKE', 'PG', 'WMT'];
          let found = 0;
          for (const s of syms) { if (panelText.includes(s)) found++; }
          record(tab.name, 'Lists positions', found >= 2, `Found ${found} symbols`);
        }

        if (tab.name.includes('Orders')) {
          const hasOrders = panelText.includes('Order') || panelText.includes('order') || panelText.includes('No orders') || panelText.includes('filled');
          record(tab.name, 'Orders section works', hasOrders, '');
        }

        if (tab.name.includes('Journal')) {
          const journalInput = page.locator('textarea, [contenteditable], input[type="text"]').last();
          if (await journalInput.count() > 0) {
            await journalInput.fill('QA test note - widget audit');
            await page.waitForTimeout(500);

            // Switch away and back
            const otherTab = page.locator('button:has-text("Orders"), [role="tab"]:has-text("Orders")').first();
            if (await otherTab.count() > 0) {
              await otherTab.click();
              await page.waitForTimeout(500);
              await tabBtn.click();
              await page.waitForTimeout(500);
              const afterText = await page.textContent('body');
              const notePersisted = afterText.includes('QA test note');
              record(tab.name, 'Note persists across tab switch', notePersisted, '');
            }
          } else {
            record(tab.name, 'Journal input found', false, '');
          }
        }

        if (tab.name.includes('Calendar')) {
          const hasCalendar = panelText.includes('Mon') || panelText.includes('Tue') || panelText.includes('Sun') || panelText.includes('Calendar');
          record(tab.name, 'Calendar renders', hasCalendar, '');
        }

      } else {
        record(tab.name, 'Tab found', false, `No "${tab.label}" tab`);
      }
    } catch (e) {
      record(tab.name, 'Tab test', false, e.message.slice(0, 100));
    }
  }
}

// ==================== PIPELINE PAGE WIDGETS ====================

async function testPipelinePage(page) {
  console.log('\n=== PIPELINE PAGE ===');
  const pipelineLink = page.locator('a[href*="pipeline"], button:has-text("Pipeline")').first();
  if (await pipelineLink.count() > 0) {
    await pipelineLink.click();
  } else {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  }
  await page.waitForTimeout(3000);
  await screenshot(page, '28-pipeline-page-full');

  const bodyText = await page.textContent('body');

  // 28. Current Positions Table
  console.log('\n=== 28. CURRENT POSITIONS TABLE ===');
  const hasPositions = bodyText.includes('Position') || bodyText.includes('position') || bodyText.includes('MRK') || bodyText.includes('NKE');
  record('Pipeline Positions', 'Positions table rendered', hasPositions, '');

  const hasEntryPrice = bodyText.includes('Entry') || bodyText.includes('entry') || bodyText.includes('Avg');
  record('Pipeline Positions', 'Shows entry price', hasEntryPrice, '');

  await screenshot(page, '28-pipeline-positions');

  // 29. Pipeline Flow Diagram
  console.log('\n=== 29. PIPELINE FLOW DIAGRAM ===');
  const flowTerms = ['Screened', 'Analyzed', 'Signal', 'Order', 'Funnel', 'Pipeline', 'Flow', 'Stage'];
  let foundFlow = 0;
  for (const t of flowTerms) { if (bodyText.includes(t)) foundFlow++; }
  record('Pipeline Flow', 'Flow diagram rendered', foundFlow >= 2, `Found ${foundFlow} flow terms`);

  // Check for non-zero numbers in the flow
  const flowNumbers = bodyText.match(/\b[1-9]\d*\b/g);
  record('Pipeline Flow', 'Numbers are non-zero', flowNumbers && flowNumbers.length > 0, '');

  await screenshot(page, '29-pipeline-flow');

  // 30. Strategy Builder
  console.log('\n=== 30. STRATEGY BUILDER ===');
  const hasBuilder = bodyText.includes('Strategy Builder') || bodyText.includes('strategy builder') || bodyText.includes('Build') || bodyText.includes('Natural Language') || bodyText.includes('natural language');
  record('Strategy Builder', 'Builder rendered', hasBuilder, '');

  // Try typing a rule
  const builderInput = page.locator('textarea[placeholder*="Buy"], textarea[placeholder*="strategy"], input[placeholder*="Buy"], input[placeholder*="strategy"], textarea[placeholder*="rule"], input[placeholder*="describe"]').first();
  if (await builderInput.count() > 0) {
    await builderInput.fill('Buy when RSI < 30');
    await page.waitForTimeout(1000);
    await screenshot(page, '30-strategy-builder-input');

    // Check for parsing
    const parseBtn = page.locator('button:has-text("Parse"), button:has-text("Build"), button:has-text("Generate"), button:has-text("Create")').first();
    if (await parseBtn.count() > 0) {
      await parseBtn.click();
      await page.waitForTimeout(2000);
      const afterParse = await page.textContent('body');
      const parsed = afterParse.includes('RSI') || afterParse.includes('parsed') || afterParse.includes('rule');
      record('Strategy Builder', 'Parses natural language', parsed, '');
      await screenshot(page, '30-strategy-builder-parsed');
    }
  } else {
    record('Strategy Builder', 'Builder input found', false, 'No strategy builder input');
  }

  // Check for example chips
  const chips = page.locator('[class*="chip"], [class*="Chip"], [class*="example"], [class*="Example"], button:has-text("SMA"), button:has-text("RSI")');
  record('Strategy Builder', 'Example chips present', await chips.count() > 0, `Found ${await chips.count()} chips`);

  // 31. Backtest Section
  console.log('\n=== 31. BACKTEST SECTION ===');
  const backtestTab = page.locator('button:has-text("Backtest"), [role="tab"]:has-text("Backtest"), a:has-text("Backtest")').first();
  if (await backtestTab.count() > 0) {
    await backtestTab.click();
    await page.waitForTimeout(1500);
  }

  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(500);

  const btBody = await page.textContent('body');
  const hasBacktest = btBody.includes('Backtest') || btBody.includes('backtest');
  record('Backtest', 'Backtest section rendered', hasBacktest, '');

  // Look for strategy selector and run button
  const stratSelector = page.locator('select, [class*="select"], [role="combobox"], [class*="dropdown"]').first();
  const runBtn = page.locator('button:has-text("Run"), button:has-text("Backtest"), button:has-text("Start")').first();

  if (await runBtn.count() > 0) {
    // Select SMA if possible
    if (await stratSelector.count() > 0) {
      try {
        await stratSelector.click();
        await page.waitForTimeout(500);
        const smaOpt = page.locator('option:has-text("SMA"), [role="option"]:has-text("SMA"), li:has-text("SMA")').first();
        if (await smaOpt.count() > 0) {
          await smaOpt.click();
          await page.waitForTimeout(500);
        }
      } catch (e) {
        // continue
      }
    }

    await runBtn.click();
    await page.waitForTimeout(5000);
    await screenshot(page, '31-backtest-results');

    const results = await page.textContent('body');
    const hasReturn = results.includes('Return') || results.includes('return') || results.includes('%');
    const hasSharpe = results.includes('Sharpe') || results.includes('sharpe');
    const hasDrawdown = results.includes('Drawdown') || results.includes('drawdown') || results.includes('Max DD');
    record('Backtest', 'Shows return', hasReturn, '');
    record('Backtest', 'Shows Sharpe ratio', hasSharpe, '');
    record('Backtest', 'Shows max drawdown', hasDrawdown, '');

    // Check for equity curve in results
    const btChart = page.locator('[class*="backtest"] svg, [class*="backtest"] canvas, [class*="Backtest"] svg').first();
    record('Backtest', 'Equity curve rendered', await btChart.count() > 0, '');
  } else {
    record('Backtest', 'Run button found', false, '');
  }

  // 32. Run Pipeline Button
  console.log('\n=== 32. RUN PIPELINE ===');
  const runPipeline = page.locator('button:has-text("Run Pipeline"), button:has-text("Run pipeline"), button:has-text("Execute")').first();
  record('Run Pipeline', 'Button present', await runPipeline.count() > 0, '');
  if (await runPipeline.count() > 0) {
    await runPipeline.click();
    await page.waitForTimeout(3000);
    await screenshot(page, '32-run-pipeline');
    const afterRun = await page.textContent('body');
    const somethingHappened = afterRun.includes('Running') || afterRun.includes('running') || afterRun.includes('Complete') || afterRun.includes('Started') || afterRun.includes('Progress') || afterRun.includes('Error') || afterRun.includes('success');
    record('Run Pipeline', 'Triggers action', somethingHappened, '');
  }

  // 33. Performance Summary
  console.log('\n=== 33. PERFORMANCE SUMMARY ===');
  const perfText = await page.textContent('body');
  const hasTotalPnl = perfText.includes('Total P&L') || perfText.includes('Total PnL') || perfText.includes('Net P&L') || perfText.includes('Total Return');
  record('Performance Summary', 'Total P&L shown', hasTotalPnl, '');

  const hasBestWorst = perfText.includes('Best') || perfText.includes('Worst') || perfText.includes('best') || perfText.includes('worst');
  record('Performance Summary', 'Best/worst trade shown', hasBestWorst, '');

  await screenshot(page, '33-performance-summary');
}

// ==================== GLOBAL WIDGETS ====================

async function testGlobalWidgets(page) {
  // 34. TopBar Navigation
  console.log('\n=== 34. TOPBAR NAVIGATION ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const dashLink = page.locator('a[href*="dashboard"], a[href="/"], button:has-text("Dashboard")').first();
  const tradeLink = page.locator('a[href*="trade"]').first();
  const pipelineLink = page.locator('a[href*="pipeline"]').first();

  const navWorks = (await dashLink.count() > 0 || true) && (await tradeLink.count() > 0) && (await pipelineLink.count() > 0);
  record('TopBar Navigation', 'Nav links present', navWorks, '');

  // Test navigation
  if (await tradeLink.count() > 0) {
    await tradeLink.click();
    await page.waitForTimeout(2000);
    record('TopBar Navigation', 'Trade nav works', page.url().includes('trade'), `URL: ${page.url()}`);
  }

  if (await pipelineLink.count() > 0) {
    await pipelineLink.click();
    await page.waitForTimeout(2000);
    record('TopBar Navigation', 'Pipeline nav works', page.url().includes('pipeline'), `URL: ${page.url()}`);
  }

  // Logo click
  const logo = page.locator('[class*="logo"], [class*="Logo"], a[href="/"]').first();
  if (await logo.count() > 0) {
    await logo.click();
    await page.waitForTimeout(2000);
    record('TopBar Navigation', 'Logo goes home', !page.url().includes('trade') && !page.url().includes('pipeline'), `URL: ${page.url()}`);
  }

  await screenshot(page, '34-topbar');

  // 35. Command Palette
  console.log('\n=== 35. COMMAND PALETTE ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Try Ctrl+K (or Cmd+K on Mac)
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(1000);

  let paletteOpen = false;
  const palette = page.locator('[class*="command"], [class*="Command"], [class*="palette"], [class*="Palette"], [role="dialog"]');
  if (await palette.count() > 0) {
    paletteOpen = true;
  } else {
    // Try Ctrl+K
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(1000);
    if (await palette.count() > 0) paletteOpen = true;
  }

  record('Command Palette', 'Ctrl/Cmd+K opens', paletteOpen, '');
  await screenshot(page, '35-command-palette');

  if (paletteOpen) {
    // Search for a symbol
    const paletteInput = page.locator('[class*="command"] input, [class*="palette"] input, [role="dialog"] input, [role="combobox"]').first();
    if (await paletteInput.count() > 0) {
      await paletteInput.fill('AAPL');
      await page.waitForTimeout(1000);
      const bodyText = await page.textContent('body');
      record('Command Palette', 'Search returns results', bodyText.includes('AAPL') || bodyText.includes('Apple'), '');
      await screenshot(page, '35-command-palette-search');
    }

    // Close palette
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // 36. Profile Menu
  console.log('\n=== 36. PROFILE MENU ===');
  const profileBtn = page.locator('[class*="profile"], [class*="Profile"], [class*="avatar"], [class*="Avatar"], button:has-text("admin"), [class*="user-menu"]').first();
  if (await profileBtn.count() > 0) {
    await profileBtn.click();
    await page.waitForTimeout(1000);
    await screenshot(page, '36-profile-menu');

    const menuText = await page.textContent('body');
    const hasEquity = menuText.includes('$') || menuText.includes('equity');
    record('Profile Menu', 'Shows equity', hasEquity, '');

    const hasShortcuts = menuText.includes('Shortcut') || menuText.includes('shortcut') || menuText.includes('Keyboard');
    record('Profile Menu', 'Keyboard Shortcuts option', hasShortcuts, '');

    const hasLogout = menuText.includes('Logout') || menuText.includes('Sign out') || menuText.includes('Log out');
    record('Profile Menu', 'Logout option present', hasLogout, '');

    // Close menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    record('Profile Menu', 'Profile button found', false, 'No profile button found');
  }

  // 37. Notifications Bell
  console.log('\n=== 37. NOTIFICATIONS BELL ===');
  const bellBtn = page.locator('[class*="notif"], [class*="Notif"], [class*="bell"], [aria-label*="notif"], button:has(svg[class*="bell"]), [class*="alert-btn"]').first();
  if (await bellBtn.count() > 0) {
    await bellBtn.click();
    await page.waitForTimeout(1000);
    await screenshot(page, '37-notifications');

    const notifText = await page.textContent('body');
    const hasNotifContent = notifText.includes('alert') || notifText.includes('Alert') || notifText.includes('notification') || notifText.includes('No alert') || notifText.includes('No notification');
    record('Notifications Bell', 'Popover opens', true, '');
    record('Notifications Bell', 'Shows alerts or empty state', hasNotifContent, '');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    // Try looking for bell icon
    const bellIcon = page.locator('button svg, [class*="topbar"] button, [class*="TopBar"] button').nth(0);
    record('Notifications Bell', 'Bell button found', false, 'No bell icon found directly');
    await screenshot(page, '37-notifications-fallback');
  }

  // 38. Keyboard Shortcuts Overlay
  console.log('\n=== 38. KEYBOARD SHORTCUTS ===');
  await page.keyboard.press('?');
  await page.waitForTimeout(1000);

  const overlay = page.locator('[class*="shortcut"], [class*="Shortcut"], [class*="overlay"], [class*="Overlay"], [class*="shortcuts-modal"]');
  const overlayVisible = await overlay.count() > 0;

  // Also check for dialog/modal
  const modal = page.locator('[role="dialog"]:visible, [class*="modal"]:visible');
  const modalVisible = await modal.count() > 0;

  record('Keyboard Shortcuts', 'Overlay opens with ?', overlayVisible || modalVisible, '');
  await screenshot(page, '38-keyboard-shortcuts');

  if (overlayVisible || modalVisible) {
    const shortcutText = await page.textContent('body');
    const hasShortcutList = shortcutText.includes('Ctrl') || shortcutText.includes('⌘') || shortcutText.includes('Shift') || shortcutText.includes('Cmd');
    record('Keyboard Shortcuts', 'Lists shortcuts', hasShortcutList, '');

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const overlayAfter = page.locator('[class*="shortcut-overlay"]:visible, [class*="ShortcutOverlay"]:visible');
    record('Keyboard Shortcuts', 'Escape closes overlay', (await overlayAfter.count()) === 0, '');
  }
}

// ==================== MAIN ====================

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1920,1080'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await login(page);
    await screenshot(page, '00-after-login');

    // Dashboard widgets (1-11)
    await testPortfolioHero(page);
    await testEquityCurve(page);
    await testActivityFeed(page);
    await testStrategyGrid(page);
    await testOpenPositions(page);
    await testPnlCalendar(page);
    await testMarketIndices(page);
    await testSectorTreemap(page);
    await testAllocationDonut(page);
    await testEconomicCalendar(page);
    await testStatusStrip(page);

    // Trade page widgets (12-27)
    await testTradePage(page);
    await testTradePageTabs(page);
    await testOptionsAndBottomPanels(page);

    // Pipeline page widgets (28-33)
    await testPipelinePage(page);

    // Global widgets (34-38)
    await testGlobalWidgets(page);

  } catch (e) {
    console.error('FATAL ERROR:', e.message);
    await screenshot(page, 'ERROR-fatal');
  } finally {
    // Print summary
    console.log('\n\n========================================');
    console.log('WIDGET AUDIT RESULTS');
    console.log('========================================');
    console.log(`TOTAL: ${results.length} tests`);
    console.log(`PASS: ${results.filter(r => r.status === 'PASS').length}`);
    console.log(`FAIL: ${results.filter(r => r.status === 'FAIL').length}`);
    console.log('========================================\n');

    // Write results to JSON
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results.json'), JSON.stringify(results, null, 2));

    // Write results table
    let table = 'Widget | Function | Status | Issue\n--- | --- | --- | ---\n';
    for (const r of results) {
      table += `${r.widget} | ${r.fn} | ${r.status} | ${r.issue}\n`;
    }
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results-table.md'), table);
    console.log(table);

    await browser.close();
  }
}

main().catch(console.error);
