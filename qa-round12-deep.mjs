import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round12';
const BASE_URL = 'https://tradingalpha.net';
const bugs = [];

function bug(description, severity, screenshot, steps) {
  bugs.push({ description, severity, screenshot, steps });
  console.log(`\n[BUG ${severity}] ${description}`);
}

function log(msg) {
  console.log(`[INFO] ${msg}`);
}

async function ss(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
  await inputs[0].fill('admin');
  await inputs[1].fill('alphaDesk2025!');
  await page.click('button:has-text("Sign In")');
  await page.waitForTimeout(5000);
  log(`Logged in. URL: ${page.url()}`);

  // ===== TEST 1: Dashboard number math verification =====
  log('\n=== TEST 1: Dashboard Number Math ===');
  await page.waitForTimeout(2000);

  const dashMath = await page.evaluate(() => {
    const body = document.body.innerText;
    const results = {};

    // Portfolio value
    const pvMatch = body.match(/PORTFOLIO\s*\$([\d,]+\.?\d*)/);
    results.portfolioValue = pvMatch ? parseFloat(pvMatch[1].replace(/,/g, '')) : null;

    // Day P&L
    const pnlMatch = body.match(/P&L[^$]*-?\$([\d,]+\.?\d*)/);
    results.dayPnl = pnlMatch ? parseFloat(pnlMatch[1].replace(/,/g, '')) : null;
    results.dayPnlNegative = body.includes('loss') || body.includes('-$');

    // Day P&L percentage
    const pctMatch = body.match(/\((-?[\d.]+%)\)/);
    results.dayPnlPct = pctMatch ? pctMatch[1] : null;

    // Position data from Open Positions section
    const posSection = body.match(/Open Positions[\s\S]*?(?=April P&L|Strategies|$)/);
    if (posSection) {
      results.positionSection = posSection[0].substring(0, 500);
    }

    // April P&L total
    const aprilPnl = body.match(/April P&L\s*(-?\$[\d,]+\.?\d*)/);
    results.aprilPnl = aprilPnl ? aprilPnl[1] : null;

    // Strategy returns
    const stratReturns = body.match(/[+-]?\d+\.\d+%/g) || [];
    results.strategyReturns = stratReturns;

    return results;
  });

  log(`Portfolio Value: $${dashMath.portfolioValue}`);
  log(`Day P&L: ${dashMath.dayPnlNegative ? '-' : '+'}$${dashMath.dayPnl} (${dashMath.dayPnlPct})`);
  log(`April P&L: ${dashMath.aprilPnl}`);
  log(`Strategy returns: ${JSON.stringify(dashMath.strategyReturns)}`);

  // Verify: P&L % math
  if (dashMath.portfolioValue && dashMath.dayPnl && dashMath.dayPnlPct) {
    const expectedPct = (dashMath.dayPnl / (dashMath.portfolioValue + dashMath.dayPnl) * 100);
    const displayedPct = parseFloat(dashMath.dayPnlPct);
    const diff = Math.abs(Math.abs(expectedPct) - Math.abs(displayedPct));
    log(`P&L % verification: expected ~${expectedPct.toFixed(2)}%, displayed ${displayedPct}%, diff=${diff.toFixed(4)}%`);
    if (diff > 0.1) {
      bug(`Day P&L percentage mismatch: shows ${dashMath.dayPnlPct} but math suggests ${expectedPct.toFixed(2)}%`, 'P2', '', 'Check dashboard P&L percentage');
    }
  }

  // ===== TEST 2: Open positions P&L math =====
  log('\n=== TEST 2: Position P&L Math ===');
  const positionMath = await page.evaluate(() => {
    // Find the Open Positions section more precisely
    const body = document.body.innerText;
    const results = [];

    // Look for position patterns: SYMBOL shares $current avg $avg +/-$PnL +/-%
    // From the screenshot: MRK 43 shares $123.09 avg $114.13 +$14.12 ...
    const posPattern = /([A-Z]{2,5})\s+(\d+)\s+shares?\s+\$([\d,.]+)\s+avg\s+\$([\d,.]+)\s+([+-]?\$[\d,.]+)/g;
    let match;
    while ((match = posPattern.exec(body)) !== null) {
      const symbol = match[1];
      const qty = parseInt(match[2]);
      const current = parseFloat(match[3].replace(/,/g, ''));
      const avg = parseFloat(match[4].replace(/,/g, ''));
      const displayedPnl = match[5];
      const pnlNum = parseFloat(displayedPnl.replace(/[,$]/g, ''));
      const expectedPnl = (current - avg) * qty;

      results.push({
        symbol, qty, current, avg,
        displayedPnl, pnlNum,
        expectedPnl: expectedPnl.toFixed(2),
        match: Math.abs(expectedPnl - pnlNum) < 1,
      });
    }
    return results;
  });

  for (const pos of positionMath) {
    const status = pos.match ? 'OK' : 'MISMATCH';
    log(`${pos.symbol}: ${pos.qty} shares @ $${pos.current} (avg $${pos.avg}) => displayed ${pos.displayedPnl}, expected $${pos.expectedPnl} [${status}]`);
    if (!pos.match) {
      bug(`Position ${pos.symbol} P&L mismatch: shows ${pos.displayedPnl}, math says $${pos.expectedPnl}`, 'P1', '', `Check ${pos.symbol} position P&L on dashboard`);
    }
  }

  // ===== TEST 3: Trade page spread display =====
  log('\n=== TEST 3: Trade Page Spread ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  const spreadData = await page.evaluate(() => {
    const body = document.body.innerText;
    // From test output: "686.00 / 0.00spread: -686.00"
    // This looks like bid=686.00, ask=0.00, spread=-686.00 which is wrong
    const spreadLine = body.match(/[\d.]+\s*\/\s*[\d.]+\s*spread:\s*-?[\d.]+/i);
    const bidAsk = body.match(/([\d.]+)\s*\/\s*([\d.]+)/);
    const spreadVal = body.match(/spread:\s*(-?[\d.]+)/i);

    return {
      rawSpreadLine: spreadLine ? spreadLine[0] : null,
      bid: bidAsk ? bidAsk[1] : null,
      ask: bidAsk ? bidAsk[2] : null,
      spread: spreadVal ? spreadVal[1] : null,
      fullTopBar: body.substring(0, 1000),
    };
  });

  log(`Spread line: ${spreadData.rawSpreadLine}`);
  log(`Bid: ${spreadData.bid}, Ask: ${spreadData.ask}, Spread: ${spreadData.spread}`);

  if (spreadData.ask === '0.00' || spreadData.ask === '0') {
    bug('Trade page Ask price shows 0.00 - L1 data incomplete', 'P1', '', 'Load /trade, check bid/ask display');
  }
  if (spreadData.spread && parseFloat(spreadData.spread) < 0) {
    bug(`Trade page spread shows negative value (${spreadData.spread}) - impossible for a real spread`, 'P1', '', 'Load /trade, check spread calculation');
  }

  // ===== TEST 4: Verify chart symbol actually changes =====
  log('\n=== TEST 4: Symbol Switch Verification ===');

  // Record current chart title/header
  const beforeSwitch = await page.evaluate(() => {
    const body = document.body.innerText;
    const titleMatch = body.match(/^([A-Z]{1,5})\s*\$?[\d,.]+/m);
    return {
      symbolShown: titleMatch ? titleMatch[1] : null,
      topContent: body.substring(0, 300),
    };
  });
  log(`Before switch, symbol: ${beforeSwitch.symbolShown}`);

  // Click AAPL in watchlist
  try {
    const aaplLink = await page.$('text=AAPL');
    if (aaplLink) {
      await aaplLink.click();
      await page.waitForTimeout(4000);
      await ss(page, 'deep-04-aapl-switched');

      const afterSwitch = await page.evaluate(() => {
        const body = document.body.innerText;
        // Look for the main chart symbol display
        const headerArea = body.substring(0, 500);
        return {
          headerArea,
          stillShowsSPY: headerArea.includes('SPY') && !headerArea.includes('AAPL'),
          showsAAPL: headerArea.includes('AAPL'),
        };
      });

      log(`After AAPL click: showsAAPL=${afterSwitch.showsAAPL}, stillSPY=${afterSwitch.stillShowsSPY}`);
      log(`Header after switch: ${afterSwitch.headerArea.substring(0, 200)}`);

      if (afterSwitch.stillShowsSPY) {
        bug('Chart does not update when clicking AAPL in watchlist - still shows SPY', 'P1', 'deep-04-aapl-switched', 'Click AAPL in watchlist');
      }
    }
  } catch (e) {
    log(`Symbol switch: ${e.message}`);
  }

  // ===== TEST 5: Calendar weekend check =====
  log('\n=== TEST 5: P&L Calendar Weekend Check ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const calendarCheck = await page.evaluate(() => {
    // April 2026 weekends: Sat 4,11,18,25; Sun 5,12,19,26
    const weekendDays = new Set([4, 5, 11, 12, 18, 19, 25, 26]);
    // Today is April 12, 2026 (Saturday)

    // Find all calendar day cells with P&L coloring
    // Look for elements with background colors that aren't the default
    const allElements = document.querySelectorAll('*');
    const coloredCells = [];

    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      const bg = style.backgroundColor;
      const text = el.textContent.trim();

      // Check if it's a single number (day of month) with a non-transparent/non-default background
      if (/^\d{1,2}$/.test(text) && parseInt(text) >= 1 && parseInt(text) <= 30) {
        const dayNum = parseInt(text);
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== 'rgb(0, 0, 0)') {
          // Check if it has green/red tint (P&L coloring)
          const isColored = bg.includes('rgb') && !bg.includes('rgba(0, 0, 0');
          if (isColored) {
            coloredCells.push({
              day: dayNum,
              bg,
              isWeekend: weekendDays.has(dayNum),
              text,
            });
          }
        }
      }
    }

    return {
      coloredCells,
      weekendColored: coloredCells.filter(c => c.isWeekend),
    };
  });

  log(`Colored calendar cells: ${calendarCheck.coloredCells.length}`);
  for (const cell of calendarCheck.coloredCells) {
    log(`  Day ${cell.day}: bg=${cell.bg} ${cell.isWeekend ? '** WEEKEND **' : ''}`);
  }
  if (calendarCheck.weekendColored.length > 0) {
    bug(`P&L calendar shows colored cells on weekends (trading days shouldn't include weekends): days ${calendarCheck.weekendColored.map(c => c.day).join(',')}`, 'P2', '', 'Check P&L calendar for weekend coloring');
  }

  // ===== TEST 6: Strategy card links from dashboard =====
  log('\n=== TEST 6: Strategy Card Click Navigation ===');

  // The initial test found no <a> strategy links. Let's check clickable divs/cards
  const stratCards = await page.evaluate(() => {
    const body = document.body.innerText;
    const strategies = ['PEAD', 'Momentum', 'Earnings', 'Claude Alpha', 'Mean Reversion', 'VCP Breakout', 'Pairs Trading', 'Dividend Capture', 'Regime Adaptive', 'VRP Harvesting'];
    const found = [];
    for (const s of strategies) {
      if (body.includes(s)) {
        found.push(s);
      }
    }

    // Find clickable strategy elements
    const clickables = document.querySelectorAll('[class*="strateg"], [class*="card"], [data-strategy]');

    // Also check for <a> tags containing strategy names
    const links = document.querySelectorAll('a');
    const strategyAnchors = [];
    links.forEach(l => {
      const text = l.textContent.trim();
      const href = l.getAttribute('href') || '';
      if (strategies.some(s => text.includes(s)) || href.includes('strateg')) {
        strategyAnchors.push({ href, text: text.substring(0, 60) });
      }
    });

    return { strategiesVisible: found, clickableCount: clickables.length, strategyAnchors };
  });

  log(`Visible strategies: ${JSON.stringify(stratCards.strategiesVisible)}`);
  log(`Clickable strategy elements: ${stratCards.clickableCount}`);
  log(`Strategy anchors: ${JSON.stringify(stratCards.strategyAnchors)}`);

  // Try clicking on each strategy card that's visible
  for (const stratName of stratCards.strategiesVisible) {
    try {
      const card = await page.$(`text=${stratName}`);
      if (card) {
        // Check if it or a parent is clickable (has cursor:pointer or is an <a>)
        const isClickable = await card.evaluate(el => {
          let current = el;
          while (current) {
            if (current.tagName === 'A') return { clickable: true, href: current.getAttribute('href') };
            const cursor = window.getComputedStyle(current).cursor;
            if (cursor === 'pointer') return { clickable: true, href: current.closest('a')?.getAttribute('href') || 'no-href' };
            current = current.parentElement;
          }
          return { clickable: false };
        });
        log(`Strategy "${stratName}": clickable=${isClickable.clickable}, href=${isClickable.href || 'none'}`);

        if (!isClickable.clickable) {
          bug(`Strategy card "${stratName}" is not clickable - missing link/navigation`, 'P2', '', `Try to click on "${stratName}" strategy card on dashboard`);
        }
      }
    } catch (e) {
      log(`Strategy card click check "${stratName}": ${e.message}`);
    }
  }

  // ===== TEST 7: Trade page - options chain data =====
  log('\n=== TEST 7: Options Chain Data ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // The positions tab showed options chain data (strikes, greeks etc.)
  // Check if it's actually the positions tab or if it's showing options chain instead
  const positionsCheck = await page.evaluate(() => {
    const body = document.body.innerText;
    // Look for portfolio positions (MRK, NKE, PG, WMT from dashboard)
    const expectedSymbols = ['MRK', 'NKE', 'PG', 'WMT'];
    const foundSymbols = expectedSymbols.filter(s => body.includes(s));

    // Check if options tab is shown at bottom
    const hasOptionsTab = body.includes('Options') || body.includes('SPY Options');
    const hasPositionsTab = body.includes('Positions');

    return { foundSymbols, hasOptionsTab, hasPositionsTab };
  });

  log(`Expected positions found on trade page: ${JSON.stringify(positionsCheck.foundSymbols)}`);
  log(`Has options tab: ${positionsCheck.hasOptionsTab}, Has positions tab: ${positionsCheck.hasPositionsTab}`);

  // ===== TEST 8: Order entry form deep check =====
  log('\n=== TEST 8: Order Entry ===');

  // Take a closer look at the right panel
  const orderPanel = await page.evaluate(() => {
    const body = document.body.innerText;
    // Find order-related area
    const orderSection = body.match(/BUY[\s\S]*?(?=Technical|Key Levels|$)/);

    // Check for order type selector (Market/Limit)
    const hasMarketLimit = body.includes('Market') && body.includes('Limit');
    const hasBuySell = body.includes('BUY') && body.includes('SELL');

    // Look for quantity and price inputs
    const allInputs = document.querySelectorAll('input');
    const inputData = Array.from(allInputs).map(i => ({
      id: i.id,
      type: i.type,
      placeholder: i.placeholder,
      value: i.value,
      name: i.name,
      visible: i.offsetParent !== null,
    }));

    return {
      orderSection: orderSection ? orderSection[0].substring(0, 300) : 'NOT FOUND',
      hasMarketLimit,
      hasBuySell,
      inputs: inputData,
    };
  });

  log(`Order section: ${orderPanel.orderSection}`);
  log(`Has Market/Limit: ${orderPanel.hasMarketLimit}`);
  log(`Has Buy/Sell: ${orderPanel.hasBuySell}`);
  log(`All inputs: ${JSON.stringify(orderPanel.inputs)}`);

  if (!orderPanel.hasBuySell) {
    bug('Trade page missing Buy/Sell buttons in order entry', 'P1', '', 'Load /trade, check order entry area');
  }

  // ===== TEST 9: Static pages deep check =====
  log('\n=== TEST 9: Static Pages ===');
  for (const sp of ['/privacy', '/terms', '/risk', '/docs']) {
    try {
      await page.goto(`${BASE_URL}${sp}`, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1500);

      const spInfo = await page.evaluate(() => {
        const body = document.body.innerText;
        return {
          url: window.location.href,
          isLogin: window.location.href.includes('login'),
          is404: body.includes('404') && body.includes('not be found'),
          hasContent: body.length > 100,
          preview: body.substring(0, 200),
          hasBackLink: !!document.querySelector('a[href="/"]'),
        };
      });

      log(`${sp}: url=${spInfo.url}, isLogin=${spInfo.isLogin}, is404=${spInfo.is404}, hasBack=${spInfo.hasBackLink}, content="${spInfo.preview.substring(0, 80)}"`);

      if (spInfo.isLogin) {
        // Static pages redirect to login - are they supposed to be public?
        // Check if the login page's footer still links to them
        bug(`${sp} requires auth (redirects to login) - footer links to it from login page so it should be public`, 'P2', '', `Navigate to ${sp} while not logged in`);
      }
      if (spInfo.is404) {
        bug(`${sp} returns 404`, 'P2', '', `Navigate to ${sp}`);
      }

      await ss(page, `deep-09-static${sp.replace('/', '-')}`);
    } catch (e) {
      log(`${sp}: ${e.message}`);
    }
  }

  // ===== TEST 10: Pipeline positions match dashboard =====
  log('\n=== TEST 10: Pipeline vs Dashboard Positions ===');

  // Get dashboard positions
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const dashPositions = await page.evaluate(() => {
    const body = document.body.innerText;
    const posPattern = /([A-Z]{2,5})\s+(\d+)\s+shares?/g;
    const positions = [];
    let match;
    while ((match = posPattern.exec(body)) !== null) {
      positions.push({ symbol: match[1], shares: parseInt(match[2]) });
    }
    return positions;
  });
  log(`Dashboard positions: ${JSON.stringify(dashPositions)}`);

  // Get pipeline positions
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const pipPositions = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        return {
          symbol: cells[0].textContent.trim(),
          shares: cells[1].textContent.trim(),
        };
      }
      return null;
    }).filter(Boolean);
  });
  log(`Pipeline positions: ${JSON.stringify(pipPositions)}`);

  // Compare
  const dashSymbols = new Set(dashPositions.map(p => p.symbol));
  const pipSymbols = new Set(pipPositions.map(p => p.symbol));

  // Check dashboard positions that are missing from pipeline
  for (const dp of dashPositions) {
    if (!pipSymbols.has(dp.symbol)) {
      log(`Dashboard position ${dp.symbol} NOT in pipeline`);
    }
  }
  // Pipeline might only show pipeline-generated positions, not all portfolio positions
  // So this is informational, not necessarily a bug

  // ===== TEST 11: Backend logs check =====
  log('\n=== TEST 11: Checking backend health ===');

  // Check key API endpoints
  const apiChecks = await page.evaluate(async () => {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const results = {};

    const endpoints = [
      '/api/v1/portfolio/summary',
      '/api/v1/trades/positions',
      '/api/v1/strategies',
      '/api/v1/pipeline/latest',
      '/api/v1/market/quotes/SPY',
      '/api/v1/news',
    ];

    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, { headers });
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text.substring(0, 200); }
        results[ep] = { status: resp.status, preview: JSON.stringify(data).substring(0, 200) };
      } catch (e) {
        results[ep] = { error: e.message };
      }
    }
    return results;
  });

  for (const [ep, result] of Object.entries(apiChecks)) {
    log(`API ${ep}: status=${result.status || 'ERROR'} ${result.preview ? result.preview.substring(0, 100) : result.error}`);
    if (result.status >= 500) {
      bug(`API endpoint ${ep} returns server error ${result.status}`, 'P1', '', `Call ${ep}`);
    }
  }

  // ===== TEST 12: Pipeline date handling =====
  log('\n=== TEST 12: Pipeline history date bug ===');
  // The first test showed a 404 for /api/v1/pipeline/history/2026-04-13
  // Today is April 12 (Saturday). April 13 is Sunday. Requesting future date history = 404
  const pipelineDateCheck = await page.evaluate(async () => {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const results = {};

    // Check a few dates
    const dates = ['2026-04-10', '2026-04-11', '2026-04-12', '2026-04-13'];
    for (const d of dates) {
      try {
        const resp = await fetch(`/api/v1/pipeline/history/${d}`, { headers });
        results[d] = resp.status;
      } catch (e) {
        results[d] = 'error';
      }
    }
    return results;
  });

  log(`Pipeline history dates: ${JSON.stringify(pipelineDateCheck)}`);

  // ===== TEST 13: Deep strategy page analysis =====
  log('\n=== TEST 13: Strategy Pages Deep Analysis ===');

  const strategyIds = ['pead', 'momentum-quality', 'earnings-vol', 'regime-adaptive', 'claude-alpha', 'mean-reversion', 'vcp-breakout', 'pairs-trading', 'dividend-capture', 'vrp-harvesting'];

  for (const sid of strategyIds) {
    try {
      await page.goto(`${BASE_URL}/strategies/${sid}`, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(2000);

      const stratDetail = await page.evaluate(() => {
        const body = document.body.innerText;
        return {
          url: window.location.href,
          is404: body.includes('404') && body.length < 200,
          isLogin: window.location.href.includes('login'),
          title: document.querySelector('h1, h2')?.textContent?.trim() || 'none',
          hasEquityCurve: !!document.querySelector('canvas'),
          hasTotalReturn: /Total Return/.test(body),
          hasSharpe: /Sharpe/.test(body),
          hasWinRate: /Win Rate/.test(body),
          hasMaxDrawdown: /Max Drawdown/.test(body) || /Drawdown/.test(body),
          hasTradeHistory: /Trade|Entry|Exit|History/.test(body),
          totalReturnValue: body.match(/Total Return[^%]*([+-]?\d+\.?\d*%)/)?.[1] || null,
          sharpeValue: body.match(/Sharpe[^)]*?([-\d.]+)/)?.[1] || null,
          hasPositions: /Positions/.test(body),
          chartCount: document.querySelectorAll('canvas, svg').length,
          bodyLen: body.length,
          status: body.includes('Paused') ? 'Paused' : body.includes('Active') ? 'Active' : 'unknown',
        };
      });

      const flags = [];
      if (stratDetail.is404) flags.push('404');
      if (stratDetail.isLogin) flags.push('REDIRECT_LOGIN');
      if (!stratDetail.hasEquityCurve) flags.push('NO_EQUITY_CURVE');
      if (!stratDetail.hasTotalReturn) flags.push('NO_TOTAL_RETURN');
      if (!stratDetail.hasSharpe) flags.push('NO_SHARPE');

      log(`Strategy ${sid}: title="${stratDetail.title}", return=${stratDetail.totalReturnValue}, sharpe=${stratDetail.sharpeValue}, charts=${stratDetail.chartCount}, status=${stratDetail.status} ${flags.length ? '[' + flags.join(',') + ']' : '[OK]'}`);

      if (stratDetail.is404) {
        bug(`Strategy page /strategies/${sid} returns 404`, 'P1', '', `Navigate to /strategies/${sid}`);
      }

      await ss(page, `deep-13-strategy-${sid}`);
    } catch (e) {
      log(`Strategy ${sid}: ${e.message}`);
    }
  }

  // ===== TEST 14: Specific detail checks from screenshots =====
  log('\n=== TEST 14: Screenshot-Observed Issues ===');

  // Go back to trade page to check the bid/ask/spread display closely
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  const tradeBarDetail = await page.evaluate(() => {
    const body = document.body.innerText;
    // Find the SPY price area
    const priceArea = body.match(/SPY\s*\$([\d,.]+)\s*([+-][\d,.]+)\s*\(([+-][\d.]+%)\)/);
    // Find bid/ask area
    const bidAskArea = body.match(/([\d.]+)\s*\/\s*([\d.]+)\s*spread:\s*(-?[\d.]+)/);
    return {
      priceArea: priceArea ? { price: priceArea[1], change: priceArea[2], pct: priceArea[3] } : null,
      bidAsk: bidAskArea ? { bid: bidAskArea[1], ask: bidAskArea[2], spread: bidAskArea[3] } : null,
      rawBidAskLine: bidAskArea ? bidAskArea[0] : body.match(/[\d.]+\s*\/\s*[\d.]+/)?.[0] || 'not found',
    };
  });

  log(`Trade price area: ${JSON.stringify(tradeBarDetail.priceArea)}`);
  log(`Trade bid/ask: ${JSON.stringify(tradeBarDetail.bidAsk)}`);
  log(`Raw bid/ask line: ${tradeBarDetail.rawBidAskLine}`);

  if (tradeBarDetail.bidAsk) {
    const bid = parseFloat(tradeBarDetail.bidAsk.bid);
    const ask = parseFloat(tradeBarDetail.bidAsk.ask);
    const spread = parseFloat(tradeBarDetail.bidAsk.spread);

    if (ask === 0) {
      bug('Trade page Ask price is 0.00 - market data not populating Ask side', 'P1', '', 'Load /trade, observe bid/ask bar');
    }
    if (spread < 0) {
      bug(`Trade page spread is negative (${spread}) because Ask is 0 - spread = ask - bid results in negative`, 'P1', '', 'Load /trade, check spread value');
    }
    if (bid > 0 && ask === 0) {
      bug('Bid shows a price but Ask shows 0.00 - partial L1 data', 'P1', '', 'Load /trade, check L1 data bar');
    }
  }

  // ===== TEST 15: Pipeline 404 on tomorrow's date =====
  log('\n=== TEST 15: Pipeline Future Date Request ===');
  // Today is Saturday April 12. The frontend requests April 13 (tomorrow/Sunday) history
  // This is expected to 404, but the frontend should handle it gracefully
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const pipelineConsoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') pipelineConsoleErrors.push(msg.text());
  });
  await page.waitForTimeout(2000);

  // Check if there's a visible error on pipeline page
  const pipelineVisible = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasError: body.includes('Error') || body.includes('error'),
      hasNoData: body.includes('No data') || body.includes('No activity') || body.includes('no results'),
      preview: body.substring(0, 500),
    };
  });
  log(`Pipeline visible state: ${JSON.stringify(pipelineVisible)}`);

  // ===== FINAL SUMMARY =====
  log('\n' + '='.repeat(70));
  log('ROUND 12 EXHAUSTIVE BUG HUNT - FINAL REPORT');
  log('='.repeat(70));

  // Deduplicate
  const uniqueBugs = [];
  const seen = new Set();
  for (const b of bugs) {
    const key = `${b.description.substring(0, 60)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueBugs.push(b);
    }
  }

  if (uniqueBugs.length === 0) {
    log('\nAPPLICATION IS CLEAN - NO BUGS FOUND');
  } else {
    const p0 = uniqueBugs.filter(b => b.severity === 'P0');
    const p1 = uniqueBugs.filter(b => b.severity === 'P1');
    const p2 = uniqueBugs.filter(b => b.severity === 'P2');
    const p3 = uniqueBugs.filter(b => b.severity === 'P3');

    log(`\nTotal: ${uniqueBugs.length} bugs (P0:${p0.length} P1:${p1.length} P2:${p2.length} P3:${p3.length})\n`);

    for (const b of uniqueBugs) {
      log(`[${b.severity}] ${b.description}`);
      log(`  Steps: ${b.steps}`);
      log(`  Screenshot: ${b.screenshot || 'N/A'}`);
      log('');
    }
  }

  await browser.close();
  log('Done.');
})();
