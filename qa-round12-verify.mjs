import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round12';
const BASE_URL = 'https://tradingalpha.net';

function log(msg) {
  console.log(`[INFO] ${msg}`);
}

async function ss(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
}

(async () => {
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

  // ===== VERIFY 1: Strategy cards clickability =====
  log('\n=== VERIFY: Strategy Card Clickability ===');

  const cardInfo = await page.evaluate(() => {
    // Find all elements with cursor:pointer and strategy-related text
    const allCards = document.querySelectorAll('[role="button"]');
    const results = [];
    allCards.forEach(card => {
      const text = card.textContent.trim();
      if (text.length > 5 && text.length < 200) {
        results.push({
          text: text.substring(0, 60),
          tag: card.tagName,
          role: card.getAttribute('role'),
          cursor: window.getComputedStyle(card).cursor,
          hasOnClick: !!card.onclick || card.getAttribute('onclick') !== null,
        });
      }
    });
    return results;
  });

  log(`Cards with role="button": ${cardInfo.length}`);
  for (const c of cardInfo) {
    log(`  "${c.text}" [${c.tag}] cursor=${c.cursor}`);
  }

  // Try clicking actual PEAD card
  log('\n--- Clicking PEAD strategy card ---');
  try {
    // Find the card that contains "PEAD" text
    const peadCard = await page.$('[role="button"]:has-text("PEAD")');
    if (peadCard) {
      await peadCard.click();
      await page.waitForTimeout(3000);
      log(`After PEAD click: ${page.url()}`);
      await ss(page, 'verify-pead-click');

      if (page.url().includes('/strategies/')) {
        log('PEAD card navigation WORKS');
      } else {
        log('PEAD card DID NOT navigate to strategy page');
      }
    } else {
      log('PEAD card element not found');
    }
  } catch (e) {
    log(`PEAD click error: ${e.message}`);
  }

  // Go back and try Momentum
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  log('\n--- Clicking Momentum strategy card ---');
  try {
    const momCard = await page.$('[role="button"]:has-text("Momentum")');
    if (momCard) {
      await momCard.click();
      await page.waitForTimeout(3000);
      log(`After Momentum click: ${page.url()}`);
      await ss(page, 'verify-momentum-click');

      if (page.url().includes('/strategies/')) {
        log('Momentum card navigation WORKS');
      } else {
        log('Momentum card DID NOT navigate');
      }
    }
  } catch (e) {
    log(`Momentum click error: ${e.message}`);
  }

  // Go back and try Earnings
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  log('\n--- Clicking Earnings strategy card ---');
  try {
    const earnCard = await page.$('[role="button"]:has-text("Earnings")');
    if (earnCard) {
      await earnCard.click();
      await page.waitForTimeout(3000);
      log(`After Earnings click: ${page.url()}`);
      await ss(page, 'verify-earnings-click');

      if (page.url().includes('/strategies/')) {
        log('Earnings card navigation WORKS');
      } else {
        log('Earnings card DID NOT navigate');
      }
    }
  } catch (e) {
    log(`Earnings click error: ${e.message}`);
  }

  // ===== VERIFY 2: Ask price on multiple symbols =====
  log('\n=== VERIFY: Ask Price on Multiple Symbols ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const quoteChecks = await page.evaluate(async () => {
    const symbols = ['SPY', 'AAPL', 'MSFT', 'GOOGL'];
    const results = {};
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    for (const s of symbols) {
      try {
        const resp = await fetch(`/api/v1/market/quotes/${s}`, { headers });
        const data = await resp.json();
        results[s] = { bid: data.bid, ask: data.ask, last: data.last, spread: data.ask - data.bid };
      } catch (e) {
        results[s] = { error: e.message };
      }
    }
    return results;
  });

  for (const [symbol, data] of Object.entries(quoteChecks)) {
    log(`${symbol}: bid=${data.bid}, ask=${data.ask}, last=${data.last}, spread=${data.spread}`);
    if (data.ask === 0) {
      log(`  ** ASK IS ZERO for ${symbol} **`);
    }
  }

  // ===== VERIFY 3: Calendar weekend P&L colors =====
  log('\n=== VERIFY: Calendar Weekend Analysis ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Take a zoomed screenshot of just the calendar area
  const calendarEl = await page.$('[class*="calendar"], [class*="Calendar"]');
  if (calendarEl) {
    await calendarEl.screenshot({ path: path.join(SCREENSHOT_DIR, 'verify-calendar-zoom.png') });
    log('Calendar zoom screenshot taken');
  }

  // Check each calendar day cell more precisely
  const calendarDetails = await page.evaluate(() => {
    // Find the calendar grid
    const body = document.body.innerText;

    // April 2026: weekdays only trading
    // Mon=6,13,20,27; Tue=7,14,21,28; Wed=1,8,15,22,29; Thu=2,9,16,23,30; Fri=3,10,17,24
    // Sat=4,11,18,25; Sun=5,12,19,26

    // Look for colored day cells (red/green backgrounds indicating P&L)
    // We need to find cells with explicit red or green backgrounds
    const allDivs = document.querySelectorAll('div, td, span');
    const coloredDays = [];

    for (const el of allDivs) {
      const text = el.textContent.trim();
      if (/^\d{1,2}$/.test(text)) {
        const dayNum = parseInt(text);
        if (dayNum >= 1 && dayNum <= 30 && el.children.length === 0) {
          const style = window.getComputedStyle(el);
          const bg = style.backgroundColor;
          const parentBg = el.parentElement ? window.getComputedStyle(el.parentElement).backgroundColor : '';

          // Check for green (profit) or red (loss) colors
          const isGreen = bg.includes('34, 197') || bg.includes('16, 185') || bg.includes('22, 163') || parentBg.includes('34, 197') || parentBg.includes('16, 185');
          const isRed = bg.includes('239, 68') || bg.includes('220, 38') || bg.includes('248, 113') || parentBg.includes('239, 68') || parentBg.includes('220, 38');

          if (isGreen || isRed) {
            coloredDays.push({
              day: dayNum,
              color: isGreen ? 'green' : 'red',
              bg,
              parentBg,
            });
          }
        }
      }
    }
    return coloredDays;
  });

  log(`Calendar colored days: ${JSON.stringify(calendarDetails)}`);

  // ===== VERIFY 4: /dashboard 404 =====
  log('\n=== VERIFY: /dashboard route ===');
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  log(`/dashboard final URL: ${page.url()}`);
  const dashIs404 = await page.evaluate(() => document.body.innerText.includes('404'));
  log(`/dashboard shows 404: ${dashIs404}`);
  await ss(page, 'verify-dashboard-404');

  // ===== VERIFY 5: Positions count on trade page =====
  log('\n=== VERIFY: Trade page positions ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // The deep test found 25 position rows - that's the options chain, not portfolio positions
  // Check what tab is active
  const tradeTabs = await page.evaluate(() => {
    const tabs = document.querySelectorAll('[role="tab"], button');
    return Array.from(tabs).filter(t => {
      const text = t.textContent.trim();
      return ['Positions', 'Orders', 'History', 'Journal', 'Options'].some(l => text.includes(l));
    }).map(t => ({
      text: t.textContent.trim(),
      active: t.getAttribute('aria-selected') === 'true' || t.classList.contains('active') || t.getAttribute('data-state') === 'active',
    }));
  });
  log(`Trade page tabs: ${JSON.stringify(tradeTabs)}`);

  // Click Positions tab explicitly
  try {
    await page.click('button:has-text("Positions")');
    await page.waitForTimeout(1500);
    await ss(page, 'verify-trade-positions');

    const positionsData = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      return {
        count: rows.length,
        data: Array.from(rows).slice(0, 10).map(row => {
          const cells = row.querySelectorAll('td');
          return Array.from(cells).map(c => c.textContent.trim());
        }),
      };
    });
    log(`Positions tab rows: ${positionsData.count}`);
    for (const row of positionsData.data) {
      log(`  Row: ${JSON.stringify(row)}`);
    }
  } catch (e) {
    log(`Positions tab: ${e.message}`);
  }

  // ===== VERIFY 6: WMT P&L math closer look =====
  log('\n=== VERIFY: WMT Position P&L ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const wmtCheck = await page.evaluate(() => {
    const body = document.body.innerText;
    // WMT 61 shares $124.70 avg $124.19 +$31.27
    const wmtMatch = body.match(/WMT\s+(\d+)\s+shares?\s+\$([\d,.]+)\s+avg\s+\$([\d,.]+)\s+([+-]?\$[\d,.]+)/);
    if (wmtMatch) {
      const qty = parseInt(wmtMatch[1]);
      const current = parseFloat(wmtMatch[2].replace(/,/g, ''));
      const avg = parseFloat(wmtMatch[3].replace(/,/g, ''));
      const displayed = wmtMatch[4];
      const expected = (current - avg) * qty;
      return { qty, current, avg, displayed, expected: expected.toFixed(2), diff: Math.abs(expected - parseFloat(displayed.replace(/[,$]/g, ''))) };
    }
    return null;
  });
  log(`WMT P&L check: ${JSON.stringify(wmtCheck)}`);

  // ===== VERIFY 7: WebSocket reconnect spam =====
  log('\n=== VERIFY: WebSocket Behavior ===');
  const wsCheck = await page.evaluate(() => {
    // Check for WebSocket connections
    return {
      performance: performance.getEntriesByType('resource').filter(r => r.initiatorType === 'websocket' || r.name.includes('ws')).length,
    };
  });
  log(`WebSocket entries: ${wsCheck.performance}`);

  // ===== VERIFY 8: Open Positions total vs Day P&L =====
  log('\n=== VERIFY: Portfolio Math Cross-Check ===');
  const portfolioCheck = await page.evaluate(async () => {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    // Get portfolio summary
    const summaryResp = await fetch('/api/v1/portfolio/summary', { headers });
    const summary = await summaryResp.json();

    // Get positions
    const posResp = await fetch('/api/v1/trades/positions', { headers });
    const positions = await posResp.json();

    // Calculate total unrealized P&L from positions
    let totalUnrealizedPnl = 0;
    for (const pos of positions) {
      const pnl = (pos.current_price - pos.avg_cost) * pos.quantity;
      totalUnrealizedPnl += pnl;
    }

    return {
      equity: summary.equity,
      cash: summary.cash,
      buyingPower: summary.buying_power,
      marketValue: summary.total_market_value,
      unrealizedPnl: summary.unrealized_pl,
      calculatedPnl: totalUnrealizedPnl,
      cashPlusMarket: summary.cash + summary.total_market_value,
      positions: positions.map(p => ({
        symbol: p.symbol,
        qty: p.quantity,
        avg: p.avg_cost,
        current: p.current_price,
        pnl: ((p.current_price - p.avg_cost) * p.quantity).toFixed(2),
        unrealizedPnl: p.unrealized_pl,
      })),
    };
  });

  log(`Portfolio: equity=$${portfolioCheck.equity}, cash=$${portfolioCheck.cash}, marketValue=$${portfolioCheck.marketValue}`);
  log(`Cash + Market Value = $${portfolioCheck.cashPlusMarket.toFixed(2)} (should ≈ equity $${portfolioCheck.equity})`);
  log(`API unrealized P&L: $${portfolioCheck.unrealizedPnl}`);
  log(`Calculated P&L from positions: $${portfolioCheck.calculatedPnl.toFixed(2)}`);

  for (const pos of portfolioCheck.positions) {
    log(`  ${pos.symbol}: ${pos.qty} shares, avg=$${pos.avg}, current=$${pos.current}, calc_pnl=$${pos.pnl}, api_pnl=${pos.unrealizedPnl}`);
  }

  const equityDiff = Math.abs(portfolioCheck.cashPlusMarket - portfolioCheck.equity);
  if (equityDiff > 1) {
    log(`** WARNING: Cash + Market Value differs from Equity by $${equityDiff.toFixed(2)} **`);
  }

  // ===== VERIFY 9: Pipeline only shows 1 position vs dashboard 4 =====
  log('\n=== VERIFY: Pipeline vs Dashboard Position Count ===');
  log(`Dashboard shows 4 positions: MRK, NKE, PG, WMT`);
  log(`Pipeline shows 1 position: MRK`);
  log(`This may be by design - pipeline only shows pipeline-generated positions, not broker-synced positions`);

  // Verify from API
  const pipelineAPI = await page.evaluate(async () => {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    try {
      const resp = await fetch('/api/v1/pipeline/positions', { headers });
      return { status: resp.status, data: resp.ok ? await resp.json() : null };
    } catch (e) {
      return { error: e.message };
    }
  });
  log(`Pipeline positions API: ${JSON.stringify(pipelineAPI).substring(0, 300)}`);

  await browser.close();
  log('\nVerification complete.');
})();
