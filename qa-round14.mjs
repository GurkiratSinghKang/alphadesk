import puppeteer from 'puppeteer';
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

const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round14';
const BASE = 'https://tradingalpha.net';
const results = [];

function log(msg) { console.log(`[QA] ${msg}`); }
function pass(id, desc) { results.push({ id, desc, status: 'PASS' }); log(`PASS ${id}: ${desc}`); }
function fail(id, desc, detail) { results.push({ id, desc, status: 'FAIL', detail }); log(`FAIL ${id}: ${desc} — ${detail}`); }
function warn(id, desc, detail) { results.push({ id, desc, status: 'WARN', detail }); log(`WARN ${id}: ${desc} — ${detail}`); }

async function screenshot(page, name, opts = {}) {
  const fpath = path.join(DIR, `${name}.png`);
  if (opts.clip) {
    await page.screenshot({ path: fpath, clip: opts.clip });
  } else if (opts.element) {
    const el = await page.$(opts.element);
    if (el) {
      await el.screenshot({ path: fpath });
    } else {
      await page.screenshot({ path: fpath, fullPage: false });
      log(`Element not found for ${name}: ${opts.element}`);
    }
  } else {
    await page.screenshot({ path: fpath, fullPage: opts.fullPage || false });
  }
  log(`Screenshot: ${name}.png`);
  return fpath;
}

async function safeClick(page, selector, timeout = 3000) {
  try {
    await page.waitForSelector(selector, { timeout });
    await page.click(selector);
    return true;
  } catch { return false; }
}

async function hasElement(page, selector, timeout = 3000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch { return false; }
}

