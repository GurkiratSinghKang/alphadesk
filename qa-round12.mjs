import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round12';
const BASE_URL = 'https://tradingalpha.net';
const bugs = [];

function reportBug(description, severity, screenshot, steps) {
  bugs.push({ description, severity, screenshot, steps });
  console.log(`[BUG ${severity}] ${description}`);
}

function log(msg) {
  console.log(`[INFO] ${msg}`);
}

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  log(`Screenshot saved: ${name}.png`);
  return filePath;
}

async function screenshotFull(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  log(`Full screenshot saved: ${name}.png`);
  return filePath;
}

async function collectConsoleErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  const consoleErrors = await collectConsoleErrors(page);

  // Track network errors
  const networkErrors = [];
  page.on('response', response => {
    if (response.status() >= 400) {
      networkErrors.push({ url: response.url(), status: response.status() });
    }
  });
  page.on('requestfailed', request => {
    networkErrors.push({ url: request.url(), failure: request.failure()?.errorText });
  });

  // ===== LOGIN =====
  log('=== Phase 0: Login ===');
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[name="username"], input[type="text"]', 'admin');
    await page.fill('input[name="password"], input[type="password"]', 'alphaDesk2025!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/', { timeout: 15000 });
    await page.waitForTimeout(3000);
    log('Login successful');
  } catch (e) {
    reportBug(`Login failed: ${e.message}`, 'P0', 'login-fail', 'Navigate to /login, enter credentials, click submit');
    await screenshot(page, 'login-fail');
  }

  // ===== PHASE 1: Dashboard =====
  log('=== Phase 1: Dashboard Deep Inspection ===');
  await page.waitForTimeout(2000);
  await screenshot(page, '01-dashboard-full');

  // Grab all text content for number analysis
  const dashboardText = await page.textContent('body');
  log(`Dashboard text length: ${dashboardText.length}`);

  // Check portfolio value and P&L
  try {
    // Look for portfolio value, day P&L
    const portfolioData = await page.evaluate(() => {
      const body = document.body.innerText;
      const data = {};
      // Look for patterns of dollar amounts
      const dollarAmounts = body.match(/\$[\d,]+\.?\d*/g) || [];
      data.dollarAmounts = dollarAmounts.slice(0, 20);
      // Look for percentage values
      const percentages = body.match(/[+-]?\d+\.?\d*%/g) || [];
      data.percentages = percentages.slice(0, 20);
      return data;
    });
    log(`Dollar amounts found: ${JSON.stringify(portfolioData.dollarAmounts)}`);
    log(`Percentages found: ${JSON.stringify(portfolioData.percentages)}`);
  } catch (e) {
    log(`Could not parse portfolio data: ${e.message}`);
  }

  // Check all strategy cards
  try {
    const strategyCards = await page.$$('[class*="strategy"], [class*="Strategy"], [data-strategy], a[href*="strategies"]');
    log(`Found ${strategyCards.length} strategy-related elements`);

    // Look for strategy card links specifically
    const strategyLinks = await page.$$eval('a[href*="strategies"]', els => els.map(el => ({
      href: el.getAttribute('href'),
      text: el.textContent.trim().substring(0, 50)
    })));
    log(`Strategy links found: ${JSON.stringify(strategyLinks)}`);
  } catch (e) {
    log(`Strategy card check: ${e.message}`);
  }

  // Check P&L calendar
  try {
    const calendarCells = await page.$$('[class*="calendar"], [class*="Calendar"]');
    log(`Calendar elements found: ${calendarCells.length}`);
    await screenshot(page, '01b-dashboard-calendar-area');
  } catch (e) {
    log(`Calendar check: ${e.message}`);
  }

  // Check allocation donut
  try {
    const canvas = await page.$$('canvas');
    log(`Canvas elements (charts) found: ${canvas.length}`);
  } catch (e) {
    log(`Donut check: ${e.message}`);
  }

  // Check news section
  try {
    const newsLinks = await page.$$eval('a[href*="http"]', els =>
      els.filter(el => {
        const href = el.getAttribute('href');
        return href && (href.includes('example.com') || href.includes('placeholder'));
      }).map(el => el.getAttribute('href'))
    );
    if (newsLinks.length > 0) {
      reportBug(`Found placeholder/example.com links: ${newsLinks.join(', ')}`, 'P2', '01-dashboard-full', 'Check news section links');
    } else {
      log('No example.com or placeholder links found');
    }
  } catch (e) {
    log(`News link check: ${e.message}`);
  }

  // Scroll down to see full dashboard
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(500);
  await screenshot(page, '01c-dashboard-scrolled');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await screenshot(page, '01d-dashboard-bottom');
  await page.evaluate(() => window.scrollTo(0, 0));

  // Check positions on dashboard
  try {
    const positionRows = await page.$$('tr, [class*="position"], [class*="Position"]');
    log(`Position/table row elements: ${positionRows.length}`);

    // Extract position data for math verification
    const posData = await page.evaluate(() => {
      const rows = document.querySelectorAll('tr');
      const data = [];
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          data.push(Array.from(cells).map(c => c.textContent.trim()));
        }
      });
      return data.slice(0, 10);
    });
    log(`Position table data: ${JSON.stringify(posData)}`);
  } catch (e) {
    log(`Position check: ${e.message}`);
  }

  // ===== PHASE 2: Trade Page =====
  log('\n=== Phase 2: Trade Page ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await screenshot(page, '02-trade-page');

  // Check L1 data bar
  try {
    const l1Data = await page.evaluate(() => {
      const body = document.body.innerText;
      const data = {};
      // Look for bid/ask/spread/volume/high/low labels and values
      const labels = ['Bid', 'Ask', 'Spread', 'Volume', 'High', 'Low', 'Open', 'Close'];
      labels.forEach(label => {
        const regex = new RegExp(label + '[:\\s]*\\$?([\\d,.]+)', 'i');
        const match = body.match(regex);
        data[label] = match ? match[1] : 'NOT FOUND';
      });
      return data;
    });
    log(`L1 Data: ${JSON.stringify(l1Data)}`);

    // Check for zero values
    Object.entries(l1Data).forEach(([key, val]) => {
      if (val === '0' || val === '0.00' || val === '0.0') {
        reportBug(`L1 data "${key}" shows zero value`, 'P1', '02-trade-page', `Load /trade, check ${key} value`);
      }
    });
  } catch (e) {
    log(`L1 data check: ${e.message}`);
  }

  // Switch to AAPL
  try {
    // Look for symbol input/search
    const symbolInput = await page.$('input[placeholder*="symbol" i], input[placeholder*="search" i], input[placeholder*="ticker" i], [class*="symbol"] input');
    if (symbolInput) {
      await symbolInput.fill('AAPL');
      await page.waitForTimeout(1000);
      // Try to select from dropdown
      const suggestion = await page.$('[class*="suggestion"], [class*="dropdown"] [class*="item"], [role="option"]');
      if (suggestion) {
        await suggestion.click();
      } else {
        await symbolInput.press('Enter');
      }
      await page.waitForTimeout(3000);
      await screenshot(page, '02b-trade-aapl');
      log('Switched to AAPL');
    } else {
      log('No symbol input found - checking alternative methods');
      // Try clicking on symbol selector area
      const symbolArea = await page.$('[class*="symbol"], [class*="ticker"]');
      if (symbolArea) {
        log(`Found symbol area: ${await symbolArea.textContent()}`);
      }
    }
  } catch (e) {
    log(`AAPL switch: ${e.message}`);
  }

  // Check timeframe buttons
  try {
    const timeframeButtons = await page.$$('button');
    const tfTexts = await Promise.all(timeframeButtons.map(b => b.textContent()));
    const timeframes = tfTexts.filter(t => /^(1[mM]|5[mM]|15[mM]|30[mM]|1[hH]|4[hH]|1[dD]|1[wW])$/.test(t.trim()));
    log(`Timeframe buttons found: ${timeframes.join(', ')}`);

    // Click 1m if available
    for (const btn of timeframeButtons) {
      const text = await btn.textContent();
      if (text.trim() === '1m' || text.trim() === '1M') {
        await btn.click();
        await page.waitForTimeout(3000);
        await screenshot(page, '02c-trade-1m-timeframe');
        log('Switched to 1m timeframe');
        break;
      }
    }
  } catch (e) {
    log(`Timeframe check: ${e.message}`);
  }

  // Check key levels panel
  try {
    const rightPanel = await page.evaluate(() => {
      const body = document.body.innerText;
      const support = body.match(/[Ss]upport[:\s]*\$?([\d,.]+)/);
      const resistance = body.match(/[Rr]esistance[:\s]*\$?([\d,.]+)/);
      return {
        support: support ? support[1] : 'NOT FOUND',
        resistance: resistance ? resistance[1] : 'NOT FOUND'
      };
    });
    log(`Key levels: ${JSON.stringify(rightPanel)}`);
  } catch (e) {
    log(`Key levels check: ${e.message}`);
  }

  // Try placing a limit order
  try {
    // Look for order form
    const orderType = await page.$('select, [class*="order-type"], [class*="orderType"]');
    const qtyInput = await page.$('input[placeholder*="qty" i], input[placeholder*="quantity" i], input[placeholder*="shares" i], input[name*="qty" i], input[name*="quantity" i]');
    const priceInput = await page.$('input[placeholder*="price" i], input[name*="price" i]');

    log(`Order form elements - type: ${!!orderType}, qty: ${!!qtyInput}, price: ${!!priceInput}`);

    if (qtyInput) {
      await qtyInput.fill('1');
    }
    if (priceInput) {
      await priceInput.fill('250');
    }

    // Look for submit/place order button
    const submitBtn = await page.$('button:has-text("Place"), button:has-text("Submit"), button:has-text("Buy"), button:has-text("Order")');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(2000);
      await screenshot(page, '02d-trade-order-placed');
      log('Order submission attempted');
    }
  } catch (e) {
    log(`Order placement: ${e.message}`);
  }

  // Check Positions tab
  try {
    const posTab = await page.$('button:has-text("Positions"), [role="tab"]:has-text("Positions"), a:has-text("Positions")');
    if (posTab) {
      await posTab.click();
      await page.waitForTimeout(1000);
      await screenshot(page, '02e-trade-positions');

      const posCount = await page.$$eval('tr, [class*="position-row"]', els => els.length);
      log(`Positions rows visible: ${posCount}`);
    }
  } catch (e) {
    log(`Positions tab: ${e.message}`);
  }

  // Check Journal tab
  try {
    const journalTab = await page.$('button:has-text("Journal"), [role="tab"]:has-text("Journal"), a:has-text("Journal")');
    if (journalTab) {
      await journalTab.click();
      await page.waitForTimeout(1000);
      await screenshot(page, '02f-trade-journal');

      const textarea = await page.$('textarea, [contenteditable="true"]');
      if (textarea) {
        await textarea.fill('QA test note - round 12');
        await page.waitForTimeout(500);

        // Switch away and back
        const posTab2 = await page.$('button:has-text("Positions"), [role="tab"]:has-text("Positions")');
        if (posTab2) {
          await posTab2.click();
          await page.waitForTimeout(500);
          await journalTab.click();
          await page.waitForTimeout(500);

          const noteText = await textarea.inputValue().catch(() => textarea.textContent());
          if (noteText && noteText.includes('QA test note')) {
            log('Journal note persists across tab switches');
          } else {
            reportBug('Journal note does not persist when switching tabs', 'P2', '02f-trade-journal', 'Type note in journal, switch to Positions tab, switch back');
          }
        }
      }
    }
  } catch (e) {
    log(`Journal tab: ${e.message}`);
  }

  // ===== PHASE 3: Pipeline =====
  log('\n=== Phase 3: Pipeline ===');
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await screenshot(page, '03-pipeline');

  // Check pipeline flow numbers
  try {
    const pipelineText = await page.textContent('body');
    const pipelineNumbers = pipelineText.match(/\d+/g) || [];
    const allZeros = pipelineNumbers.every(n => parseInt(n) === 0);
    if (allZeros && pipelineNumbers.length > 5) {
      reportBug('Pipeline shows all zero values', 'P1', '03-pipeline', 'Navigate to /pipeline');
    }
    log(`Pipeline has ${pipelineNumbers.length} numeric values`);
  } catch (e) {
    log(`Pipeline numbers: ${e.message}`);
  }

  // Check pipeline positions table
  try {
    const pipelinePositions = await page.$$eval('table tr td, [class*="position"]', els =>
      els.slice(0, 20).map(el => el.textContent.trim())
    );
    log(`Pipeline positions data: ${JSON.stringify(pipelinePositions.slice(0, 10))}`);
  } catch (e) {
    log(`Pipeline positions: ${e.message}`);
  }

  // Click Run Pipeline button
  try {
    const runBtn = await page.$('button:has-text("Run Pipeline"), button:has-text("Run"), button:has-text("Execute")');
    if (runBtn) {
      await runBtn.click();
      await page.waitForTimeout(3000);
      await screenshot(page, '03b-pipeline-running');
      log('Run Pipeline clicked');
    } else {
      log('No Run Pipeline button found');
    }
  } catch (e) {
    log(`Run Pipeline: ${e.message}`);
  }

  // ===== PHASE 4: Strategy Pages =====
  log('\n=== Phase 4: Strategy Pages ===');

  const strategies = ['pead', 'momentum-quality', 'earnings-vol'];
  for (const strat of strategies) {
    try {
      await page.goto(`${BASE_URL}/strategies/${strat}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      await screenshot(page, `04-strategy-${strat}`);

      const pageTitle = await page.title();
      const bodyText = await page.textContent('body');
      const hasError = bodyText.toLowerCase().includes('error') || bodyText.toLowerCase().includes('not found');
      const has404 = bodyText.includes('404');

      log(`Strategy ${strat}: title="${pageTitle}", hasError=${hasError}, has404=${has404}, textLen=${bodyText.length}`);

      // Check for equity curve (canvas/svg)
      const charts = await page.$$('canvas, svg, [class*="chart"], [class*="Chart"]');
      log(`Strategy ${strat} charts/graphics: ${charts.length}`);

      // Check for stats
      const hasStats = bodyText.includes('Return') || bodyText.includes('Sharpe') || bodyText.includes('Win Rate') || bodyText.includes('Max Draw');
      log(`Strategy ${strat} has stats: ${hasStats}`);

      if (has404) {
        reportBug(`Strategy page /strategies/${strat} shows 404`, 'P1', `04-strategy-${strat}`, `Navigate to /strategies/${strat}`);
      }
    } catch (e) {
      reportBug(`Strategy page /strategies/${strat} failed to load: ${e.message}`, 'P1', `04-strategy-${strat}`, `Navigate to /strategies/${strat}`);
    }
  }

  // ===== PHASE 5: Edge Cases =====
  log('\n=== Phase 5: Edge Cases ===');

  // Command palette
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.keyboard.press('Control+k');
    await page.waitForTimeout(1000);
    let cmdPalette = await page.$('[class*="command"], [class*="Command"], [class*="palette"], [class*="Palette"], [role="dialog"]');
    if (!cmdPalette) {
      await page.keyboard.press('Meta+k');
      await page.waitForTimeout(1000);
      cmdPalette = await page.$('[class*="command"], [class*="Command"], [class*="palette"], [class*="Palette"], [role="dialog"]');
    }

    if (cmdPalette) {
      await screenshot(page, '05a-command-palette');
      log('Command palette opened');

      // Search NVDA
      await page.keyboard.type('NVDA');
      await page.waitForTimeout(1000);
      await screenshot(page, '05b-command-palette-nvda');

      // Try to select
      const suggestion = await page.$('[class*="suggestion"], [class*="result"], [class*="item"]');
      if (suggestion) {
        await suggestion.click();
        await page.waitForTimeout(2000);
        await screenshot(page, '05c-after-nvda-select');
      }

      // Close palette if still open
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      log('Command palette not found with Ctrl+K or Cmd+K');
    }
  } catch (e) {
    log(`Command palette: ${e.message}`);
  }

  // Keyboard shortcuts overlay
  try {
    await page.keyboard.press('?');
    await page.waitForTimeout(1000);
    const overlay = await page.$('[class*="shortcut"], [class*="Shortcut"], [class*="overlay"], [class*="modal"]');
    if (overlay) {
      await screenshot(page, '05d-keyboard-shortcuts');
      log('Keyboard shortcuts overlay opened');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const overlayGone = await page.$('[class*="shortcut"][class*="overlay"]');
      log(`Overlay closed after Escape: ${!overlayGone}`);
    } else {
      log('Keyboard shortcuts overlay not found with "?"');
    }
  } catch (e) {
    log(`Shortcuts overlay: ${e.message}`);
  }

  // Profile menu
  try {
    const profileBtn = await page.$('[class*="profile"], [class*="Profile"], [class*="avatar"], [class*="Avatar"], [class*="user-menu"], button:has-text("admin"), button:has-text("Admin")');
    if (profileBtn) {
      await profileBtn.click();
      await page.waitForTimeout(1000);
      await screenshot(page, '05e-profile-menu');

      // Click Settings
      const settingsLink = await page.$('a:has-text("Settings"), button:has-text("Settings"), [class*="menu"] a:has-text("Settings")');
      if (settingsLink) {
        await settingsLink.click();
        await page.waitForTimeout(2000);
        await screenshot(page, '05f-settings-page');
        log(`Settings page URL: ${page.url()}`);
      }
    } else {
      log('Profile button not found');
    }
  } catch (e) {
    log(`Profile menu: ${e.message}`);
  }

  // Static pages
  const staticPages = ['/privacy', '/terms', '/risk', '/docs'];
  for (const sp of staticPages) {
    try {
      await page.goto(`${BASE_URL}${sp}`, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1000);
      await screenshot(page, `05g-static${sp.replace('/', '-')}`);

      const bodyText = await page.textContent('body');
      const has404 = bodyText.includes('404') || bodyText.includes('not found');
      const pageUrl = page.url();
      log(`Static page ${sp}: url=${pageUrl}, has404=${has404}, textLen=${bodyText.length}`);

      if (has404) {
        reportBug(`Static page ${sp} returns 404`, 'P2', `05g-static${sp.replace('/', '-')}`, `Navigate to ${sp}`);
      }

      // Check for back link
      const backLink = await page.$('a[href="/"], a:has-text("Back"), a:has-text("Home")');
      if (!backLink) {
        reportBug(`Static page ${sp} missing back/home link`, 'P3', `05g-static${sp.replace('/', '-')}`, `Navigate to ${sp}, look for back link`);
      }
    } catch (e) {
      log(`Static page ${sp}: ${e.message}`);
    }
  }

  // Test /dashboard URL
  try {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    const dashUrl = page.url();
    const dashBody = await page.textContent('body');
    const has404 = dashBody.includes('404');
    await screenshot(page, '05h-dashboard-url');
    log(`/dashboard URL: redirected to ${dashUrl}, has404=${has404}`);
    if (has404) {
      reportBug('/dashboard shows 404 instead of redirecting to /', 'P2', '05h-dashboard-url', 'Navigate to /dashboard');
    }
  } catch (e) {
    log(`/dashboard check: ${e.message}`);
  }

  // Responsive test at 800x600
  try {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '05i-responsive-800x600');

    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '05j-responsive-trade-800x600');
    log('Responsive screenshots taken at 800x600');

    // Reset viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
  } catch (e) {
    log(`Responsive test: ${e.message}`);
  }

  // Logout/Login cycle
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Find and click profile/logout
    const profileBtn2 = await page.$('[class*="profile"], [class*="avatar"], [class*="user-menu"], button:has-text("admin"), button:has-text("Admin")');
    if (profileBtn2) {
      await profileBtn2.click();
      await page.waitForTimeout(500);
      const logoutBtn = await page.$('a:has-text("Logout"), button:has-text("Logout"), a:has-text("Log out"), button:has-text("Log out"), a:has-text("Sign out")');
      if (logoutBtn) {
        await logoutBtn.click();
        await page.waitForTimeout(2000);
        await screenshot(page, '05k-after-logout');
        log(`After logout URL: ${page.url()}`);

        // Login again
        try {
          await page.fill('input[name="username"], input[type="text"]', 'admin');
          await page.fill('input[name="password"], input[type="password"]', 'alphaDesk2025!');
          await page.click('button[type="submit"]');
          await page.waitForURL('**/', { timeout: 15000 });
          await page.waitForTimeout(2000);
          await screenshot(page, '05l-relogin-dashboard');
          log('Re-login successful');
        } catch (e2) {
          reportBug(`Re-login failed after logout: ${e2.message}`, 'P0', '05k-after-logout', 'Logout then login again');
        }
      }
    }
  } catch (e) {
    log(`Logout/Login: ${e.message}`);
  }

  // ===== PHASE 6: Console/Network Errors =====
  log('\n=== Phase 6: Console/Network Error Summary ===');

  // Navigate to each page and collect errors
  const pagesToCheck = ['/', '/trade', '/pipeline'];
  for (const pg of pagesToCheck) {
    const pgErrors = [];
    const pgNetErrors = [];

    const testPage = await context.newPage();
    testPage.on('console', msg => {
      if (msg.type() === 'error') pgErrors.push(msg.text());
    });
    testPage.on('response', response => {
      if (response.status() >= 400) {
        pgNetErrors.push({ url: response.url(), status: response.status() });
      }
    });

    try {
      await testPage.goto(`${BASE_URL}${pg}`, { waitUntil: 'networkidle', timeout: 20000 });
      await testPage.waitForTimeout(3000);

      if (pgErrors.length > 0) {
        log(`Console errors on ${pg}: ${JSON.stringify(pgErrors)}`);
      } else {
        log(`No console errors on ${pg}`);
      }

      if (pgNetErrors.length > 0) {
        // Filter out expected 4xx (like auth checks)
        const realErrors = pgNetErrors.filter(e => e.status >= 500 || (e.status >= 400 && !e.url.includes('/auth/')));
        if (realErrors.length > 0) {
          log(`Network errors on ${pg}: ${JSON.stringify(realErrors)}`);
          for (const ne of realErrors) {
            if (ne.status >= 500) {
              reportBug(`Server error ${ne.status} on ${pg}: ${ne.url}`, 'P1', '', `Load ${pg}`);
            }
          }
        }
      } else {
        log(`No network errors on ${pg}`);
      }
    } catch (e) {
      log(`Error checking ${pg}: ${e.message}`);
    }
    await testPage.close();
  }

  // Final summary of accumulated errors from main page
  log('\n=== Accumulated Errors from Main Session ===');
  log(`Console errors: ${consoleErrors.length}`);
  consoleErrors.forEach(e => log(`  CONSOLE ERROR: ${e}`));
  log(`Network errors: ${networkErrors.length}`);
  const significantNetErrors = networkErrors.filter(e =>
    (e.status && e.status >= 500) ||
    (e.status && e.status >= 400 && !e.url?.includes('/auth/') && !e.url?.includes('favicon'))
  );
  significantNetErrors.forEach(e => log(`  NET ERROR: ${e.url} - ${e.status || e.failure}`));

  // ===== FINAL REPORT =====
  log('\n========================================');
  log('=== FINAL BUG REPORT ===');
  log('========================================');

  if (bugs.length === 0) {
    log('NO BUGS FOUND - App appears clean!');
  } else {
    bugs.forEach((bug, i) => {
      log(`\nBug #${i + 1}:`);
      log(`  Description: ${bug.description}`);
      log(`  Severity: ${bug.severity}`);
      log(`  Screenshot: ${bug.screenshot}`);
      log(`  Steps: ${bug.steps}`);
    });
  }

  log(`\nTotal bugs found: ${bugs.length}`);
  log(`Total console errors across session: ${consoleErrors.length}`);
  log(`Total significant network errors: ${significantNetErrors.length}`);

  await browser.close();
})();
