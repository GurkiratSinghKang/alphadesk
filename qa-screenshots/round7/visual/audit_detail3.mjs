import { chromium } from 'playwright';
import { join } from 'path';

const BASE = 'https://tradingalpha.net';
const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round7/visual';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"], input[placeholder*="user" i], input[placeholder*="email" i]', 'admin');
  await page.fill('input[type="password"]', 'alphaDesk2025!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // ─── DASHBOARD HERO P&L area close-up ───
  console.log('\n=== DASHBOARD HERO P&L CLOSE-UP ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Get P&L hero section (the -$181 area + equity graph)
  await page.screenshot({
    path: join(DIR, '60_hero_pnl_closeup.png'),
    clip: { x: 20, y: 30, width: 700, height: 60 }
  });
  console.log('  [SNAP] 60_hero_pnl_closeup.png');

  // Look for the hidden percentage text overlapping
  const hiddenElements = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      const text = el.textContent?.trim();
      // Check for elements that contain the percentage and might be hidden
      if (text && text.includes('-0.18%') && el.children.length === 0) {
        results.push({
          text,
          color: cs.color,
          bg: cs.backgroundColor,
          opacity: cs.opacity,
          visibility: cs.visibility,
          display: cs.display,
          overflow: cs.overflow,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          tag: el.tagName,
          class: el.className?.substring(0, 100)
        });
      }
    }
    return results;
  });
  console.log('  Hidden/overlapping percentage elements:');
  hiddenElements.forEach(e => console.log(`    "${e.text}" color=${e.color} opacity=${e.opacity} vis=${e.visibility} display=${e.display} at (${e.rect.x}, ${e.rect.y}) ${e.rect.w}x${e.rect.h} class="${e.class}"`));

  // ─── DASHBOARD: complete strategy grid close-up ───
  console.log('\n=== STRATEGY GRID DETAIL ===');
  // Screenshot each strategy card row
  await page.screenshot({
    path: join(DIR, '61_strat_row1.png'),
    clip: { x: 1140, y: 290, width: 700, height: 170 }
  });
  console.log('  [SNAP] 61_strat_row1.png (Momentum + PEAD)');

  await page.screenshot({
    path: join(DIR, '62_strat_row2.png'),
    clip: { x: 1140, y: 470, width: 700, height: 170 }
  });
  console.log('  [SNAP] 62_strat_row2.png (VRP + Earnings Vol)');

  await page.screenshot({
    path: join(DIR, '63_strat_row3.png'),
    clip: { x: 1140, y: 650, width: 700, height: 170 }
  });
  console.log('  [SNAP] 63_strat_row3.png (Regime + Claude Alpha)');

  // Scroll down to see more strategy cards
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(500);

  await page.screenshot({
    path: join(DIR, '64_strat_row4_5.png'),
    clip: { x: 1140, y: 250, width: 700, height: 350 }
  });
  console.log('  [SNAP] 64_strat_row4_5.png (Mean Rev + VCP + Pairs + Dividend)');

  // More scrolling to see Gap Fill and Sector Rotation
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(500);

  await page.screenshot({
    path: join(DIR, '65_strat_row6.png'),
    clip: { x: 1140, y: 250, width: 700, height: 200 }
  });
  console.log('  [SNAP] 65_strat_row6.png (Sector Rotation + Gap Fill)');

  // ─── DASHBOARD: Check the equity curve graph ───
  console.log('\n=== EQUITY CURVE ===');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  await page.screenshot({
    path: join(DIR, '66_equity_curve.png'),
    clip: { x: 20, y: 55, width: 700, height: 120 }
  });
  console.log('  [SNAP] 66_equity_curve.png');

  // ─── PEAD: metric boxes and tab panels ───
  console.log('\n=== PEAD DETAIL SCREENSHOTS ===');
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Metric boxes row
  await page.screenshot({
    path: join(DIR, '67_pead_metrics.png'),
    clip: { x: 80, y: 205, width: 1760, height: 70 }
  });
  console.log('  [SNAP] 67_pead_metrics.png');

  // Check the CALMAR RATIO value specifically
  const calmarDetail = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.textContent?.trim() === 'CALMAR RATIO' && el.children.length === 0) {
        const parent = el.parentElement;
        return {
          labelText: el.textContent.trim(),
          parentText: parent?.textContent?.trim().substring(0, 100),
          siblings: Array.from(parent?.children || []).map(c => ({
            text: c.textContent?.trim(),
            tag: c.tagName,
            color: window.getComputedStyle(c).color
          }))
        };
      }
    }
    return null;
  });
  console.log(`  CALMAR RATIO detail: ${JSON.stringify(calmarDetail)}`);

  // Tab: Positions
  const positionsTab = await page.$('text=Positions');
  if (positionsTab) {
    await positionsTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: join(DIR, '68_pead_positions.png'),
      clip: { x: 80, y: 265, width: 1760, height: 300 }
    });
    console.log('  [SNAP] 68_pead_positions.png');
  }

  // Tab: Market Exposure
  const exposureTab = await page.$('text=Market Exposure');
  if (exposureTab) {
    await exposureTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: join(DIR, '69_pead_exposure.png'),
      clip: { x: 80, y: 265, width: 1760, height: 300 }
    });
    console.log('  [SNAP] 69_pead_exposure.png');
  }

  // Tab: Correlation
  const corrTab = await page.$('text=Correlation');
  if (corrTab) {
    await corrTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: join(DIR, '70_pead_correlation.png'),
      clip: { x: 80, y: 265, width: 1760, height: 300 }
    });
    console.log('  [SNAP] 70_pead_correlation.png');
  }

  // Tab: Analytics
  const analyticsTab = await page.$('text=Analytics');
  if (analyticsTab) {
    await analyticsTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: join(DIR, '71_pead_analytics.png'),
      clip: { x: 80, y: 265, width: 1760, height: 300 }
    });
    console.log('  [SNAP] 71_pead_analytics.png');
  }

  // Trade History table
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: join(DIR, '72_pead_trade_history.png'),
    clip: { x: 80, y: 400, width: 1760, height: 200 }
  });
  console.log('  [SNAP] 72_pead_trade_history.png');

  // ─── MOMENTUM: all detail ───
  console.log('\n=== MOMENTUM DETAIL ===');
  await page.goto(`${BASE}/strategies/momentum-quality`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Metric boxes
  await page.screenshot({
    path: join(DIR, '73_momentum_metrics.png'),
    clip: { x: 80, y: 205, width: 1760, height: 70 }
  });
  console.log('  [SNAP] 73_momentum_metrics.png');

  // Check "awaiting trades" styling in momentum
  const momentumAwait = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    const results = [];
    for (const el of allEls) {
      const text = el.textContent?.trim().toLowerCase();
      if ((text === 'awaiting trades' || text === 'awaiting' || text?.includes('awaiting')) && el.children.length === 0 && text.length < 30) {
        const cs = window.getComputedStyle(el);
        results.push({
          text: el.textContent?.trim(),
          color: cs.color,
          opacity: cs.opacity,
          fontSize: cs.fontSize,
          tag: el.tagName,
          class: el.className?.substring(0, 80)
        });
      }
    }
    return results;
  });
  console.log('  "Awaiting trades" elements:');
  momentumAwait.forEach(a => console.log(`    "${a.text}" color=${a.color} opacity=${a.opacity} size=${a.fontSize} <${a.tag}>`));

  // Trade history bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: join(DIR, '74_momentum_bottom.png'),
    clip: { x: 80, y: 400, width: 1760, height: 200 }
  });
  console.log('  [SNAP] 74_momentum_bottom.png');

  // ─── PROFILE MENU DETAIL ───
  console.log('\n=== PROFILE MENU DETAIL ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Click the profile avatar
  const avatar = await page.$('[class*="avatar"], button:last-of-type');
  const allBtns = await page.$$('button');
  for (const btn of allBtns.reverse()) {
    const box = await btn.boundingBox();
    if (box && box.x > 1850 && box.y < 50) {
      await btn.click();
      await page.waitForTimeout(1000);
      break;
    }
  }
  await page.screenshot({
    path: join(DIR, '75_profile_menu_detail.png'),
    clip: { x: 1600, y: 0, width: 320, height: 200 }
  });
  console.log('  [SNAP] 75_profile_menu_detail.png');

  // ─── CHECK FOR SCROLLBAR ISSUES ───
  console.log('\n=== SCROLLBAR CHECK ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const scrollbarIssues = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const hasHScroll = el.scrollWidth > el.clientWidth && el.clientWidth > 0;
      const hasVScroll = el.scrollHeight > el.clientHeight && el.clientHeight > 0;
      const cs = window.getComputedStyle(el);
      if ((hasHScroll || hasVScroll) && cs.overflow !== 'hidden' && cs.overflow !== 'clip') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50 && rect.width < 1920) {
          results.push({
            tag: el.tagName,
            class: el.className?.substring(0, 80),
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            hScroll: hasHScroll,
            vScroll: hasVScroll,
            overflow: cs.overflow,
            overflowX: cs.overflowX,
            overflowY: cs.overflowY
          });
        }
      }
    }
    return results;
  });
  console.log(`  Elements with scrollbars: ${scrollbarIssues.length}`);
  scrollbarIssues.forEach(s => console.log(`    <${s.tag}> class="${s.class}" ${s.rect.w}x${s.rect.h} hScroll=${s.hScroll} vScroll=${s.vScroll} overflow=${s.overflow}`));

  // ─── LOGIN PAGE FOOTER DETAIL ───
  console.log('\n=== LOGIN PAGE DETAIL ===');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Close-up of login card
  await page.screenshot({
    path: join(DIR, '76_login_card.png'),
    clip: { x: 650, y: 60, width: 400, height: 300 }
  });
  console.log('  [SNAP] 76_login_card.png');

  // Footer
  await page.screenshot({
    path: join(DIR, '77_login_footer.png'),
    clip: { x: 0, y: 980, width: 1920, height: 100 }
  });
  console.log('  [SNAP] 77_login_footer.png');

  // Check if "2026" year is used or wrong year
  const yearCheck = await page.evaluate(() => {
    return document.body.innerText.match(/20\d{2}/g);
  });
  console.log(`  Years found on login page: ${JSON.stringify(yearCheck)}`);

  await browser.close();
  console.log('\n=== DETAIL AUDIT 3 COMPLETE ===');
})();
