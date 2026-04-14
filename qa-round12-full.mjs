import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round12';
const BASE_URL = 'https://tradingalpha.net';
const bugs = [];

function bug(description, severity, screenshot, steps) {
  bugs.push({ description, severity, screenshot, steps });
  console.log(`[BUG ${severity}] ${description}`);
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

  // Error tracking
  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon')) {
        consoleErrors.push({ text, page: page.url() });
      }
    }
  });
  page.on('response', resp => {
    if (resp.status() >= 400 && !resp.url().includes('favicon')) {
      networkErrors.push({ url: resp.url(), status: resp.status(), page: page.url() });
    }
  });

  // ===== LOGIN =====
  log('=== LOGIN ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  const allInputs = await page.$$('input');
  await allInputs[0].fill('admin');
  await allInputs[1].fill('alphaDesk2025!');
  const signInBtn = await page.$('button:has-text("Sign In")');
  await signInBtn.click();
  await page.waitForTimeout(5000);

  if (page.url().includes('login')) {
    bug('Login failed', 'P0', '', '');
    await browser.close();
    return;
  }
  log('Login OK');

  // ===== PHASE 1: Dashboard Deep Inspection =====
  log('\n=== PHASE 1: DASHBOARD ===');
  await page.waitForTimeout(3000);
  await ss(page, 'P1-01-dashboard-full');

  // 1. Extract ALL numbers for math verification
  const dashData = await page.evaluate(() => {
    const data = {};

    // Portfolio value
    const bodyText = document.body.innerText;

    // Find portfolio value
    const pvMatch = bodyText.match(/PORTFOLIO[^$]*\$([\d,]+\.?\d*)/);
    data.portfolioValue = pvMatch ? pvMatch[1] : null;

    // Find P&L
    const pnlMatch = bodyText.match(/P&L[^-$]*(-?\$[\d,]+\.?\d*)/);
    data.dayPnl = pnlMatch ? pnlMatch[1] : null;

    // Another approach - look for specific dollar amounts
    const allDollars = bodyText.match(/\$[\d,]+\.?\d*/g) || [];
    data.allDollarValues = allDollars;

    // Percentages
    const allPcts = bodyText.match(/-?\d+\.?\d*%/g) || [];
    data.allPercentages = allPcts;

    // Find position rows
    const positions = [];
    const rows = document.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        positions.push(Array.from(cells).map(c => c.textContent.trim()));
      }
    });
    data.positionRows = positions;

    // Strategy cards
    const strategyEls = document.querySelectorAll('[class*="strategy"], [data-testid*="strategy"]');
    data.strategyCardCount = strategyEls.length;

    // Look for strategy links
    const links = document.querySelectorAll('a');
    const stratLinks = [];
    links.forEach(l => {
      const href = l.getAttribute('href') || '';
      if (href.includes('strateg')) {
        stratLinks.push({ href, text: l.textContent.trim().substring(0, 60) });
      }
    });
    data.strategyLinks = stratLinks;

    // Check for "example.com" anywhere
    data.hasExampleCom = bodyText.includes('example.com');

    // VIX value
    const vixMatch = bodyText.match(/VIX\s*([\d.]+)/);
    data.vix = vixMatch ? vixMatch[1] : null;

    // Regime
    const regimeMatch = bodyText.match(/Regime\s*([^\n]+)/);
    data.regime = regimeMatch ? regimeMatch[1].trim() : null;

    return data;
  });

  log(`Portfolio Value: ${dashData.portfolioValue}`);
  log(`Day P&L: ${dashData.dayPnl}`);
  log(`All dollar values: ${JSON.stringify(dashData.allDollarValues)}`);
  log(`All percentages: ${JSON.stringify(dashData.allPercentages)}`);
  log(`Position rows: ${JSON.stringify(dashData.positionRows)}`);
  log(`Strategy card count: ${dashData.strategyCardCount}`);
  log(`Strategy links: ${JSON.stringify(dashData.strategyLinks)}`);
  log(`Has example.com: ${dashData.hasExampleCom}`);
  log(`VIX: ${dashData.vix}`);
  log(`Regime: ${dashData.regime}`);

  if (dashData.hasExampleCom) {
    bug('Dashboard contains "example.com" placeholder links', 'P2', 'P1-01-dashboard-full', 'Check news/links on dashboard');
  }

  // 2. Verify position P&L math
  for (const pos of dashData.positionRows) {
    // pos format: [symbol, shares, current price, avg price, P&L, etc]
    log(`  Position row: ${JSON.stringify(pos)}`);
  }

  // 3. Check strategy cards navigation - click each strategy link
  log('\n--- Strategy Card Navigation ---');
  for (const link of dashData.strategyLinks) {
    log(`Strategy link: ${link.href} -> "${link.text}"`);
  }

  // Actually click each strategy card and verify navigation
  const strategyLinksData = dashData.strategyLinks;
  for (let i = 0; i < strategyLinksData.length; i++) {
    const sl = strategyLinksData[i];
    try {
      await page.goto(`${BASE_URL}${sl.href}`, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1500);
      const stratUrl = page.url();
      const stratBody = await page.textContent('body');
      const is404 = stratBody.includes('404') || stratBody.includes('Page not found') || stratBody.includes('Not Found');
      const isLoginPage = stratBody.includes('Sign In') && stratUrl.includes('login');

      if (is404) {
        bug(`Strategy link "${sl.text}" (${sl.href}) leads to 404`, 'P1', `P1-strat-${i}`, `Click strategy card "${sl.text}"`);
      } else if (isLoginPage) {
        bug(`Strategy link "${sl.text}" (${sl.href}) redirects to login`, 'P1', `P1-strat-${i}`, `Click strategy card "${sl.text}"`);
      }

      await ss(page, `P1-strat-${i}-${sl.href.replace(/\//g, '_')}`);
      log(`  Strategy ${sl.href}: url=${stratUrl}, is404=${is404}, isLogin=${isLoginPage}`);
    } catch (e) {
      bug(`Strategy "${sl.text}" (${sl.href}) failed to load: ${e.message}`, 'P1', '', '');
    }
  }

  // Go back to dashboard
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 4. P&L Calendar close inspection
  log('\n--- P&L Calendar ---');
  const calendarData = await page.evaluate(() => {
    // Find calendar container
    const bodyText = document.body.innerText;
    const calMatch = bodyText.match(/April P&L[^]*?(?=\n\n|\nOpen|$)/);

    // Find all colored/highlighted cells - check for weekend dates
    // April 2026: Sat=4,11,18,25; Sun=5,12,19,26
    const weekendDays = [4, 5, 11, 12, 18, 19, 25, 26];

    return {
      calendarSection: calMatch ? calMatch[0].substring(0, 300) : 'NOT FOUND',
      weekendDays,
    };
  });
  log(`Calendar: ${calendarData.calendarSection}`);

  // 5. Allocation donut check
  log('\n--- Allocation Check ---');
  const allocData = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    // Look for cash and invested values
    const cashMatch = bodyText.match(/Cash[:\s]*\$?([\d,]+\.?\d*)/i);
    const investedMatch = bodyText.match(/Invested[:\s]*\$?([\d,]+\.?\d*)/i);
    return {
      cash: cashMatch ? cashMatch[1] : null,
      invested: investedMatch ? investedMatch[1] : null,
    };
  });
  log(`Cash: ${allocData.cash}, Invested: ${allocData.invested}`);

  // 6. News section check
  log('\n--- News/Activity Feed ---');
  const newsData = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    const externalLinks = [];
    const brokenLinks = [];
    links.forEach(l => {
      const href = l.getAttribute('href') || '';
      if (href.startsWith('http') && !href.includes('tradingalpha.net')) {
        externalLinks.push({ href, text: l.textContent.trim().substring(0, 60) });
        if (href.includes('example.com') || href.includes('placeholder') || href === '#') {
          brokenLinks.push(href);
        }
      }
    });
    return { externalLinks, brokenLinks };
  });
  log(`External links: ${JSON.stringify(newsData.externalLinks)}`);
  if (newsData.brokenLinks.length > 0) {
    bug(`Broken/placeholder links found: ${newsData.brokenLinks.join(', ')}`, 'P2', 'P1-01-dashboard-full', 'Check news section links');
  }

  // Scroll dashboard and take multiple screenshots
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(500);
  await ss(page, 'P1-02-dashboard-mid');

  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForTimeout(500);
  await ss(page, 'P1-03-dashboard-bottom');

  await page.evaluate(() => window.scrollTo(0, 0));

  // ===== PHASE 2: Trade Page =====
  log('\n=== PHASE 2: TRADE PAGE ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  await ss(page, 'P2-01-trade-full');

  // 8. Check L1 data bar
  const tradeData = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const data = {};

    // Extract all key-value like patterns
    const patterns = {
      bid: /Bid[:\s]*\$?([\d,.]+)/i,
      ask: /Ask[:\s]*\$?([\d,.]+)/i,
      spread: /Spread[:\s]*\$?([\d,.]+)/i,
      volume: /Vol(?:ume)?[:\s]*([\d,.KMB]+)/i,
      high: /High[:\s]*\$?([\d,.]+)/i,
      low: /Low[:\s]*\$?([\d,.]+)/i,
      open: /Open[:\s]*\$?([\d,.]+)/i,
      last: /Last[:\s]*\$?([\d,.]+)/i,
    };

    for (const [key, regex] of Object.entries(patterns)) {
      const match = bodyText.match(regex);
      data[key] = match ? match[1] : 'NOT_FOUND';
    }

    // Get current symbol displayed
    const symbolMatch = bodyText.match(/^([A-Z]{1,5})\s/m);
    data.currentSymbol = symbolMatch ? symbolMatch[1] : null;

    // Get the full text of the top data bar area
    data.topBarText = bodyText.substring(0, 800);

    return data;
  });

  log(`Trade L1 data: ${JSON.stringify(tradeData)}`);

  for (const [key, val] of Object.entries(tradeData)) {
    if (key === 'topBarText' || key === 'currentSymbol') continue;
    if (val === '0' || val === '0.00' || val === '0.0' || val === '0.000') {
      bug(`Trade page L1 "${key}" shows zero`, 'P1', 'P2-01-trade-full', `Load /trade, check ${key} value in data bar`);
    }
  }

  // 9. Switch to AAPL
  log('\n--- Switch to AAPL ---');
  try {
    // Look for the symbol search/selector
    const searchInput = await page.$('#symbol-search, input[placeholder*="Search" i], input[placeholder*="symbol" i], [class*="search"] input');
    if (searchInput) {
      await searchInput.click();
      await searchInput.fill('AAPL');
      await page.waitForTimeout(1500);

      // Look for dropdown suggestion
      const suggestion = await page.$('[class*="suggestion"], [class*="dropdown"] div, [class*="result"], [role="listbox"] [role="option"]');
      if (suggestion) {
        await suggestion.click();
      } else {
        await searchInput.press('Enter');
      }
    } else {
      // Try the command palette approach
      log('No search input found, trying Cmd+K');
      await page.keyboard.press('Meta+k');
      await page.waitForTimeout(1000);
      await page.keyboard.type('AAPL');
      await page.waitForTimeout(1500);
      await page.keyboard.press('Enter');
    }

    await page.waitForTimeout(4000);
    await ss(page, 'P2-02-trade-aapl');

    // Verify symbol changed
    const newSymbol = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      return bodyText.substring(0, 300);
    });
    log(`After AAPL switch, top content: ${newSymbol.substring(0, 200)}`);
  } catch (e) {
    log(`AAPL switch error: ${e.message}`);
  }

  // 10. Switch to 1m timeframe
  log('\n--- 1m Timeframe ---');
  try {
    const buttons = await page.$$('button');
    let found1m = false;
    for (const btn of buttons) {
      const text = (await btn.textContent()).trim();
      if (text === '1m' || text === '1M' || text === '1min') {
        await btn.click();
        found1m = true;
        break;
      }
    }
    if (found1m) {
      await page.waitForTimeout(4000);
      await ss(page, 'P2-03-trade-1m');
      log('Switched to 1m timeframe');
    } else {
      log('1m button not found');
      // List all button texts for debugging
      const allBtnTexts = await Promise.all(buttons.map(b => b.textContent()));
      log(`Available buttons: ${allBtnTexts.map(t => t.trim()).filter(t => t.length < 10).join(', ')}`);
    }
  } catch (e) {
    log(`1m timeframe: ${e.message}`);
  }

  // 11. Key levels
  log('\n--- Key Levels ---');
  const keyLevels = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    // Look for support/resistance levels
    const supports = bodyText.match(/S(?:upport)?\d?[:\s]*\$?([\d,.]+)/gi) || [];
    const resistances = bodyText.match(/R(?:esistance)?\d?[:\s]*\$?([\d,.]+)/gi) || [];
    const keyLevels = bodyText.match(/Key Level[s]?[:\s]*([^\n]+)/gi) || [];
    return { supports, resistances, keyLevels };
  });
  log(`Key levels: ${JSON.stringify(keyLevels)}`);

  // 12. Place limit order
  log('\n--- Limit Order ---');
  try {
    // Check order entry area
    const orderArea = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasOrderEntry = bodyText.includes('Limit') || bodyText.includes('Market') || bodyText.includes('Order');
      const hasBuy = bodyText.includes('Buy') || bodyText.includes('BUY');
      const hasSell = bodyText.includes('Sell') || bodyText.includes('SELL');

      // Find all inputs
      const inputs = document.querySelectorAll('input');
      const inputInfo = Array.from(inputs).map(i => ({
        type: i.type,
        placeholder: i.placeholder,
        id: i.id,
        name: i.name,
        value: i.value,
      }));

      // Find selects
      const selects = document.querySelectorAll('select');
      const selectInfo = Array.from(selects).map(s => ({
        id: s.id,
        name: s.name,
        options: Array.from(s.options).map(o => o.text),
      }));

      return { hasOrderEntry, hasBuy, hasSell, inputs: inputInfo, selects: selectInfo };
    });
    log(`Order area: ${JSON.stringify(orderArea)}`);

    // Try to find and fill order inputs
    const qtyInput = await page.$('input[id*="qty" i], input[id*="quantity" i], input[id*="shares" i], input[placeholder*="Qty" i], input[placeholder*="Shares" i], input[placeholder*="Quantity" i]');
    const priceInput = await page.$('input[id*="price" i], input[placeholder*="Price" i], input[placeholder*="Limit" i]');

    if (qtyInput && priceInput) {
      // Select Limit order type if possible
      const limitBtn = await page.$('button:has-text("Limit"), [class*="limit" i]');
      if (limitBtn) await limitBtn.click();

      await qtyInput.fill('1');
      await priceInput.fill('250');

      await ss(page, 'P2-04-order-filled');

      const placeBtn = await page.$('button:has-text("Place"), button:has-text("Submit"), button:has-text("Buy")');
      if (placeBtn) {
        await placeBtn.click();
        await page.waitForTimeout(2000);
        await ss(page, 'P2-05-order-submitted');
        log('Order submitted');
      }
    } else {
      // Try by index - get all inputs on trade page
      const allTradeInputs = await page.$$('input');
      log(`Total inputs on trade page: ${allTradeInputs.length}`);
      for (let i = 0; i < allTradeInputs.length; i++) {
        const attrs = await allTradeInputs[i].evaluate(el => ({
          type: el.type, id: el.id, placeholder: el.placeholder, name: el.name
        }));
        log(`  Input ${i}: ${JSON.stringify(attrs)}`);
      }
    }
  } catch (e) {
    log(`Order placement: ${e.message}`);
  }

  // 13. Positions tab
  log('\n--- Positions Tab ---');
  try {
    const posTab = await page.$('button:has-text("Positions"), [role="tab"]:has-text("Positions")');
    if (posTab) {
      await posTab.click();
      await page.waitForTimeout(1500);
      await ss(page, 'P2-06-positions');

      const positions = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr, [class*="position-row"], [class*="positions"] tr');
        return Array.from(rows).map(row => {
          const cells = row.querySelectorAll('td');
          return Array.from(cells).map(c => c.textContent.trim());
        });
      });
      log(`Positions: ${JSON.stringify(positions)}`);
      log(`Position count: ${positions.length}`);
    } else {
      log('Positions tab not found');
    }
  } catch (e) {
    log(`Positions tab: ${e.message}`);
  }

  // 14. Journal tab
  log('\n--- Journal Tab ---');
  try {
    const journalTab = await page.$('button:has-text("Journal"), [role="tab"]:has-text("Journal")');
    if (journalTab) {
      await journalTab.click();
      await page.waitForTimeout(1500);
      await ss(page, 'P2-07-journal');

      const textarea = await page.$('textarea, [contenteditable="true"], [class*="journal"] textarea');
      if (textarea) {
        await textarea.fill('QA Round 12 test note - checking persistence');
        await page.waitForTimeout(500);

        // Switch tabs and back
        const posTab2 = await page.$('button:has-text("Positions"), [role="tab"]:has-text("Positions")');
        if (posTab2) {
          await posTab2.click();
          await page.waitForTimeout(500);
          await journalTab.click();
          await page.waitForTimeout(500);

          const persistedText = await textarea.inputValue().catch(() => '');
          if (persistedText.includes('QA Round 12')) {
            log('Journal note persists correctly');
          } else {
            bug('Journal note does not persist when switching tabs', 'P2', 'P2-07-journal', 'Type note, switch to Positions, switch back to Journal');
          }
        }
      } else {
        log('Journal textarea not found');
      }
    } else {
      log('Journal tab not found');
    }
  } catch (e) {
    log(`Journal tab: ${e.message}`);
  }

  // ===== PHASE 3: Pipeline =====
  log('\n=== PHASE 3: PIPELINE ===');
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await ss(page, 'P3-01-pipeline');

  // 15. Pipeline flow numbers
  const pipelineData = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    return {
      preview: bodyText.substring(0, 1500),
      hasAllZeros: false,
    };
  });
  log(`Pipeline content: ${pipelineData.preview.substring(0, 500)}`);

  // 16. Check positions match dashboard
  const pipelinePositions = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');
      return Array.from(cells).map(c => c.textContent.trim());
    });
  });
  log(`Pipeline positions: ${JSON.stringify(pipelinePositions)}`);

  // 17. Run Pipeline button
  try {
    const runBtn = await page.$('button:has-text("Run"), button:has-text("Execute"), button:has-text("Pipeline")');
    if (runBtn) {
      const btnText = await runBtn.textContent();
      log(`Found run button: "${btnText.trim()}"`);
      await runBtn.click();
      await page.waitForTimeout(3000);
      await ss(page, 'P3-02-pipeline-after-run');
      log('Pipeline run clicked');
    } else {
      log('No Run Pipeline button found');
    }
  } catch (e) {
    log(`Run Pipeline: ${e.message}`);
  }

  // Scroll pipeline
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(500);
  await ss(page, 'P3-03-pipeline-scrolled');
  await page.evaluate(() => window.scrollTo(0, 0));

  // ===== PHASE 4: Strategy Detail Pages =====
  log('\n=== PHASE 4: STRATEGY PAGES ===');

  // First get the real strategy IDs from the dashboard
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const realStrategyLinks = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="strateg"]');
    return Array.from(links).map(l => ({
      href: l.getAttribute('href'),
      text: l.textContent.trim().substring(0, 80),
    }));
  });
  log(`Real strategy links from dashboard: ${JSON.stringify(realStrategyLinks)}`);

  // Also try API to get strategies
  const apiStrategies = await page.evaluate(async () => {
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('access_token');
      const resp = await fetch('/api/v1/strategies', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (resp.ok) {
        return await resp.json();
      }
      return { status: resp.status };
    } catch (e) {
      return { error: e.message };
    }
  });
  log(`API strategies: ${JSON.stringify(apiStrategies).substring(0, 500)}`);

  // Visit each strategy page (use real links + requested ones)
  const strategyPagesToCheck = new Set();
  for (const sl of realStrategyLinks) {
    if (sl.href) strategyPagesToCheck.add(sl.href);
  }
  // Also add the specifically requested ones
  ['/strategies/pead', '/strategies/momentum-quality', '/strategies/earnings-vol'].forEach(s => strategyPagesToCheck.add(s));

  for (const stratPath of strategyPagesToCheck) {
    try {
      await page.goto(`${BASE_URL}${stratPath}`, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(2000);

      const stratInfo = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        return {
          url: window.location.href,
          is404: bodyText.includes('404') || bodyText.includes('not found'),
          isLogin: bodyText.includes('Sign In') && window.location.href.includes('login'),
          hasEquityCurve: document.querySelectorAll('canvas, svg path, [class*="chart"]').length > 0,
          hasStats: bodyText.includes('Return') || bodyText.includes('Sharpe') || bodyText.includes('Win') || bodyText.includes('Drawdown'),
          hasTrades: bodyText.includes('Trade') || bodyText.includes('Entry') || bodyText.includes('Exit'),
          preview: bodyText.substring(0, 400),
          chartElements: document.querySelectorAll('canvas, svg').length,
        };
      });

      const safeName = stratPath.replace(/\//g, '_');
      await ss(page, `P4-${safeName}`);
      log(`Strategy ${stratPath}: is404=${stratInfo.is404}, isLogin=${stratInfo.isLogin}, hasChart=${stratInfo.hasEquityCurve}, hasStats=${stratInfo.hasStats}, charts=${stratInfo.chartElements}`);
      log(`  Preview: ${stratInfo.preview.substring(0, 200)}`);

      if (stratInfo.is404) {
        bug(`Strategy page ${stratPath} shows 404`, 'P1', `P4-${safeName}`, `Navigate to ${stratPath}`);
      }
      if (stratInfo.isLogin) {
        bug(`Strategy page ${stratPath} redirects to login (auth issue)`, 'P1', `P4-${safeName}`, `Navigate to ${stratPath} while logged in`);
      }
    } catch (e) {
      bug(`Strategy page ${stratPath} failed: ${e.message}`, 'P1', '', `Navigate to ${stratPath}`);
    }
  }

  // ===== PHASE 5: Edge Cases =====
  log('\n=== PHASE 5: EDGE CASES ===');

  // 22. Command palette
  log('\n--- Command Palette ---');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  try {
    // Try Cmd+K (macOS) or Ctrl+K
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(1500);

    let cmdPaletteOpen = await page.evaluate(() => {
      // Check for any modal/dialog/overlay that appeared
      const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="command"], [class*="palette"], [class*="overlay"], [class*="cmdk"]');
      return modals.length > 0;
    });

    if (!cmdPaletteOpen) {
      // Try clicking the search bar
      const searchBar = await page.$('[class*="search"], [placeholder*="Search" i], [placeholder*="command" i]');
      if (searchBar) {
        await searchBar.click();
        await page.waitForTimeout(1000);
        cmdPaletteOpen = true;
      }
    }

    if (cmdPaletteOpen) {
      await ss(page, 'P5-01-command-palette');
      await page.keyboard.type('NVDA');
      await page.waitForTimeout(1500);
      await ss(page, 'P5-02-palette-nvda');

      // Try to select result
      const result = await page.$('[class*="result"], [class*="item"], [role="option"]');
      if (result) {
        await result.click();
        await page.waitForTimeout(2000);
        await ss(page, 'P5-03-after-nvda');
        log('NVDA selected from command palette');

        // Verify we navigated or symbol changed
        const afterNvda = page.url();
        log(`After NVDA select, URL: ${afterNvda}`);
      } else {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
        await ss(page, 'P5-03-after-nvda-enter');
      }
    } else {
      log('Command palette did not open');
    }
  } catch (e) {
    log(`Command palette: ${e.message}`);
  }

  // Close any open overlays
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 23. Keyboard shortcuts overlay
  log('\n--- Keyboard Shortcuts ---');
  try {
    // Press "?" for shortcuts overlay
    await page.keyboard.press('Shift+/'); // "?" on US keyboard
    await page.waitForTimeout(1500);

    const overlayOpen = await page.evaluate(() => {
      const overlays = document.querySelectorAll('[class*="shortcut"], [class*="Shortcut"], [class*="keyboard"], [class*="help-overlay"], [role="dialog"]');
      return {
        found: overlays.length > 0,
        texts: Array.from(overlays).map(o => o.textContent.trim().substring(0, 100)),
      };
    });
    log(`Shortcuts overlay: ${JSON.stringify(overlayOpen)}`);

    if (overlayOpen.found) {
      await ss(page, 'P5-04-shortcuts-overlay');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      const stillOpen = await page.evaluate(() => {
        return document.querySelectorAll('[class*="shortcut"][class*="overlay"], [role="dialog"]').length > 0;
      });
      log(`Shortcuts overlay closed after Escape: ${!stillOpen}`);
    } else {
      log('Shortcuts overlay not found after pressing "?"');
    }
  } catch (e) {
    log(`Shortcuts overlay: ${e.message}`);
  }

  // 24-25. Profile menu
  log('\n--- Profile Menu ---');
  try {
    // Look for profile/avatar button - could be initials, icon, etc.
    const profileBtn = await page.$('[class*="avatar"], [class*="profile"], [class*="user-menu"], [class*="dropdown-trigger"]');
    if (!profileBtn) {
      // Try finding by looking for a button with single letter (initial)
      const allButtons = await page.$$('button');
      for (const btn of allButtons) {
        const text = (await btn.textContent()).trim();
        if (text.length === 1 && text.match(/[A-Z]/)) {
          log(`Found potential profile button with initial: "${text}"`);
          await btn.click();
          await page.waitForTimeout(1000);
          await ss(page, 'P5-05-profile-menu');

          // Look for menu items
          const menuItems = await page.evaluate(() => {
            const items = document.querySelectorAll('[role="menuitem"], [class*="menu-item"], [class*="dropdown-item"]');
            return Array.from(items).map(i => i.textContent.trim());
          });
          log(`Profile menu items: ${JSON.stringify(menuItems)}`);
          break;
        }
      }
    } else {
      await profileBtn.click();
      await page.waitForTimeout(1000);
      await ss(page, 'P5-05-profile-menu');
    }
  } catch (e) {
    log(`Profile menu: ${e.message}`);
  }

  // Close menu
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 26. Logout / Login cycle
  log('\n--- Logout/Login ---');
  try {
    // Find profile button and logout
    const allButtons = await page.$$('button');
    for (const btn of allButtons) {
      const text = (await btn.textContent()).trim();
      if (text.length === 1 && text.match(/[A-Z]/)) {
        await btn.click();
        await page.waitForTimeout(500);
        break;
      }
    }

    const logoutItem = await page.$('[role="menuitem"]:has-text("Log"), a:has-text("Log out"), button:has-text("Log out"), a:has-text("Logout"), button:has-text("Logout"), [role="menuitem"]:has-text("Sign out")');
    if (logoutItem) {
      await logoutItem.click();
      await page.waitForTimeout(3000);
      await ss(page, 'P5-06-after-logout');
      log(`After logout URL: ${page.url()}`);

      // Login again
      const inputs = await page.$$('input');
      if (inputs.length >= 2) {
        await inputs[0].fill('admin');
        await inputs[1].fill('alphaDesk2025!');
        const signBtn = await page.$('button:has-text("Sign In")');
        if (signBtn) await signBtn.click();
        await page.waitForTimeout(5000);
        await ss(page, 'P5-07-relogin');
        log(`After re-login URL: ${page.url()}`);

        if (page.url().includes('login')) {
          bug('Re-login after logout fails', 'P0', 'P5-07-relogin', 'Logout, then login again');
        } else {
          log('Re-login successful');
        }
      }
    } else {
      log('Logout menu item not found');
      await page.keyboard.press('Escape');
    }
  } catch (e) {
    log(`Logout/Login: ${e.message}`);
  }

  // Make sure we're logged in for remaining tests
  if (page.url().includes('login')) {
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].fill('admin');
      await inputs[1].fill('alphaDesk2025!');
      const signBtn = await page.$('button:has-text("Sign In")');
      if (signBtn) await signBtn.click();
      await page.waitForTimeout(5000);
    }
  }

  // 27. Static pages
  log('\n--- Static Pages ---');
  for (const staticPath of ['/privacy', '/terms', '/risk', '/docs']) {
    try {
      await page.goto(`${BASE_URL}${staticPath}`, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1500);
      await ss(page, `P5-static${staticPath.replace('/', '-')}`);

      const pageInfo = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        return {
          url: window.location.href,
          is404: bodyText.includes('404') || bodyText.includes('Page not found'),
          isLogin: window.location.href.includes('login'),
          hasContent: bodyText.length > 200,
          hasBackLink: !!document.querySelector('a[href="/"], a[href*="home"], a:has-text("Back"), a:has-text("Home")'),
          preview: bodyText.substring(0, 300),
        };
      });

      log(`${staticPath}: url=${pageInfo.url}, is404=${pageInfo.is404}, isLogin=${pageInfo.isLogin}, hasContent=${pageInfo.hasContent}, hasBack=${pageInfo.hasBackLink}`);

      if (pageInfo.isLogin) {
        bug(`Static page ${staticPath} redirects to login (should be public)`, 'P2', `P5-static${staticPath.replace('/', '-')}`, `Navigate to ${staticPath}`);
      } else if (pageInfo.is404) {
        bug(`Static page ${staticPath} returns 404`, 'P2', `P5-static${staticPath.replace('/', '-')}`, `Navigate to ${staticPath}`);
      }
    } catch (e) {
      log(`Static ${staticPath}: ${e.message}`);
    }
  }

  // 28. /dashboard URL
  log('\n--- /dashboard URL ---');
  try {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    await ss(page, 'P5-08-dashboard-url');
    const dashUrl = page.url();
    const dashBody = await page.textContent('body');
    log(`/dashboard: redirected to ${dashUrl}`);

    if (dashBody.includes('404') || dashBody.includes('Page not found')) {
      bug('/dashboard shows 404 instead of redirecting to main dashboard at /', 'P2', 'P5-08-dashboard-url', 'Navigate to /dashboard');
    }
  } catch (e) {
    log(`/dashboard: ${e.message}`);
  }

  // 29. Responsive 800x600
  log('\n--- Responsive 800x600 ---');
  try {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    await ss(page, 'P5-09-responsive-dashboard');

    // Check for horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.body.scrollWidth > window.innerWidth;
    });
    if (hasOverflow) {
      bug('Dashboard has horizontal scroll at 800x600 viewport', 'P3', 'P5-09-responsive-dashboard', 'Resize to 800x600');
    }

    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    await ss(page, 'P5-10-responsive-trade');

    // Reset viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
  } catch (e) {
    log(`Responsive: ${e.message}`);
  }

  // 30. Multi-tab test
  log('\n--- Multi-tab ---');
  try {
    const page2 = await context.newPage();
    await page2.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await page2.waitForTimeout(2000);

    const tab2Content = await page2.evaluate(() => document.body.innerText.substring(0, 200));
    log(`Second tab content: ${tab2Content.substring(0, 100)}`);

    // Both tabs should work
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    const tab1Content = await page.evaluate(() => document.body.innerText.substring(0, 200));
    log(`First tab still works: ${tab1Content.substring(0, 100)}`);

    await page2.close();
    log('Multi-tab test OK');
  } catch (e) {
    log(`Multi-tab: ${e.message}`);
  }

  // ===== PHASE 6: Console/Network Errors =====
  log('\n=== PHASE 6: CONSOLE/NETWORK ERRORS ===');

  // Dedicated per-page error collection
  for (const checkPage of ['/', '/trade', '/pipeline']) {
    const pgConsole = [];
    const pgNetwork = [];

    const testPage = await context.newPage();
    testPage.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        pgConsole.push(msg.text());
      }
    });
    testPage.on('response', resp => {
      if (resp.status() >= 400 && !resp.url().includes('favicon')) {
        pgNetwork.push({ url: resp.url(), status: resp.status() });
      }
    });

    try {
      await testPage.goto(`${BASE_URL}${checkPage}`, { waitUntil: 'networkidle', timeout: 20000 });
      await testPage.waitForTimeout(5000);

      const realConsoleErrors = pgConsole.filter(e => !e.includes('401'));
      const realNetErrors = pgNetwork.filter(e => e.status >= 500);

      if (realConsoleErrors.length > 0) {
        log(`[${checkPage}] JS errors: ${JSON.stringify(realConsoleErrors)}`);
        for (const ce of realConsoleErrors) {
          bug(`JavaScript error on ${checkPage}: ${ce.substring(0, 100)}`, 'P2', '', `Load ${checkPage}, check console`);
        }
      } else {
        log(`[${checkPage}] No JS errors (excluding 401s)`);
      }

      if (realNetErrors.length > 0) {
        log(`[${checkPage}] Server errors: ${JSON.stringify(realNetErrors)}`);
        for (const ne of realNetErrors) {
          bug(`Server error ${ne.status} on ${checkPage}: ${ne.url}`, 'P1', '', `Load ${checkPage}`);
        }
      } else {
        log(`[${checkPage}] No server errors (5xx)`);
      }

      // Also report 4xx that aren't auth-related
      const nonAuth4xx = pgNetwork.filter(e => e.status >= 400 && e.status < 500 && !e.url.includes('/auth'));
      if (nonAuth4xx.length > 0) {
        log(`[${checkPage}] 4xx errors (non-auth): ${JSON.stringify(nonAuth4xx.slice(0, 5))}`);
      }
    } catch (e) {
      log(`Error checking ${checkPage}: ${e.message}`);
    }
    await testPage.close();
  }

  // ===== OVERALL SUMMARY =====
  log('\n' + '='.repeat(60));
  log('FINAL EXHAUSTIVE BUG REPORT - ROUND 12');
  log('='.repeat(60));

  // Deduplicate and filter false positives
  const uniqueBugs = [];
  const seen = new Set();
  for (const b of bugs) {
    const key = `${b.severity}:${b.description.substring(0, 50)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueBugs.push(b);
    }
  }

  if (uniqueBugs.length === 0) {
    log('\n*** NO BUGS FOUND - APPLICATION IS CLEAN ***');
  } else {
    log(`\nTotal unique bugs: ${uniqueBugs.length}\n`);
    const p0 = uniqueBugs.filter(b => b.severity === 'P0');
    const p1 = uniqueBugs.filter(b => b.severity === 'P1');
    const p2 = uniqueBugs.filter(b => b.severity === 'P2');
    const p3 = uniqueBugs.filter(b => b.severity === 'P3');

    if (p0.length) {
      log(`\n--- P0 (Critical) ---`);
      p0.forEach((b, i) => log(`  ${i + 1}. ${b.description}\n     Steps: ${b.steps}\n     Screenshot: ${b.screenshot}`));
    }
    if (p1.length) {
      log(`\n--- P1 (High) ---`);
      p1.forEach((b, i) => log(`  ${i + 1}. ${b.description}\n     Steps: ${b.steps}\n     Screenshot: ${b.screenshot}`));
    }
    if (p2.length) {
      log(`\n--- P2 (Medium) ---`);
      p2.forEach((b, i) => log(`  ${i + 1}. ${b.description}\n     Steps: ${b.steps}\n     Screenshot: ${b.screenshot}`));
    }
    if (p3.length) {
      log(`\n--- P3 (Low) ---`);
      p3.forEach((b, i) => log(`  ${i + 1}. ${b.description}\n     Steps: ${b.steps}\n     Screenshot: ${b.screenshot}`));
    }
  }

  // Session-wide error summary
  const nonAuthConsole = consoleErrors.filter(e => !e.text.includes('401'));
  const nonAuthNetwork = networkErrors.filter(e => e.status >= 500 || (e.status >= 400 && !e.url.includes('/auth')));
  log(`\nSession-wide: ${consoleErrors.length} console errors (${nonAuthConsole.length} non-401), ${networkErrors.length} network errors (${nonAuthNetwork.length} significant)`);

  await browser.close();
  log('\nDone.');
})();
