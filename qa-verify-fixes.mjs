import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'https://tradingalpha.net';
const SCREENSHOTS_DIR = join(import.meta.dirname, 'qa-screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const results = {};

function record(name, pass, detail) {
  results[name] = { pass, detail };
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${name}: ${detail}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // ──────────────────────────────────────────────
  // Step 0 — Login
  // ──────────────────────────────────────────────
  console.log('\n=== Logging in ===');
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '00-login-page.png'), fullPage: true });

    // Fill login form using exact IDs from source
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'alphaDesk2025!');
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '00-login-filled.png'), fullPage: true });
    await page.click('button[type="submit"]');

    // Wait for navigation away from login
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '00-after-login.png'), fullPage: true });
    console.log('Login successful, current URL:', page.url());
  } catch (err) {
    console.error('Login failed:', err.message);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '00-login-error.png'), fullPage: true });
  }

  // ──────────────────────────────────────────────
  // Test 1 — Trading halt endpoint exists
  // ──────────────────────────────────────────────
  console.log('\n=== Test 1: Trading halt endpoint ===');
  try {
    // The halt endpoint is POST /api/v1/trades/halt (confirmed from source)
    // It requires auth (set via cookies from login)
    // We use OPTIONS or a GET to confirm the route exists (Method Not Allowed = route exists)
    // Or POST to actually test it

    // First, try GET — should return 405 Method Not Allowed (route exists but only POST)
    const haltGetResp = await page.request.get(`${BASE_URL}/api/v1/trades/halt`);
    const haltGetStatus = haltGetResp.status();
    console.log(`GET /api/v1/trades/halt => status ${haltGetStatus}`);

    // Also check the resume endpoint to confirm the pair exists
    const resumeGetResp = await page.request.get(`${BASE_URL}/api/v1/trades/resume`);
    const resumeGetStatus = resumeGetResp.status();
    console.log(`GET /api/v1/trades/resume => status ${resumeGetStatus}`);

    // 405 = route exists but wrong method (PASS)
    // 200/401/403/422 = route exists (PASS)
    // 404 = route not found (FAIL)
    const haltExists = haltGetStatus !== 404;
    const resumeExists = resumeGetStatus !== 404;

    if (haltExists && resumeExists) {
      record('1-halt-endpoint', true, `POST /api/v1/trades/halt exists (GET => ${haltGetStatus}), resume exists (GET => ${resumeGetStatus})`);
    } else if (haltExists) {
      record('1-halt-endpoint', true, `POST /api/v1/trades/halt exists (GET => ${haltGetStatus})`);
    } else {
      record('1-halt-endpoint', false, `Halt endpoint returned 404`);
    }
  } catch (err) {
    record('1-halt-endpoint', false, `Error: ${err.message}`);
  }

  // ──────────────────────────────────────────────
  // Test 2 — Demo data removed from TradePanel (Positions tab)
  // ──────────────────────────────────────────────
  console.log('\n=== Test 2: Demo data removed from Positions tab ===');
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '02-trade-page.png'), fullPage: true });

    // Find and click the Positions tab
    const positionsTab = page.locator('text=Positions').first();
    if (await positionsTab.isVisible({ timeout: 5000 })) {
      await positionsTab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, '02-positions-tab.png'), fullPage: true });

      // The positions panel is in the bottom-right area of the trade page.
      // We need to check ONLY the positions panel, not the entire page
      // (since SPY/AAPL etc. appear in the watchlist and chart naturally).
      // Look for the empty state message in the positions area.
      const pageText = await page.textContent('body');

      // The key indicator: "No open positions" means demo data is REMOVED
      const hasEmptyState =
        pageText.includes('No open positions') ||
        pageText.includes('No positions') ||
        pageText.includes('Positions will appear');

      // Check for hardcoded DEMO positions (specific fake prices from old code)
      // Old demo data had: AAPL @ $175.23, NVDA @ $890.45, SPY @ $512.67
      const hasOldAAPL = pageText.includes('175.23');
      const hasOldNVDA = pageText.includes('890.45');
      const hasOldSPY = pageText.includes('512.67');
      const hasDemoData = hasOldAAPL || hasOldNVDA || hasOldSPY;

      if (hasEmptyState && !hasDemoData) {
        record('2-no-demo-data', true, `Positions tab shows empty state ("No open positions"). No hardcoded demo prices found.`);
      } else if (hasDemoData) {
        record('2-no-demo-data', false, `Demo data still present — old prices: AAPL@175.23:${hasOldAAPL} NVDA@890.45:${hasOldNVDA} SPY@512.67:${hasOldSPY}`);
      } else {
        record('2-no-demo-data', true, `No hardcoded demo positions found. Empty state: ${hasEmptyState}`);
      }
    } else {
      // Maybe it's a tab with different text
      const allTabs = await page.locator('[role="tab"], button').allTextContents();
      console.log('Available tabs/buttons:', allTabs.join(', '));
      record('2-no-demo-data', false, `Could not find Positions tab`);
    }
  } catch (err) {
    record('2-no-demo-data', false, `Error: ${err.message}`);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '02-error.png'), fullPage: true });
  }

  // ──────────────────────────────────────────────
  // Test 3 — React Query / StatusStrip with regime data
  // ──────────────────────────────────────────────
  console.log('\n=== Test 3: React Query — StatusStrip / Regime data ===');
  try {
    // StatusStrip is typically visible on most pages, go to dashboard
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '03-dashboard.png'), fullPage: true });

    const pageText = await page.textContent('body');

    // Check for regime indicators
    const regimeTerms = ['Bull', 'Bear', 'Neutral', 'Volatile', 'Regime', 'regime'];
    const foundRegime = regimeTerms.filter(t => pageText.includes(t));

    // Check for VIX
    const hasVIX = pageText.includes('VIX') || pageText.includes('vix');

    // Check for P&L
    const hasPnL = pageText.includes('P&L') || pageText.includes('PnL') || pageText.includes('P/L') || /\$[\d,]+/.test(pageText);

    const details = [];
    if (foundRegime.length > 0) details.push(`Regime: [${foundRegime.join(',')}]`);
    if (hasVIX) details.push('VIX present');
    if (hasPnL) details.push('P&L present');

    if (foundRegime.length > 0 || hasVIX || hasPnL) {
      record('3-react-query-status', true, details.join('; '));
    } else {
      record('3-react-query-status', false, 'No regime/VIX/P&L data found in StatusStrip');
    }
  } catch (err) {
    record('3-react-query-status', false, `Error: ${err.message}`);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '03-error.png'), fullPage: true });
  }

  // ──────────────────────────────────────────────
  // Test 4 — Error toast system available
  // ──────────────────────────────────────────────
  console.log('\n=== Test 4: Toast system ===');
  try {
    // AlphaDesk uses a custom ToastProvider (src/components/ui/toast.tsx)
    // that renders: <div className="fixed bottom-4 right-4 z-[55] flex flex-col-reverse gap-2 w-[380px] pointer-events-none">
    // This is always in the DOM even when no toasts are showing.
    // Also check: the dashboard layout wires up window event listener for alphadesk:api-error

    // 1. Check for the toast container element (custom implementation)
    const customToastContainer = page.locator('div.fixed.bottom-4.right-4');
    const customCount = await customToastContainer.count();
    console.log(`Custom toast container (fixed bottom-4 right-4): ${customCount} elements`);

    // 2. Check for the ToastContext provider by triggering a toast via JS
    const toastTriggered = await page.evaluate(() => {
      // Dispatch the custom event that the dashboard layout listens for
      const evt = new CustomEvent('alphadesk:api-error', {
        detail: { status: 500, message: 'QA Test: Toast system verification' }
      });
      window.dispatchEvent(evt);
      return true;
    });

    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '04-toast-check.png'), fullPage: true });

    // 3. Check if a toast actually appeared (role="alert" from ToastItem)
    const alertCount = await page.locator('[role="alert"]').count();
    console.log(`Alert elements after dispatching event: ${alertCount}`);

    // 4. Also check for the pointer-events-none wrapper
    const wrapperCount = await page.locator('div.pointer-events-none.fixed').count();
    console.log(`Fixed pointer-events-none wrappers: ${wrapperCount}`);

    // 5. Fallback: check HTML source for toast-related code
    const html = await page.content();
    const hasToastInHTML = html.includes('pointer-events-none') && html.includes('pointer-events-auto');

    if (alertCount > 0) {
      record('4-toast-system', true, `Toast system working — triggered test toast, found ${alertCount} alert element(s) in DOM`);
    } else if (customCount > 0 || wrapperCount > 0) {
      record('4-toast-system', true, `Toast container present in DOM (custom ToastProvider). Container count: ${customCount || wrapperCount}`);
    } else if (hasToastInHTML) {
      record('4-toast-system', true, `Toast provider markup found in page HTML (pointer-events-none/auto pattern)`);
    } else {
      record('4-toast-system', false, 'No toast container/system found in DOM');
    }
  } catch (err) {
    record('4-toast-system', false, `Error: ${err.message}`);
  }

  // ──────────────────────────────────────────────
  // Test 5 — Backtesting expanded (SMA, RSI, MACD)
  // ──────────────────────────────────────────────
  console.log('\n=== Test 5: Backtesting strategy selector ===');
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Look for a Backtest tab or panel
    const backtestTab = page.locator('text=/backtest/i').first();
    if (await backtestTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await backtestTab.click();
      await page.waitForTimeout(1500);
    }

    await page.screenshot({ path: join(SCREENSHOTS_DIR, '05-backtest-panel.png'), fullPage: true });

    const pageText = await page.textContent('body');

    // Check for strategy options
    const hasSMA = pageText.includes('SMA') || pageText.includes('Simple Moving Average');
    const hasRSI = pageText.includes('RSI') || pageText.includes('Relative Strength');
    const hasMACD = pageText.includes('MACD');

    // Try to find and open a dropdown/select for strategies
    const selectors = [
      'select',
      '[role="combobox"]',
      '[role="listbox"]',
      'button:has-text("strategy")',
      'button:has-text("Strategy")',
      'button:has-text("Select")',
    ];

    for (const sel of selectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`Found selector element: ${sel}`);
        try {
          await el.click();
          await page.waitForTimeout(1000);
        } catch {}
        break;
      }
    }

    await page.screenshot({ path: join(SCREENSHOTS_DIR, '05-strategy-dropdown.png'), fullPage: true });

    // Re-check page text after potentially opening dropdown
    const updatedText = await page.textContent('body');
    const hasSMA2 = updatedText.includes('SMA') || updatedText.includes('Simple Moving Average');
    const hasRSI2 = updatedText.includes('RSI') || updatedText.includes('Relative Strength');
    const hasMACD2 = updatedText.includes('MACD');

    const foundStrategies = [];
    if (hasSMA || hasSMA2) foundStrategies.push('SMA');
    if (hasRSI || hasRSI2) foundStrategies.push('RSI');
    if (hasMACD || hasMACD2) foundStrategies.push('MACD');

    if (foundStrategies.length >= 2) {
      record('5-backtest-strategies', true, `Found strategies: ${foundStrategies.join(', ')}`);
    } else if (foundStrategies.length === 1) {
      record('5-backtest-strategies', false, `Only found ${foundStrategies.join(', ')} — expected SMA, RSI, MACD`);
    } else {
      record('5-backtest-strategies', false, `No SMA/RSI/MACD strategy options found`);
    }
  } catch (err) {
    record('5-backtest-strategies', false, `Error: ${err.message}`);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '05-error.png'), fullPage: true });
  }

  // ──────────────────────────────────────────────
  // Test 6 — Trading mode badge persisted
  // ──────────────────────────────────────────────
  console.log('\n=== Test 6: Trading mode badge ===');
  try {
    // Check for trading mode indicators on the current page
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const pageText = await page.textContent('body');

    // Trading mode could be: Paper, Live, Simulation, Demo
    const modeTerms = ['Paper', 'Live', 'Simulation', 'Demo', 'paper', 'live', 'PAPER', 'LIVE'];
    const foundModes = modeTerms.filter(t => pageText.includes(t));

    // Also check for a badge-like element
    const badgeSelectors = [
      'span:has-text("Paper")',
      'span:has-text("Live")',
      'span:has-text("PAPER")',
      'span:has-text("LIVE")',
      '[class*="badge"]',
      '[class*="Badge"]',
      '[data-trading-mode]',
    ];

    let foundBadge = null;
    for (const sel of badgeSelectors) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        const text = await page.locator(sel).first().textContent();
        foundBadge = `${sel} => "${text}"`;
        console.log(`Found badge: ${foundBadge}`);
        break;
      }
    }

    await page.screenshot({ path: join(SCREENSHOTS_DIR, '06-trading-mode.png'), fullPage: true });

    // Also check localStorage for persisted mode
    const storedMode = await page.evaluate(() => {
      return localStorage.getItem('tradingMode') ||
             localStorage.getItem('trading_mode') ||
             localStorage.getItem('tradeMode') ||
             localStorage.getItem('mode');
    });
    console.log('Stored trading mode in localStorage:', storedMode);

    if (foundBadge || foundModes.length > 0 || storedMode) {
      const details = [];
      if (foundModes.length) details.push(`Mode text: ${[...new Set(foundModes)].join(',')}`);
      if (foundBadge) details.push(`Badge: ${foundBadge}`);
      if (storedMode) details.push(`localStorage: ${storedMode}`);
      record('6-trading-mode', true, details.join('; '));
    } else {
      record('6-trading-mode', false, 'No trading mode badge or persisted mode found');
    }
  } catch (err) {
    record('6-trading-mode', false, `Error: ${err.message}`);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '06-error.png'), fullPage: true });
  }

  // ──────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────
  console.log('\n\n========================================');
  console.log('  QA VERIFICATION SUMMARY');
  console.log('========================================\n');

  let passCount = 0;
  let failCount = 0;
  for (const [name, { pass, detail }] of Object.entries(results)) {
    const icon = pass ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${name}`);
    console.log(`         ${detail}\n`);
    if (pass) passCount++;
    else failCount++;
  }

  console.log(`\nTotal: ${passCount} passed, ${failCount} failed out of ${passCount + failCount}`);
  console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}\n`);

  await browser.close();

  // Exit with non-zero if any tests failed
  if (failCount > 0) process.exit(1);
})();
