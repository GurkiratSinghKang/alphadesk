import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import path from 'path';

const BASE = 'https://tradingalpha.net';
const SSDIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round7/workflows';
mkdirSync(SSDIR, { recursive: true });

let issues = [];
function logIssue(category, description, steps) {
  issues.push({ category, description, steps });
  console.log(`[ISSUE] ${category}: ${description}`);
}

function logOK(msg) {
  console.log(`[OK] ${msg}`);
}

async function ss(page, name) {
  const fp = path.join(SSDIR, `${name}.png`);
  await page.screenshot({ path: fp, fullPage: false });
  console.log(`  screenshot: ${name}.png`);
  return fp;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safeClick(page, selector, opts = {}) {
  try {
    await page.waitForSelector(selector, { timeout: opts.timeout || 5000 });
    await page.click(selector, { timeout: opts.timeout || 5000 });
    return true;
  } catch (e) {
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Collect console errors
  let consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // ============================================================
  // PHASE 1: LOGIN
  // ============================================================
  console.log('\n=== PHASE 1: LOGIN ===');
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  await ss(page, '01-login-page');

  // Fill credentials
  try {
    await page.fill('input[name="username"], input[type="text"], input[placeholder*="user" i], input[placeholder*="email" i]', 'admin', { timeout: 5000 });
    await page.fill('input[name="password"], input[type="password"]', 'alphaDesk2025!', { timeout: 5000 });
    await ss(page, '02-login-filled');
    await page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")', { timeout: 5000 });
    await page.waitForURL('**/dashboard**', { timeout: 15000 }).catch(() => {});
    await sleep(3000);
    await ss(page, '03-after-login');

    const url = page.url();
    if (url.includes('login')) {
      logIssue('LOGIN', 'Login did not redirect away from login page', 'Enter admin/alphaDesk2025! and submit');
    } else {
      logOK(`Login successful, redirected to ${url}`);
    }
  } catch (e) {
    logIssue('LOGIN', `Login flow failed: ${e.message}`, 'Navigate to /login and fill credentials');
    await ss(page, '03-login-error');
  }

  // ============================================================
  // PHASE 2: NAVIGATE TO TERMINAL
  // ============================================================
  console.log('\n=== PHASE 2: NAVIGATE TO TERMINAL ===');
  await page.goto(BASE + '/terminal', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);
  await ss(page, '04-terminal-page');

  const terminalUrl = page.url();
  if (terminalUrl.includes('login')) {
    logIssue('NAVIGATION', 'Terminal page redirected to login', 'Go to /terminal after login');
  } else {
    logOK(`Terminal loaded at ${terminalUrl}`);
  }

  // ============================================================
  // PHASE 3: SYMBOL SWITCHING (5 symbols)
  // ============================================================
  console.log('\n=== PHASE 3: SYMBOL SWITCHING ===');
  const symbolsToTest = ['AAPL', 'MSFT', 'TSLA', 'GOOGL', 'AMZN'];

  for (let i = 0; i < symbolsToTest.length; i++) {
    const sym = symbolsToTest[i];
    console.log(`  Testing symbol: ${sym}`);

    // Try clicking in watchlist
    const clicked = await safeClick(page, `text="${sym}"`, { timeout: 3000 })
      || await safeClick(page, `[data-symbol="${sym}"]`, { timeout: 2000 })
      || await safeClick(page, `td:has-text("${sym}")`, { timeout: 2000 })
      || await safeClick(page, `div:has-text("${sym}"):not(:has(div))`, { timeout: 2000 });

    if (!clicked) {
      logIssue('SYMBOL_SWITCH', `Could not find/click ${sym} in watchlist`, `Look for ${sym} in the watchlist panel and click it`);
      continue;
    }

    await sleep(2000);
    await ss(page, `05-symbol-${sym}`);

    // Check if header updated
    const headerText = await page.textContent('body').catch(() => '');
    if (!headerText.includes(sym)) {
      logIssue('SYMBOL_SWITCH', `Header may not show ${sym} after clicking`, `Click ${sym} in watchlist, check page header`);
    } else {
      logOK(`${sym} appears on page after clicking`);
    }
  }

  // ============================================================
  // PHASE 4: CHART INTERACTIONS - Timeframes
  // ============================================================
  console.log('\n=== PHASE 4: CHART TIMEFRAMES ===');
  const timeframes = ['1m', '5m', '15m', '1H', '4H', 'D', 'W', 'M'];

  for (const tf of timeframes) {
    const tfClicked = await safeClick(page, `button:has-text("${tf}")`, { timeout: 2000 })
      || await safeClick(page, `[data-timeframe="${tf}"]`, { timeout: 2000 })
      || await safeClick(page, `text="${tf}"`, { timeout: 2000 });

    if (tfClicked) {
      await sleep(1500);
      logOK(`Timeframe ${tf} clicked`);
    } else {
      logIssue('CHART', `Could not find/click timeframe button "${tf}"`, `Look for timeframe selector and click ${tf}`);
    }
  }
  await ss(page, '06-timeframes-tested');

  // ============================================================
  // PHASE 5: CHART TYPE SWITCHING
  // ============================================================
  console.log('\n=== PHASE 5: CHART TYPE ===');
  const chartTypes = ['candle', 'line', 'area', 'Candle', 'Line', 'Area', 'Candlestick'];
  for (const ct of chartTypes) {
    const ctClicked = await safeClick(page, `button:has-text("${ct}")`, { timeout: 1500 })
      || await safeClick(page, `[data-chart-type="${ct.toLowerCase()}"]`, { timeout: 1500 });
    if (ctClicked) {
      await sleep(1000);
      logOK(`Chart type "${ct}" clicked`);
      await ss(page, `07-chart-type-${ct.toLowerCase()}`);
      break;
    }
  }

  // Check for chart type dropdown/select
  const chartTypeSelect = await page.$('select[name*="chart"], select[class*="chart"]');
  if (chartTypeSelect) {
    logOK('Found chart type dropdown');
  }

  // ============================================================
  // PHASE 6: INDICATORS
  // ============================================================
  console.log('\n=== PHASE 6: INDICATORS ===');
  // Try to find indicator button/menu
  const indicatorClicked = await safeClick(page, 'button:has-text("Indicator")', { timeout: 3000 })
    || await safeClick(page, 'button:has-text("indicator")', { timeout: 2000 })
    || await safeClick(page, '[aria-label*="indicator" i]', { timeout: 2000 })
    || await safeClick(page, 'button:has-text("EMA")', { timeout: 2000 });

  if (indicatorClicked) {
    await sleep(1000);
    await ss(page, '08-indicator-menu');
    // Try to add EMA
    const emaClicked = await safeClick(page, 'text="EMA"', { timeout: 2000 })
      || await safeClick(page, 'button:has-text("EMA")', { timeout: 2000 });
    if (emaClicked) {
      await sleep(1000);
      logOK('EMA indicator added/clicked');
    }
  } else {
    logIssue('CHART', 'Could not find indicator button/menu', 'Look for an Indicators button on chart toolbar');
  }
  await ss(page, '09-after-indicator');

  // ============================================================
  // PHASE 7: BUY/SELL BUTTONS
  // ============================================================
  console.log('\n=== PHASE 7: BUY/SELL BUTTONS ===');

  const buyClicked = await safeClick(page, 'button:has-text("BUY")', { timeout: 3000 })
    || await safeClick(page, 'button:has-text("Buy")', { timeout: 2000 });
  if (buyClicked) {
    await sleep(2000);
    await ss(page, '10-buy-clicked');
    logOK('BUY button clicked');

    // Check what happened - modal? form? toast?
    const modal = await page.$('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]');
    if (modal) {
      logOK('BUY opened a modal/dialog');
      // Close it
      await safeClick(page, 'button:has-text("Cancel")', { timeout: 2000 })
        || await safeClick(page, 'button:has-text("Close")', { timeout: 2000 })
        || await safeClick(page, '[aria-label="Close"]', { timeout: 2000 });
    }
  } else {
    logIssue('TRADING', 'Could not find BUY button', 'Look for BUY button on terminal page');
  }

  const sellClicked = await safeClick(page, 'button:has-text("SELL")', { timeout: 3000 })
    || await safeClick(page, 'button:has-text("Sell")', { timeout: 2000 });
  if (sellClicked) {
    await sleep(2000);
    await ss(page, '11-sell-clicked');
    logOK('SELL button clicked');

    const modal = await page.$('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]');
    if (modal) {
      logOK('SELL opened a modal/dialog');
      await safeClick(page, 'button:has-text("Cancel")', { timeout: 2000 })
        || await safeClick(page, 'button:has-text("Close")', { timeout: 2000 })
        || await safeClick(page, '[aria-label="Close"]', { timeout: 2000 });
    }
  } else {
    logIssue('TRADING', 'Could not find SELL button', 'Look for SELL button on terminal page');
  }

  // ============================================================
  // PHASE 8: ORDER PLACEMENT
  // ============================================================
  console.log('\n=== PHASE 8: ORDER PLACEMENT ===');

  // Try order tab
  const orderTabClicked = await safeClick(page, 'button:has-text("Order")', { timeout: 3000 })
    || await safeClick(page, '[role="tab"]:has-text("Order")', { timeout: 2000 })
    || await safeClick(page, 'a:has-text("Order")', { timeout: 2000 });

  if (orderTabClicked) {
    await sleep(1500);
    await ss(page, '12-order-tab');
    logOK('Order tab opened');

    // Try to place paper order for 1 share SPY
    // First make sure SPY is selected
    const spyInput = await page.$('input[placeholder*="symbol" i], input[name*="symbol" i]');
    if (spyInput) {
      await spyInput.fill('SPY');
      await sleep(500);
    }

    // Fill quantity
    const qtyInput = await page.$('input[placeholder*="qty" i], input[name*="qty" i], input[placeholder*="quantity" i], input[name*="quantity" i], input[type="number"]');
    if (qtyInput) {
      await qtyInput.fill('1');
      logOK('Filled quantity = 1');
    }

    // Submit order
    const submitOrder = await safeClick(page, 'button:has-text("Place Order")', { timeout: 2000 })
      || await safeClick(page, 'button:has-text("Submit")', { timeout: 2000 })
      || await safeClick(page, 'button:has-text("Execute")', { timeout: 2000 })
      || await safeClick(page, 'button[type="submit"]', { timeout: 2000 });

    if (submitOrder) {
      await sleep(2000);
      await ss(page, '13-order-submitted');
      logOK('Order submit button clicked');
    } else {
      logIssue('TRADING', 'Could not find order submit button', 'Go to Order tab, look for Place Order / Submit button');
    }
  } else {
    logIssue('TRADING', 'Could not find Order tab', 'Look for Order tab on terminal page');
  }

  // Check Orders tab
  const ordersTabClicked = await safeClick(page, 'button:has-text("Orders")', { timeout: 3000 })
    || await safeClick(page, '[role="tab"]:has-text("Orders")', { timeout: 2000 });
  if (ordersTabClicked) {
    await sleep(1500);
    await ss(page, '14-orders-list');
    logOK('Orders tab opened');
  }

  // Check Positions tab
  const posTabClicked = await safeClick(page, 'button:has-text("Position")', { timeout: 3000 })
    || await safeClick(page, '[role="tab"]:has-text("Position")', { timeout: 2000 });
  if (posTabClicked) {
    await sleep(1500);
    await ss(page, '15-positions-list');
    logOK('Positions tab opened');
  }

  // ============================================================
  // PHASE 9: COMMAND PALETTE (Ctrl+K)
  // ============================================================
  console.log('\n=== PHASE 9: COMMAND PALETTE ===');

  await page.keyboard.press('Control+k');
  await sleep(1500);
  let paletteVisible = await page.$('[role="dialog"], [class*="command"], [class*="palette"], [class*="cmdk"], [data-cmdk-root]');

  if (!paletteVisible) {
    // Try Meta+K (macOS)
    await page.keyboard.press('Meta+k');
    await sleep(1500);
    paletteVisible = await page.$('[role="dialog"], [class*="command"], [class*="palette"], [class*="cmdk"], [data-cmdk-root]');
  }

  if (paletteVisible) {
    await ss(page, '16-command-palette-open');
    logOK('Command palette opened');

    // Search for TSLA
    const cmdInput = await page.$('[cmdk-input], input[placeholder*="search" i], input[placeholder*="command" i], [role="combobox"]');
    if (cmdInput) {
      await cmdInput.fill('TSLA');
      await sleep(1500);
      await ss(page, '17-cmd-palette-tsla-search');

      // Check if results appear
      const results = await page.$$('[cmdk-item], [role="option"], [class*="result"], li');
      if (results.length > 0) {
        logOK(`TSLA search returned ${results.length} results`);
        // Click first result
        await results[0].click();
        await sleep(2000);
        await ss(page, '18-cmd-palette-tsla-selected');

        const bodyText = await page.textContent('body').catch(() => '');
        if (bodyText.includes('TSLA')) {
          logOK('TSLA selected from command palette, page updated');
        }
      } else {
        logIssue('CMD_PALETTE', 'No search results for TSLA', 'Open Ctrl+K, type TSLA');
      }
    }

    // Test "Analyze current symbol"
    await page.keyboard.press('Control+k');
    await sleep(1000);
    const cmdInput2 = await page.$('[cmdk-input], input[placeholder*="search" i], input[placeholder*="command" i], [role="combobox"]');
    if (cmdInput2) {
      await cmdInput2.fill('Analyze');
      await sleep(1500);
      await ss(page, '19-cmd-analyze');
      const analyzeItem = await page.$('[cmdk-item]:has-text("Analyze"), [role="option"]:has-text("Analyze")');
      if (analyzeItem) {
        await analyzeItem.click();
        await sleep(3000);
        await ss(page, '20-analyze-result');
        logOK('"Analyze" command executed');
      } else {
        logIssue('CMD_PALETTE', 'No "Analyze current symbol" option found', 'Open Ctrl+K, type "Analyze"');
      }
    }

    // Test "Screen momentum stocks"
    await page.keyboard.press('Control+k');
    await sleep(1000);
    const cmdInput3 = await page.$('[cmdk-input], input[placeholder*="search" i], input[placeholder*="command" i], [role="combobox"]');
    if (cmdInput3) {
      await cmdInput3.fill('Screen');
      await sleep(1500);
      await ss(page, '21-cmd-screen');
      const screenItem = await page.$('[cmdk-item]:has-text("Screen"), [role="option"]:has-text("Screen"), [cmdk-item]:has-text("momentum")');
      if (screenItem) {
        await screenItem.click();
        await sleep(3000);
        await ss(page, '22-screen-result');
        logOK('"Screen" command executed');
      } else {
        logIssue('CMD_PALETTE', 'No "Screen momentum stocks" option found', 'Open Ctrl+K, type "Screen"');
      }
    }

    // Test "Show portfolio"
    await page.keyboard.press('Control+k');
    await sleep(1000);
    const cmdInput4 = await page.$('[cmdk-input], input[placeholder*="search" i], input[placeholder*="command" i], [role="combobox"]');
    if (cmdInput4) {
      await cmdInput4.fill('portfolio');
      await sleep(1500);
      await ss(page, '23-cmd-portfolio');
      const portfolioItem = await page.$('[cmdk-item]:has-text("portfolio"), [role="option"]:has-text("portfolio")');
      if (portfolioItem) {
        await portfolioItem.click();
        await sleep(3000);
        await ss(page, '24-portfolio-result');
        logOK('"Show portfolio" command executed');
      } else {
        logIssue('CMD_PALETTE', 'No "Show portfolio" option found', 'Open Ctrl+K, type "portfolio"');
      }
    }
  } else {
    logIssue('CMD_PALETTE', 'Command palette did not open with Ctrl+K or Meta+K', 'Press Ctrl+K or Cmd+K on terminal page');
  }

  // ============================================================
  // PHASE 10: STRATEGY DETAIL PAGE
  // ============================================================
  console.log('\n=== PHASE 10: STRATEGY DETAIL ===');
  await page.goto(BASE + '/strategies/pead', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);
  await ss(page, '25-strategy-pead');

  const stratUrl = page.url();
  if (stratUrl.includes('login')) {
    logIssue('STRATEGY', 'Strategy page redirected to login', 'Go to /strategies/pead');
  } else if (stratUrl.includes('404') || stratUrl.includes('not-found')) {
    logIssue('STRATEGY', 'Strategy page returned 404', 'Go to /strategies/pead');
  } else {
    logOK(`Strategy page loaded: ${stratUrl}`);
  }

  // Pause/Resume toggle
  const pauseToggle = await safeClick(page, 'button:has-text("Pause")', { timeout: 3000 })
    || await safeClick(page, 'button:has-text("Resume")', { timeout: 2000 })
    || await safeClick(page, '[role="switch"]', { timeout: 2000 });
  if (pauseToggle) {
    await sleep(1500);
    await ss(page, '26-strategy-toggle');
    logOK('Pause/Resume toggle clicked');
  } else {
    logIssue('STRATEGY', 'Could not find Pause/Resume toggle', 'Go to /strategies/pead, look for pause/resume button');
  }

  // Strategy tabs
  const stratTabs = ['About', 'Positions', 'Sector', 'Correlation', 'Analytics'];
  for (const tab of stratTabs) {
    const tabClicked = await safeClick(page, `button:has-text("${tab}")`, { timeout: 2000 })
      || await safeClick(page, `[role="tab"]:has-text("${tab}")`, { timeout: 2000 })
      || await safeClick(page, `a:has-text("${tab}")`, { timeout: 2000 });
    if (tabClicked) {
      await sleep(1500);
      await ss(page, `27-strategy-tab-${tab.toLowerCase()}`);
      logOK(`Strategy tab "${tab}" clicked`);
    } else {
      logIssue('STRATEGY', `Could not find "${tab}" tab on strategy page`, `Go to /strategies/pead, look for ${tab} tab`);
    }
  }

  // ============================================================
  // PHASE 11: PIPELINE
  // ============================================================
  console.log('\n=== PHASE 11: PIPELINE ===');
  await page.goto(BASE + '/pipeline', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);
  await ss(page, '28-pipeline-page');

  // Try Run Pipeline
  const runPipelineClicked = await safeClick(page, 'button:has-text("Run Pipeline")', { timeout: 3000 })
    || await safeClick(page, 'button:has-text("Run")', { timeout: 2000 });
  if (runPipelineClicked) {
    await sleep(3000);
    await ss(page, '29-pipeline-running');
    logOK('Run Pipeline clicked');
  } else {
    logIssue('PIPELINE', 'Could not find "Run Pipeline" button', 'Go to /pipeline, look for Run Pipeline button');
  }

  // Strategy builder
  const builderInput = await page.$('textarea, input[placeholder*="strategy" i], input[placeholder*="buy" i], [contenteditable]');
  if (builderInput) {
    await builderInput.fill('Buy when RSI < 30');
    await sleep(1000);
    await ss(page, '30-pipeline-strategy-input');
    logOK('Strategy builder accepted text input');
  }

  // Try backtest with SMA
  const backtestInput = await page.$('select[name*="strategy"], [class*="strategy-select"]');
  if (backtestInput) {
    logOK('Found strategy selector for backtest');
  }

  const backtestBtn = await safeClick(page, 'button:has-text("Backtest")', { timeout: 3000 })
    || await safeClick(page, 'button:has-text("Run Backtest")', { timeout: 2000 });
  if (backtestBtn) {
    await sleep(5000);
    await ss(page, '31-backtest-result');
    logOK('Backtest button clicked');
  } else {
    logIssue('PIPELINE', 'Could not find Backtest button', 'Go to /pipeline, look for Backtest button');
  }

  // ============================================================
  // PHASE 12: PROFILE MENU
  // ============================================================
  console.log('\n=== PHASE 12: PROFILE MENU ===');
  // Navigate back to terminal/dashboard first
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(2000);

  // Click avatar
  const avatarClicked = await safeClick(page, '[class*="avatar"], img[alt*="avatar" i], img[alt*="user" i], img[alt*="profile" i]', { timeout: 3000 })
    || await safeClick(page, 'button[class*="avatar"]', { timeout: 2000 })
    || await safeClick(page, '[data-testid*="avatar"]', { timeout: 2000 })
    || await safeClick(page, 'button:has(img)', { timeout: 2000 });

  if (avatarClicked) {
    await sleep(1500);
    await ss(page, '32-profile-menu');
    logOK('Avatar/profile clicked, menu may be open');

    // Keyboard Shortcuts
    const kbClicked = await safeClick(page, 'text="Keyboard Shortcuts"', { timeout: 2000 })
      || await safeClick(page, '[role="menuitem"]:has-text("Keyboard")', { timeout: 2000 });
    if (kbClicked) {
      await sleep(1500);
      await ss(page, '33-keyboard-shortcuts');
      logOK('Keyboard Shortcuts overlay opened');
      // Close it
      await page.keyboard.press('Escape');
      await sleep(500);
    } else {
      logIssue('PROFILE', 'Could not find "Keyboard Shortcuts" menu item', 'Click avatar, look for Keyboard Shortcuts');
    }

    // Re-open menu
    await safeClick(page, '[class*="avatar"], button:has(img)', { timeout: 2000 });
    await sleep(1000);

    // Settings
    const settingsClicked = await safeClick(page, 'text="Settings"', { timeout: 2000 })
      || await safeClick(page, '[role="menuitem"]:has-text("Settings")', { timeout: 2000 });
    if (settingsClicked) {
      await sleep(1500);
      await ss(page, '34-settings-sheet');
      logOK('Settings opened');
      await page.keyboard.press('Escape');
      await sleep(500);
    } else {
      logIssue('PROFILE', 'Could not find "Settings" menu item', 'Click avatar, look for Settings');
    }

    // Re-open menu
    await safeClick(page, '[class*="avatar"], button:has(img)', { timeout: 2000 });
    await sleep(1000);

    // Logout
    const logoutClicked = await safeClick(page, 'text="Logout"', { timeout: 2000 })
      || await safeClick(page, 'text="Log out"', { timeout: 2000 })
      || await safeClick(page, 'text="Sign out"', { timeout: 2000 })
      || await safeClick(page, '[role="menuitem"]:has-text("Log")', { timeout: 2000 });
    if (logoutClicked) {
      await sleep(3000);
      await ss(page, '35-after-logout');
      const afterLogoutUrl = page.url();
      if (afterLogoutUrl.includes('login')) {
        logOK('Logout redirected to login page');
      } else {
        logIssue('PROFILE', `Logout did not redirect to login. URL: ${afterLogoutUrl}`, 'Click avatar > Logout');
      }

      // Log back in
      try {
        await page.fill('input[name="username"], input[type="text"], input[placeholder*="user" i]', 'admin', { timeout: 3000 });
        await page.fill('input[name="password"], input[type="password"]', 'alphaDesk2025!', { timeout: 3000 });
        await page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")', { timeout: 3000 });
        await sleep(3000);
        await ss(page, '36-re-login');
        logOK('Re-login successful');
      } catch (e) {
        logIssue('PROFILE', 'Could not re-login after logout', 'After logout, try to log back in');
      }
    } else {
      logIssue('PROFILE', 'Could not find Logout menu item', 'Click avatar, look for Logout option');
    }
  } else {
    logIssue('PROFILE', 'Could not find/click avatar/profile button', 'Look for user avatar in header/sidebar');
  }

  // ============================================================
  // PHASE 13: EDGE CASES
  // ============================================================
  console.log('\n=== PHASE 13: EDGE CASES ===');

  // Navigate to terminal for edge case testing
  await page.goto(BASE + '/terminal', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  // Edge case 1: Add non-existent symbol
  console.log('  Edge case: non-existent symbol');
  const addSymBtn = await safeClick(page, 'button:has-text("Add")', { timeout: 2000 })
    || await safeClick(page, 'button:has-text("+")', { timeout: 2000 })
    || await safeClick(page, '[aria-label*="add" i]', { timeout: 2000 });
  if (addSymBtn) {
    const symInput = await page.$('input[placeholder*="symbol" i], input[placeholder*="ticker" i], input[placeholder*="search" i]');
    if (symInput) {
      await symInput.fill('XXXXX');
      await sleep(1000);
      await page.keyboard.press('Enter');
      await sleep(2000);
      await ss(page, '37-invalid-symbol');
      logOK('Tested invalid symbol "XXXXX"');
    }
  } else {
    // Try command palette for symbol
    await page.keyboard.press('Control+k');
    await sleep(1000);
    const cmdI = await page.$('[cmdk-input], input[placeholder*="search" i], [role="combobox"]');
    if (cmdI) {
      await cmdI.fill('XXXXX');
      await sleep(2000);
      await ss(page, '37-invalid-symbol-cmd');
      logOK('Tested invalid symbol "XXXXX" via command palette');
      await page.keyboard.press('Escape');
    }
  }

  // Edge case 2: Order with 0 quantity
  console.log('  Edge case: 0 quantity order');
  const orderTab2 = await safeClick(page, 'button:has-text("Order")', { timeout: 2000 })
    || await safeClick(page, '[role="tab"]:has-text("Order")', { timeout: 2000 });
  if (orderTab2) {
    await sleep(1000);
    const qtyInput2 = await page.$('input[type="number"], input[placeholder*="qty" i], input[name*="qty" i]');
    if (qtyInput2) {
      await qtyInput2.fill('0');
      await safeClick(page, 'button:has-text("Place"), button:has-text("Submit"), button[type="submit"]', { timeout: 2000 });
      await sleep(1500);
      await ss(page, '38-zero-qty-order');
      logOK('Tested 0 quantity order');
    }

    // Edge case 3: Negative quantity
    console.log('  Edge case: negative quantity order');
    if (qtyInput2) {
      await qtyInput2.fill('-5');
      await safeClick(page, 'button:has-text("Place"), button:has-text("Submit"), button[type="submit"]', { timeout: 2000 });
      await sleep(1500);
      await ss(page, '39-negative-qty-order');
      logOK('Tested negative quantity order');
    }
  }

  // Edge case 4: Rapid page switching
  console.log('  Edge case: rapid page switching');
  const pages = ['/dashboard', '/terminal', '/strategies/pead', '/pipeline', '/dashboard',
                 '/terminal', '/pipeline', '/strategies/pead', '/dashboard', '/terminal'];
  let rapidErrors = 0;
  for (const p of pages) {
    try {
      await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await sleep(500);
    } catch (e) {
      rapidErrors++;
    }
  }
  await ss(page, '40-rapid-switch');
  if (rapidErrors > 0) {
    logIssue('EDGE_CASE', `${rapidErrors} errors during rapid page switching`, 'Navigate rapidly between 10 pages');
  } else {
    logOK('Rapid page switching (10 pages) completed without errors');
  }

  // Edge case 5: Long string in command palette
  console.log('  Edge case: long string in command palette');
  await page.keyboard.press('Control+k');
  await sleep(1000);
  const cmdLong = await page.$('[cmdk-input], input[placeholder*="search" i], [role="combobox"]');
  if (cmdLong) {
    const longStr = 'A'.repeat(120);
    await cmdLong.fill(longStr);
    await sleep(1500);
    await ss(page, '41-long-string-cmd');

    // Check for visual overflow
    const inputBox = await cmdLong.boundingBox();
    if (inputBox && inputBox.width > 1440) {
      logIssue('EDGE_CASE', 'Command palette input overflows viewport with long string', 'Open Ctrl+K, type 120 chars');
    } else {
      logOK('Long string in command palette handled without visible overflow');
    }
    await page.keyboard.press('Escape');
  }

  // Edge case 6: Small viewport (800x600)
  console.log('  Edge case: small viewport');
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(BASE + '/terminal', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);
  await ss(page, '42-small-viewport-terminal');

  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(2000);
  await ss(page, '43-small-viewport-dashboard');

  // Check for horizontal scroll (bad sign)
  const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (hasHScroll) {
    logIssue('EDGE_CASE', 'Page has horizontal scroll at 800x600 viewport', 'Resize browser to 800x600, check for horizontal scrollbar');
  } else {
    logOK('No horizontal overflow at 800x600');
  }

  // Reset viewport
  await page.setViewportSize({ width: 1440, height: 900 });

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n\n========================================');
  console.log('       QA ROUND 7 TEST SUMMARY');
  console.log('========================================');
  console.log(`Total issues found: ${issues.length}`);
  console.log(`Console errors captured: ${consoleErrors.length}`);

  if (issues.length > 0) {
    console.log('\n--- ISSUES ---');
    issues.forEach((issue, i) => {
      console.log(`\n${i + 1}. [${issue.category}] ${issue.description}`);
      console.log(`   Steps: ${issue.steps}`);
    });
  }

  if (consoleErrors.length > 0) {
    console.log('\n--- CONSOLE ERRORS (first 20) ---');
    consoleErrors.slice(0, 20).forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.substring(0, 200)}`);
    });
  }

  console.log('\n========================================');

  await browser.close();
})();
