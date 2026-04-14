import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'https://tradingalpha.net';
const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round8';
mkdirSync(DIR, { recursive: true });

let shotNum = 50;
async function shot(page, name) {
  shotNum++;
  const path = `${DIR}/${String(shotNum).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`SHOT: ${path}`);
  return path;
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', err => errors.push(`PAGE_ERROR: ${err.message}`));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  // ===== LOGIN =====
  console.log('=== LOGIN ===');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);

  // The login form is on the landing page - find the Sign In form
  // Fill username
  const inputs = await page.$$('input');
  console.log(`Found ${inputs.length} input fields`);
  for (const input of inputs) {
    const type = await input.getAttribute('type');
    const placeholder = await input.getAttribute('placeholder');
    console.log(`  Input: type=${type}, placeholder=${placeholder}`);
  }

  // Try filling by placeholder or by order
  const allInputs = await page.$$('input:not([type="hidden"])');
  if (allInputs.length >= 2) {
    await allInputs[0].fill('admin');
    await allInputs[1].fill('alphaDesk2025!');
    await sleep(500);

    // Click Sign In button
    const signInBtn = await page.$('button:has-text("Sign In"), button:has-text("Sign in"), button:has-text("Login"), button[type="submit"]');
    if (signInBtn) {
      const btnText = await signInBtn.textContent();
      console.log(`Clicking button: "${btnText.trim()}"`);
      await signInBtn.click();
    }
  }

  // Wait for navigation/loading
  await sleep(5000);
  await shot(page, 'after-login');
  const afterLoginUrl = page.url();
  console.log(`After login URL: ${afterLoginUrl}`);

  // Verify we're logged in by checking for nav items
  const isLoggedIn = await page.evaluate(() => {
    const text = document.body.textContent;
    return text.includes('Dashboard') && text.includes('Trade') && text.includes('Pipeline');
  });
  console.log(`Logged in: ${isLoggedIn}`);

  if (!isLoggedIn) {
    console.log('LOGIN FAILED - aborting');
    await browser.close();
    return;
  }

  // ===== DASHBOARD (root page) =====
  console.log('\n========== DASHBOARD ==========');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);
  await shot(page, 'dash-top');

  // Portfolio value
  const portfolioValue = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('h1, h2, h3, span, p, div'));
    for (const el of els) {
      const t = el.textContent.trim();
      if (/^\$[\d,]+\.\d{2}$/.test(t) && parseFloat(t.replace(/[$,]/g,'')) > 10000) {
        const fs = parseFloat(window.getComputedStyle(el).fontSize);
        if (fs > 18) return { value: t, fontSize: fs };
      }
    }
    return null;
  });
  console.log(`[DASH] Portfolio value: ${JSON.stringify(portfolioValue)}`);

  // P&L and P&L %
  const pnlInfo = await page.evaluate(() => {
    const body = document.body.textContent;
    const pnlMatch = body.match(/-?\$[\d,]+\.\d{2}/g);
    const pctMatch = body.match(/\([-+]?\d+\.\d+%\)/g) || body.match(/[-+]?\d+\.\d+%/g);
    // Check visibility of percentage
    const els = Array.from(document.querySelectorAll('*'));
    let pctVisible = null;
    for (const el of els) {
      const t = el.textContent.trim();
      if (/^[\(\-\+]?\d+\.\d+%\)?$/.test(t)) {
        const s = window.getComputedStyle(el);
        pctVisible = {
          text: t,
          opacity: s.opacity,
          color: s.color,
          visibility: s.visibility,
          display: s.display,
          fontSize: s.fontSize
        };
        break;
      }
    }
    return { pnlValues: pnlMatch?.slice(0, 5), pctValues: pctMatch?.slice(0, 3), pctVisible };
  });
  console.log(`[DASH] P&L info: ${JSON.stringify(pnlInfo)}`);

  // Strategy cards
  const strategyInfo = await page.evaluate(() => {
    const results = [];
    // Look for strategy-related sections
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      const t = el.textContent.trim();
      if ((t.includes('Momentum') || t.includes('PEAD') || t.includes('VRP') || t.includes('Mean Reversion') ||
           t.includes('Earnings') || t.includes('Breakout') || t.includes('Harvesting') || t.includes('Adaptive'))
          && el.children.length < 8 && t.length < 200 && t.length > 5) {
        results.push({ text: t.substring(0, 120), hasNoHistory: t.includes('No history'), hasReturn: /[+-]?\d+\.\d+%/.test(t) });
      }
    }
    return results;
  });
  console.log(`[DASH] Strategy cards: ${JSON.stringify(strategyInfo.slice(0, 10))}`);

  // Open Positions
  const positions = await page.evaluate(() => {
    const body = document.body.textContent;
    if (body.includes('Open Positions') || body.includes('CURRENT POSITIONS')) {
      // Find the section
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        if (el.textContent.includes('Open Positions') && el.tagName.match(/H[1-6]/)) {
          const parent = el.parentElement;
          return { header: el.textContent.trim(), content: parent?.textContent.trim().substring(0, 300) };
        }
      }
    }
    return null;
  });
  console.log(`[DASH] Open Positions: ${JSON.stringify(positions)}`);

  // Scroll to mid-page
  await page.evaluate(() => window.scrollTo(0, 500));
  await sleep(1000);
  await shot(page, 'dash-mid');

  // P&L Calendar
  const calendar = await page.evaluate(() => {
    const body = document.body.textContent;
    const hasCalendar = body.includes('P&L') || body.includes('Calendar');
    const hasFakeData = body.includes('No trading data');
    // Look for calendar grid
    const calendarCells = document.querySelectorAll('[class*="calendar" i] td, [class*="calendar" i] [class*="cell" i], [class*="Calendar" i] [class*="day" i]');
    return { hasCalendar, hasFakeData, cellCount: calendarCells.length };
  });
  console.log(`[DASH] Calendar: ${JSON.stringify(calendar)}`);

  // Activity Feed
  const activity = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      if (el.textContent.trim() === 'Activity' || el.textContent.trim() === 'Recent Activity' || el.textContent.trim().startsWith('Activity')) {
        if (el.children.length < 3 && el.textContent.length < 30) {
          const section = el.closest('section, div[class*="card" i], div[class*="Card" i]') || el.parentElement;
          return { header: el.textContent.trim(), content: section?.textContent.trim().substring(0, 200) };
        }
      }
    }
    return 'NOT FOUND';
  });
  console.log(`[DASH] Activity: ${JSON.stringify(activity)}`);

  // Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, 9999));
  await sleep(1000);
  await shot(page, 'dash-bottom');

  // Market Indices
  const indices = await page.evaluate(() => {
    const texts = [];
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      const t = el.textContent.trim();
      if ((t.includes('S&P 500') || t.includes('NASDAQ') || t.includes('Dow') || t.includes('Russell'))
          && el.children.length < 4 && t.length < 80 && t.length > 3) {
        texts.push(t);
      }
    }
    return texts;
  });
  console.log(`[DASH] Market Indices: ${JSON.stringify(indices.slice(0, 5))}`);

  // Sector Performance + Economic Calendar
  const sectorEcon = await page.evaluate(() => {
    const results = {};
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      const t = el.textContent.trim();
      if (t === 'Sector Performance' || t === 'Sector Heatmap') {
        const parent = el.closest('section, div[class*="card" i]') || el.parentElement;
        const s = window.getComputedStyle(parent || el);
        results.sector = { text: t, opacity: s.opacity };
      }
      if (t === 'Economic Calendar' || t.startsWith('Economic Calendar')) {
        const parent = el.closest('section, div[class*="card" i]') || el.parentElement;
        const s = window.getComputedStyle(parent || el);
        results.economic = { text: t, opacity: s.opacity };
      }
    }
    return results;
  });
  console.log(`[DASH] Sector/Economic: ${JSON.stringify(sectorEcon)}`);

  // ===== /dashboard URL check =====
  console.log('\n=== /dashboard URL CHECK ===');
  const dashResp = await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 15000 }).catch(e => null);
  await sleep(2000);
  const dashStatus = dashResp ? dashResp.status() : 'error';
  const dashIs404 = await page.evaluate(() => document.body.textContent.includes('404'));
  console.log(`/dashboard status: ${dashStatus}, is404: ${dashIs404}`);
  await shot(page, 'dashboard-url-404');

  // ===== TRADE PAGE =====
  console.log('\n========== TRADE PAGE ==========');

  // Attempt 1
  errors.length = 0;
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(6000);
  const trade1Crash = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
  await shot(page, 'trade-attempt1');
  console.log(`[TRADE] Attempt 1: ${trade1Crash ? 'CRASHED' : 'OK'}`);

  if (trade1Crash) {
    // Try clicking "Try Again"
    const tryAgain = await page.$('button:has-text("Try Again")');
    if (tryAgain) {
      await tryAgain.click();
      await sleep(5000);
      const stillCrashed = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
      await shot(page, 'trade-after-tryagain');
      console.log(`[TRADE] After Try Again: ${stillCrashed ? 'STILL CRASHED' : 'OK'}`);
    }

    // Full reload attempts
    for (let i = 2; i <= 4; i++) {
      await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(6000);
      const crashed = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
      await shot(page, `trade-attempt${i}`);
      console.log(`[TRADE] Attempt ${i}: ${crashed ? 'CRASHED' : 'OK'}`);
      if (!crashed) break;
    }
  }

  // Now analyze the trade page in detail
  const tradeCrashed = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));

  if (!tradeCrashed) {
    console.log('\n--- Trade Page Detail Analysis ---');

    // Chart header
    const chartInfo = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      const results = {};
      for (const el of els) {
        const t = el.textContent.trim();
        // Match "SPY  $650.12" pattern
        const m = t.match(/^([A-Z]{1,5})\s+\$(\d{1,5}\.\d{2})/);
        if (m && t.length < 80) {
          results.chartHeader = { ticker: m[1], price: m[2], fullText: t.substring(0, 60) };
          break;
        }
      }
      // Also look for change info
      for (const el of els) {
        const t = el.textContent.trim();
        const m = t.match(/([+-]?\d+\.\d{2})\s*\(([+-]?\d+\.\d+%)\)/);
        if (m && t.length < 40) {
          results.change = { amount: m[1], pct: m[2] };
          break;
        }
      }
      return results;
    });
    console.log(`[TRADE] Chart info: ${JSON.stringify(chartInfo)}`);

    // Watchlist
    const watchlistData = await page.evaluate(() => {
      const items = [];
      // Look for the left sidebar with symbols
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        const t = el.textContent.trim();
        // Pattern like "AAPL$257.72..." or "AAPL  $257.72  +1.23%"
        const m = t.match(/^([A-Z]{1,5})\s*\$(\d+\.\d{2})/);
        if (m && t.length < 80 && el.children.length < 10) {
          items.push({ symbol: m[1], price: m[2], fullText: t.substring(0, 60) });
        }
      }
      return items;
    });
    console.log(`[TRADE] Watchlist (${watchlistData.length} items): ${JSON.stringify(watchlistData.slice(0, 10))}`);

    // Check if sparklines are unique (already checked: 17 total, 16 unique)
    const sparkInfo = await page.evaluate(() => {
      const paths = [];
      document.querySelectorAll('path').forEach(p => {
        const d = p.getAttribute('d');
        if (d && d.length > 20 && d.length < 500 && d.startsWith('M')) {
          paths.push(d.substring(0, 40));
        }
      });
      const unique = new Set(paths);
      return { total: paths.length, unique: unique.size, duplicates: paths.length - unique.size };
    });
    console.log(`[TRADE] Sparklines: ${JSON.stringify(sparkInfo)}`);

    // Left panel tabs
    const leftTabs = await page.evaluate(() => {
      const tabs = [];
      document.querySelectorAll('button, [role="tab"]').forEach(el => {
        const t = el.textContent.trim();
        if (['Watchlist', 'Screener', 'Signals'].includes(t)) tabs.push(t);
      });
      return tabs;
    });
    console.log(`[TRADE] Left tabs: ${JSON.stringify(leftTabs)}`);

    // Click each left tab
    for (const tabName of leftTabs) {
      try {
        await page.click(`button:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`);
        await sleep(1500);
        const crashed = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
        console.log(`[TRADE] Left tab "${tabName}": ${crashed ? 'CRASHED' : 'OK'}`);
        await shot(page, `trade-left-${tabName.toLowerCase()}`);
      } catch(e) {
        console.log(`[TRADE] Left tab "${tabName}": click error - ${e.message.substring(0, 100)}`);
      }
    }

    // Right panel tabs
    const rightTabs = await page.evaluate(() => {
      const tabs = [];
      document.querySelectorAll('button, [role="tab"]').forEach(el => {
        const t = el.textContent.trim();
        if (['Trade', 'Positions', 'Orders', 'Journal', 'Calendar', 'Logs'].includes(t)) tabs.push(t);
      });
      return tabs;
    });
    console.log(`[TRADE] Right tabs: ${JSON.stringify(rightTabs)}`);

    for (const tabName of rightTabs) {
      try {
        await page.click(`button:has-text("${tabName}"):visible`);
        await sleep(1500);
        const crashed = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
        console.log(`[TRADE] Right tab "${tabName}": ${crashed ? 'CRASHED' : 'OK'}`);
      } catch(e) {
        console.log(`[TRADE] Right tab "${tabName}": click error`);
      }
    }
    await shot(page, 'trade-right-tabs');

    // Bottom panel - options
    await page.evaluate(() => {
      document.querySelectorAll('button, [role="tab"]').forEach(el => {
        if (el.textContent.trim().includes('SPY Options') || el.textContent.trim() === 'Options') {
          el.click();
        }
      });
    });
    await sleep(2000);
    await shot(page, 'trade-options');

    const optionsInfo = await page.evaluate(() => {
      const body = document.body.textContent;
      return {
        hasStrike: body.includes('Strike') || /\d{3}\.\d{2}/.test(body),
        hasCallPut: body.includes('Call') || body.includes('Put'),
        hasExpiry: body.includes('Exp') || body.includes('Apr') || body.includes('May'),
        hasOptionsData: body.includes('Options') || body.includes('options'),
      };
    });
    console.log(`[TRADE] Options chain: ${JSON.stringify(optionsInfo)}`);

    // BUY/SELL buttons
    const buySellInfo = await page.evaluate(() => {
      const results = {};
      document.querySelectorAll('button').forEach(el => {
        const t = el.textContent.trim().toUpperCase();
        if (t === 'BUY' || t.includes('BUY')) {
          const r = el.getBoundingClientRect();
          results.buy = { text: t, x: r.x, y: r.y, w: r.width, h: r.height };
        }
        if (t === 'SELL' || t.includes('SELL')) {
          const r = el.getBoundingClientRect();
          results.sell = { text: t, x: r.x, y: r.y, w: r.width, h: r.height };
        }
      });
      // Also get chart bounds
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const r = canvas.getBoundingClientRect();
        results.chart = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      return results;
    });
    console.log(`[TRADE] Buy/Sell/Chart: ${JSON.stringify(buySellInfo)}`);

    // Status strip
    const statusItems = await page.evaluate(() => {
      const strip = [];
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        const t = el.textContent.trim();
        if (el.children.length < 3 && t.length < 40) {
          if (t.includes('Regime') || t.includes('VIX') || t.includes('LIVE') || t.includes('PAPER') || t.includes('Alpaca')) {
            const s = window.getComputedStyle(el);
            strip.push({ text: t, opacity: s.opacity, color: s.color });
          }
        }
      }
      return strip;
    });
    console.log(`[TRADE] Status strip: ${JSON.stringify(statusItems)}`);

    // Check for "(demoLabel)" or "(Demo)"
    const demoCheck = await page.evaluate(() => {
      const body = document.body.textContent;
      return {
        hasDemoLabel: body.includes('(demoLabel)'),
        hasDemo: body.includes('(Demo)'),
        hasDemoAnywhere: body.toLowerCase().includes('demo') && !body.toLowerCase().includes('demolabel')
      };
    });
    console.log(`[TRADE] Demo check: ${JSON.stringify(demoCheck)}`);

    // Grayed out regime/VIX
    const grayedOut = await page.evaluate(() => {
      const items = [];
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        const t = el.textContent.trim();
        if ((t.includes('Regime') || t.includes('VIX') || t === 'LIVE') && el.children.length < 2) {
          const s = window.getComputedStyle(el);
          items.push({ text: t, opacity: s.opacity, color: s.color, hasGrayClass: el.className.includes('gray') || el.className.includes('muted') || el.className.includes('disabled') });
        }
      }
      return items;
    });
    console.log(`[TRADE] Grayed out check: ${JSON.stringify(grayedOut)}`);
  }

  // ===== PIPELINE =====
  console.log('\n========== PIPELINE ==========');
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);
  await shot(page, 'pipeline-full');

  const pipelineInfo = await page.evaluate(() => {
    const body = document.body.textContent;
    return {
      crashed: body.includes('Something went wrong'),
      hasPositions: body.includes('CURRENT POSITIONS') || body.includes('Current Positions') || body.includes('Open Positions'),
      hasRunBtn: !!document.querySelector('button') && Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Run')),
      hasBacktest: body.includes('BACKTESTING') || body.includes('Backtesting') || body.includes('Backtest'),
      hasStrategyBuilder: body.includes('STRATEGY BUILDER') || body.includes('Strategy Builder'),
      snippet: body.substring(0, 400)
    };
  });
  console.log(`[PIPELINE] Info: ${JSON.stringify(pipelineInfo)}`);

  // Scroll to show all sections
  await page.evaluate(() => window.scrollTo(0, 500));
  await sleep(500);
  await shot(page, 'pipeline-mid');

  await page.evaluate(() => window.scrollTo(0, 9999));
  await sleep(500);
  await shot(page, 'pipeline-bottom');

  // ===== STRATEGIES =====
  console.log('\n========== STRATEGY: PEAD ==========');
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);
  await shot(page, 'pead-top');

  const peadInfo = await page.evaluate(() => {
    const body = document.body.textContent;
    return {
      crashed: body.includes('Something went wrong'),
      title: body.includes('Post-Earnings') || body.includes('PEAD'),
      hasStats: /Total Return|Win Rate|Sharpe|Max Drawdown|Active Positions/i.test(body),
      hasChart: !!document.querySelector('canvas, [class*="recharts" i] svg'),
      hasNoData: body.includes('Not enough data'),
      statsSnippet: body.substring(0, 500)
    };
  });
  console.log(`[PEAD] Info: ${JSON.stringify(peadInfo)}`);

  await page.evaluate(() => window.scrollTo(0, 9999));
  await sleep(500);
  await shot(page, 'pead-bottom');

  console.log('\n========== STRATEGY: MOMENTUM ==========');
  await page.goto(`${BASE}/strategies/momentum-quality`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);
  await shot(page, 'momentum-top');

  const momInfo = await page.evaluate(() => {
    const body = document.body.textContent;
    return {
      crashed: body.includes('Something went wrong'),
      title: body.includes('Momentum') || body.includes('Quality'),
      hasStats: /Total Return|Win Rate|Sharpe|Max Drawdown|Active Positions/i.test(body),
      hasChart: !!document.querySelector('canvas, [class*="recharts" i] svg'),
      hasNoData: body.includes('Not enough data'),
      statsSnippet: body.substring(0, 500)
    };
  });
  console.log(`[MOMENTUM] Info: ${JSON.stringify(momInfo)}`);

  // ===== PROFILE MENU =====
  console.log('\n========== PROFILE & NAV ==========');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);

  // Find the avatar/profile in top right
  const avatarInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const topRight = buttons.filter(el => {
      const r = el.getBoundingClientRect();
      return r.right > 1300 && r.top < 60;
    }).map(el => ({
      text: el.textContent.trim().substring(0, 20),
      tag: el.tagName,
      class: el.className?.substring(0, 80),
      x: el.getBoundingClientRect().x,
      y: el.getBoundingClientRect().y,
      w: el.getBoundingClientRect().width,
      h: el.getBoundingClientRect().height
    }));
    return topRight;
  });
  console.log(`[PROFILE] Top-right elements: ${JSON.stringify(avatarInfo)}`);

  // Click the rightmost top element (likely avatar)
  if (avatarInfo.length > 0) {
    const avatar = avatarInfo[avatarInfo.length - 1];
    await page.mouse.click(avatar.x + avatar.w / 2, avatar.y + avatar.h / 2);
    await sleep(2000);
    await shot(page, 'profile-dropdown');

    // Check dropdown content
    const dropdownContent = await page.evaluate(() => {
      const menus = document.querySelectorAll('[role="menu"], [class*="dropdown" i], [class*="popover" i], [class*="menu" i]');
      const items = [];
      menus.forEach(m => {
        const style = window.getComputedStyle(m);
        if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
          items.push(m.textContent.trim().substring(0, 300));
        }
      });
      return items;
    });
    console.log(`[PROFILE] Dropdown content: ${JSON.stringify(dropdownContent)}`);

    // Check for portfolio value in the dropdown
    const menuPortfolio = await page.evaluate(() => {
      const menus = document.querySelectorAll('[role="menu"], [class*="dropdown" i], [class*="popover" i]');
      for (const m of menus) {
        const t = m.textContent;
        const match = t.match(/\$[\d,]+\.\d{2}/);
        if (match) return match[0];
      }
      return null;
    });
    console.log(`[PROFILE] Portfolio in menu: ${menuPortfolio}`);

    // Logout
    const logoutBtn = await page.$('[role="menuitem"]:has-text("Log out"), [role="menuitem"]:has-text("Logout"), button:has-text("Log out"), button:has-text("Logout"), a:has-text("Log out")');
    if (logoutBtn) {
      console.log('[PROFILE] Logout button found');
      await logoutBtn.click();
      await sleep(3000);
      await shot(page, 'after-logout');
      const logoutURL = page.url();
      console.log(`[PROFILE] After logout URL: ${logoutURL}`);

      // Re-login
      const inputs2 = await page.$$('input:not([type="hidden"])');
      if (inputs2.length >= 2) {
        await inputs2[0].fill('admin');
        await inputs2[1].fill('alphaDesk2025!');
        const btn = await page.$('button[type="submit"], button:has-text("Sign")');
        if (btn) await btn.click();
        await sleep(5000);
        await shot(page, 'after-relogin');
        const reloginOK = await page.evaluate(() => document.body.textContent.includes('Dashboard'));
        console.log(`[PROFILE] Re-login OK: ${reloginOK}`);
      }
    } else {
      console.log('[PROFILE] Logout button NOT FOUND in dropdown');
      // Close menu
      await page.keyboard.press('Escape');
    }
  }

  // ===== CMD+K COMMAND PALETTE =====
  console.log('\n=== COMMAND PALETTE (CMD+K) ===');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);
  await page.keyboard.press('Meta+k');
  await sleep(2000);
  await shot(page, 'cmd-k');

  const cmdKInfo = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"], [class*="cmdk" i], [class*="command" i], [class*="Command" i]');
    const visible = [];
    dialogs.forEach(d => {
      const s = window.getComputedStyle(d);
      if (s.display !== 'none') visible.push({ tag: d.tagName, class: d.className?.substring(0, 60), text: d.textContent.trim().substring(0, 200) });
    });
    return visible;
  });
  console.log(`[CMD+K] Result: ${JSON.stringify(cmdKInfo)}`);
  await page.keyboard.press('Escape');

  // ===== KEYBOARD SHORTCUTS =====
  console.log('\n=== KEYBOARD SHORTCUTS ===');
  await page.keyboard.press('Shift+?');
  await sleep(1500);
  await shot(page, 'shift-question');
  const shortcutsDialog = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"], [class*="shortcut" i], [class*="keyboard" i]');
    return Array.from(dialogs).map(d => ({
      visible: window.getComputedStyle(d).display !== 'none',
      text: d.textContent.trim().substring(0, 200)
    }));
  });
  console.log(`[SHORTCUTS] Dialog: ${JSON.stringify(shortcutsDialog)}`);
  await page.keyboard.press('Escape');

  // ===== RAPID NAVIGATION =====
  console.log('\n=== RAPID NAVIGATION STRESS ===');
  const navPaths = ['/', '/trade', '/pipeline', '/strategies/pead', '/trade', '/', '/strategies/momentum-quality', '/trade', '/pipeline', '/'];
  let navCrashes = 0;
  for (const path of navPaths) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await sleep(2000);
      const crashed = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
      if (crashed) { navCrashes++; console.log(`  CRASH: ${path}`); }
      else console.log(`  OK: ${path}`);
    } catch(e) {
      console.log(`  TIMEOUT: ${path}`);
    }
  }
  console.log(`Rapid nav: ${navCrashes} crashes out of ${navPaths.length}`);
  await shot(page, 'after-stress');

  // ===== CROSS-PAGE PORTFOLIO CONSISTENCY =====
  console.log('\n=== PORTFOLIO VALUE CONSISTENCY ===');

  // From dashboard
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);
  const dashPortfolio = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      const t = el.textContent.trim();
      if (/^\$[\d,]+\.\d{2}$/.test(t) && parseFloat(t.replace(/[$,]/g, '')) > 50000) {
        return t;
      }
    }
    return null;
  });
  console.log(`Dashboard portfolio: ${dashPortfolio}`);

  // From status strip on trade page
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);
  const tradeStripPortfolio = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      const t = el.textContent.trim();
      if (t.includes('P&L') && el.children.length < 4 && t.length < 60) {
        return t;
      }
    }
    return null;
  });
  console.log(`Trade strip P&L: ${tradeStripPortfolio}`);

  // ===== FINAL ERROR SUMMARY =====
  console.log('\n========== CONSOLE ERRORS ==========');
  const uniqueErrors = [...new Set(errors)];
  console.log(`Total: ${errors.length}, Unique: ${uniqueErrors.length}`);
  uniqueErrors.slice(0, 15).forEach((e, i) => console.log(`  ${i+1}. ${e.substring(0, 200)}`));

  await browser.close();
  console.log('\n========== ALL TESTS COMPLETE ==========');
})();
