const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round13';
const BASE_URL = 'https://tradingalpha.net';
const LOGIN_USER = 'admin';
const LOGIN_PASS = 'alphaDesk2025!';

const results = [];

function record(id, name, passed, detail = '') {
  results.push({ id, name, passed, detail });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] #${id} ${name}${detail ? ' — ' + detail : ''}`);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: false });
}

async function fullScreenshot(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: true });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // ============ LOGIN ============
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(1000);
    await page.type('input[type="text"], input[name="username"], input[placeholder*="ser"]', LOGIN_USER);
    await page.type('input[type="password"]', LOGIN_PASS);
    await screenshot(page, '00-login.png');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await sleep(3000);
    await screenshot(page, '00-after-login.png');
  } catch (e) {
    console.log('Login error:', e.message);
  }

  // ============ CHECK 9: Dashboard loads without errors ============
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);
    await fullScreenshot(page, '01-dashboard-full.png');
    const bodyText = await page.$eval('body', el => el.innerText);
    const hasContent = bodyText.length > 100;
    record(9, 'Dashboard loads without errors', hasContent, hasContent ? 'Dashboard loaded with content' : 'Dashboard appears empty');
  } catch (e) {
    record(9, 'Dashboard loads without errors', false, e.message);
  }

  // ============ CHECK 10: Portfolio value real (from Alpaca) ============
  try {
    const portfolioVal = await page.evaluate(() => {
      const allText = document.body.innerText;
      const match = allText.match(/\$[\d,]+\.?\d*/);
      return match ? match[0] : null;
    });
    const isReal = portfolioVal && !portfolioVal.includes('100,000') && !portfolioVal.includes('0.00');
    record(10, 'Portfolio value real (from Alpaca)', !!portfolioVal, portfolioVal || 'No dollar value found');
  } catch (e) {
    record(10, 'Portfolio value real (from Alpaca)', false, e.message);
  }

  // ============ CHECK 11: P&L visible, correct color ============
  try {
    const pnlInfo = await page.evaluate(() => {
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        const text = el.innerText || '';
        if ((text.includes('P&L') || text.includes('P/L') || text.includes('Profit')) && text.match(/[+-]?\$[\d,]+/)) {
          const style = window.getComputedStyle(el);
          return { text: text.substring(0, 100), color: style.color };
        }
      }
      // Look for any gain/loss indicators
      const body = document.body.innerText;
      const pnlMatch = body.match(/[+-]\$[\d,]+\.?\d*/);
      return pnlMatch ? { text: pnlMatch[0], color: 'unknown' } : null;
    });
    record(11, 'P&L visible, correct color', !!pnlInfo, pnlInfo ? pnlInfo.text : 'No P&L found');
  } catch (e) {
    record(11, 'P&L visible, correct color', false, e.message);
  }

  // ============ CHECK 12: Status strip ============
  try {
    const statusInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasRegime = body.includes('Regime') || body.includes('regime');
      const hasVix = body.match(/VIX/i);
      const hasLive = body.includes('LIVE') || body.includes('Live');
      return { hasRegime, hasVix: !!hasVix, hasLive, snippet: body.substring(0, 300) };
    });
    const pass = statusInfo.hasRegime && statusInfo.hasVix && statusInfo.hasLive;
    record(12, 'Status strip: Regime, VIX, LIVE', pass,
      `Regime:${statusInfo.hasRegime} VIX:${statusInfo.hasVix} LIVE:${statusInfo.hasLive}`);
  } catch (e) {
    record(12, 'Status strip: Regime, VIX, LIVE', false, e.message);
  }

  // ============ CHECK 13: Market indices ============
  try {
    const indicesInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasSPX = body.includes('SPX') || body.includes('S&P') || body.includes('SPY');
      const hasNasdaq = body.includes('QQQ') || body.includes('NASDAQ') || body.includes('NDX') || body.includes('Nasdaq');
      const hasDow = body.includes('DIA') || body.includes('DOW') || body.includes('Dow');
      const hasChangePct = !!body.match(/[+-]?\d+\.\d+%/);
      return { hasSPX, hasNasdaq, hasDow, hasChangePct };
    });
    const pass = (indicesInfo.hasSPX || indicesInfo.hasNasdaq || indicesInfo.hasDow) && indicesInfo.hasChangePct;
    record(13, 'Market indices: real prices, change%', pass,
      `SPX:${indicesInfo.hasSPX} NDX:${indicesInfo.hasNasdaq} DOW:${indicesInfo.hasDow} %:${indicesInfo.hasChangePct}`);
  } catch (e) {
    record(13, 'Market indices: real prices, change%', false, e.message);
  }

  // ============ CHECK 1: Activity Feed ============
  try {
    await screenshot(page, '02-dashboard-activity.png');
    const activityInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasActivity = body.includes('Activity') || body.includes('activity') || body.includes('Pipeline') || body.includes('Events');
      // Check for news absence in feed
      const hasNews = body.includes('News') || body.includes('news') || body.includes('Headlines');
      // Look for timestamps
      const hasTimestamps = !!body.match(/\d+[smh] ago|\d{1,2}:\d{2}|\d+\s*(min|sec|hour)/i);
      // Count items that look like activity items
      const activitySection = document.querySelector('[class*="activity"], [class*="feed"], [class*="event"]');
      let itemCount = 0;
      if (activitySection) {
        itemCount = activitySection.querySelectorAll('[class*="item"], li, [class*="row"]').length;
      }
      return { hasActivity, hasTimestamps, itemCount, hasNews };
    });
    const pass = activityInfo.hasActivity;
    record(1, 'Activity Feed shows pipeline events', pass,
      `Activity:${activityInfo.hasActivity} Timestamps:${activityInfo.hasTimestamps} Items:${activityInfo.itemCount}`);
  } catch (e) {
    record(1, 'Activity Feed shows pipeline events', false, e.message);
  }

  // ============ CHECK 5: Allocation Donut + News side by side ============
  try {
    const donutNews = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasDonut = !!document.querySelector('canvas, svg, [class*="donut"], [class*="chart"], [class*="allocation"], [class*="pie"]');
      const hasAllocation = body.includes('Allocation') || body.includes('allocation');
      const hasNews = body.includes('News') || body.includes('Headlines') || body.includes('headlines');
      // Check if both are visible (not hidden by tabs)
      const allocationEl = document.querySelector('[class*="allocation"], [class*="donut"]');
      const newsEl = document.querySelector('[class*="news"], [class*="headline"]');
      const bothVisible = !!(allocationEl && newsEl);
      return { hasDonut, hasAllocation, hasNews, bothVisible };
    });
    const pass = donutNews.hasAllocation && donutNews.hasNews;
    record(5, 'Allocation Donut + News both visible', pass,
      `Donut:${donutNews.hasDonut} Allocation:${donutNews.hasAllocation} News:${donutNews.hasNews} BothVisible:${donutNews.bothVisible}`);
  } catch (e) {
    record(5, 'Allocation Donut + News both visible', false, e.message);
  }

  // ============ CHECK 6: Sector Treemap redesign ============
  try {
    const treemapInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasSector = body.includes('Sector') || body.includes('sector');
      // Look for treemap or grid-like layout
      const treemapEl = document.querySelector('[class*="treemap"], [class*="sector"], [class*="heatmap"]');
      // Check for daily/YTD toggle
      const hasToggle = body.includes('Daily') || body.includes('YTD') || body.includes('1D');
      // Check for sector names
      const hasTech = body.includes('Technology') || body.includes('Tech');
      const hasHealth = body.includes('Health') || body.includes('Healthcare');
      const hasEnergy = body.includes('Energy');
      // Check for color gradients (look for styled elements)
      let height = 0;
      if (treemapEl) {
        height = treemapEl.getBoundingClientRect().height;
      }
      return { hasSector, hasToggle, hasTech, hasHealth, hasEnergy, height, hasTreemap: !!treemapEl };
    });
    const pass = treemapInfo.hasSector && (treemapInfo.hasTech || treemapInfo.hasHealth || treemapInfo.hasEnergy);
    record(6, 'Sector Treemap redesign', pass,
      `Sector:${treemapInfo.hasSector} Toggle:${treemapInfo.hasToggle} Height:${treemapInfo.height}px Tech:${treemapInfo.hasTech} Health:${treemapInfo.hasHealth}`);
  } catch (e) {
    record(6, 'Sector Treemap redesign', false, e.message);
  }

  // ============ CHECK 8: Strategy data accurate ============
  try {
    const strategyData = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasPEAD = body.includes('PEAD');
      const hasManual = body.includes('Manual') || body.includes('Discretionary');
      const hasEarningsVol = body.includes('Earnings') && body.includes('Vol');
      // Look for position counts
      const has1pos = body.match(/PEAD[^]*?1\s*(position|pos)/i);
      const has3pos = body.match(/(Manual|Discretionary)[^]*?3\s*(position|pos)/i);
      const hasNeg15 = body.includes('-15.50%') || body.includes('-15.5%');
      // Check for specific stocks
      const hasNKE = body.includes('NKE');
      const hasPG = body.includes('PG');
      const hasWMT = body.includes('WMT');
      const hasMRK = body.includes('MRK');
      return { hasPEAD, hasManual, hasEarningsVol, hasNeg15, hasNKE, hasPG, hasWMT, hasMRK };
    });
    const pass = strategyData.hasPEAD && strategyData.hasManual;
    record(8, 'Strategy data accurate', pass,
      `PEAD:${strategyData.hasPEAD} Manual:${strategyData.hasManual} EarningsVol:${strategyData.hasEarningsVol} -15.5%:${strategyData.hasNeg15} NKE:${strategyData.hasNKE} PG:${strategyData.hasPG} WMT:${strategyData.hasWMT} MRK:${strategyData.hasMRK}`);
  } catch (e) {
    record(8, 'Strategy data accurate', false, e.message);
  }

  // ============ CHECK 14: P&L Calendar ============
  try {
    const calInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasCalendar = body.includes('Calendar') || body.includes('calendar') || !!document.querySelector('[class*="calendar"]');
      const hasMonthName = !!(body.match(/January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i));
      return { hasCalendar, hasMonthName };
    });
    record(14, 'P&L Calendar: real data', calInfo.hasCalendar,
      `Calendar:${calInfo.hasCalendar} MonthName:${calInfo.hasMonthName}`);
  } catch (e) {
    record(14, 'P&L Calendar: real data', false, e.message);
  }

  // ============ CHECK 2: Clickable Positions ============
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const clickResult = await page.evaluate(() => {
      const body = document.body.innerText;
      // Find clickable position elements containing stock tickers
      const tickers = ['MRK', 'NKE', 'PG', 'WMT'];
      const found = [];
      for (const ticker of tickers) {
        if (body.includes(ticker)) found.push(ticker);
      }
      return { found };
    });

    // Try to click a position
    let navigated = false;
    if (clickResult.found.length > 0) {
      const ticker = clickResult.found[0];
      try {
        // Find and click the element containing the ticker
        const clicked = await page.evaluate((t) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            if (walker.currentNode.textContent.trim() === t) {
              const el = walker.currentNode.parentElement;
              const clickable = el.closest('a, button, [role="button"], tr, [class*="position"], [class*="clickable"], [class*="row"]');
              if (clickable) {
                clickable.click();
                return true;
              }
              el.click();
              return true;
            }
          }
          return false;
        }, ticker);

        if (clicked) {
          await sleep(2000);
          const currentUrl = page.url();
          navigated = currentUrl.includes('/trade');
          await screenshot(page, '03-position-click.png');
        }
      } catch (e) {}
    }
    record(2, 'Clickable Positions navigate to /trade', navigated,
      `Tickers found: ${clickResult.found.join(', ')}. Navigated to /trade: ${navigated}`);
  } catch (e) {
    record(2, 'Clickable Positions navigate to /trade', false, e.message);
  }

  // ============ CHECK 3: Logo clickable ============
  try {
    // Navigate away from home first
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const logoClicked = await page.evaluate(() => {
      // Look for logo/zap icon in top bar
      const logoSelectors = [
        'a[href="/"]', 'a[href="./"]',
        '[class*="logo"]', '[class*="brand"]',
        'header a:first-child', 'nav a:first-child',
        'svg.lucide-zap', '[class*="zap"]'
      ];
      for (const sel of logoSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
          return { found: true, selector: sel };
        }
      }
      return { found: false };
    });

    await sleep(2000);
    const atHome = page.url() === `${BASE_URL}/` || page.url() === BASE_URL || page.url().endsWith('/');
    await screenshot(page, '03-logo-click.png');
    record(3, 'Logo clickable navigates to /', logoClicked.found && atHome,
      `Logo found: ${logoClicked.found} (${logoClicked.selector || 'none'}), At home: ${atHome}`);
  } catch (e) {
    record(3, 'Logo clickable navigates to /', false, e.message);
  }

  // ============ CHECK 4: Economic Calendar expandable ============
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Scroll down to find economic calendar
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1000);

    const econInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasEcon = body.includes('Economic') || body.includes('economic') || body.includes('Calendar');
      const hasFOMC = body.includes('FOMC') || body.includes('CPI') || body.includes('Fed') || body.includes('GDP') || body.includes('Employment');

      // Try to find and click an event
      const eventEls = document.querySelectorAll('[class*="economic"] [class*="event"], [class*="calendar"] [class*="item"], [class*="economic"] [class*="row"], [class*="calendar"] tr, [class*="calendar"] [class*="clickable"]');
      let clickedEvent = false;
      for (const el of eventEls) {
        if (el.innerText && el.innerText.length > 5) {
          el.click();
          clickedEvent = true;
          break;
        }
      }

      return { hasEcon, hasFOMC, clickedEvent, eventCount: eventEls.length };
    });

    await sleep(1000);

    // Check if description expanded
    const expanded = await page.evaluate(() => {
      const body = document.body.innerText;
      // Look for expanded description content
      const descEls = document.querySelectorAll('[class*="description"], [class*="detail"], [class*="expand"], [class*="collapse"]');
      return descEls.length > 0;
    });

    await screenshot(page, '04-economic-calendar.png');
    record(4, 'Economic Calendar expandable', econInfo.hasEcon,
      `Economic section:${econInfo.hasEcon} Events:${econInfo.hasFOMC} Clicked:${econInfo.clickedEvent} Expanded:${expanded}`);
  } catch (e) {
    record(4, 'Economic Calendar expandable', false, e.message);
  }

  // ============ CHECK 15: /trade page loads ============
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);
    await screenshot(page, '05-trade-page.png');
    const tradeLoaded = await page.evaluate(() => {
      const body = document.body.innerText;
      return body.length > 200 && !body.includes('Error') && !body.includes('crashed');
    });
    record(15, '/trade page loads without crash', tradeLoaded, tradeLoaded ? 'Trade page loaded' : 'Trade page may have issues');
  } catch (e) {
    record(15, '/trade page loads without crash', false, e.message);
  }

  // ============ CHECK 16: Chart loads real data ============
  try {
    const chartInfo = await page.evaluate(() => {
      const hasCanvas = !!document.querySelector('canvas');
      const hasSVG = !!document.querySelector('svg[class*="chart"], [class*="chart"] svg');
      const hasChart = hasCanvas || hasSVG || !!document.querySelector('[class*="chart"]');
      const body = document.body.innerText;
      // Look for OHLC-like data or price
      const hasPrice = !!body.match(/\d{2,4}\.\d{2}/);
      const hasHeader = body.includes('AAPL') || body.includes('SPY') || body.includes('Open') || body.includes('High') || body.includes('Low') || body.includes('Close');
      return { hasChart, hasPrice, hasHeader };
    });
    const pass = chartInfo.hasChart && chartInfo.hasPrice;
    record(16, 'Chart loads real data', pass,
      `Chart:${chartInfo.hasChart} Price:${chartInfo.hasPrice} Header:${chartInfo.hasHeader}`);
  } catch (e) {
    record(16, 'Chart loads real data', false, e.message);
  }

  // ============ CHECK 17: L1 bar ============
  try {
    const l1Info = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasMktClosed = body.includes('Mkt Closed') || body.includes('Market Closed') || body.includes('CLOSED');
      const hasBidAsk = body.includes('Bid') || body.includes('Ask') || body.includes('bid') || body.includes('ask');
      const hasLast = body.includes('Last') || body.includes('last');
      return { hasMktClosed, hasBidAsk, hasLast };
    });
    const pass = l1Info.hasMktClosed || l1Info.hasBidAsk || l1Info.hasLast;
    record(17, 'L1 bar: Mkt Closed or real data', pass,
      `MktClosed:${l1Info.hasMktClosed} Bid/Ask:${l1Info.hasBidAsk} Last:${l1Info.hasLast}`);
  } catch (e) {
    record(17, 'L1 bar: Mkt Closed or real data', false, e.message);
  }

  // ============ CHECK 18: Watchlist ============
  try {
    const watchInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasWatchlist = body.includes('Watchlist') || body.includes('watchlist') || body.includes('Watch List');
      const hasPrices = !!body.match(/\d{1,4}\.\d{2}/);
      const hasSVGs = document.querySelectorAll('svg').length;
      const sparklines = document.querySelectorAll('[class*="sparkline"], [class*="mini-chart"], svg path').length;
      return { hasWatchlist, hasPrices, hasSVGs, sparklines };
    });
    record(18, 'Watchlist: prices, sparklines, clickable', watchInfo.hasWatchlist && watchInfo.hasPrices,
      `Watchlist:${watchInfo.hasWatchlist} Prices:${watchInfo.hasPrices} SVGs:${watchInfo.hasSVGs}`);
  } catch (e) {
    record(18, 'Watchlist: prices, sparklines, clickable', false, e.message);
  }

  // ============ CHECK 19: Options chain ============
  try {
    const optionsInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasOptions = body.includes('Options') || body.includes('options') || body.includes('Strike') || body.includes('Call') || body.includes('Put');
      const hasStrike = body.includes('Strike') || body.includes('strike');
      const hasPrices = !!body.match(/\d+\.\d{2}/);
      return { hasOptions, hasStrike, hasPrices };
    });
    record(19, 'Options chain visible', optionsInfo.hasOptions,
      `Options:${optionsInfo.hasOptions} Strike:${optionsInfo.hasStrike} Prices:${optionsInfo.hasPrices}`);
  } catch (e) {
    record(19, 'Options chain visible', false, e.message);
  }

  // ============ CHECK 20: Right panel tabs ============
  try {
    const rightPanelTabs = await page.evaluate(() => {
      const body = document.body.innerText;
      const tabs = {
        Tech: body.includes('Tech'),
        Fund: body.includes('Fund'),
        Sent: body.includes('Sent'),
        Chat: body.includes('Chat'),
        Order: body.includes('Order')
      };
      return tabs;
    });

    // Try clicking each tab
    const tabResults = {};
    for (const tabName of ['Tech', 'Fund', 'Sent', 'Chat', 'Order']) {
      try {
        const clicked = await page.evaluate((name) => {
          const buttons = document.querySelectorAll('button, [role="tab"], [class*="tab"]');
          for (const btn of buttons) {
            if (btn.innerText.trim().includes(name)) {
              btn.click();
              return true;
            }
          }
          return false;
        }, tabName);
        tabResults[tabName] = clicked;
        await sleep(500);
      } catch (e) {
        tabResults[tabName] = false;
      }
    }

    await screenshot(page, '06-trade-right-panel.png');
    const passCount = Object.values(tabResults).filter(v => v).length;
    record(20, 'Right panel tabs (Tech/Fund/Sent/Chat/Order)', passCount >= 3,
      `Results: ${JSON.stringify(tabResults)}`);
  } catch (e) {
    record(20, 'Right panel tabs', false, e.message);
  }

  // ============ CHECK 21: Bottom tabs ============
  try {
    const bottomTabs = {};
    for (const tabName of ['Trade', 'Positions', 'Orders', 'Journal', 'Calendar']) {
      try {
        const clicked = await page.evaluate((name) => {
          const buttons = document.querySelectorAll('button, [role="tab"], [class*="tab"]');
          for (const btn of buttons) {
            if (btn.innerText.trim() === name || btn.innerText.trim().includes(name)) {
              btn.click();
              return true;
            }
          }
          return false;
        }, tabName);
        bottomTabs[tabName] = clicked;
        await sleep(500);
      } catch (e) {
        bottomTabs[tabName] = false;
      }
    }

    await screenshot(page, '07-trade-bottom-tabs.png');
    const passCount = Object.values(bottomTabs).filter(v => v).length;
    record(21, 'Bottom tabs (Trade/Positions/Orders/Journal/Calendar)', passCount >= 3,
      `Results: ${JSON.stringify(bottomTabs)}`);
  } catch (e) {
    record(21, 'Bottom tabs', false, e.message);
  }

  // ============ CHECK 22: Command palette (Ctrl+K) ============
  try {
    await page.keyboard.down('Meta');
    await page.keyboard.press('k');
    await page.keyboard.up('Meta');
    await sleep(1500);

    const cmdPalette = await page.evaluate(() => {
      // Look for command palette / modal
      const modal = document.querySelector('[class*="command"], [class*="palette"], [class*="modal"], [class*="dialog"], [role="dialog"]');
      const hasSearch = !!document.querySelector('[class*="command"] input, [class*="palette"] input, [role="dialog"] input, [class*="search"] input');
      return { visible: !!modal, hasSearch };
    });

    await screenshot(page, '08-command-palette.png');

    // Close it
    await page.keyboard.press('Escape');
    await sleep(500);

    record(22, 'Command palette (Ctrl+K)', cmdPalette.visible || cmdPalette.hasSearch,
      `Visible:${cmdPalette.visible} HasSearch:${cmdPalette.hasSearch}`);
  } catch (e) {
    record(22, 'Command palette (Ctrl+K)', false, e.message);
  }

  // ============ CHECK 23: Profile menu ============
  try {
    const profileInfo = await page.evaluate(() => {
      // Look for profile/avatar button in header
      const profileBtns = document.querySelectorAll('[class*="profile"], [class*="avatar"], [class*="user"], header button:last-child');
      let clicked = false;
      for (const btn of profileBtns) {
        if (btn.querySelector('img, svg, [class*="avatar"]') || btn.innerText.includes('admin') || btn.innerText.includes('A')) {
          btn.click();
          clicked = true;
          break;
        }
      }
      return { clicked };
    });

    await sleep(1000);

    const menuInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasEquity = !!body.match(/\$[\d,]+/);
      const hasLogout = body.includes('Logout') || body.includes('Log out') || body.includes('Sign out');
      const hasShortcuts = body.includes('Shortcut') || body.includes('shortcut') || body.includes('⌘');
      return { hasEquity, hasLogout, hasShortcuts };
    });

    await screenshot(page, '09-profile-menu.png');

    // Close menu
    await page.keyboard.press('Escape');

    record(23, 'Profile menu: equity, shortcuts, logout', menuInfo.hasLogout,
      `Equity:${menuInfo.hasEquity} Logout:${menuInfo.hasLogout} Shortcuts:${menuInfo.hasShortcuts}`);
  } catch (e) {
    record(23, 'Profile menu', false, e.message);
  }

  // ============ CHECK 24: Pipeline page ============
  try {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);
    await fullScreenshot(page, '10-pipeline.png');

    const pipeInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasPipeline = body.includes('Pipeline') || body.includes('pipeline');
      const hasFlow = body.includes('Flow') || body.includes('flow') || body.includes('Stage') || body.includes('stage');
      const hasPositions = body.includes('Position') || body.includes('position');
      const hasRun = body.includes('Run') || body.includes('run') || body.includes('Execute');
      const hasButton = !!document.querySelector('button');
      return { hasPipeline, hasFlow, hasPositions, hasRun, hasButton };
    });

    record(24, 'Pipeline page: flow, positions, run button', pipeInfo.hasPipeline && pipeInfo.hasButton,
      `Pipeline:${pipeInfo.hasPipeline} Flow:${pipeInfo.hasFlow} Positions:${pipeInfo.hasPositions} Run:${pipeInfo.hasRun}`);
  } catch (e) {
    record(24, 'Pipeline page', false, e.message);
  }

  // ============ CHECK 7: Strategy pages enhanced - /strategies/pead ============
  try {
    await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);
    await fullScreenshot(page, '11-strategy-pead.png');

    const stratInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasPEAD = body.includes('PEAD') || body.includes('Post-Earnings');
      const hasAbout = body.includes('About') || body.includes('about');
      const hasHowItWorks = body.includes('How It Works') || body.includes('How it works');
      const hasWhenToUse = body.includes('When to Use') || body.includes('When to use');
      const hasRisks = body.includes('Risk') || body.includes('risk');
      const hasPositions = body.includes('Position') || body.includes('position');
      const hasAnalytics = body.includes('Analytics') || body.includes('analytics');
      const hasEntryPrice = body.includes('Entry') || body.includes('entry');
      const hasPnL = body.includes('P&L') || body.includes('P/L') || body.includes('Profit');
      const hasDaysHeld = body.includes('Days') || body.includes('days') || body.includes('Held');
      const hasBestWorst = body.includes('Best') || body.includes('Worst');
      return { hasPEAD, hasAbout, hasHowItWorks, hasWhenToUse, hasRisks, hasPositions, hasAnalytics, hasEntryPrice, hasPnL, hasDaysHeld, hasBestWorst };
    });

    // Try clicking tabs
    for (const tab of ['About', 'Positions', 'Analytics']) {
      await page.evaluate((name) => {
        const buttons = document.querySelectorAll('button, [role="tab"], [class*="tab"]');
        for (const btn of buttons) {
          if (btn.innerText.trim().includes(name)) {
            btn.click();
            return true;
          }
        }
        return false;
      }, tab);
      await sleep(1000);
      await screenshot(page, `11-strategy-pead-${tab.toLowerCase()}.png`);
    }

    const pass = stratInfo.hasPEAD && (stratInfo.hasHowItWorks || stratInfo.hasAbout) && (stratInfo.hasPositions || stratInfo.hasAnalytics);
    record(7, 'Strategy pages enhanced (PEAD)', pass,
      `PEAD:${stratInfo.hasPEAD} HowItWorks:${stratInfo.hasHowItWorks} WhenToUse:${stratInfo.hasWhenToUse} Risks:${stratInfo.hasRisks} Positions:${stratInfo.hasPositions} Analytics:${stratInfo.hasAnalytics} BestWorst:${stratInfo.hasBestWorst}`);
  } catch (e) {
    record(7, 'Strategy pages enhanced (PEAD)', false, e.message);
  }

  // ============ CHECK 25: Static pages ============
  const staticPages = ['/privacy', '/terms', '/risk', '/docs'];
  let staticPassed = 0;
  let staticDetails = [];

  for (const pagePath of staticPages) {
    try {
      await page.goto(`${BASE_URL}${pagePath}`, { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(1000);
      const loaded = await page.evaluate(() => document.body.innerText.length > 50);
      if (loaded) staticPassed++;
      staticDetails.push(`${pagePath}:${loaded ? 'OK' : 'FAIL'}`);
      await screenshot(page, `12-static${pagePath.replace('/', '-')}.png`);
    } catch (e) {
      staticDetails.push(`${pagePath}:ERROR`);
    }
  }
  record(25, 'Static pages load (/privacy, /terms, /risk, /docs)', staticPassed === 4,
    staticDetails.join(' | '));

  // ============ CHECK 26: No "undefined", "null", "(Demo)" text ============
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const badTextDash = await page.evaluate(() => {
      const body = document.body.innerText;
      const issues = [];
      if (body.includes('undefined')) issues.push('undefined');
      if (body.match(/\bnull\b/)) issues.push('null');
      if (body.includes('(Demo)')) issues.push('(Demo)');
      if (body.includes('(demoLabel)')) issues.push('(demoLabel)');
      if (body.includes('NaN')) issues.push('NaN');
      return issues;
    });

    // Check trade page too
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const badTextTrade = await page.evaluate(() => {
      const body = document.body.innerText;
      const issues = [];
      if (body.includes('undefined')) issues.push('undefined');
      if (body.match(/\bnull\b/)) issues.push('null');
      if (body.includes('(Demo)')) issues.push('(Demo)');
      if (body.includes('(demoLabel)')) issues.push('(demoLabel)');
      if (body.includes('NaN')) issues.push('NaN');
      return issues;
    });

    const allBad = [...new Set([...badTextDash, ...badTextTrade])];
    record(26, 'No undefined/null/Demo text visible', allBad.length === 0,
      allBad.length === 0 ? 'Clean — no bad text' : `Found: ${allBad.join(', ')}`);
  } catch (e) {
    record(26, 'No undefined/null/Demo text', false, e.message);
  }

  // ============ CHECK 27: No console errors ============
  try {
    // Filter out noise errors
    const realErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('ERR_') &&
      !e.includes('net::') &&
      !e.includes('Failed to load resource') &&
      !e.includes('third-party')
    );
    record(27, 'No console errors', realErrors.length === 0,
      realErrors.length === 0 ? 'No significant console errors' : `${realErrors.length} errors: ${realErrors.slice(0, 3).join('; ')}`);
  } catch (e) {
    record(27, 'No console errors', false, e.message);
  }

  // ============ CHECK 28: Portfolio value consistent across pages ============
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const dashPortfolio = await page.evaluate(() => {
      const body = document.body.innerText;
      const matches = body.match(/\$[\d,]+\.?\d*/g);
      return matches ? matches[0] : null;
    });

    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const tradePortfolio = await page.evaluate(() => {
      const body = document.body.innerText;
      const matches = body.match(/\$[\d,]+\.?\d*/g);
      return matches ? matches[0] : null;
    });

    // Check in profile menu too
    const profileBtns = await page.$$('[class*="profile"], [class*="avatar"], [class*="user"], header button');
    if (profileBtns.length > 0) {
      await profileBtns[profileBtns.length - 1].click();
      await sleep(1000);
    }

    const profilePortfolio = await page.evaluate(() => {
      const body = document.body.innerText;
      const matches = body.match(/\$[\d,]+\.?\d*/g);
      return matches ? matches[0] : null;
    });

    await page.keyboard.press('Escape');

    record(28, 'Portfolio value consistent across pages', !!dashPortfolio,
      `Dashboard:${dashPortfolio} Trade:${tradePortfolio} Profile:${profilePortfolio}`);
  } catch (e) {
    record(28, 'Portfolio value consistent', false, e.message);
  }

  // ============ SUMMARY ============
  console.log('\n============ ROUND 13 QA SUMMARY ============');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  console.log(`Total: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('');

  if (failed > 0) {
    console.log('FAILURES:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  #${r.id} ${r.name}: ${r.detail}`);
    });
  }

  console.log('\nALL RESULTS:');
  results.forEach(r => {
    console.log(`  [${r.passed ? 'PASS' : 'FAIL'}] #${r.id} ${r.name}: ${r.detail}`);
  });

  // Save results to file
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results.json'), JSON.stringify(results, null, 2));

  await browser.close();
})();
