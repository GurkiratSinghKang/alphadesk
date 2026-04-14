import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'https://tradingalpha.net';
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round8';

let shotNum = 20;
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

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE_ERROR: ${err.message}`));

  // ===== LOGIN =====
  console.log('=== LOGIN ===');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  const usernameField = await page.$('input[name="username"], input[type="text"]');
  const passwordField = await page.$('input[type="password"]');
  if (usernameField && passwordField) {
    await usernameField.fill('admin');
    await passwordField.fill('alphaDesk2025!');
    const loginBtn = await page.$('button[type="submit"]');
    if (loginBtn) await loginBtn.click();
    await page.waitForURL('**/');
    await sleep(3000);
  }
  console.log(`Logged in. URL: ${page.url()}`);

  // ===== DASHBOARD (the root / IS the dashboard) =====
  console.log('\n=== DASHBOARD at / ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);
  await screenshot(page, 'dashboard-top');

  // Check hero section
  const heroText = await page.evaluate(() => {
    const body = document.body.textContent;
    const portfolioMatch = body.match(/\$[\d,]+\.\d{2}/g);
    return { portfolioValues: portfolioMatch, bodySnippet: body.substring(0, 500) };
  });
  console.log('Hero portfolio values:', JSON.stringify(heroText.portfolioValues?.slice(0, 8)));

  // Check P&L percentage visibility
  const pnlPercentVisible = await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      const t = el.textContent || '';
      if (/[-+]?\d+\.\d+%/.test(t) && t.length < 30) {
        const style = window.getComputedStyle(el);
        return { text: t.trim(), opacity: style.opacity, color: style.color, display: style.display, visibility: style.visibility };
      }
    }
    return null;
  });
  console.log('P&L % element:', JSON.stringify(pnlPercentVisible));

  // Scroll down to see strategy cards
  await page.evaluate(() => window.scrollTo(0, 300));
  await sleep(1000);
  await screenshot(page, 'dashboard-strategies');

  // Check strategy cards for "No history"
  const strategyCards = await page.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('[class*="card" i], [class*="Card" i], [class*="strategy" i]');
    cards.forEach(c => {
      const text = c.textContent || '';
      if (text.length > 10 && text.length < 500) {
        results.push(text.trim().substring(0, 120));
      }
    });
    return results;
  });
  console.log('Strategy cards found:', strategyCards.length);
  strategyCards.forEach((c, i) => console.log(`  Card ${i}: ${c}`));

  // Check Open Positions section
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  const openPositions = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      if (el.textContent.includes('Open Positions') && el.children.length < 5) {
        return el.textContent.trim().substring(0, 200);
      }
    }
    return null;
  });
  console.log('Open Positions section:', openPositions);

  // P&L Calendar
  const calendarSection = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      if ((el.textContent.includes('Calendar') || el.textContent.includes('calendar')) && el.children.length < 10 && el.textContent.length < 100) {
        return el.textContent.trim();
      }
    }
    return null;
  });
  console.log('Calendar section:', calendarSection);

  // Scroll down to bottom sections
  await page.evaluate(() => window.scrollTo(0, 600));
  await sleep(1000);
  await screenshot(page, 'dashboard-calendar-area');

  await page.evaluate(() => window.scrollTo(0, 1200));
  await sleep(1000);
  await screenshot(page, 'dashboard-economic-sector');

  // Check sector performance & economic calendar opacity
  const sectorOpacity = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    const results = [];
    for (const el of els) {
      const text = el.textContent || '';
      if ((text.includes('Sector') || text.includes('Economic Calendar')) && el.children.length < 5 && text.length < 60) {
        const style = window.getComputedStyle(el);
        results.push({ text: text.trim(), opacity: style.opacity });
      }
    }
    return results;
  });
  console.log('Sector/Econ Calendar opacity:', JSON.stringify(sectorOpacity));

  // Market indices
  const marketData = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    const results = [];
    for (const el of els) {
      const text = el.textContent || '';
      if ((text.includes('S&P') || text.includes('NASDAQ') || text.includes('Dow') || text.includes('Russell') || text.includes('SPX'))
          && el.children.length < 3 && text.length < 80) {
        results.push(text.trim());
      }
    }
    return results;
  });
  console.log('Market indices:', JSON.stringify(marketData.slice(0, 5)));

  // Activity feed check
  const activityFeed = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      if (el.textContent.includes('Activity') && el.children.length < 3 && el.textContent.length < 50) {
        // Find next sibling content
        const parent = el.closest('[class*="card" i], [class*="section" i], section, div');
        return { header: el.textContent.trim(), content: parent ? parent.textContent.trim().substring(0, 300) : 'no parent' };
      }
    }
    return null;
  });
  console.log('Activity feed:', JSON.stringify(activityFeed));

  // ===== TRADE PAGE - detailed retry =====
  console.log('\n=== TRADE PAGE - DETAILED (5 attempts) ===');
  let tradeLoaded = false;
  for (let i = 1; i <= 5; i++) {
    consoleErrors.length = 0;
    await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await sleep(5000);

    const crashed = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
    await screenshot(page, `trade-retry-${i}`);

    if (crashed) {
      const errText = await page.evaluate(() => {
        const el = document.querySelector('p, span, div');
        return document.body.textContent.substring(0, 300);
      });
      console.log(`  Attempt ${i}: CRASHED - ${errText.substring(0, 200)}`);
    } else {
      console.log(`  Attempt ${i}: LOADED OK`);
      tradeLoaded = true;
      break;
    }
  }

  if (tradeLoaded) {
    // Chart header price check
    const chartHeader = await page.evaluate(() => {
      // Look for the main chart header - something like "SPY $650.12"
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        const text = el.textContent || '';
        // Pattern: ticker followed by price
        const match = text.match(/([A-Z]{1,5})\s+\$(\d{1,5}\.\d{2})/);
        if (match && el.children.length < 5 && text.length < 100) {
          return { full: text.trim().substring(0, 80), ticker: match[1], price: match[2] };
        }
      }
      return null;
    });
    console.log('Chart header:', JSON.stringify(chartHeader));

    // Watchlist details
    const watchlist = await page.evaluate(() => {
      const items = [];
      // Find watchlist area
      const rows = document.querySelectorAll('tr, [class*="watchlist" i] > *, [class*="symbol-row" i]');
      rows.forEach(r => {
        const text = r.textContent.trim();
        if (/[A-Z]{1,5}/.test(text) && /\$?\d+\.\d{2}/.test(text) && text.length < 100) {
          items.push(text);
        }
      });
      return items;
    });
    console.log('Watchlist items:', JSON.stringify(watchlist.slice(0, 10)));

    // Sparkline uniqueness check
    const sparklines = await page.evaluate(() => {
      const svgs = document.querySelectorAll('svg[class*="spark" i], svg path, [class*="sparkline" i] svg, [class*="chart" i] svg');
      const paths = [];
      svgs.forEach(s => {
        const d = s.getAttribute('d') || '';
        if (d.length > 10 && d.length < 300) paths.push(d.substring(0, 50));
      });
      return paths;
    });
    const uniqueSparklines = new Set(sparklines);
    console.log(`Sparklines total: ${sparklines.length}, unique: ${uniqueSparklines.size}`);

    // Right panel tabs
    const rightPanelTabs = await page.evaluate(() => {
      const tabs = [];
      const els = document.querySelectorAll('button, [role="tab"]');
      els.forEach(el => {
        const text = el.textContent.trim();
        if (['Trade', 'Positions', 'Orders', 'Journal', 'Calendar', 'News', 'Technicals', 'Technical Score',
             'Indicators', 'Key Levels', 'Overview', 'Screener', 'Signals', 'Options'].some(t => text.includes(t))) {
          tabs.push(text);
        }
      });
      return tabs;
    });
    console.log('Right panel tabs:', JSON.stringify(rightPanelTabs));

    // Click each right panel tab and check for crashes
    for (const tabName of ['Positions', 'Orders', 'Journal', 'Calendar']) {
      const tab = await page.$(`button:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`);
      if (tab) {
        await tab.click();
        await sleep(1500);
        const crashed2 = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
        console.log(`  Tab "${tabName}": ${crashed2 ? 'CRASHED' : 'OK'}`);
      } else {
        console.log(`  Tab "${tabName}": NOT FOUND`);
      }
    }
    await screenshot(page, 'trade-right-panel-tabs');

    // Bottom panel tabs
    const bottomTabs = await page.evaluate(() => {
      const tabs = [];
      const els = document.querySelectorAll('button, [role="tab"]');
      els.forEach(el => {
        const text = el.textContent.trim();
        if (['SPY Options', 'Options', 'Watchlist', 'Screener', 'Signals', 'News'].some(t => text === t || text.startsWith(t))) {
          tabs.push(text);
        }
      });
      return tabs;
    });
    console.log('Bottom panel tabs:', JSON.stringify(bottomTabs));

    // Check options chain
    const optionsTab = await page.$('button:has-text("Options"), [role="tab"]:has-text("Options")');
    if (optionsTab) {
      await optionsTab.click();
      await sleep(2000);
      await screenshot(page, 'trade-options-chain');
      const optionsContent = await page.evaluate(() => {
        const body = document.body.textContent;
        const hasStrikes = /\d{3,4}\.\d{2}/.test(body) && (body.includes('Call') || body.includes('Put') || body.includes('Strike'));
        return { hasStrikes, bodySnippet: body.substring(0, 200) };
      });
      console.log('Options chain:', JSON.stringify(optionsContent));
    }

    // BUY/SELL overlap check
    const buyBtn = await page.$('button:has-text("Buy"), button:has-text("BUY")');
    const sellBtn = await page.$('button:has-text("Sell"), button:has-text("SELL")');
    if (buyBtn && sellBtn) {
      const buyBox = await buyBtn.boundingBox();
      const sellBox = await sellBtn.boundingBox();
      console.log(`Buy button position: ${JSON.stringify(buyBox)}`);
      console.log(`Sell button position: ${JSON.stringify(sellBox)}`);

      // Check overlap with chart
      const chartArea = await page.$('canvas, [class*="chart" i]:not(button)');
      if (chartArea) {
        const chartBox = await chartArea.boundingBox();
        console.log(`Chart area position: ${JSON.stringify(chartBox)}`);
        if (buyBox && chartBox) {
          const overlaps = buyBox.x < chartBox.x + chartBox.width &&
                           buyBox.x + buyBox.width > chartBox.x &&
                           buyBox.y < chartBox.y + chartBox.height &&
                           buyBox.y + buyBox.height > chartBox.y;
          console.log(`Buy/Sell overlaps chart: ${overlaps}`);
        }
      }
    }

    // Status strip detailed check
    const statusStrip = await page.evaluate(() => {
      // Get all text from the status bar area (usually a thin bar below navbar)
      const els = Array.from(document.querySelectorAll('*'));
      const stripItems = [];
      for (const el of els) {
        const text = el.textContent.trim();
        if ((text.includes('P&L') || text.includes('Regime') || text.includes('VIX') ||
             text.includes('LIVE') || text.includes('Alpaca') || text.includes('PAPER'))
            && el.children.length < 3 && text.length < 60) {
          const style = window.getComputedStyle(el);
          stripItems.push({ text, opacity: style.opacity, color: style.color });
        }
      }
      return stripItems;
    });
    console.log('Status strip items:', JSON.stringify(statusStrip));
  }

  // ===== TRADE PAGE - left panel tabs (Watchlist, Screener, Signals) =====
  console.log('\n=== TRADE LEFT PANEL TABS ===');
  for (const tabName of ['Watchlist', 'Screener', 'Signals']) {
    const tab = await page.$(`button:has-text("${tabName}")`);
    if (tab) {
      await tab.click();
      await sleep(2000);
      await screenshot(page, `trade-left-${tabName.toLowerCase()}`);
      const crashed = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
      console.log(`Left tab "${tabName}": ${crashed ? 'CRASHED' : 'OK'}`);
    } else {
      console.log(`Left tab "${tabName}": NOT FOUND`);
    }
  }

  // ===== PIPELINE DETAILED =====
  console.log('\n=== PIPELINE DETAILED ===');
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);
  await screenshot(page, 'pipeline-detailed');

  const pipelineContent = await page.evaluate(() => {
    const body = document.body.textContent;
    return {
      hasPositions: body.includes('CURRENT POSITIONS') || body.includes('Current Positions'),
      hasRun: body.includes('Run') || body.includes('Pipeline'),
      hasBacktest: body.includes('Backtest') || body.includes('BACKTESTING'),
      hasStrategyBuilder: body.includes('Strategy Builder') || body.includes('STRATEGY BUILDER'),
      snippet: body.substring(0, 500)
    };
  });
  console.log('Pipeline content:', JSON.stringify(pipelineContent));

  // Scroll down to backtest
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1000);
  await screenshot(page, 'pipeline-backtest-area');

  // ===== STRATEGY PAGES DETAILED =====
  console.log('\n=== STRATEGY PEAD DETAILED ===');
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);
  await screenshot(page, 'strategy-pead-detail');

  const peadContent = await page.evaluate(() => {
    const body = document.body.textContent;
    return {
      hasChart: !!document.querySelector('canvas, svg[class*="chart" i], [class*="recharts" i]'),
      hasStats: /Total Return|Win Rate|Sharpe|Active Positions/i.test(body),
      hasNoData: body.includes('Not enough data') || body.includes('No data'),
      snippet: body.substring(0, 500)
    };
  });
  console.log('PEAD content:', JSON.stringify(peadContent));

  // Scroll to strategy trades
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1000);
  await screenshot(page, 'strategy-pead-trades');

  console.log('\n=== STRATEGY MOMENTUM DETAILED ===');
  await page.goto(`${BASE}/strategies/momentum-quality`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);
  await screenshot(page, 'strategy-momentum-detail');

  const momContent = await page.evaluate(() => {
    const body = document.body.textContent;
    return {
      hasChart: !!document.querySelector('canvas, svg[class*="chart" i], [class*="recharts" i]'),
      hasStats: /Total Return|Win Rate|Sharpe|Active Positions/i.test(body),
      hasNoData: body.includes('Not enough data') || body.includes('No data'),
      snippet: body.substring(0, 500)
    };
  });
  console.log('Momentum content:', JSON.stringify(momContent));

  // ===== PROFILE MENU =====
  console.log('\n=== PROFILE MENU ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);

  // The profile icon is typically top-right
  const profileIcon = await page.$('[class*="avatar" i], [class*="profile" i], [class*="user" i] img, .rounded-full');
  if (profileIcon) {
    await profileIcon.click();
    await sleep(1500);
    await screenshot(page, 'profile-menu');

    const menuItems = await page.evaluate(() => {
      const items = [];
      const els = document.querySelectorAll('[role="menuitem"], [class*="menu" i] a, [class*="menu" i] button, [class*="dropdown" i] a, [class*="dropdown" i] button');
      els.forEach(el => items.push(el.textContent.trim()));
      return items;
    });
    console.log('Profile menu items:', JSON.stringify(menuItems));
  }

  // Try clicking the avatar/icon area in top right
  await page.click('body', { position: { x: 1400, y: 20 } });
  await sleep(1500);
  await screenshot(page, 'top-right-click');

  // ===== KEYBOARD SHORTCUTS =====
  console.log('\n=== KEYBOARD SHORTCUTS ===');
  // Try Shift+? for shortcuts overlay
  await page.keyboard.down('Shift');
  await page.keyboard.press('Slash');
  await page.keyboard.up('Shift');
  await sleep(1500);
  await screenshot(page, 'keyboard-shortcuts-shift');

  const dialogVisible = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="overlay" i], [class*="shortcut" i]');
    return Array.from(dialogs).filter(d => {
      const style = window.getComputedStyle(d);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }).map(d => d.textContent.trim().substring(0, 200));
  });
  console.log('Dialogs after Shift+?:', JSON.stringify(dialogVisible));
  await page.keyboard.press('Escape');

  // ===== CMD+K COMMAND PALETTE =====
  console.log('\n=== COMMAND PALETTE ===');
  await page.keyboard.press('Meta+k');
  await sleep(1500);
  await screenshot(page, 'cmd-k-palette');

  const paletteVisible = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"], input[placeholder*="search" i], input[placeholder*="command" i]');
    const dialogs = document.querySelectorAll('[role="dialog"], [class*="cmdk" i], [class*="command" i]');
    return {
      inputs: Array.from(inputs).map(i => ({ placeholder: i.placeholder, visible: window.getComputedStyle(i).display !== 'none' })),
      dialogs: dialogs.length
    };
  });
  console.log('Command palette:', JSON.stringify(paletteVisible));
  await page.keyboard.press('Escape');

  // ===== LOGOUT/RE-LOGIN =====
  console.log('\n=== LOGOUT / RE-LOGIN ===');
  // Navigate to a page first
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);

  // Try clicking on the top-right area to find profile/avatar
  const topRightBtn = await page.evaluate(() => {
    // Find all clickable elements in the top-right corner
    const els = document.querySelectorAll('button, a, [role="button"]');
    const topRight = [];
    els.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.right > 1300 && rect.top < 60 && rect.width < 60) {
        topRight.push({ text: el.textContent.trim().substring(0, 30), tag: el.tagName, x: rect.x, y: rect.y });
      }
    });
    return topRight;
  });
  console.log('Top-right buttons:', JSON.stringify(topRightBtn));

  // Click the avatar area
  if (topRightBtn.length > 0) {
    const lastBtn = topRightBtn[topRightBtn.length - 1];
    await page.click(`body`, { position: { x: lastBtn.x + 10, y: lastBtn.y + 10 } });
    await sleep(1500);
    await screenshot(page, 'avatar-clicked');

    // Look for logout
    const logoutLink = await page.$('a:has-text("Logout"), a:has-text("Log out"), button:has-text("Logout"), button:has-text("Log out"), button:has-text("Sign out"), [class*="logout" i]');
    if (logoutLink) {
      console.log('Logout link found!');
      await logoutLink.click();
      await sleep(3000);
      await screenshot(page, 'after-logout');
      console.log(`URL after logout: ${page.url()}`);

      // Re-login
      const usernameField2 = await page.$('input[name="username"], input[type="text"]');
      const passwordField2 = await page.$('input[type="password"]');
      if (usernameField2 && passwordField2) {
        await usernameField2.fill('admin');
        await passwordField2.fill('alphaDesk2025!');
        const loginBtn2 = await page.$('button[type="submit"]');
        if (loginBtn2) await loginBtn2.click();
        await sleep(4000);
        await screenshot(page, 'after-relogin');
        console.log(`URL after re-login: ${page.url()}`);
        const reloginOK = !page.url().includes('login');
        console.log(`Re-login success: ${reloginOK}`);
      }
    } else {
      console.log('Logout link NOT found in dropdown');
    }
  }

  // ===== CROSS-PAGE PORTFOLIO VALUE CONSISTENCY =====
  console.log('\n=== PORTFOLIO VALUE CONSISTENCY ===');

  // Dashboard hero value
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);
  const dashHeroValue = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      const t = el.textContent.trim();
      if (/^\$[\d,]+\.\d{2}$/.test(t) && t.length < 20 && t.length > 5) {
        const fontSize = parseInt(window.getComputedStyle(el).fontSize);
        if (fontSize > 20) return { value: t, fontSize };
      }
    }
    return null;
  });
  console.log('Dashboard hero value:', JSON.stringify(dashHeroValue));

  // Status strip P&L
  const statusPnL = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      const t = el.textContent.trim();
      if (t.startsWith('P&L') && t.length < 50) {
        return t;
      }
    }
    return null;
  });
  console.log('Status strip P&L:', statusPnL);

  // Trade page
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(4000);
  const tradePnL = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      const t = el.textContent.trim();
      if (t.startsWith('P&L') && t.length < 50) {
        return t;
      }
    }
    return null;
  });
  console.log('Trade page P&L:', tradePnL);

  // ===== DONE =====
  console.log('\n=== CONSOLE ERRORS ===');
  const unique = [...new Set(consoleErrors)];
  unique.forEach((e, i) => console.log(`  ${i+1}: ${e.substring(0, 200)}`));

  await browser.close();
  console.log('\n=== SECOND TEST RUN COMPLETE ===');
})();
