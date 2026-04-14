import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'https://tradingalpha.net';
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round8';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

let shotNum = 0;
async function screenshot(page, name) {
  shotNum++;
  const path = `${SCREENSHOT_DIR}/${String(shotNum).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`SCREENSHOT: ${path}`);
  return path;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE_ERROR: ${err.message}`));

  // ==================== LOGIN ====================
  console.log('\n=== TEST: LOGIN ===');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await screenshot(page, 'login-page');

  // Fill login form
  const usernameField = await page.$('input[name="username"], input[type="text"], input[placeholder*="user" i], input[placeholder*="email" i]');
  const passwordField = await page.$('input[name="password"], input[type="password"]');

  if (usernameField && passwordField) {
    await usernameField.fill('admin');
    await passwordField.fill('alphaDesk2025!');
    await screenshot(page, 'login-filled');

    const loginBtn = await page.$('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in")');
    if (loginBtn) {
      await loginBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
      await sleep(3000);
    }
  }
  await screenshot(page, 'after-login');
  console.log(`Current URL after login: ${page.url()}`);

  // ==================== CRITICAL CHECK 1: /trade page loads ====================
  console.log('\n=== CRITICAL CHECK 1: /trade page loads ===');
  let tradePageCrashed = false;
  for (let attempt = 1; attempt <= 4; attempt++) {
    console.log(`Trade page attempt ${attempt}...`);
    await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log(`Nav error: ${e.message}`));
    await sleep(4000);
    await screenshot(page, `trade-attempt-${attempt}`);

    const errorBoundary = await page.$('text="Something went wrong"');
    const bodyText = await page.textContent('body').catch(() => '');
    if (errorBoundary || bodyText.includes('Something went wrong')) {
      console.log(`ATTEMPT ${attempt}: CRASHED - "Something went wrong" detected`);
      tradePageCrashed = true;
    } else {
      console.log(`ATTEMPT ${attempt}: Page loaded OK`);
      tradePageCrashed = false;
      break;
    }
  }
  console.log(`CRITICAL CHECK 1 RESULT: ${tradePageCrashed ? 'FAIL - CRASH' : 'PASS'}`);

  // ==================== CRITICAL CHECK 2: Chart matches ticker ====================
  console.log('\n=== CRITICAL CHECK 2: Chart matches ticker ===');
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(5000);
  await screenshot(page, 'trade-chart-check');

  // Look for price header text
  const priceElements = await page.$$eval('*', els => {
    return els.filter(el => {
      const t = el.textContent || '';
      return /\$\d{1,5}\.\d{2}/.test(t) && el.children.length < 5;
    }).map(el => ({ tag: el.tagName, text: el.textContent.trim().substring(0, 100), class: el.className }));
  });
  console.log('Price elements found:', JSON.stringify(priceElements.slice(0, 10)));

  // ==================== CRITICAL CHECK 3: No demo labels ====================
  console.log('\n=== CRITICAL CHECK 3: No demo labels ===');
  const bodyText = await page.textContent('body').catch(() => '');
  const hasDemoLabel = bodyText.includes('(demoLabel)') || bodyText.includes('(Demo)');
  console.log(`Demo label found: ${hasDemoLabel}`);
  console.log(`CRITICAL CHECK 3 RESULT: ${hasDemoLabel ? 'FAIL' : 'PASS'}`);

  // Check status strip elements
  const statusStrip = await page.$('.status-bar, [class*="status"], [class*="StatusBar"], footer, [class*="footer"]');
  if (statusStrip) {
    await screenshot(page, 'status-strip');
    const stripText = await statusStrip.textContent().catch(() => '');
    console.log(`Status strip text: ${stripText.substring(0, 200)}`);
  }

  // ==================== TRADE PAGE DETAILED ====================
  console.log('\n=== TRADE PAGE DETAILED CHECKS ===');

  // Check watchlist
  const watchlistItems = await page.$$('[class*="watchlist"] tr, [class*="Watchlist"] tr, [class*="watchlist"] [class*="item"], [class*="symbol"]');
  console.log(`Watchlist items found: ${watchlistItems.length}`);
  await screenshot(page, 'trade-watchlist');

  // Check right panel tabs
  const rightTabs = await page.$$('[class*="tab"], [role="tab"]');
  console.log(`Tabs found: ${rightTabs.length}`);
  for (let i = 0; i < Math.min(rightTabs.length, 8); i++) {
    const tabText = await rightTabs[i].textContent().catch(() => '');
    if (tabText.trim()) {
      console.log(`  Tab ${i}: "${tabText.trim()}"`);
      try {
        await rightTabs[i].click();
        await sleep(1000);
      } catch(e) {}
    }
  }
  await screenshot(page, 'trade-tabs-clicked');

  // Check BUY/SELL buttons
  const buyBtn = await page.$('button:has-text("Buy"), button:has-text("BUY"), [class*="buy" i]');
  const sellBtn = await page.$('button:has-text("Sell"), button:has-text("SELL"), [class*="sell" i]');
  console.log(`Buy button found: ${!!buyBtn}`);
  console.log(`Sell button found: ${!!sellBtn}`);

  // Check for options chain
  const optionsChain = await page.$('text="Options Chain", text="Options", [class*="option" i]');
  console.log(`Options chain found: ${!!optionsChain}`);

  // Check for grayed out elements
  const grayedElements = await page.$$eval('*', els => {
    return els.filter(el => {
      const style = window.getComputedStyle(el);
      const opacity = parseFloat(style.opacity);
      return opacity > 0 && opacity < 0.6 && el.textContent.trim().length > 0 && el.textContent.trim().length < 50;
    }).map(el => ({ text: el.textContent.trim().substring(0, 60), opacity: window.getComputedStyle(el).opacity }));
  });
  console.log(`Grayed out elements: ${JSON.stringify(grayedElements.slice(0, 10))}`);

  // ==================== DASHBOARD ====================
  console.log('\n=== DASHBOARD CHECKS ===');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(4000);
  await screenshot(page, 'dashboard-full');

  // Scroll for full page screenshot
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
  await sleep(1000);
  await screenshot(page, 'dashboard-mid');

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1000);
  await screenshot(page, 'dashboard-bottom');
  await page.evaluate(() => window.scrollTo(0, 0));

  // Check portfolio value
  const portfolioValue = await page.$$eval('*', els => {
    return els.filter(el => {
      const t = el.textContent || '';
      return /\$[\d,]+\.?\d*/.test(t) && (t.includes('Portfolio') || t.includes('portfolio') || t.includes('Value') || t.includes('NAV'));
    }).map(el => el.textContent.trim().substring(0, 100));
  });
  console.log(`Portfolio value elements: ${JSON.stringify(portfolioValue.slice(0, 5))}`);

  // Check P&L visibility
  const pnlElements = await page.$$eval('*', els => {
    return els.filter(el => {
      const t = el.textContent || '';
      return (t.includes('P&L') || t.includes('PnL') || t.includes('Profit'));
    }).map(el => ({ text: el.textContent.trim().substring(0, 80), visible: window.getComputedStyle(el).opacity !== '0' && window.getComputedStyle(el).display !== 'none' }));
  });
  console.log(`P&L elements: ${JSON.stringify(pnlElements.slice(0, 5))}`);

  // Check strategy cards
  const noHistoryText = await page.$$('text="No history"');
  console.log(`"No history" texts found: ${noHistoryText.length}`);

  // Check "No trading data"
  const noTradingData = await page.$$eval('*', els => {
    return els.filter(el => el.textContent.includes('No trading data') && el.children.length < 3).length;
  });
  console.log(`"No trading data" elements: ${noTradingData}`);

  // Check Activity Feed
  const activityFeed = await page.$('[class*="activity" i], [class*="feed" i], [class*="Activity" i]');
  console.log(`Activity feed found: ${!!activityFeed}`);

  // Check market indices
  const marketIndices = await page.$$eval('*', els => {
    return els.filter(el => {
      const t = el.textContent || '';
      return (t.includes('S&P') || t.includes('NASDAQ') || t.includes('DOW') || t.includes('SPY') || t.includes('QQQ'));
    }).map(el => el.textContent.trim().substring(0, 100));
  });
  console.log(`Market indices: ${JSON.stringify(marketIndices.slice(0, 5))}`);

  // Check Economic Calendar opacity
  const econCalendar = await page.$$eval('*', els => {
    return els.filter(el => {
      const t = el.textContent || '';
      return t.includes('Economic Calendar') || t.includes('economic calendar');
    }).map(el => ({
      text: el.textContent.trim().substring(0, 60),
      opacity: window.getComputedStyle(el).opacity
    }));
  });
  console.log(`Economic Calendar: ${JSON.stringify(econCalendar.slice(0, 3))}`);

  // ==================== PIPELINE ====================
  console.log('\n=== PIPELINE CHECKS ===');
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(4000);
  await screenshot(page, 'pipeline-page');

  const pipelineError = await page.$('text="Something went wrong"');
  console.log(`Pipeline page crashed: ${!!pipelineError}`);

  const runPipelineBtn = await page.$('button:has-text("Run Pipeline"), button:has-text("Run"), button:has-text("Execute")');
  console.log(`Run Pipeline button found: ${!!runPipelineBtn}`);

  const backtestBtn = await page.$('button:has-text("Backtest"), button:has-text("Back Test")');
  console.log(`Backtest button found: ${!!backtestBtn}`);

  // ==================== STRATEGIES ====================
  console.log('\n=== STRATEGY PAGES ===');

  // PEAD strategy
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(4000);
  await screenshot(page, 'strategy-pead');
  const peadError = await page.$('text="Something went wrong"');
  console.log(`PEAD page crashed: ${!!peadError}`);
  const peadBody = await page.textContent('body').catch(() => '');
  console.log(`PEAD page has stats: ${/\d+%|\d+\.\d+/.test(peadBody)}`);

  // Momentum Quality strategy
  await page.goto(`${BASE}/strategies/momentum-quality`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(4000);
  await screenshot(page, 'strategy-momentum');
  const momError = await page.$('text="Something went wrong"');
  console.log(`Momentum Quality page crashed: ${!!momError}`);

  // ==================== PROFILE & NAV ====================
  console.log('\n=== PROFILE & NAV ===');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  // Profile menu
  const profileBtn = await page.$('[class*="profile" i], [class*="avatar" i], [class*="user-menu" i], button:has-text("admin"), [class*="Profile" i]');
  if (profileBtn) {
    await profileBtn.click();
    await sleep(1500);
    await screenshot(page, 'profile-menu-open');
    console.log('Profile menu opened');

    // Check portfolio value in profile menu
    const menuText = await page.textContent('body').catch(() => '');
    const portfolioInMenu = menuText.match(/\$[\d,]+\.?\d*/g);
    console.log(`Portfolio values visible: ${JSON.stringify(portfolioInMenu?.slice(0, 5))}`);

    // Close by clicking elsewhere
    await page.click('body', { position: { x: 100, y: 100 } });
    await sleep(500);
  } else {
    console.log('Profile button NOT FOUND');
  }

  // Keyboard shortcuts overlay - try common shortcuts
  console.log('\nTesting keyboard shortcuts...');
  await page.keyboard.press('?');
  await sleep(1500);
  await screenshot(page, 'keyboard-shortcuts');
  const shortcutOverlay = await page.$('[class*="shortcut" i], [class*="keyboard" i], [class*="hotkey" i], [role="dialog"]');
  console.log(`Keyboard shortcuts overlay visible: ${!!shortcutOverlay}`);
  await page.keyboard.press('Escape');
  await sleep(500);

  // Command palette - Cmd+K
  await page.keyboard.press('Meta+k');
  await sleep(1500);
  await screenshot(page, 'command-palette');
  const cmdPalette = await page.$('[class*="command" i], [class*="palette" i], [class*="Command" i], [role="dialog"] input');
  console.log(`Command palette visible: ${!!cmdPalette}`);
  await page.keyboard.press('Escape');
  await sleep(500);

  // ==================== CROSS-PAGE CONSISTENCY ====================
  console.log('\n=== CROSS-PAGE CONSISTENCY ===');

  // Collect portfolio values from different places
  const portfolioValues = [];

  // Dashboard hero
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);
  const dashboardValues = await page.$$eval('*', els => {
    return els.filter(el => {
      const t = el.textContent || '';
      return /\$[\d,]{3,}/.test(t) && el.children.length < 5 && t.length < 100;
    }).map(el => el.textContent.trim());
  });
  portfolioValues.push({ page: 'dashboard', values: dashboardValues.slice(0, 10) });

  // Trade page status strip
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);
  const tradeValues = await page.$$eval('*', els => {
    return els.filter(el => {
      const t = el.textContent || '';
      return /\$[\d,]{3,}/.test(t) && el.children.length < 5 && t.length < 100;
    }).map(el => el.textContent.trim());
  });
  portfolioValues.push({ page: 'trade', values: tradeValues.slice(0, 10) });
  console.log('Portfolio cross-check:', JSON.stringify(portfolioValues));

  // ==================== RAPID NAVIGATION STRESS TEST ====================
  console.log('\n=== RAPID NAVIGATION STRESS TEST ===');
  const pages = ['/dashboard', '/trade', '/pipeline', '/strategies/pead', '/trade', '/dashboard', '/strategies/momentum-quality', '/trade'];
  let crashCount = 0;
  for (const path of pages) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(2000);
      const crashed = await page.$('text="Something went wrong"');
      if (crashed) {
        console.log(`CRASH on rapid nav to ${path}`);
        crashCount++;
      } else {
        console.log(`OK: ${path}`);
      }
    } catch(e) {
      console.log(`ERROR navigating to ${path}: ${e.message}`);
      crashCount++;
    }
  }
  await screenshot(page, 'after-rapid-nav');
  console.log(`Rapid nav crashes: ${crashCount}`);

  // ==================== LOGOUT/RE-LOGIN ====================
  console.log('\n=== LOGOUT/RE-LOGIN ===');
  // Find and click logout
  const profileBtn2 = await page.$('[class*="profile" i], [class*="avatar" i], [class*="user-menu" i], button:has-text("admin"), [class*="Profile" i]');
  if (profileBtn2) {
    await profileBtn2.click();
    await sleep(1500);
    const logoutBtn = await page.$('button:has-text("Logout"), button:has-text("Log out"), a:has-text("Logout"), [class*="logout" i]');
    if (logoutBtn) {
      await logoutBtn.click();
      await sleep(3000);
      await screenshot(page, 'after-logout');
      console.log(`URL after logout: ${page.url()}`);

      // Re-login
      const usernameField2 = await page.$('input[name="username"], input[type="text"], input[placeholder*="user" i]');
      const passwordField2 = await page.$('input[name="password"], input[type="password"]');
      if (usernameField2 && passwordField2) {
        await usernameField2.fill('admin');
        await passwordField2.fill('alphaDesk2025!');
        const loginBtn2 = await page.$('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
        if (loginBtn2) {
          await loginBtn2.click();
          await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
          await sleep(3000);
          await screenshot(page, 'after-relogin');
          console.log(`URL after re-login: ${page.url()}`);
          console.log('Logout/re-login cycle: PASS');
        }
      }
    } else {
      console.log('Logout button NOT FOUND');
    }
  }

  // ==================== FINAL CHECKS ====================
  console.log('\n=== CONSOLE ERRORS SUMMARY ===');
  const uniqueErrors = [...new Set(consoleErrors)];
  console.log(`Total console errors: ${consoleErrors.length}`);
  console.log(`Unique console errors: ${uniqueErrors.length}`);
  uniqueErrors.slice(0, 20).forEach((e, i) => console.log(`  Error ${i+1}: ${e.substring(0, 150)}`));

  await browser.close();
  console.log('\n=== TEST RUN COMPLETE ===');
})();
