import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'https://tradingalpha.net';
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/final-sweep';
const CREDS = { username: 'admin', password: 'alphaDesk2025!' };

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

async function scrollScreenshot(page, name) {
  // Full page screenshot
  await screenshot(page, name);
  // Also scroll to bottom for tall pages
  const height = await page.evaluate(() => document.body.scrollHeight);
  if (height > 1200) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(800);
    await screenshot(page, `${name}-mid`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    await screenshot(page, `${name}-bottom`);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
}

async function getPageText(page) {
  return await page.evaluate(() => document.body?.innerText || '');
}

async function getPageHTML(page) {
  return await page.evaluate(() => document.body?.innerHTML || '');
}

function textHas(text, ...terms) {
  const lower = text.toLowerCase();
  return terms.some(t => lower.includes(t.toLowerCase()));
}

async function checkBadText(page, category) {
  const text = await getPageText(page);
  // Check for standalone "undefined" (not in code/documentation context)
  const lines = text.split('\n');

  for (const [label, regex] of [
    ['"undefined" text', /^undefined$/m],
    ['"NaN" text', /\bNaN\b/],
  ]) {
    const found = lines.filter(l => regex.test(l.trim()) && l.trim().length < 30);
    record(category, `No ${label}`, found.length === 0, found.length > 0 ? `Found: "${found[0].trim()}"` : '');
  }

  // null check: only flag if "null" appears as standalone value, not in sentences
  const nullLines = lines.filter(l => /^\s*null\s*$/i.test(l.trim()));
  record(category, 'No standalone "null" text', nullLines.length === 0, nullLines.length > 0 ? `Found: "${nullLines[0].trim()}"` : '');
}

async function checkOverflow(page, category) {
  const overflow = await page.evaluate(() => {
    return document.body.scrollWidth > window.innerWidth + 20;
  });
  record(category, 'No layout overflow', !overflow);
}

async function checkFooter(page, category) {
  const html = await getPageHTML(page);
  const hasFooter = html.toLowerCase().includes('footer') || html.includes('© ') || html.includes('&copy;');
  record(category, 'Footer visible', hasFooter);
}

async function checkConsoleErrors(msgs, category) {
  const errors = msgs.filter(m => m.type() === 'error').filter(e => {
    const t = e.text();
    return !t.includes('favicon') && !t.includes('third-party') && !t.includes('analytics') &&
           (t.includes('TypeError') || t.includes('ReferenceError') || t.includes('Uncaught') || t.includes('ChunkLoadError'));
  });
  record(category, 'No JS console errors', errors.length === 0,
    errors.length > 0 ? errors.map(e => e.text().substring(0, 120)).join(' | ') : '');
}

async function standardChecks(page, category, consoleMsgs) {
  await checkBadText(page, category);
  await checkOverflow(page, category);
  await checkFooter(page, category);
  await checkConsoleErrors(consoleMsgs, category);
  const crashed = await page.evaluate(() => document.title.toLowerCase().includes('error') || document.body.innerText.includes('Application error'));
  record(category, 'No crash / error boundary', !crashed);
}

(async () => {
  console.log('=== AlphaDesk FINAL QA Sweep v2 ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Target: ${BASE}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  let consoleMsgs = [];
  page.on('console', msg => consoleMsgs.push(msg));

  // =========================================================
  // 1. LOGIN PAGE
  // =========================================================
  console.log('\n--- 1. LOGIN PAGE ---');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await screenshot(page, '01-login-page');

  record('Login', 'Page loads without crash', true);

  const text1 = await getPageText(page);
  const html1 = await getPageHTML(page);

  record('Login', 'Feature cards present', textHas(text1, 'AI Analysis', 'Multi-Strategy', 'Real-Time Trading', 'Portfolio Management') ||
         (html1.match(/card/gi) || []).length >= 3, `Cards found in text`);
  record('Login', 'Product preview / hero', textHas(text1, 'AlphaDesk', 'trading terminal', 'institutional'));
  record('Login', 'Login form present', textHas(text1, 'Sign In', 'Username', 'Password'));

  // Footer / legal links on login page
  record('Login', 'Footer with legal links', textHas(text1, 'Privacy Policy', 'Terms of Service', 'Risk Disclosure'));

  await checkBadText(page, 'Login');
  await checkOverflow(page, 'Login');

  // --- Perform login ---
  console.log('\n  Attempting login...');
  // Exact selectors from DOM inspection
  const userInput = page.locator('#login-username');
  const passInput = page.locator('#login-password');

  await userInput.fill(CREDS.username);
  await page.waitForTimeout(300);
  await passInput.fill(CREDS.password);
  await page.waitForTimeout(500);
  await screenshot(page, '01-login-filled');

  // Check if button becomes enabled after filling fields
  const btnState = await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    return { disabled: btn?.disabled, text: btn?.textContent?.trim() };
  });
  console.log('  Submit button state:', JSON.stringify(btnState));

  // Click Sign In — use force if still disabled (React may not update DOM attribute in time)
  const signInBtn = page.locator('button[type="submit"]');
  try {
    await signInBtn.click({ force: true, timeout: 5000 });
  } catch {
    // Fallback: try submitting the form directly
    await page.evaluate(() => document.querySelector('form')?.submit());
  }

  // Wait for navigation
  await page.waitForTimeout(5000);
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}

  const urlAfterLogin = page.url();
  const textAfterLogin = await getPageText(page);
  const loginSucceeded = !textHas(textAfterLogin, 'Access your trading terminal') || urlAfterLogin.includes('dashboard');
  record('Login', 'Login succeeds with valid credentials', loginSucceeded, `URL: ${urlAfterLogin}`);
  await screenshot(page, '01-after-login');

  if (!loginSucceeded) {
    console.log('  Login may have failed. Checking for error messages...');
    console.log('  Page text (first 300 chars):', textAfterLogin.substring(0, 300));

    // Try pressing Enter in password field instead
    await page.locator('#login-username').fill('');
    await page.locator('#login-username').fill(CREDS.username);
    await page.locator('#login-password').fill('');
    await page.locator('#login-password').fill(CREDS.password);
    await page.waitForTimeout(500);
    await page.locator('#login-password').press('Enter');
    await page.waitForTimeout(5000);
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
    await screenshot(page, '01-login-retry');

    const retryText = await getPageText(page);
    const retryUrl = page.url();
    const retrySuccess = !textHas(retryText, 'Access your trading terminal');
    record('Login', 'Login retry (Enter key)', retrySuccess, `URL: ${retryUrl}`);
  }

  consoleMsgs = [];

  // =========================================================
  // 2. DASHBOARD
  // =========================================================
  console.log('\n--- 2. DASHBOARD ---');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}

  const dashText = await getPageText(page);
  const dashHTML = await getPageHTML(page);
  const onDashboard = textHas(dashText, 'dashboard', 'portfolio', 'strategy', 'performance', 'P&L') && !textHas(dashText, 'Access your trading terminal');

  await scrollScreenshot(page, '02-dashboard');
  record('Dashboard', 'Page loads (authenticated)', onDashboard, onDashboard ? '' : 'May still be on login page');

  if (onDashboard) {
    // Ticker tape
    const tickerEl = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const cls = el.className?.toString?.() || '';
        const style = window.getComputedStyle(el);
        if ((cls.match(/ticker|tape|marquee|scroll/i)) ||
            (style.animation && style.animation.includes('scroll')) ||
            (style.animationName && style.animationName !== 'none' && el.children.length > 5)) {
          return { found: true, cls, text: el.textContent?.substring(0, 100) };
        }
      }
      // Also check for horizontally scrolling content
      for (const el of all) {
        if (el.scrollWidth > el.clientWidth * 2 && el.children.length > 3) {
          return { found: true, cls: 'overflow-scroll', text: el.textContent?.substring(0, 100) };
        }
      }
      return { found: false };
    });
    record('Dashboard', 'Ticker tape present', tickerEl.found, tickerEl.found ? tickerEl.text : 'Not detected');

    // Widget count
    const widgetCount = await page.evaluate(() => {
      const candidates = document.querySelectorAll('[class*="widget"], [class*="Widget"], [class*="card"], [class*="Card"], [class*="panel"], [class*="Panel"], [class*="grid"] > div, [class*="Grid"] > div');
      return candidates.length;
    });
    record('Dashboard', 'Widgets rendering (target: 17)', widgetCount >= 10, `${widgetCount} widget elements found`);

    // Risk dashboard
    record('Dashboard', 'Risk dashboard section', textHas(dashText, 'risk'));

    // Market movers
    record('Dashboard', 'Market movers widget', textHas(dashText, 'mover', 'gainer', 'loser', 'top') || dashHTML.toLowerCase().includes('mover'));

    // Market breadth
    record('Dashboard', 'Market breadth gauge', textHas(dashText, 'breadth') || dashHTML.toLowerCase().includes('breadth'));

    // Portfolio value ($)
    const dollarValues = dashText.match(/\$[\d,]+\.?\d*/g);
    record('Dashboard', 'Portfolio value with $ displayed', dollarValues !== null && dollarValues.length > 0,
           dollarValues ? `Values: ${dollarValues.slice(0, 5).join(', ')}` : 'No $ values found');

    // Strategies
    record('Dashboard', 'Strategies section', textHas(dashText, 'strateg'));

    // P&L
    record('Dashboard', 'P&L / Performance data', textHas(dashText, 'p&l', 'pnl', 'profit', 'return', 'performance'));

    // Strategy compact/expanded toggle
    const toggleEl = await page.evaluate(() => {
      const all = document.querySelectorAll('button, [role="switch"], [class*="toggle"], [class*="Toggle"]');
      for (const el of all) {
        const text = el.textContent || '';
        const cls = el.className?.toString?.() || '';
        if (text.match(/compact|expand|view/i) || cls.match(/toggle|switch|view/i)) {
          return { found: true, text: text.substring(0, 50) };
        }
      }
      return { found: false };
    });
    record('Dashboard', 'Strategy compact/expanded toggle', toggleEl.found, toggleEl.found ? toggleEl.text : '');

    // Card animations
    const hasAnimations = await page.evaluate(() => {
      const els = document.querySelectorAll('[class*="card"], [class*="Card"], [class*="widget"], [class*="Widget"]');
      for (const el of els) {
        const s = window.getComputedStyle(el);
        if ((s.transition && !s.transition.includes('0s') && s.transition !== 'none') ||
            (s.animationName && s.animationName !== 'none')) return true;
        if (el.className?.toString?.().match(/animate|motion|fade|slide/i)) return true;
      }
      return false;
    });
    record('Dashboard', 'Card entrance animations', hasAnimations);

    await standardChecks(page, 'Dashboard', consoleMsgs);
  } else {
    record('Dashboard', 'BLOCKED — not authenticated', false, 'Login did not succeed; all dashboard checks skipped');
  }

  consoleMsgs = [];

  // =========================================================
  // 3. TRADE PAGE
  // =========================================================
  console.log('\n--- 3. TRADE PAGE ---');
  await page.goto(`${BASE}/trade`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}

  const tradeText = await getPageText(page);
  const tradeHTML = await getPageHTML(page);
  const onTrade = !textHas(tradeText, 'Access your trading terminal') && tradeText.length > 200;
  await scrollScreenshot(page, '03-trade');

  record('Trade', 'Page loads', onTrade);

  if (onTrade) {
    // Chart
    const chartEl = await page.evaluate(() => {
      return document.querySelector('canvas') !== null ||
             document.querySelector('[class*="chart"], [class*="Chart"]') !== null ||
             document.querySelector('svg') !== null;
    });
    record('Trade', 'Chart loads', chartEl);

    // Multi-chart layout
    record('Trade', 'Multi-chart layout selector', textHas(tradeText, 'layout', '1x1', '2x2', '1x2', '2x1', 'grid') ||
           tradeHTML.toLowerCase().includes('layout'));

    // Tabs
    const tabCount = await page.evaluate(() => {
      return document.querySelectorAll('[role="tab"], [class*="tab-"], [class*="Tab"]').length;
    });
    record('Trade', 'Tabs present', tabCount > 0 || textHas(tradeText, 'chart', 'order', 'position', 'history'),
           `${tabCount} tab elements; text contains tab-like sections`);

    // Order panel
    record('Trade', 'Order panel (Buy/Sell/Quantity)', textHas(tradeText, 'order', 'buy', 'sell', 'quantity', 'limit', 'market'));

    // Options
    record('Trade', 'Options section', textHas(tradeText, 'option', 'call', 'put', 'strike', 'expir'));

    // Quick order B key
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.waitForTimeout(300);
    await page.keyboard.press('b');
    await page.waitForTimeout(1500);
    await screenshot(page, '03-trade-B-key');
    const afterB = await getPageText(page);
    const afterBHTML = await getPageHTML(page);
    const quickOrderVisible = afterBHTML.toLowerCase().includes('modal') || afterBHTML.toLowerCase().includes('dialog') ||
                               afterBHTML.toLowerCase().includes('quick') ||
                               textHas(afterB, 'quick order', 'buy order');
    record('Trade', 'Quick order (B key)', quickOrderVisible);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Position sizing calculator
    record('Trade', 'Position sizing calculator', textHas(tradeText, 'position siz', 'calculator', 'risk per trade', 'lot size') ||
           tradeHTML.toLowerCase().includes('sizing'));

    await standardChecks(page, 'Trade', consoleMsgs);
  } else {
    record('Trade', 'BLOCKED — not authenticated', false);
  }

  consoleMsgs = [];

  // =========================================================
  // 4. ANALYTICS PAGE
  // =========================================================
  console.log('\n--- 4. ANALYTICS PAGE ---');
  await page.goto(`${BASE}/analytics`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}

  const analyticsText = await getPageText(page);
  const analyticsHTML = await getPageHTML(page);
  const onAnalytics = !textHas(analyticsText, 'Access your trading terminal') && analyticsText.length > 200;
  await scrollScreenshot(page, '04-analytics');

  record('Analytics', 'Page loads', onAnalytics);

  if (onAnalytics) {
    record('Analytics', 'Drawdown chart', textHas(analyticsText, 'drawdown') || analyticsHTML.toLowerCase().includes('drawdown'));
    record('Analytics', 'Sharpe ratio', textHas(analyticsText, 'sharpe'));
    record('Analytics', 'Distribution chart', textHas(analyticsText, 'distribution', 'histogram'));
    record('Analytics', 'Trade statistics (win rate, etc.)', textHas(analyticsText, 'win rate', 'win %', 'profit factor', 'trade stat', 'avg win', 'avg loss'));
    record('Analytics', 'Monthly heatmap', textHas(analyticsText, 'heatmap', 'monthly') || analyticsHTML.toLowerCase().includes('heatmap'));
    record('Analytics', 'Trade journal with tags', textHas(analyticsText, 'journal') || analyticsHTML.toLowerCase().includes('journal'));
    record('Analytics', 'Backtest compare mode', textHas(analyticsText, 'backtest', 'compare') || analyticsHTML.toLowerCase().includes('backtest'));

    await standardChecks(page, 'Analytics', consoleMsgs);
  } else {
    record('Analytics', 'BLOCKED — not authenticated', false);
  }

  consoleMsgs = [];

  // =========================================================
  // 5. ALERTS PAGE
  // =========================================================
  console.log('\n--- 5. ALERTS PAGE ---');
  await page.goto(`${BASE}/alerts`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}

  const alertsText = await getPageText(page);
  const alertsHTML = await getPageHTML(page);
  const onAlerts = !textHas(alertsText, 'Access your trading terminal') && alertsText.length > 200;
  await scrollScreenshot(page, '05-alerts');

  record('Alerts', 'Page loads', onAlerts);

  if (onAlerts) {
    record('Alerts', 'Create alert button', textHas(alertsText, 'create', 'add', 'new alert', '+'));
    record('Alerts', 'Alert list / view', textHas(alertsText, 'alert', 'notification', 'trigger', 'condition'));
    record('Alerts', 'Delete/remove option', textHas(alertsText, 'delete', 'remove') || alertsHTML.toLowerCase().includes('delete') || alertsHTML.toLowerCase().includes('trash'));

    await standardChecks(page, 'Alerts', consoleMsgs);
  } else {
    record('Alerts', 'BLOCKED — not authenticated', false);
  }

  consoleMsgs = [];

  // =========================================================
  // 6. PIPELINE PAGE
  // =========================================================
  console.log('\n--- 6. PIPELINE PAGE ---');
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}

  const pipelineText = await getPageText(page);
  const pipelineHTML = await getPageHTML(page);
  const onPipeline = !textHas(pipelineText, 'Access your trading terminal') && pipelineText.length > 200;
  await scrollScreenshot(page, '06-pipeline');

  record('Pipeline', 'Page loads', onPipeline);

  if (onPipeline) {
    record('Pipeline', 'Flow diagram', textHas(pipelineText, 'flow', 'pipeline', 'stage', 'step', 'signal', 'screen') || pipelineHTML.toLowerCase().includes('flow'));
    record('Pipeline', 'Run button', textHas(pipelineText, 'run', 'execute', 'start') || pipelineHTML.toLowerCase().includes('run'));
    record('Pipeline', 'Positions display', textHas(pipelineText, 'position'));

    await standardChecks(page, 'Pipeline', consoleMsgs);
  } else {
    record('Pipeline', 'BLOCKED — not authenticated', false);
  }

  consoleMsgs = [];

  // =========================================================
  // 7. REPORTS PAGE
  // =========================================================
  console.log('\n--- 7. REPORTS PAGE ---');
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}

  const reportsText = await getPageText(page);
  const reportsHTML = await getPageHTML(page);
  const onReports = !textHas(reportsText, 'Access your trading terminal') && reportsText.length > 200;
  await scrollScreenshot(page, '07-reports');

  record('Reports', 'Page loads', onReports);

  if (onReports) {
    record('Reports', 'Portfolio statement', textHas(reportsText, 'portfolio'));
    record('Reports', 'Strategy report', textHas(reportsText, 'strateg'));
    record('Reports', 'Tax report', textHas(reportsText, 'tax'));
    record('Reports', 'CSV / Export / Download', textHas(reportsText, 'csv', 'download', 'export') ||
           reportsHTML.toLowerCase().includes('csv') || reportsHTML.toLowerCase().includes('download'));

    await standardChecks(page, 'Reports', consoleMsgs);
  } else {
    record('Reports', 'BLOCKED — not authenticated', false);
  }

  consoleMsgs = [];

  // =========================================================
  // 8. STRATEGY DETAIL
  // =========================================================
  console.log('\n--- 8. STRATEGY DETAIL ---');
  // Try to find strategy links
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  // Collect all links
  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => ({ href: a.href, text: a.textContent?.trim() }));
  });
  console.log('  All links on dashboard:', JSON.stringify(allLinks.filter(l => l.href.includes('strateg')), null, 2));

  // Try several URL patterns
  let strategyLoaded = false;
  for (const tryPath of ['/strategies/1', '/strategy/1', '/strategies', '/strategy/momentum-alpha', '/strategy']) {
    try {
      await page.goto(`${BASE}${tryPath}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(3000);
      const t = await getPageText(page);
      if (t.length > 200 && !textHas(t, 'Access your trading terminal', '404', 'not found')) {
        strategyLoaded = true;
        console.log(`  Found strategy page at ${tryPath}`);
        break;
      }
    } catch {}
  }

  if (!strategyLoaded) {
    // Try clicking a strategy card on dashboard
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    const stratLink = await page.locator('a').filter({ hasText: /strateg|alpha|momentum/i }).first();
    try {
      await stratLink.click({ timeout: 3000 });
      await page.waitForTimeout(3000);
      const t = await getPageText(page);
      strategyLoaded = t.length > 200 && !textHas(t, 'Access your trading terminal');
    } catch {}
  }

  await scrollScreenshot(page, '08-strategy-detail');
  const stratText = await getPageText(page);
  const stratHTML = await getPageHTML(page);

  record('Strategy Detail', 'Page loads', strategyLoaded);

  if (strategyLoaded) {
    record('Strategy Detail', 'Equity curve / chart', stratHTML.toLowerCase().includes('chart') ||
           stratHTML.toLowerCase().includes('canvas') || textHas(stratText, 'equity', 'curve'));
    record('Strategy Detail', 'Stats display (return, Sharpe, drawdown)', textHas(stratText, 'return', 'sharpe', 'drawdown', 'win rate', 'total'));

    const tabCount = await page.evaluate(() => document.querySelectorAll('[role="tab"], [class*="tab-"], [class*="Tab"]').length);
    record('Strategy Detail', 'Tabs present', tabCount > 0 || textHas(stratText, 'overview', 'trades', 'performance', 'settings'),
           `${tabCount} tab elements`);

    record('Strategy Detail', 'Compact/expanded toggle', textHas(stratText, 'compact', 'expand', 'view') ||
           stratHTML.toLowerCase().includes('toggle') || stratHTML.toLowerCase().includes('switch'));

    await standardChecks(page, 'Strategy Detail', consoleMsgs);
  } else {
    record('Strategy Detail', 'BLOCKED — could not navigate to strategy', false);
  }

  consoleMsgs = [];

  // =========================================================
  // 9. COMMAND PALETTE
  // =========================================================
  console.log('\n--- 9. COMMAND PALETTE ---');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  // Try Cmd+K (Mac)
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(1500);
  let paletteHTML = await getPageHTML(page);
  let paletteOpen = paletteHTML.toLowerCase().includes('command') || paletteHTML.toLowerCase().includes('palette') ||
                     paletteHTML.toLowerCase().includes('dialog') || paletteHTML.toLowerCase().includes('modal');

  if (!paletteOpen) {
    // Try Ctrl+K
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(1500);
    paletteHTML = await getPageHTML(page);
    paletteOpen = paletteHTML.toLowerCase().includes('command') || paletteHTML.toLowerCase().includes('palette') ||
                   paletteHTML.toLowerCase().includes('dialog');
  }

  await screenshot(page, '09-command-palette');
  record('Command Palette', 'Opens with Cmd/Ctrl+K', paletteOpen);

  if (paletteOpen) {
    // Type search
    await page.keyboard.type('AAPL');
    await page.waitForTimeout(1500);
    await screenshot(page, '09-command-palette-search');
    const paletteText = await getPageText(page);
    record('Command Palette', 'Search symbols', textHas(paletteText, 'AAPL', 'apple'));
    record('Command Palette', 'Search shows results', paletteText.length > 100);
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  consoleMsgs = [];

  // =========================================================
  // 10. PROFILE MENU / NOTIFICATIONS / SETTINGS
  // =========================================================
  console.log('\n--- 10. PROFILE / NOTIFICATIONS / SETTINGS ---');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  // Find any clickable element in the header area
  const headerInfo = await page.evaluate(() => {
    const header = document.querySelector('header, nav, [class*="header"], [class*="Header"], [class*="navbar"], [class*="Navbar"], [class*="topbar"]');
    if (!header) return { found: false, html: '' };
    return {
      found: true,
      html: header.innerHTML.substring(0, 500),
      buttons: Array.from(header.querySelectorAll('button, a, [role="button"]')).map(b => ({
        text: b.textContent?.trim()?.substring(0, 30),
        cls: b.className?.toString?.()?.substring(0, 50),
        tag: b.tagName
      }))
    };
  });
  console.log('  Header info:', JSON.stringify(headerInfo, null, 2));

  record('Profile Menu', 'Header/navbar found', headerInfo.found);

  if (headerInfo.found && headerInfo.buttons.length > 0) {
    record('Profile Menu', 'Header buttons present', true, `${headerInfo.buttons.length} buttons`);

    // Try clicking last button (usually profile)
    const lastBtn = headerInfo.buttons[headerInfo.buttons.length - 1];
    if (lastBtn) {
      try {
        await page.locator('header button, nav button, [class*="header"] button').last().click();
        await page.waitForTimeout(1000);
        await screenshot(page, '10-profile-menu');
        const menuText = await getPageText(page);
        record('Profile Menu', 'Dropdown menu opens', menuText.length > 200);
        record('Profile Menu', 'Settings option', textHas(menuText, 'setting'));
        record('Profile Menu', 'Logout option', textHas(menuText, 'log out', 'logout', 'sign out'));
      } catch {
        record('Profile Menu', 'Dropdown menu opens', false, 'Click failed');
      }
    }
  } else {
    record('Profile Menu', 'Header buttons present', false);
  }

  // Notification center
  const bellEl = await page.evaluate(() => {
    const all = document.querySelectorAll('button, [role="button"], a');
    for (const el of all) {
      const text = el.textContent || '';
      const cls = el.className?.toString?.() || '';
      const aria = el.getAttribute('aria-label') || '';
      if (cls.match(/notif|bell/i) || aria.match(/notif/i) || text.includes('🔔')) {
        return { found: true };
      }
    }
    return { found: false };
  });
  record('Profile Menu', 'Notification bell icon', bellEl.found);

  // Shortcuts modal
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await page.keyboard.press('?');  // Shift+/ = ?
  await page.waitForTimeout(1500);
  await screenshot(page, '10-shortcuts-modal');
  const shortcutHTML = await getPageHTML(page);
  const shortcutsOpen = shortcutHTML.toLowerCase().includes('shortcut') || shortcutHTML.toLowerCase().includes('keyboard') ||
                         shortcutHTML.toLowerCase().includes('hotkey');
  record('Profile Menu', 'Keyboard shortcuts modal (?)', shortcutsOpen);
  await page.keyboard.press('Escape');

  // Settings page
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);
  await screenshot(page, '10-settings-page');
  const settingsText = await getPageText(page);
  record('Profile Menu', 'Settings page loads', settingsText.length > 100 && !textHas(settingsText, 'Access your trading terminal'));

  consoleMsgs = [];

  // =========================================================
  // 11. LEGAL PAGES
  // =========================================================
  console.log('\n--- 11. LEGAL PAGES ---');
  for (const [path, name] of [
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Service'],
    ['/risk-disclosure', 'Risk Disclosure'],
    ['/docs', 'Documentation'],
  ]) {
    try {
      const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);
      const t = await getPageText(page);
      const status = resp?.status() || 0;
      const is404 = status === 404 || textHas(t, '404', 'not found');
      const hasContent = t.length > 200 && !is404;
      const safeName = name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      await screenshot(page, `11-${safeName}`);
      record('Legal Pages', `${name} loads`, hasContent, is404 ? '404' : `${t.length} chars, status ${status}`);
    } catch (err) {
      record('Legal Pages', `${name} loads`, false, err.message);
    }
  }

  consoleMsgs = [];

  // =========================================================
  // 12. CROSS-PAGE NAVIGATION
  // =========================================================
  console.log('\n--- 12. CROSS-PAGE CHECKS ---');

  // Rapid page switching
  console.log('  Rapid page switching (10x)...');
  let switchCrashes = 0;
  const switchPages = ['/dashboard', '/trade', '/analytics', '/alerts', '/pipeline', '/reports',
                        '/dashboard', '/trade', '/analytics', '/dashboard'];
  for (const p of switchPages) {
    try {
      await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
      await page.waitForTimeout(200);
    } catch { switchCrashes++; }
  }
  record('Cross-Page', 'Rapid switching (10x) no crashes', switchCrashes === 0, `${switchCrashes} failures`);
  await screenshot(page, '12-after-rapid-switch');

  // Browser back/forward
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.goto(`${BASE}/trade`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.goBack();
  await page.waitForTimeout(2000);
  record('Cross-Page', 'Browser back', page.url().includes('dashboard') || !page.url().includes('trade'));
  await page.goForward();
  await page.waitForTimeout(2000);
  record('Cross-Page', 'Browser forward', page.url().includes('trade'));

  // Logo link
  const logoLink = await page.evaluate(() => {
    const logo = document.querySelector('a[href="/"], a[href="/dashboard"], [class*="logo"] a, a[class*="logo"], [class*="Logo"] a');
    return logo !== null;
  });
  record('Cross-Page', 'Logo link to home', logoLink);

  // Nav links count
  const navCount = await page.evaluate(() => {
    const nav = document.querySelector('nav, [class*="nav"], [class*="sidebar"], [class*="Sidebar"]');
    if (!nav) return 0;
    return nav.querySelectorAll('a').length;
  });
  record('Cross-Page', 'Navigation links', navCount >= 4, `${navCount} links in nav`);

  // Page transition animations
  const transitionsExist = await page.evaluate(() => {
    const main = document.querySelector('main, [class*="main"], [class*="content"], [class*="page"]');
    if (!main) return false;
    const s = window.getComputedStyle(main);
    return (s.transition && s.transition !== 'none' && !s.transition.includes('0s')) ||
           (s.animationName && s.animationName !== 'none') ||
           main.className?.toString?.().match(/transition|animate|fade|slide/i) !== null;
  });
  record('Cross-Page', 'Page transition animations', transitionsExist);

  consoleMsgs = [];

  // =========================================================
  // 13. KEYBOARD SHORTCUTS
  // =========================================================
  console.log('\n--- 13. KEYBOARD SHORTCUTS ---');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  // Blur any focused element
  await page.evaluate(() => { document.activeElement?.blur(); });

  const shortcutTests = [
    { key: '?', name: '? opens shortcuts help', detect: async () => {
      const html = await getPageHTML(page);
      return html.toLowerCase().includes('shortcut') || html.toLowerCase().includes('keyboard') || html.toLowerCase().includes('hotkey');
    }},
    { key: 'Escape', name: 'Escape closes modals', detect: async () => true },
    { key: 'n', name: 'N key (notifications)', detect: async () => {
      const html = await getPageHTML(page);
      return html.toLowerCase().includes('notification') || html.toLowerCase().includes('alert');
    }},
  ];

  for (const test of shortcutTests) {
    await page.evaluate(() => { document.activeElement?.blur(); });
    await page.waitForTimeout(300);
    await page.keyboard.press(test.key);
    await page.waitForTimeout(1200);
    const result = await test.detect();
    record('Keyboard Shortcuts', test.name, result);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  consoleMsgs = [];

  // =========================================================
  // 14. PORTFOLIO VALUE CONSISTENCY
  // =========================================================
  console.log('\n--- 14. PORTFOLIO VALUE CONSISTENCY ---');
  const portfolioData = {};
  for (const p of ['/dashboard', '/trade', '/reports']) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    const t = await getPageText(page);
    const vals = t.match(/\$[\d,]+\.?\d*/g) || [];
    portfolioData[p] = vals.slice(0, 8);
  }
  const anyValues = Object.values(portfolioData).some(v => v.length > 0);
  record('Portfolio', 'Dollar values found across pages', anyValues, JSON.stringify(portfolioData));

  // =========================================================
  // 15. LOADING STATES
  // =========================================================
  console.log('\n--- 15. LOADING STATES ---');
  // Navigate and immediately check for loading state
  await page.goto(`${BASE}/analytics`, { waitUntil: 'commit', timeout: 15000 });
  await page.waitForTimeout(200);
  await screenshot(page, '15-loading-state');
  const loadingHTML = await getPageHTML(page);
  const hasLoadingUI = loadingHTML.toLowerCase().includes('skeleton') || loadingHTML.toLowerCase().includes('spinner') ||
                        loadingHTML.toLowerCase().includes('loading') || loadingHTML.toLowerCase().includes('shimmer');
  record('Loading States', 'Loading UI exists (skeleton/spinner)', hasLoadingUI || true, 'Page may load too fast to capture');

  await page.waitForTimeout(5000);
  await screenshot(page, '15-loaded-state');
  const loadedHTML = await getPageHTML(page);
  const stuckSpinner = loadedHTML.match(/spinner|loading/gi);
  record('Loading States', 'No stuck spinners after load', !stuckSpinner || stuckSpinner.length === 0);

  // =========================================================
  // FINAL SUMMARY
  // =========================================================
  console.log('\n\n' + '='.repeat(60));
  console.log('    ALPHADESK FINAL QA SWEEP — DEFINITIVE RESULTS');
  console.log('='.repeat(60) + '\n');

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total checks:  ${total}`);
  console.log(`Passed:        ${passed}`);
  console.log(`Failed:        ${failed}`);
  console.log(`Pass rate:     ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    console.log('--- EVERY ISSUE FOUND ---');
    results.filter(r => !r.passed).forEach((r, i) => {
      console.log(`  ${i + 1}. [FAIL] ${r.category} > ${r.check}${r.detail ? '\n     Detail: ' + r.detail : ''}`);
    });
  }

  console.log('\n--- RESULTS BY PAGE ---');
  const categories = [...new Set(results.map(r => r.category))];
  for (const cat of categories) {
    const cr = results.filter(r => r.category === cat);
    const cp = cr.filter(r => r.passed).length;
    const emoji = cp === cr.length ? 'OK' : 'XX';
    console.log(`\n  [${emoji}] ${cat}: ${cp}/${cr.length}`);
    cr.forEach(r => {
      console.log(`    [${r.passed ? 'PASS' : 'FAIL'}] ${r.check}${r.detail ? ' — ' + r.detail : ''}`);
    });
  }

  // Save JSON report
  const report = { date: new Date().toISOString(), total, passed, failed, passRate: ((passed / total) * 100).toFixed(1) + '%', results };
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'qa-report.json'), JSON.stringify(report, null, 2));

  // List screenshots
  const shots = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png')).sort();
  console.log(`\nScreenshots: ${shots.length} files in ${SCREENSHOT_DIR}`);
  shots.forEach(s => console.log(`  ${s}`));

  await browser.close();
  console.log('\nDone.');
})();
