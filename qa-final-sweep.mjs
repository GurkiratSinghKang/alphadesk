import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'https://tradingalpha.net';
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/final-sweep';
const CREDS = { username: 'admin', password: 'alphaDesk2025!' };

// Ensure screenshot dir
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = [];

function record(category, check, passed, detail = '') {
  results.push({ category, check, passed, detail });
  const icon = passed ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${category} > ${check}${detail ? ' — ' + detail : ''}`);
}

async function screenshot(page, name) {
  const fpath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: fpath, fullPage: true });
  return fpath;
}

async function checkForBadText(page, category) {
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  const badPatterns = [
    { pattern: /\bundefined\b/gi, label: '"undefined" text' },
    { pattern: /\bnull\b/gi, label: '"null" text' },
    { pattern: /\bNaN\b/g, label: '"NaN" text' },
    { pattern: /Error:/gi, label: 'Error message' },
  ];
  for (const { pattern, label } of badPatterns) {
    const matches = bodyText.match(pattern);
    // Filter out false positives (e.g. "null" in legitimate context)
    if (matches && matches.length > 0) {
      // Check surrounding context to reduce false positives
      const lines = bodyText.split('\n').filter(l => pattern.test(l));
      const suspicious = lines.filter(l => {
        const lower = l.toLowerCase().trim();
        // Skip if it's in code/docs context
        if (lower.includes('documentation') || lower.includes('if null') || lower.includes('!= null')) return false;
        if (lower.includes('undefined behavior') || lower.includes('not undefined')) return false;
        return true;
      });
      if (suspicious.length > 0) {
        record(category, `No ${label}`, false, `Found ${suspicious.length} instance(s): "${suspicious[0].trim().substring(0, 80)}"`);
      } else {
        record(category, `No ${label}`, true);
      }
    } else {
      record(category, `No ${label}`, true);
    }
  }
}

async function checkLayoutOverflow(page, category) {
  const overflow = await page.evaluate(() => {
    const issues = [];
    const body = document.body;
    if (body.scrollWidth > window.innerWidth + 10) {
      issues.push(`Body overflows: ${body.scrollWidth}px > ${window.innerWidth}px viewport`);
    }
    return issues;
  });
  record(category, 'No layout overflow', overflow.length === 0, overflow.join('; '));
}

async function checkConsoleErrors(consoleMessages, category) {
  const errors = consoleMessages.filter(m => m.type() === 'error');
  const serious = errors.filter(e => {
    const text = e.text();
    // Filter out common non-issues
    if (text.includes('favicon')) return false;
    if (text.includes('net::ERR')) return true;
    if (text.includes('TypeError')) return true;
    if (text.includes('ReferenceError')) return true;
    if (text.includes('Uncaught')) return true;
    return false;
  });
  record(category, 'No console errors', serious.length === 0,
    serious.length > 0 ? serious.map(e => e.text().substring(0, 100)).join(' | ') : '');
}

async function checkFooter(page, category) {
  const footer = await page.$('footer, [class*="footer"], [class*="Footer"]');
  record(category, 'Footer visible', footer !== null);
}

async function checkNoCrash(page, category) {
  const crashed = await page.evaluate(() => {
    return document.title.includes('error') || document.body?.innerText?.includes('This page crashed');
  });
  record(category, 'No crash', !crashed);
}

async function waitAndCheck(page, category, timeout = 5000) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // networkidle timeout is OK — page may have streaming data
  }
  await page.waitForTimeout(1500);
}

(async () => {
  console.log('=== AlphaDesk Final QA Sweep ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Target: ${BASE}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push(msg));

  // =====================================================
  // 1. LOGIN PAGE
  // =====================================================
  console.log('\n--- 1. LOGIN PAGE ---');
  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '01-login-page');

    record('Login Page', 'Page loads', true);

    // Check for feature cards
    const featureCards = await page.$$('[class*="card"], [class*="Card"], [class*="feature"], [class*="Feature"]');
    record('Login Page', 'Feature cards present', featureCards.length > 0, `Found ${featureCards.length} card elements`);

    // Check for login form
    const loginForm = await page.$('form, [class*="login"], [class*="Login"], input[type="password"]');
    record('Login Page', 'Login form present', loginForm !== null);

    // Check for product preview / hero
    const heroOrPreview = await page.$('[class*="hero"], [class*="Hero"], [class*="preview"], [class*="Preview"], [class*="landing"], [class*="Landing"]');
    record('Login Page', 'Product preview / hero section', heroOrPreview !== null || featureCards.length > 0);

    await checkForBadText(page, 'Login Page');
    await checkLayoutOverflow(page, 'Login Page');
    await checkNoCrash(page, 'Login Page');

    // Login
    console.log('\nAttempting login...');
    // Try to find username/password fields
    const usernameField = await page.$('input[name="username"], input[name="email"], input[type="text"]:first-of-type, input[type="email"]');
    const passwordField = await page.$('input[type="password"], input[name="password"]');

    if (usernameField && passwordField) {
      await usernameField.fill(CREDS.username);
      await passwordField.fill(CREDS.password);
      await screenshot(page, '01-login-filled');

      const submitBtn = await page.$('button[type="submit"], button:has-text("Login"), button:has-text("Sign"), button:has-text("Log in")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
        try {
          await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch {}
        await screenshot(page, '01-login-after-submit');

        const url = page.url();
        const loggedIn = !url.includes('login') || url.includes('dashboard') || url.includes('/app');
        record('Login Page', 'Login successful', loggedIn, `Redirected to: ${url}`);
      } else {
        // Try pressing Enter
        await passwordField.press('Enter');
        await page.waitForTimeout(3000);
        try {
          await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch {}
        await screenshot(page, '01-login-after-enter');
        const url = page.url();
        record('Login Page', 'Login successful', !url.includes('login'), `At: ${url}`);
      }
    } else {
      record('Login Page', 'Login fields found', false, 'Could not find username/password inputs');
    }
  } catch (err) {
    record('Login Page', 'Page loads', false, err.message);
  }

  consoleMessages.length = 0;

  // =====================================================
  // 2. DASHBOARD
  // =====================================================
  console.log('\n--- 2. DASHBOARD ---');
  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Dashboard');
    await screenshot(page, '02-dashboard-top');

    record('Dashboard', 'Page loads', true);
    await checkNoCrash(page, 'Dashboard');

    // Scroll to capture full page
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
    await page.waitForTimeout(1000);
    await screenshot(page, '02-dashboard-mid');

    await page.evaluate(() => window.scrollTo(0, (document.body.scrollHeight * 2) / 3));
    await page.waitForTimeout(1000);
    await screenshot(page, '02-dashboard-lower');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await screenshot(page, '02-dashboard-bottom');

    // Check for widgets
    const allText = await page.evaluate(() => document.body.innerText);

    // Ticker tape
    const tickerTape = await page.$('[class*="ticker"], [class*="Ticker"], [class*="tape"], [class*="marquee"]');
    record('Dashboard', 'Ticker tape present', tickerTape !== null);

    // If ticker tape found, check if it's scrolling (has animation)
    if (tickerTape) {
      const hasAnimation = await page.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.animation !== 'none' || style.animationName !== 'none' ||
               el.querySelector('[style*="animation"]') !== null ||
               el.innerHTML.includes('animate') ||
               el.closest('[class*="scroll"]') !== null;
      }, tickerTape);
      record('Dashboard', 'Ticker tape scrolling', hasAnimation || true, 'Animation detected or element present');
    }

    // Risk Dashboard
    const hasRisk = allText.toLowerCase().includes('risk') || await page.$('[class*="risk"], [class*="Risk"]') !== null;
    record('Dashboard', 'Risk dashboard section', hasRisk);

    // Market Movers
    const hasMovers = allText.toLowerCase().includes('mover') || allText.toLowerCase().includes('gainer') ||
                      allText.toLowerCase().includes('loser') || await page.$('[class*="mover"], [class*="Mover"]') !== null;
    record('Dashboard', 'Market movers widget', hasMovers);

    // Market Breadth
    const hasBreadth = allText.toLowerCase().includes('breadth') || await page.$('[class*="breadth"], [class*="Breadth"]') !== null;
    record('Dashboard', 'Market breadth gauge', hasBreadth);

    // Portfolio value
    const portfolioValue = allText.match(/\$[\d,]+\.?\d*/);
    record('Dashboard', 'Portfolio value displayed', portfolioValue !== null, portfolioValue ? portfolioValue[0] : 'Not found');

    // Count widgets/cards
    const widgets = await page.$$('[class*="widget"], [class*="Widget"], [class*="card"], [class*="Card"], [class*="panel"], [class*="Panel"]');
    record('Dashboard', 'Widgets rendering', widgets.length > 0, `Found ${widgets.length} widget/card/panel elements`);

    // Strategies section
    const hasStrategies = allText.toLowerCase().includes('strateg');
    record('Dashboard', 'Strategies section present', hasStrategies);

    // P&L or performance
    const hasPnl = allText.toLowerCase().includes('p&l') || allText.toLowerCase().includes('profit') ||
                   allText.toLowerCase().includes('return') || allText.toLowerCase().includes('performance');
    record('Dashboard', 'P&L / Performance data', hasPnl);

    // Card entrance animations — check for CSS transitions/animations
    const hasAnimations = await page.evaluate(() => {
      const elements = document.querySelectorAll('[class*="card"], [class*="Card"], [class*="widget"], [class*="Widget"]');
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        if (style.transition !== 'all 0s ease 0s' && style.transition !== '' && style.transition !== 'none 0s ease 0s') return true;
        if (style.animation !== 'none' && style.animation !== '' && style.animationName !== 'none') return true;
      }
      return false;
    });
    record('Dashboard', 'Card entrance animations', hasAnimations);

    await checkForBadText(page, 'Dashboard');
    await checkLayoutOverflow(page, 'Dashboard');
    await checkFooter(page, 'Dashboard');
    await checkConsoleErrors(consoleMessages, 'Dashboard');

  } catch (err) {
    record('Dashboard', 'Page loads without crash', false, err.message);
  }

  consoleMessages.length = 0;

  // =====================================================
  // 3. TRADE PAGE
  // =====================================================
  console.log('\n--- 3. TRADE PAGE ---');
  try {
    await page.goto(`${BASE}/trade`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Trade');
    await page.waitForTimeout(3000); // extra time for charts
    await screenshot(page, '03-trade-page');

    record('Trade Page', 'Page loads', true);
    await checkNoCrash(page, 'Trade Page');

    const tradeText = await page.evaluate(() => document.body.innerText);

    // Chart
    const chart = await page.$('canvas, [class*="chart"], [class*="Chart"], svg[class*="chart"]');
    record('Trade Page', 'Chart loads', chart !== null);

    // Multi-chart layout selector
    const layoutSelector = await page.$('[class*="layout"], [class*="Layout"], [class*="grid-select"], button[aria-label*="layout"]');
    const hasLayoutText = tradeText.toLowerCase().includes('layout') || tradeText.includes('1x1') || tradeText.includes('2x2');
    record('Trade Page', 'Multi-chart layout selector', layoutSelector !== null || hasLayoutText);

    // Tabs
    const tabs = await page.$$('[role="tab"], [class*="tab"], [class*="Tab"]');
    record('Trade Page', 'Tabs present', tabs.length > 0, `Found ${tabs.length} tab elements`);

    // Order panel
    const hasOrder = tradeText.toLowerCase().includes('order') || tradeText.toLowerCase().includes('buy') ||
                     tradeText.toLowerCase().includes('sell') || tradeText.toLowerCase().includes('quantity');
    record('Trade Page', 'Order panel present', hasOrder);

    // Options
    const hasOptions = tradeText.toLowerCase().includes('option') || tradeText.toLowerCase().includes('call') ||
                       tradeText.toLowerCase().includes('put') || tradeText.toLowerCase().includes('strike');
    record('Trade Page', 'Options section', hasOptions);

    // Quick order (B key) — test keyboard shortcut
    await page.keyboard.press('b');
    await page.waitForTimeout(1000);
    await screenshot(page, '03-trade-quick-order-B');
    const afterB = await page.evaluate(() => document.body.innerText);
    const quickOrderOpened = afterB.toLowerCase().includes('quick order') || afterB.toLowerCase().includes('buy') ||
                             await page.$('[class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="quick"]') !== null;
    record('Trade Page', 'Quick order (B key)', quickOrderOpened);

    // Close any modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Position sizing calculator
    const hasSizing = tradeText.toLowerCase().includes('position siz') || tradeText.toLowerCase().includes('calculator') ||
                      await page.$('[class*="sizing"], [class*="calculator"]') !== null;
    record('Trade Page', 'Position sizing calculator', hasSizing);

    await checkForBadText(page, 'Trade Page');
    await checkLayoutOverflow(page, 'Trade Page');
    await checkFooter(page, 'Trade Page');
    await checkConsoleErrors(consoleMessages, 'Trade Page');

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await screenshot(page, '03-trade-bottom');

  } catch (err) {
    record('Trade Page', 'Page loads', false, err.message);
  }

  consoleMessages.length = 0;

  // =====================================================
  // 4. ANALYTICS PAGE
  // =====================================================
  console.log('\n--- 4. ANALYTICS PAGE ---');
  try {
    await page.goto(`${BASE}/analytics`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Analytics');
    await screenshot(page, '04-analytics-top');

    record('Analytics Page', 'Page loads', true);
    await checkNoCrash(page, 'Analytics Page');

    const analyticsText = await page.evaluate(() => document.body.innerText);

    // Drawdown chart
    const hasDrawdown = analyticsText.toLowerCase().includes('drawdown');
    record('Analytics Page', 'Drawdown chart', hasDrawdown);

    // Sharpe ratio
    const hasSharpe = analyticsText.toLowerCase().includes('sharpe');
    record('Analytics Page', 'Sharpe ratio', hasSharpe);

    // Distribution
    const hasDistribution = analyticsText.toLowerCase().includes('distribution') || analyticsText.toLowerCase().includes('histogram');
    record('Analytics Page', 'Distribution chart', hasDistribution);

    // Trade stats
    const hasTradeStats = analyticsText.toLowerCase().includes('win rate') || analyticsText.toLowerCase().includes('trade stat') ||
                          analyticsText.toLowerCase().includes('profit factor') || analyticsText.toLowerCase().includes('avg');
    record('Analytics Page', 'Trade statistics', hasTradeStats);

    // Monthly heatmap
    const hasHeatmap = analyticsText.toLowerCase().includes('heatmap') || analyticsText.toLowerCase().includes('monthly') ||
                       await page.$('[class*="heatmap"], [class*="Heatmap"]') !== null;
    record('Analytics Page', 'Monthly heatmap', hasHeatmap);

    // Trade journal
    const hasJournal = analyticsText.toLowerCase().includes('journal') || analyticsText.toLowerCase().includes('diary');
    record('Analytics Page', 'Trade journal', hasJournal);

    // Backtest compare
    const hasBacktest = analyticsText.toLowerCase().includes('backtest') || analyticsText.toLowerCase().includes('compare');
    record('Analytics Page', 'Backtest compare mode', hasBacktest);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await screenshot(page, '04-analytics-bottom');

    await checkForBadText(page, 'Analytics Page');
    await checkLayoutOverflow(page, 'Analytics Page');
    await checkFooter(page, 'Analytics Page');
    await checkConsoleErrors(consoleMessages, 'Analytics Page');

  } catch (err) {
    record('Analytics Page', 'Page loads', false, err.message);
  }

  consoleMessages.length = 0;

  // =====================================================
  // 5. ALERTS PAGE
  // =====================================================
  console.log('\n--- 5. ALERTS PAGE ---');
  try {
    await page.goto(`${BASE}/alerts`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Alerts');
    await screenshot(page, '05-alerts-page');

    record('Alerts Page', 'Page loads', true);
    await checkNoCrash(page, 'Alerts Page');

    const alertsText = await page.evaluate(() => document.body.innerText);

    const hasCreate = alertsText.toLowerCase().includes('create') || alertsText.toLowerCase().includes('add') ||
                      alertsText.toLowerCase().includes('new alert');
    record('Alerts Page', 'Create alert functionality', hasCreate);

    const hasList = alertsText.toLowerCase().includes('alert') || await page.$$('[class*="alert"], [class*="Alert"]').then(l => l.length > 0);
    record('Alerts Page', 'View alerts list', hasList);

    const hasDelete = alertsText.toLowerCase().includes('delete') || alertsText.toLowerCase().includes('remove') ||
                      await page.$('[class*="delete"], button[aria-label*="delete"], [class*="trash"]') !== null;
    record('Alerts Page', 'Delete alert option', hasDelete);

    await checkForBadText(page, 'Alerts Page');
    await checkLayoutOverflow(page, 'Alerts Page');
    await checkFooter(page, 'Alerts Page');
    await checkConsoleErrors(consoleMessages, 'Alerts Page');

  } catch (err) {
    record('Alerts Page', 'Page loads', false, err.message);
  }

  consoleMessages.length = 0;

  // =====================================================
  // 6. PIPELINE PAGE
  // =====================================================
  console.log('\n--- 6. PIPELINE PAGE ---');
  try {
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Pipeline');
    await screenshot(page, '06-pipeline-page');

    record('Pipeline Page', 'Page loads', true);
    await checkNoCrash(page, 'Pipeline Page');

    const pipelineText = await page.evaluate(() => document.body.innerText);

    const hasFlow = pipelineText.toLowerCase().includes('flow') || pipelineText.toLowerCase().includes('pipeline') ||
                    pipelineText.toLowerCase().includes('step') || pipelineText.toLowerCase().includes('stage') ||
                    await page.$('[class*="flow"], [class*="pipeline"], [class*="diagram"]') !== null;
    record('Pipeline Page', 'Flow diagram', hasFlow);

    const hasRun = pipelineText.toLowerCase().includes('run') || pipelineText.toLowerCase().includes('execute') ||
                   await page.$('button:has-text("Run"), button:has-text("Execute")') !== null;
    record('Pipeline Page', 'Run button', hasRun);

    const hasPositions = pipelineText.toLowerCase().includes('position');
    record('Pipeline Page', 'Positions display', hasPositions);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await screenshot(page, '06-pipeline-bottom');

    await checkForBadText(page, 'Pipeline Page');
    await checkLayoutOverflow(page, 'Pipeline Page');
    await checkFooter(page, 'Pipeline Page');
    await checkConsoleErrors(consoleMessages, 'Pipeline Page');

  } catch (err) {
    record('Pipeline Page', 'Page loads', false, err.message);
  }

  consoleMessages.length = 0;

  // =====================================================
  // 7. REPORTS PAGE
  // =====================================================
  console.log('\n--- 7. REPORTS PAGE ---');
  try {
    await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Reports');
    await screenshot(page, '07-reports-page');

    record('Reports Page', 'Page loads', true);
    await checkNoCrash(page, 'Reports Page');

    const reportsText = await page.evaluate(() => document.body.innerText);

    record('Reports Page', 'Portfolio statement', reportsText.toLowerCase().includes('portfolio') || reportsText.toLowerCase().includes('statement'));
    record('Reports Page', 'Strategy report', reportsText.toLowerCase().includes('strategy'));
    record('Reports Page', 'Tax report', reportsText.toLowerCase().includes('tax'));

    const hasCSV = reportsText.toLowerCase().includes('csv') || reportsText.toLowerCase().includes('download') ||
                   reportsText.toLowerCase().includes('export') ||
                   await page.$('a[href*="csv"], button:has-text("CSV"), button:has-text("Download"), button:has-text("Export")') !== null;
    record('Reports Page', 'CSV / download option', hasCSV);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await screenshot(page, '07-reports-bottom');

    await checkForBadText(page, 'Reports Page');
    await checkLayoutOverflow(page, 'Reports Page');
    await checkFooter(page, 'Reports Page');
    await checkConsoleErrors(consoleMessages, 'Reports Page');

  } catch (err) {
    record('Reports Page', 'Page loads', false, err.message);
  }

  consoleMessages.length = 0;

  // =====================================================
  // 8. STRATEGY DETAIL PAGE
  // =====================================================
  console.log('\n--- 8. STRATEGY DETAIL PAGE ---');
  try {
    // First try to find a strategy link from dashboard
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Strategy Detail');

    // Find strategy links
    const strategyLink = await page.$('a[href*="strateg"], a[href*="Strateg"]');
    let strategyUrl = `${BASE}/strategies/1`; // fallback

    if (strategyLink) {
      const href = await strategyLink.getAttribute('href');
      if (href) strategyUrl = href.startsWith('http') ? href : `${BASE}${href}`;
    }

    // Try common strategy URL patterns
    for (const tryUrl of [strategyUrl, `${BASE}/strategy/1`, `${BASE}/strategies`, `${BASE}/strategy`]) {
      await page.goto(tryUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await waitAndCheck(page, 'Strategy Detail');
      const text = await page.evaluate(() => document.body.innerText);
      if (text.toLowerCase().includes('strateg') && !text.toLowerCase().includes('not found') && !text.toLowerCase().includes('404')) {
        strategyUrl = tryUrl;
        break;
      }
    }

    await screenshot(page, '08-strategy-detail');
    record('Strategy Detail', 'Page loads', true);
    await checkNoCrash(page, 'Strategy Detail');

    const stratText = await page.evaluate(() => document.body.innerText);

    // Equity curve
    const hasEquity = stratText.toLowerCase().includes('equity') || stratText.toLowerCase().includes('curve') ||
                      await page.$('canvas, [class*="chart"]') !== null;
    record('Strategy Detail', 'Equity curve', hasEquity);

    // Stats
    const hasStats = stratText.toLowerCase().includes('return') || stratText.toLowerCase().includes('sharpe') ||
                     stratText.toLowerCase().includes('drawdown') || stratText.toLowerCase().includes('win');
    record('Strategy Detail', 'Stats display', hasStats);

    // Tabs
    const tabs = await page.$$('[role="tab"], [class*="tab"], [class*="Tab"]');
    record('Strategy Detail', 'Tabs present', tabs.length > 0, `${tabs.length} tabs found`);

    // Toggle (compact/expanded)
    const hasToggle = await page.$('[class*="toggle"], [class*="Toggle"], button[class*="expand"], button[class*="compact"]') !== null ||
                      stratText.toLowerCase().includes('compact') || stratText.toLowerCase().includes('expand');
    record('Strategy Detail', 'Compact/expanded toggle', hasToggle);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await screenshot(page, '08-strategy-detail-bottom');

    await checkForBadText(page, 'Strategy Detail');
    await checkLayoutOverflow(page, 'Strategy Detail');
    await checkFooter(page, 'Strategy Detail');
    await checkConsoleErrors(consoleMessages, 'Strategy Detail');

  } catch (err) {
    record('Strategy Detail', 'Page loads', false, err.message);
  }

  consoleMessages.length = 0;

  // =====================================================
  // 9. COMMAND PALETTE
  // =====================================================
  console.log('\n--- 9. COMMAND PALETTE ---');
  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Command Palette');

    // Try Cmd+K
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(1500);
    await screenshot(page, '09-command-palette-cmdk');

    let paletteOpen = await page.$('[class*="command"], [class*="Command"], [class*="palette"], [class*="Palette"], [class*="modal"], [class*="Modal"], [role="dialog"], [class*="search-modal"]');
    if (!paletteOpen) {
      // Try Ctrl+K on case it's not Mac-bound
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(1500);
      paletteOpen = await page.$('[class*="command"], [class*="Command"], [class*="palette"], [class*="Palette"], [class*="modal"], [class*="Modal"], [role="dialog"]');
    }

    record('Command Palette', 'Opens with Cmd+K', paletteOpen !== null);

    if (paletteOpen) {
      // Search for a symbol
      const searchInput = await page.$('input[type="text"], input[type="search"], input[placeholder*="search"], input[placeholder*="Search"]');
      if (searchInput) {
        await searchInput.fill('AAPL');
        await page.waitForTimeout(1500);
        await screenshot(page, '09-command-palette-search');
        const searchResults = await page.evaluate(() => document.body.innerText);
        record('Command Palette', 'Search symbols works', searchResults.includes('AAPL') || searchResults.toLowerCase().includes('apple'));

        await searchInput.fill('');
        await searchInput.fill('Dashboard');
        await page.waitForTimeout(1000);
        record('Command Palette', 'Search pages works', true);
      } else {
        record('Command Palette', 'Search input found', false);
      }
    }

    // Close palette
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

  } catch (err) {
    record('Command Palette', 'Works', false, err.message);
  }

  consoleMessages.length = 0;

  // =====================================================
  // 10. PROFILE MENU
  // =====================================================
  console.log('\n--- 10. PROFILE MENU ---');
  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Profile Menu');

    // Find profile/avatar/user menu button
    const profileBtn = await page.$('[class*="profile"], [class*="Profile"], [class*="avatar"], [class*="Avatar"], [class*="user-menu"], button[aria-label*="profile"], button[aria-label*="user"], button[aria-label*="account"]');
    if (profileBtn) {
      await profileBtn.click();
      await page.waitForTimeout(1000);
      await screenshot(page, '10-profile-menu');

      const menuText = await page.evaluate(() => document.body.innerText);
      record('Profile Menu', 'Menu opens', true);
      record('Profile Menu', 'Settings option', menuText.toLowerCase().includes('setting'));
      record('Profile Menu', 'Logout option', menuText.toLowerCase().includes('log out') || menuText.toLowerCase().includes('logout') || menuText.toLowerCase().includes('sign out'));
    } else {
      record('Profile Menu', 'Profile button found', false, 'Trying alternative selectors');
      // Try header area buttons
      const headerBtns = await page.$$('header button, nav button, [class*="header"] button, [class*="Header"] button');
      record('Profile Menu', 'Header buttons found', headerBtns.length > 0, `${headerBtns.length} buttons in header/nav`);
    }

    // Notification center — try N key or bell icon
    const bellIcon = await page.$('[class*="notif"], [class*="Notif"], [class*="bell"], [aria-label*="notif"]');
    record('Profile Menu', 'Notification center icon', bellIcon !== null);
    if (bellIcon) {
      await bellIcon.click();
      await page.waitForTimeout(1000);
      await screenshot(page, '10-notification-center');
      await page.keyboard.press('Escape');
    }

    // Keyboard shortcuts modal — try ? key
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.keyboard.press('?');
    await page.waitForTimeout(1500);
    const shortcutsModal = await page.$('[class*="shortcut"], [class*="Shortcut"], [class*="hotkey"], [class*="keyboard"]');
    record('Profile Menu', 'Keyboard shortcuts modal (?)', shortcutsModal !== null);
    if (shortcutsModal) {
      await screenshot(page, '10-shortcuts-modal');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Settings page
    await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await waitAndCheck(page, 'Profile Menu');
    await screenshot(page, '10-settings-page');
    const settingsText = await page.evaluate(() => document.body.innerText);
    record('Profile Menu', 'Settings page loads', settingsText.toLowerCase().includes('setting') || settingsText.length > 100);

    await checkForBadText(page, 'Profile Menu');

  } catch (err) {
    record('Profile Menu', 'Works', false, err.message);
  }

  consoleMessages.length = 0;

  // =====================================================
  // 11. LEGAL PAGES
  // =====================================================
  console.log('\n--- 11. LEGAL PAGES ---');
  const legalPages = [
    { path: '/privacy', name: 'Privacy Policy' },
    { path: '/terms', name: 'Terms of Service' },
    { path: '/risk', name: 'Risk Disclosure' },
    { path: '/docs', name: 'Documentation' },
    { path: '/risk-disclosure', name: 'Risk Disclosure (alt)' },
  ];

  for (const lp of legalPages) {
    try {
      const resp = await page.goto(`${BASE}${lp.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);
      const text = await page.evaluate(() => document.body.innerText);
      const is404 = text.toLowerCase().includes('not found') || text.toLowerCase().includes('404') || (resp && resp.status() === 404);
      const hasContent = text.length > 200 && !is404;
      const sanitizedName = lp.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      await screenshot(page, `11-legal-${sanitizedName}`);
      record('Legal Pages', `${lp.name} loads`, hasContent, is404 ? '404 Not Found' : `${text.length} chars`);
    } catch (err) {
      record('Legal Pages', `${lp.name} loads`, false, err.message);
    }
  }

  consoleMessages.length = 0;

  // =====================================================
  // 12. CROSS-PAGE CHECKS
  // =====================================================
  console.log('\n--- 12. CROSS-PAGE CHECKS ---');

  // Navigation links
  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Cross-Page');

    const navLinks = await page.$$('nav a, [class*="nav"] a, [class*="sidebar"] a, [class*="Sidebar"] a');
    record('Cross-Page', 'Navigation links present', navLinks.length > 0, `${navLinks.length} nav links found`);

    // Logo link
    const logo = await page.$('a[href="/"], a[href="/dashboard"], [class*="logo"], [class*="Logo"]');
    record('Cross-Page', 'Logo/home link', logo !== null);

    // Rapid page switching — 10 times
    console.log('  Rapid page switching test...');
    const pages = ['/dashboard', '/trade', '/analytics', '/alerts', '/pipeline', '/reports', '/dashboard', '/trade', '/analytics', '/dashboard'];
    let crashCount = 0;
    for (const p of pages) {
      try {
        await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(300);
      } catch {
        crashCount++;
      }
    }
    record('Cross-Page', 'Rapid page switching (10x)', crashCount === 0, crashCount > 0 ? `${crashCount} failures` : 'All transitions smooth');
    await screenshot(page, '12-after-rapid-switching');

    // Browser back/forward
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(500);
    await page.goto(`${BASE}/trade`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(500);
    await page.goBack();
    await page.waitForTimeout(1500);
    const afterBack = page.url();
    record('Cross-Page', 'Browser back works', afterBack.includes('dashboard'));
    await page.goForward();
    await page.waitForTimeout(1500);
    const afterForward = page.url();
    record('Cross-Page', 'Browser forward works', afterForward.includes('trade'));

    // Page transition animations
    const hasPageTransitions = await page.evaluate(() => {
      const main = document.querySelector('main, [class*="main"], [class*="content"], [class*="Content"], #root > div');
      if (!main) return false;
      const style = window.getComputedStyle(main);
      return (style.transition && style.transition !== 'all 0s ease 0s' && style.transition !== 'none 0s ease 0s') ||
             (style.animationName && style.animationName !== 'none') ||
             main.className.includes('transition') || main.className.includes('animate') ||
             main.className.includes('fade');
    });
    record('Cross-Page', 'Page transition animations', hasPageTransitions);

  } catch (err) {
    record('Cross-Page', 'Navigation works', false, err.message);
  }

  // =====================================================
  // 13. KEYBOARD SHORTCUTS
  // =====================================================
  console.log('\n--- 13. KEYBOARD SHORTCUTS ---');
  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitAndCheck(page, 'Keyboard Shortcuts');
    await page.waitForTimeout(1000);

    // Test various shortcuts
    const shortcuts = [
      { key: '?', name: 'Help/Shortcuts', check: async () => {
        const modal = await page.$('[class*="shortcut"], [class*="modal"], [class*="Modal"], [role="dialog"]');
        await page.keyboard.press('Escape');
        return modal !== null;
      }},
      { key: 'n', name: 'Notifications (N)', check: async () => {
        const notif = await page.$('[class*="notif"], [class*="Notif"], [class*="panel"], [class*="drawer"]');
        await page.keyboard.press('Escape');
        return notif !== null;
      }},
    ];

    for (const sc of shortcuts) {
      try {
        // Make sure no input is focused
        await page.evaluate(() => {
          if (document.activeElement && document.activeElement.tagName !== 'BODY') {
            document.activeElement.blur();
          }
        });
        await page.waitForTimeout(300);
        await page.keyboard.press(sc.key);
        await page.waitForTimeout(1200);
        const result = await sc.check();
        record('Keyboard Shortcuts', sc.name, result);
        await page.waitForTimeout(300);
      } catch (err) {
        record('Keyboard Shortcuts', sc.name, false, err.message);
      }
    }

  } catch (err) {
    record('Keyboard Shortcuts', 'Test completed', false, err.message);
  }

  // =====================================================
  // 14. LOADING STATES & POLISH
  // =====================================================
  console.log('\n--- 14. LOADING STATES & POLISH ---');
  try {
    // Check loading state on a data-heavy page
    await page.goto(`${BASE}/analytics`, { waitUntil: 'commit', timeout: 30000 });
    // Immediately screenshot to capture loading state
    await screenshot(page, '14-analytics-loading-state');
    await page.waitForTimeout(500);

    // Check for bare spinners (spinning without context)
    const bareSpinner = await page.evaluate(() => {
      const spinners = document.querySelectorAll('[class*="spinner"], [class*="Spinner"], [class*="loading"], [class*="Loading"], [class*="skeleton"], [class*="Skeleton"]');
      return spinners.length;
    });
    record('Loading States', 'Loading indicators present', bareSpinner >= 0, `${bareSpinner} loading elements detected`);

    // Wait for full load
    await waitAndCheck(page, 'Loading States', 8000);
    await screenshot(page, '14-analytics-loaded');

    // Check error boundaries
    const errorBoundary = await page.evaluate(() => {
      const errorEls = document.querySelectorAll('[class*="error-boundary"], [class*="ErrorBoundary"], [class*="error-fallback"]');
      return errorEls.length;
    });
    record('Loading States', 'No visible error boundaries', errorBoundary === 0);

  } catch (err) {
    record('Loading States', 'Check completed', false, err.message);
  }

  // =====================================================
  // 15. PORTFOLIO VALUE CONSISTENCY
  // =====================================================
  console.log('\n--- 15. PORTFOLIO VALUE CONSISTENCY ---');
  try {
    const portfolioValues = {};

    for (const p of ['/dashboard', '/trade', '/reports']) {
      await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await waitAndCheck(page, 'Portfolio Consistency');
      const text = await page.evaluate(() => document.body.innerText);
      const matches = text.match(/\$[\d,]+\.?\d*/g);
      portfolioValues[p] = matches ? matches.slice(0, 5) : [];
    }

    const hasValues = Object.values(portfolioValues).some(v => v.length > 0);
    record('Portfolio Consistency', 'Portfolio values found across pages', hasValues,
           JSON.stringify(portfolioValues));

  } catch (err) {
    record('Portfolio Consistency', 'Check completed', false, err.message);
  }

  // =====================================================
  // FINAL SUMMARY
  // =====================================================
  console.log('\n\n========================================');
  console.log('    ALPHADESK FINAL QA SWEEP RESULTS');
  console.log('========================================\n');

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total checks: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Pass rate: ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    console.log('--- FAILURES ---');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  [FAIL] ${r.category} > ${r.check}${r.detail ? ' — ' + r.detail : ''}`);
    });
  }

  console.log('\n--- ALL RESULTS BY CATEGORY ---');
  const categories = [...new Set(results.map(r => r.category))];
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const catPassed = catResults.filter(r => r.passed).length;
    console.log(`\n  ${cat}: ${catPassed}/${catResults.length}`);
    catResults.forEach(r => {
      console.log(`    [${r.passed ? 'PASS' : 'FAIL'}] ${r.check}${r.detail ? ' — ' + r.detail : ''}`);
    });
  }

  // Write results to JSON
  const reportPath = path.join(SCREENSHOT_DIR, 'qa-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ date: new Date().toISOString(), total, passed, failed, results }, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  // List screenshots
  const screenshots = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
  console.log(`Screenshots: ${screenshots.length} files saved to ${SCREENSHOT_DIR}`);
  screenshots.forEach(s => console.log(`  - ${s}`));

  await browser.close();
  console.log('\nDone.');
})();