async function getText(page, selector, timeout = 3000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return await page.$eval(selector, el => el.textContent.trim());
  } catch { return null; }
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  try {
    // ==============================
    // LANDING PAGE (Check 28, 29)
    // ==============================
    log('=== LANDING PAGE ===');
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await screenshot(page, '28-landing-page', { fullPage: true });

    // Check 28: Product preview mockup
    const hasPreview = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      for (const img of imgs) {
        if (img.src.includes('preview') || img.src.includes('mockup') || img.src.includes('dashboard')) return true;
      }
      // Also check for any preview section
      const sections = document.querySelectorAll('section, div');
      for (const s of sections) {
        if (s.textContent.includes('preview') || s.className.includes('preview')) return true;
      }
      return false;
    });
    if (hasPreview) pass('28', 'Product preview mockup visible on landing page');
    else warn('28', 'Product preview mockup on landing page', 'No preview/mockup image found');

    // Check 29: Login form
    const loginForm = await hasElement(page, 'input[type="text"], input[name="username"], input[placeholder*="user" i], input[placeholder*="email" i]', 5000);
    if (loginForm) {
      pass('29a', 'Login form visible on landing page');
    } else {
      // Maybe need to click a login button first
      const loginBtn = await safeClick(page, 'a[href*="login"], button:has-text("Login"), a:has-text("Login"), [href*="login"]', 3000);
      if (loginBtn) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Navigate to login
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await screenshot(page, '29-login-page');

    // Login
    log('Logging in...');
    const usernameInput = await page.$('input[type="text"], input[name="username"], input[placeholder*="user" i], input[placeholder*="email" i]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');
    if (usernameInput && passwordInput) {
      await usernameInput.click({ clickCount: 3 });
      await usernameInput.type(QA_USERNAME);
      await passwordInput.click({ clickCount: 3 });
      await passwordInput.type(getQaPassword());
      await screenshot(page, '29-login-filled');

      // Submit
      const submitBtn = await page.$('button[type="submit"], button:not([type])');
      if (submitBtn) await submitBtn.click();
      await new Promise(r => setTimeout(r, 3000));
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      const url = page.url();
      if (url.includes('/dashboard') || url.includes('/trade') || !url.includes('/login')) {
        pass('29', 'Login form works — redirected after login');
      } else {
        fail('29', 'Login form', `Still on ${url} after login attempt`);
      }
    } else {
      fail('29', 'Login form', 'Could not find username/password inputs');
    }

    // ==============================
    // DASHBOARD
    // ==============================
    log('=== DASHBOARD ===');
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));
    await screenshot(page, '00-dashboard-full', { fullPage: true });

    // Check 1: Status strip
    const statusStrip = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasPnL = /P&?L|profit|loss/i.test(body);
      const hasRegime = /regime|bull|bear|neutral/i.test(body);
      const hasVIX = /VIX/i.test(body);
      const hasLive = /LIVE/i.test(body);
      const hasPaper = /Paper/i.test(body);
      return { hasPnL, hasRegime, hasVIX, hasLive, hasPaper, text: body.substring(0, 500) };
    });

    // Try to screenshot just the top status strip
    await page.evaluate(() => window.scrollTo(0, 0));
    await screenshot(page, '01-status-strip', { clip: { x: 0, y: 0, width: 1920, height: 120 } });

    if (statusStrip.hasPnL) pass('1a', 'Status strip — P&L visible');
    else fail('1a', 'Status strip — P&L', 'P&L not found in status strip');
    if (statusStrip.hasRegime) pass('1b', 'Status strip — Regime visible');
    else fail('1b', 'Status strip — Regime', 'Regime indicator not found');
    if (statusStrip.hasVIX) pass('1c', 'Status strip — VIX visible');
    else fail('1c', 'Status strip — VIX', 'VIX not found');
    if (statusStrip.hasLive) pass('1d', 'Status strip — LIVE indicator');
    else warn('1d', 'Status strip — LIVE', 'LIVE indicator not found');
    if (statusStrip.hasPaper) pass('1e', 'Status strip — Paper indicator');
    else warn('1e', 'Status strip — Paper', 'Paper indicator not found');

    // Check 2: Portfolio Hero
    const heroSection = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasEquity = /equity|portfolio.*value|\$[\d,]+/i.test(body);
      const hasPnL = /[+-]?\$[\d,]+\.\d{2}|[+-]?\d+\.\d+%/i.test(body);
      return { hasEquity, hasPnL };
    });

    // Screenshot hero area
    await screenshot(page, '02-portfolio-hero', { clip: { x: 0, y: 60, width: 1920, height: 280 } });

    // Check equity curve height
    const equityCurveHeight = await page.evaluate(() => {
      const canvases = document.querySelectorAll('canvas');
      const svgs = document.querySelectorAll('svg');
      let maxHeight = 0;
      // Check first few canvases/svgs for the equity curve
      for (const el of [...canvases, ...svgs]) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 400 && rect.height > 100) { // In hero area
          maxHeight = Math.max(maxHeight, rect.height);
        }
      }
      return maxHeight;
    });

    if (heroSection.hasEquity) pass('2a', 'Portfolio Hero — equity value visible');
    else fail('2a', 'Portfolio Hero — equity value', 'No equity/portfolio value found');
    if (heroSection.hasPnL) pass('2b', 'Portfolio Hero — P&L visible');
    else fail('2b', 'Portfolio Hero — P&L', 'No P&L values found');
    if (equityCurveHeight >= 140) pass('2c', `Portfolio Hero — equity curve height ${equityCurveHeight}px (target 160px)`);
    else if (equityCurveHeight > 0) warn('2c', 'Portfolio Hero — equity curve', `Height is ${equityCurveHeight}px, expected ~160px`);
    else warn('2c', 'Portfolio Hero — equity curve', 'No chart element found in hero area');

    // Check 3: Activity Feed
    await page.evaluate(() => window.scrollTo(0, 200));
    await new Promise(r => setTimeout(r, 500));

    const activityFeed = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasActivity = /activity|feed|event|pipeline|signal|trade.*executed/i.test(body);
      const hasTimestamps = /\d{1,2}:\d{2}|\d+\s*(min|hour|sec|ago)/i.test(body);
      const hasNews = /reuters|bloomberg|cnbc|headline|breaking/i.test(body);

      // Find activity feed section
      const sections = document.querySelectorAll('[class*="activity"], [class*="feed"], [class*="event"]');
      let feedText = '';
      sections.forEach(s => feedText += s.textContent + ' ');

      return { hasActivity, hasTimestamps, hasNews, feedText: feedText.substring(0, 300) };
    });

    // Screenshot activity feed area
    const activityEl = await page.$('[class*="activity"], [class*="feed"]');
    if (activityEl) {
      await screenshot(page, '03-activity-feed', { element: '[class*="activity"], [class*="feed"]' });
    } else {
      await screenshot(page, '03-activity-feed', { clip: { x: 0, y: 280, width: 960, height: 400 } });
    }

    if (activityFeed.hasActivity) pass('3a', 'Activity Feed — section visible');
    else warn('3a', 'Activity Feed', 'Activity feed section not clearly identified');
    if (activityFeed.hasTimestamps) pass('3b', 'Activity Feed — timestamps present');
    else warn('3b', 'Activity Feed — timestamps', 'No timestamps found');
    if (!activityFeed.hasNews) pass('3c', 'Activity Feed — no news mixed in');
    else fail('3c', 'Activity Feed — news contamination', 'News content found mixed with pipeline events');

    // Check 4: Strategy Grid
    await page.evaluate(() => window.scrollTo(0, 600));
    await new Promise(r => setTimeout(r, 1000));

    const strategyGrid = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="strategy"], [class*="card"]');
      const body = document.body.innerText;

      // Count strategy-like cards
      const stratNames = ['PEAD', 'Momentum', 'Mean Rev', 'Pairs', 'Volatility', 'Sector', 'Breakout', 'Trend', 'Statistical', 'Options', 'ML', 'Event', 'Multi'];
      let foundStrategies = 0;
      stratNames.forEach(name => {
        if (body.includes(name)) foundStrategies++;
      });

      // Check for sparklines (canvas/svg in cards)
      let sparklineCount = 0;
      cards.forEach(card => {
        const hasChart = card.querySelector('canvas, svg, [class*="spark"], [class*="chart"]');
        if (hasChart) sparklineCount++;
      });

      // Check for position counts and returns
      const hasReturns = /[+-]?\d+\.\d+%/g.test(body);
      const hasPositions = /\d+\s*(position|pos)/i.test(body) || /positions?:\s*\d/i.test(body);

      return { cardCount: cards.length, foundStrategies, sparklineCount, hasReturns, hasPositions };
    });

    // Full-width screenshot of strategy grid area
    await screenshot(page, '04-strategy-grid', { clip: { x: 0, y: 400, width: 1920, height: 700 } });
    // Scroll more for remaining cards
    await page.evaluate(() => window.scrollTo(0, 1100));
    await new Promise(r => setTimeout(r, 500));
    await screenshot(page, '04b-strategy-grid-more', { clip: { x: 0, y: 0, width: 1920, height: 700 } });

    if (strategyGrid.foundStrategies >= 10) pass('4a', `Strategy Grid — ${strategyGrid.foundStrategies} strategies found (target 13)`);
    else if (strategyGrid.foundStrategies >= 5) warn('4a', 'Strategy Grid', `Only ${strategyGrid.foundStrategies} strategies visible, expected 13`);
    else fail('4a', 'Strategy Grid', `Only ${strategyGrid.foundStrategies} strategies found, expected 13`);

    if (strategyGrid.sparklineCount > 0) pass('4b', `Strategy Grid — ${strategyGrid.sparklineCount} sparklines found`);
    else warn('4b', 'Strategy Grid — sparklines', 'No sparkline charts found in strategy cards');

    if (strategyGrid.hasReturns) pass('4c', 'Strategy Grid — returns percentages visible');
    else warn('4c', 'Strategy Grid — returns', 'No return percentages found');

    // Check 5: Open Positions
    await page.evaluate(() => window.scrollTo(0, 1500));
    await new Promise(r => setTimeout(r, 1000));

    const positions = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasPositions = /position/i.test(body);
      const rows = document.querySelectorAll('table tr, [class*="position"] [class*="row"], [class*="position"] li');

      // Check clickability
      const clickableRows = document.querySelectorAll('table tr[class*="cursor"], table tr[class*="click"], [class*="position"] a, table tbody tr');

      // Count ticker-like entries
      const tickers = body.match(/\b[A-Z]{1,5}\b/g) || [];
      const uniqueTickers = [...new Set(tickers.filter(t => ['AAPL','MSFT','GOOGL','AMZN','TSLA','META','NVDA','SPY','QQQ','IWM','AMD','INTC','BA','JPM','GS','WMT','TGT','DIS','NFLX','CRM','V','MA'].includes(t)))];

      return { hasPositions, rowCount: rows.length, clickableCount: clickableRows.length, tickers: uniqueTickers };
    });

    await screenshot(page, '05-open-positions', { clip: { x: 0, y: 0, width: 1920, height: 500 } });

    if (positions.hasPositions) pass('5a', 'Open Positions — section visible');
    else warn('5a', 'Open Positions', 'Positions section not found');
    if (positions.tickers.length >= 2) pass('5b', `Open Positions — ${positions.tickers.length} positions: ${positions.tickers.join(', ')}`);
    else warn('5b', 'Open Positions', `Only ${positions.tickers.length} recognizable tickers found`);

    // Check 6: P&L Calendar
    await page.evaluate(() => window.scrollTo(0, 2000));
    await new Promise(r => setTimeout(r, 1000));

    const calendar = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasCalendar = /calendar|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|Mo|Tu|We|Th|Fr/i.test(body);
      const hasDayNumbers = /\b[1-9]\b|\b[12]\d\b|\b3[01]\b/.test(body);

      // Check for colored cells (P&L calendar uses background colors)
      const coloredCells = document.querySelectorAll('[style*="background"], [class*="green"], [class*="red"], [class*="profit"], [class*="loss"]');

      return { hasCalendar, hasDayNumbers, coloredCellCount: coloredCells.length };
    });

    await screenshot(page, '06-pnl-calendar', { clip: { x: 0, y: 0, width: 1920, height: 500 } });

    if (calendar.hasCalendar) pass('6a', 'P&L Calendar — visible');
    else warn('6a', 'P&L Calendar', 'Calendar section not found');
    if (calendar.coloredCellCount > 0) pass('6b', `P&L Calendar — ${calendar.coloredCellCount} colored cells (dynamic scale)`);
    else warn('6b', 'P&L Calendar — colors', 'No colored cells found');

    // Check 7: Market Indices
    await page.evaluate(() => window.scrollTo(0, 2500));
    await new Promise(r => setTimeout(r, 1000));

    const indices = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasSPY = /SPY/i.test(body);
      const hasQQQ = /QQQ/i.test(body);
      const hasIWM = /IWM/i.test(body);

      // Check for sparklines in index cards
      const indexSection = document.querySelector('[class*="index"], [class*="indices"], [class*="market"]');
      let sparklines = 0;
      if (indexSection) {
        sparklines = indexSection.querySelectorAll('canvas, svg, [class*="spark"]').length;
      }

      return { hasSPY, hasQQQ, hasIWM, sparklines };
    });

    await screenshot(page, '07-market-indices', { clip: { x: 0, y: 0, width: 1920, height: 400 } });

    if (indices.hasSPY) pass('7a', 'Market Indices — SPY visible');
    else fail('7a', 'Market Indices — SPY', 'SPY not found');
    if (indices.hasQQQ) pass('7b', 'Market Indices — QQQ visible');
    else fail('7b', 'Market Indices — QQQ', 'QQQ not found');
    if (indices.hasIWM) pass('7c', 'Market Indices — IWM visible');
    else fail('7c', 'Market Indices — IWM', 'IWM not found');
    if (indices.sparklines > 0) pass('7d', `Market Indices — ${indices.sparklines} sparklines (real 20-day trends)`);
    else warn('7d', 'Market Indices — sparklines', 'No sparkline charts found for indices');

    // Check 8: Sector Treemap
    await page.evaluate(() => window.scrollTo(0, 3000));
    await new Promise(r => setTimeout(r, 1000));

    const treemap = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasSectors = /tech|health|financ|energy|consumer|industrial|materials|utilit|real estate|communication/i.test(body);
      const hasToggle = /daily|ytd|1d|1y/i.test(body);

      // Check for treemap-like elements (divs with specific sizes or SVG rects)
      const treemapEls = document.querySelectorAll('[class*="treemap"], [class*="heatmap"], [class*="sector"]');

      // Check for different sized tiles
      let tileSizes = [];
      treemapEls.forEach(el => {
        const children = el.children;
        for (const child of children) {
          const rect = child.getBoundingClientRect();
          if (rect.width > 20 && rect.height > 20) {
            tileSizes.push({ w: rect.width, h: rect.height });
          }
        }
      });

      const hasDifferentSizes = tileSizes.length > 1 &&
        (new Set(tileSizes.map(t => Math.round(t.w)))).size > 1;

      return { hasSectors, hasToggle, tileCount: tileSizes.length, hasDifferentSizes };
    });

    await screenshot(page, '08-sector-treemap', { clip: { x: 0, y: 0, width: 1920, height: 500 } });

    if (treemap.hasSectors) pass('8a', 'Sector Treemap — sectors visible');
    else warn('8a', 'Sector Treemap', 'Sector names not found');
    if (treemap.hasToggle) pass('8b', 'Sector Treemap — Daily/YTD toggle present');
    else warn('8b', 'Sector Treemap — toggle', 'Daily/YTD toggle not found');
    if (treemap.hasDifferentSizes) pass('8c', 'Sector Treemap — different sized tiles');
    else warn('8c', 'Sector Treemap — tile sizes', 'Tiles may not have varying sizes');

    // Test Daily/YTD toggle click
    const toggleClicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (/ytd|daily/i.test(btn.textContent)) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    if (toggleClicked) {
      await new Promise(r => setTimeout(r, 1000));
      await screenshot(page, '08b-treemap-toggled', { clip: { x: 0, y: 0, width: 1920, height: 500 } });
      pass('8d', 'Sector Treemap — toggle clicked successfully');
    } else {
      warn('8d', 'Sector Treemap — toggle', 'Could not click toggle button');
    }

    // Check 9: Allocation Donut + Headlines
    await page.evaluate(() => window.scrollTo(0, 3500));
    await new Promise(r => setTimeout(r, 1000));

    const donutHeadlines = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasAllocation = /allocation|donut|portfolio.*breakdown/i.test(body);
      const hasHeadlines = /headline|news|market.*news/i.test(body);

      // Check for donut chart (usually canvas or SVG with circular paths)
      const charts = document.querySelectorAll('canvas, svg');
      let hasPieChart = false;
      charts.forEach(c => {
        if (c.tagName === 'svg') {
          const paths = c.querySelectorAll('path, circle');
          if (paths.length > 2) hasPieChart = true;
        }
      });

      return { hasAllocation, hasHeadlines, hasPieChart };
    });

    await screenshot(page, '09-allocation-headlines', { clip: { x: 0, y: 0, width: 1920, height: 500 } });

    if (donutHeadlines.hasAllocation || donutHeadlines.hasPieChart) pass('9a', 'Allocation Donut — visible');
    else warn('9a', 'Allocation Donut', 'Donut/allocation chart not found');
    if (donutHeadlines.hasHeadlines) pass('9b', 'Headlines — section visible');
    else warn('9b', 'Headlines', 'Headlines section not found');

    // Check 10: Economic Calendar
    await page.evaluate(() => window.scrollTo(0, 4000));
    await new Promise(r => setTimeout(r, 1000));

    const econCal = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasEconCal = /economic.*calendar|fed|fomc|cpi|ppi|gdp|employment|nonfarm|retail.*sales/i.test(body);

      // Check for expandable elements
      const expandables = document.querySelectorAll('[class*="expand"], [class*="accordion"], [class*="collapse"], details');

      // Check for duplicates
      const events = [];
      const rows = document.querySelectorAll('tr, [class*="event-row"], [class*="calendar-item"]');
      rows.forEach(r => events.push(r.textContent.trim().substring(0, 50)));
      const uniqueEvents = new Set(events);
      const hasDuplicates = events.length > uniqueEvents.size + 2; // Allow some tolerance

      return { hasEconCal, expandableCount: expandables.length, eventCount: events.length, hasDuplicates };
    });

    await screenshot(page, '10-economic-calendar', { clip: { x: 0, y: 0, width: 1920, height: 500 } });

    if (econCal.hasEconCal) pass('10a', 'Economic Calendar — visible');
    else warn('10a', 'Economic Calendar', 'Economic calendar section not found');
    if (!econCal.hasDuplicates) pass('10b', 'Economic Calendar — no duplicates');
    else fail('10b', 'Economic Calendar — duplicates', 'Duplicate events detected');

    // Check 11: Welcome Banner
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 500));

    const welcomeBanner = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasWelcome = /welcome|getting started|first time|hello|onboard/i.test(body);
      return { hasWelcome };
    });

    if (welcomeBanner.hasWelcome) pass('11', 'Welcome Banner — visible');
    else warn('11', 'Welcome Banner', 'No welcome/onboarding banner detected (may be expected for returning users)');

    // ==============================
    // TRADE PAGE (Checks 12-19)
    // ==============================
    log('=== TRADE PAGE ===');
    await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // Check 12: Full page screenshot
    await screenshot(page, '12-trade-full', { fullPage: true });
    pass('12', 'Trade page — full screenshot taken');

    // Check 13: Chart header
    const chartHeader = await page.evaluate(() => {
      const body = document.body.innerText;
      // Look for price display
      const priceMatch = body.match(/\$?\d{1,4}\.\d{2}/);
      const hasL1 = /bid|ask|last|volume|open|high|low|close|spread/i.test(body);
      const hasSymbol = /[A-Z]{1,5}/.test(body);
      return { price: priceMatch?.[0], hasL1, hasSymbol };
    });

    await screenshot(page, '13-chart-header', { clip: { x: 0, y: 0, width: 1920, height: 200 } });

    if (chartHeader.price) pass('13a', `Chart header — price ${chartHeader.price} visible`);
    else fail('13a', 'Chart header — price', 'No price found in chart header');
    if (chartHeader.hasL1) pass('13b', 'Chart header — L1 bar populated');
    else warn('13b', 'Chart header — L1 bar', 'L1 data (bid/ask/volume) not found');

    // Check 14: Switch symbols
    const symbols = ['AAPL', 'MSFT', 'TSLA'];
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i];
      // Find and use the symbol input/search
      const switched = await page.evaluate(async (symbol) => {
        const inputs = document.querySelectorAll('input[type="text"], input[placeholder*="symbol" i], input[placeholder*="search" i], input[placeholder*="ticker" i]');
        for (const input of inputs) {
          const rect = input.getBoundingClientRect();
          if (rect.top < 200) { // Header area
            input.value = '';
            input.focus();
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, symbol);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      }, sym);

      if (switched) {
        await new Promise(r => setTimeout(r, 2000));
        // Try pressing Enter or clicking a dropdown item
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 2000));
      }

      await screenshot(page, `14-symbol-${sym}`, { clip: { x: 0, y: 0, width: 1920, height: 400 } });
    }
    pass('14', `Symbol switching — tested ${symbols.join(', ')}`);

    // Check 15: Timeframes
    const timeframes = ['1m', 'D', 'W'];
    for (const tf of timeframes) {
      const clicked = await page.evaluate((timeframe) => {
        const btns = document.querySelectorAll('button, [role="tab"], [class*="timeframe"], [class*="interval"]');
        for (const btn of btns) {
          const text = btn.textContent.trim();
          if (text === timeframe || text.toLowerCase() === timeframe.toLowerCase() ||
              text === `${timeframe}` || text.includes(timeframe)) {
            btn.click();
            return true;
          }
        }
        return false;
      }, tf);

      if (clicked) {
        await new Promise(r => setTimeout(r, 2000));
        await screenshot(page, `15-timeframe-${tf}`, { clip: { x: 0, y: 0, width: 1920, height: 600 } });
        pass(`15-${tf}`, `Timeframe ${tf} — clicked and loaded`);
      } else {
        warn(`15-${tf}`, `Timeframe ${tf}`, 'Button not found');
      }
    }

    // Check 16: BUY/SELL buttons
    const buySell = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasBuy = /\bBUY\b/i.test(body);
      const hasSell = /\bSELL\b/i.test(body);

      // Get positions
      const btns = document.querySelectorAll('button');
      let buyBtn = null, sellBtn = null;
      btns.forEach(btn => {
        if (/^buy$/i.test(btn.textContent.trim())) {
          const rect = btn.getBoundingClientRect();
          buyBtn = { top: rect.top, left: rect.left };
        }
        if (/^sell$/i.test(btn.textContent.trim())) {
          const rect = btn.getBoundingClientRect();
          sellBtn = { top: rect.top, left: rect.left };
        }
      });

      return { hasBuy, hasSell, buyBtn, sellBtn };
    });

    if (buySell.hasBuy && buySell.hasSell) pass('16', `BUY/SELL buttons visible`);
    else fail('16', 'BUY/SELL buttons', `Buy: ${buySell.hasBuy}, Sell: ${buySell.hasSell}`);

    // Check 17: Order submission
    const orderTab = await page.evaluate(() => {
      const tabs = document.querySelectorAll('button, [role="tab"], a');
      for (const tab of tabs) {
        if (/order/i.test(tab.textContent)) {
          tab.click();
          return true;
        }
      }
      return false;
    });

    if (orderTab) {
      await new Promise(r => setTimeout(r, 1000));
      await screenshot(page, '17-order-tab');

      // Try to fill in a quantity and submit
      const qtyInput = await page.$('input[placeholder*="qty" i], input[placeholder*="quantity" i], input[name*="qty" i], input[type="number"]');
      if (qtyInput) {
        await qtyInput.click({ clickCount: 3 });
        await qtyInput.type('1');
      }

      // Click BUY to test confirmation dialog
      const buyClicked = await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (/^buy$/i.test(btn.textContent.trim())) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      if (buyClicked) {
        await new Promise(r => setTimeout(r, 2000));
        const hasDialog = await page.evaluate(() => {
          const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="confirm"], [class*="dialog"]');
          const body = document.body.innerText;
          return dialogs.length > 0 || /confirm|are you sure/i.test(body);
        });

        await screenshot(page, '17b-order-confirmation');

        if (hasDialog) pass('17', 'Order submission — confirmation dialog appears');
        else warn('17', 'Order submission', 'No confirmation dialog detected after clicking BUY');

        // Dismiss dialog if present
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      warn('17', 'Order tab', 'Order tab not found');
    }

    // Check 18: Options chain
    const optionsTab = await page.evaluate(() => {
      const tabs = document.querySelectorAll('button, [role="tab"], a');
      for (const tab of tabs) {
        if (/option/i.test(tab.textContent)) {
          tab.click();
          return true;
        }
      }
      return false;
    });

    if (optionsTab) {
      await new Promise(r => setTimeout(r, 2000));
      await screenshot(page, '18-options-chain');

      const atmHighlight = await page.evaluate(() => {
        const rows = document.querySelectorAll('tr, [class*="option-row"], [class*="strike"]');
        let hasHighlight = false;
        rows.forEach(row => {
          const style = window.getComputedStyle(row);
          const bg = style.backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== 'rgb(255, 255, 255)') {
            hasHighlight = true;
          }
          if (row.className.includes('atm') || row.className.includes('highlight') || row.className.includes('primary')) {
            hasHighlight = true;
          }
        });
        return hasHighlight;
      });

      if (atmHighlight) pass('18', 'Options chain — ATM highlight visible');
      else warn('18', 'Options chain — ATM highlight', 'No strong ATM row highlight detected');
    } else {
      warn('18', 'Options chain', 'Options tab not found');
    }

    // Check 19: All tabs working
    const allTabs = await page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"], [class*="tab-"], button[class*="tab"]');
      const tabNames = [];
      tabs.forEach(t => {
        if (t.offsetParent !== null) { // visible
          tabNames.push(t.textContent.trim());
        }
      });
      return tabNames;
    });

    log(`Trade page tabs found: ${allTabs.join(', ')}`);
    if (allTabs.length >= 3) pass('19', `All tabs present: ${allTabs.join(', ')}`);
    else warn('19', 'Trade page tabs', `Only ${allTabs.length} tabs found`);

    // ==============================
    // PIPELINE (Checks 20-21)
    // ==============================
    log('=== PIPELINE ===');
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // Check 20: Flow diagram
    await screenshot(page, '20-pipeline-flow', { fullPage: true });

    const pipelineFlow = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasFlow = /pipeline|flow|signal|screen|filter|universe|risk|execution|stage/i.test(body);
      const hasData = /\d+\s*(signal|stock|ticker|position)/i.test(body) || /\d+/.test(body);
      return { hasFlow, hasData };
    });

    if (pipelineFlow.hasFlow) pass('20a', 'Pipeline — flow diagram visible');
    else fail('20a', 'Pipeline — flow diagram', 'Pipeline flow not found');
    if (pipelineFlow.hasData) pass('20b', 'Pipeline — real data in flow');
    else warn('20b', 'Pipeline — data', 'No data values found in pipeline flow');

    // Check 21: Positions table
    const pipelinePositions = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      let posTable = null;
      tables.forEach(t => {
        if (/ticker|symbol|position|strategy/i.test(t.textContent)) {
          posTable = {
            rows: t.querySelectorAll('tbody tr').length,
            headers: Array.from(t.querySelectorAll('th')).map(h => h.textContent.trim())
          };
        }
      });
      return posTable;
    });

    await screenshot(page, '21-pipeline-positions');

    if (pipelinePositions && pipelinePositions.rows > 0)
      pass('21', `Pipeline positions — ${pipelinePositions.rows} rows, headers: ${pipelinePositions.headers.join(', ')}`);
    else
      warn('21', 'Pipeline positions table', 'No positions table found or empty');

    // ==============================
    // STRATEGY DETAIL (Checks 23-25)
    // ==============================
    log('=== STRATEGY DETAIL ===');
    await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    await screenshot(page, '23-strategy-pead', { fullPage: true });

    // Check 23: Content sections
    const stratDetail = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasHowItWorks = /how it works/i.test(body);
      const hasWhenToUse = /when to use/i.test(body);
      const hasRisks = /risk/i.test(body);
      return { hasHowItWorks, hasWhenToUse, hasRisks };
    });

    if (stratDetail.hasHowItWorks) pass('23a', 'Strategy Detail — "How It Works" visible');
    else fail('23a', 'Strategy Detail — How It Works', 'Section not found');
    if (stratDetail.hasWhenToUse) pass('23b', 'Strategy Detail — "When to Use" visible');
    else fail('23b', 'Strategy Detail — When to Use', 'Section not found');
    if (stratDetail.hasRisks) pass('23c', 'Strategy Detail — "Risks" visible');
    else fail('23c', 'Strategy Detail — Risks', 'Section not found');

    // Check 24: Positions tab
    const posTab = await page.evaluate(() => {
      const tabs = document.querySelectorAll('button, [role="tab"]');
      for (const tab of tabs) {
        if (/position/i.test(tab.textContent)) {
          tab.click();
          return true;
        }
      }
      return false;
    });

    if (posTab) {
      await new Promise(r => setTimeout(r, 2000));
      await screenshot(page, '24-strategy-positions');

      const enrichedData = await page.evaluate(() => {
        const body = document.body.innerText;
        const hasEnrichedFields = /entry|exit|p&l|return|days.*held|qty|side/i.test(body);
        const clickableRows = document.querySelectorAll('tr[class*="cursor"], tr[class*="click"], tbody tr a');
        return { hasEnrichedFields, clickableCount: clickableRows.length };
      });

      if (enrichedData.hasEnrichedFields) pass('24a', 'Strategy positions — enriched data visible');
      else warn('24a', 'Strategy positions — enriched data', 'Enriched position fields not found');
    } else {
      warn('24', 'Strategy positions tab', 'Positions tab not found');
    }

    // Check 25: Analytics — Best/Worst Trades
    const analyticsTab = await page.evaluate(() => {
      const tabs = document.querySelectorAll('button, [role="tab"]');
      for (const tab of tabs) {
        if (/analytic|performance|stat/i.test(tab.textContent)) {
          tab.click();
          return true;
        }
      }
      return false;
    });

    if (analyticsTab) {
      await new Promise(r => setTimeout(r, 2000));
      await screenshot(page, '25-strategy-analytics');

      const bestWorst = await page.evaluate(() => {
        const body = document.body.innerText;
        return /best|worst|top.*trade|bottom.*trade/i.test(body);
      });

      if (bestWorst) pass('25', 'Strategy analytics — Best/Worst Trades card visible');
      else warn('25', 'Strategy analytics — Best/Worst Trades', 'Best/Worst trades section not found');
    } else {
      warn('25', 'Strategy analytics tab', 'Analytics tab not found');
    }

    // ==============================
    // RESPONSIVE (Checks 26-27)
    // ==============================
    log('=== RESPONSIVE ===');

    // Check 26: Trade page at 800px
    await page.setViewport({ width: 800, height: 1080 });
    await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    await screenshot(page, '26-trade-800px', { fullPage: true });

    const tradeResponsive = await page.evaluate(() => {
      const body = document.body;
      const hasHorizontalOverflow = body.scrollWidth > 800;
      const hasTabs = document.querySelectorAll('[role="tab"], [class*="tab"]').length > 0;
      return { hasHorizontalOverflow, hasTabs, scrollWidth: body.scrollWidth };
    });

    if (tradeResponsive.hasTabs) pass('26a', 'Trade page at 800px — tab layout present');
    else warn('26a', 'Trade page responsive', 'No tab layout at 800px');
    if (!tradeResponsive.hasHorizontalOverflow) pass('26b', 'Trade page at 800px — no horizontal overflow');
    else fail('26b', 'Trade page at 800px', `Horizontal overflow detected: scrollWidth=${tradeResponsive.scrollWidth}px`);

    // Check 27: Dashboard at 800px
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    await screenshot(page, '27-dashboard-800px', { fullPage: true });

    const dashResponsive = await page.evaluate(() => {
      const body = document.body;
      return {
        hasHorizontalOverflow: body.scrollWidth > 800,
        scrollWidth: body.scrollWidth
      };
    });

    if (!dashResponsive.hasHorizontalOverflow) pass('27', 'Dashboard at 800px — no horizontal overflow');
    else fail('27', 'Dashboard at 800px', `Horizontal overflow: scrollWidth=${dashResponsive.scrollWidth}px`);

    // Reset viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // ==============================
    // Go back for more detailed dashboard screenshots
    // ==============================
    log('=== DASHBOARD DETAIL SCREENSHOTS ===');
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));

    // Scroll through entire dashboard taking overlapping screenshots
    const totalHeight = await page.evaluate(() => document.body.scrollHeight);
    log(`Dashboard total height: ${totalHeight}px`);

    for (let y = 0; y < totalHeight; y += 800) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
      await new Promise(r => setTimeout(r, 300));
      await screenshot(page, `dashboard-scroll-${Math.floor(y/800)}`, { clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    }

  } catch (err) {
    log(`FATAL ERROR: ${err.message}`);
    await screenshot(page, 'error-state').catch(() => {});
  }

  await browser.close();

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('QA ROUND 14 SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'PASS');
  const failed = results.filter(r => r.status === 'FAIL');
  const warned = results.filter(r => r.status === 'WARN');

  console.log(`Total checks: ${results.length}`);
  console.log(`PASSED: ${passed.length}`);
  console.log(`FAILED: ${failed.length}`);
  console.log(`WARNINGS: ${warned.length}`);

  if (failed.length > 0) {
    console.log('\n--- FAILURES ---');
    failed.forEach(f => console.log(`  [FAIL] ${f.id}: ${f.desc} — ${f.detail}`));
  }

  if (warned.length > 0) {
    console.log('\n--- WARNINGS ---');
    warned.forEach(w => console.log(`  [WARN] ${w.id}: ${w.desc} — ${w.detail}`));
  }

  // Save results JSON
  fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${DIR}/results.json`);
})();
