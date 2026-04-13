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

  async function snap(name) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(DIR, `${name}.png`), fullPage: false });
    console.log(`  [SNAP] ${name}.png`);
  }

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"], input[placeholder*="user" i], input[placeholder*="email" i]', 'admin');
  await page.fill('input[type="password"]', 'alphaDesk2025!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // ─── DASHBOARD: detailed inspections ───
  console.log('\n=== DASHBOARD DETAIL INSPECTION ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Check for any text containing issue markers
  const issues = await page.evaluate(() => {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (/undefined|null|NaN|\[object|demoLabel|est\.\)|Demo\)|opacity-40/i.test(text)) {
        const parent = walker.currentNode.parentElement;
        const rect = parent ? parent.getBoundingClientRect() : null;
        results.push({
          text: text.substring(0, 100),
          tag: parent ? parent.tagName : 'unknown',
          class: parent ? parent.className.substring(0, 80) : '',
          rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null
        });
      }
    }
    return results;
  });
  console.log(`\n  Dashboard text issues found: ${issues.length}`);
  issues.forEach(i => console.log(`    "${i.text}" in <${i.tag}> class="${i.class}" at (${i.rect?.x}, ${i.rect?.y})`));

  // Check for elements with awaiting/loading/pending text
  const loadingItems = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text && /awaiting|loading|pending/i.test(text) && text.length < 100 && el.children.length === 0) {
        const rect = el.getBoundingClientRect();
        results.push({ text, tag: el.tagName, rect: { x: Math.round(rect.x), y: Math.round(rect.y) } });
      }
    }
    return results;
  });
  console.log(`\n  Loading/pending items: ${loadingItems.length}`);
  loadingItems.forEach(i => console.log(`    "${i.text}" at (${i.rect.x}, ${i.rect.y})`));

  // Check strategy cards for "awaiting trades" or dimmed text
  const stratCards = await page.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('[class*="strategy"], [class*="card"]');
    for (const card of cards) {
      const text = card.textContent?.trim().substring(0, 200);
      const opacity = window.getComputedStyle(card).opacity;
      results.push({ text: text?.substring(0, 80), opacity, tag: card.tagName });
    }
    return results;
  });
  console.log(`\n  Strategy cards found: ${stratCards.length}`);
  stratCards.forEach(c => {
    if (parseFloat(c.opacity) < 1) console.log(`    [LOW OPACITY: ${c.opacity}] ${c.text}`);
  });

  // Check colors on P&L values
  const pnlColors = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text && /^[\-\+]?\$[\d,]+\.?\d*$/.test(text) && el.children.length === 0) {
        const color = window.getComputedStyle(el).color;
        const isNegative = text.includes('-');
        results.push({ text, color, isNegative, tag: el.tagName });
      }
    }
    return results;
  });
  console.log(`\n  P&L color checks:`);
  pnlColors.forEach(p => {
    const isRedish = p.color.includes('239') || p.color.includes('248') || p.color.includes('255, 0') || p.color.includes('red');
    const isGreenish = p.color.includes('34, ') || p.color.includes('0, 255') || p.color.includes('74,') || p.color.includes('green') || p.color.includes('16, 185');
    if (p.isNegative && isGreenish) console.log(`    [WRONG COLOR] Negative ${p.text} shown in GREEN (${p.color})`);
    if (!p.isNegative && isRedish) console.log(`    [WRONG COLOR] Positive ${p.text} shown in RED (${p.color})`);
    console.log(`    ${p.text} -> color: ${p.color}, negative: ${p.isNegative}`);
  });

  // Check for "Earnings Vol" truncation or "Flagged" text on strategies panel
  console.log('\n=== STRATEGY PANEL TEXT ===');
  const stratPanelTexts = await page.evaluate(() => {
    const results = [];
    const panels = document.querySelectorAll('h3, h4, [class*="heading"], [class*="title"]');
    for (const p of panels) {
      if (p.children.length <= 2) {
        const rect = p.getBoundingClientRect();
        const overflow = window.getComputedStyle(p).overflow;
        const textOverflow = window.getComputedStyle(p).textOverflow;
        results.push({
          text: p.textContent?.trim().substring(0, 80),
          overflow, textOverflow,
          width: Math.round(rect.width),
          x: Math.round(rect.x),
          y: Math.round(rect.y)
        });
      }
    }
    return results;
  });
  stratPanelTexts.forEach(t => console.log(`    "${t.text}" w=${t.width} overflow=${t.overflow} textOverflow=${t.textOverflow}`));

  // ─── TRADE PAGE: Investigate the error ───
  console.log('\n=== TRADE PAGE ERROR INVESTIGATION ===');
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const tradePageContent = await page.evaluate(() => {
    return {
      bodyText: document.body.innerText.substring(0, 500),
      hasErrorBoundary: !!document.querySelector('[class*="error"]'),
      title: document.title
    };
  });
  console.log(`\n  Trade page body text: ${tradePageContent.bodyText}`);
  console.log(`  Has error boundary: ${tradePageContent.hasErrorBoundary}`);

  // Check console errors
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`  [CONSOLE ERROR] ${msg.text()}`);
  });

  // Retry trade page to capture any console output
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await snap('40_trade_error_detail');

  // ─── PIPELINE: detailed check ───
  console.log('\n=== PIPELINE DETAIL ===');
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const pipelineTexts = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text && el.children.length === 0 && text.length < 100) {
        const color = window.getComputedStyle(el).color;
        const opacity = window.getComputedStyle(el).opacity;
        if (parseFloat(opacity) < 0.5 && text.length > 0) {
          results.push({ text, opacity, color });
        }
      }
    }
    return results;
  });
  console.log(`  Low opacity elements on pipeline:`);
  pipelineTexts.forEach(t => console.log(`    "${t.text}" opacity=${t.opacity}`));

  // Check for the "No activity" in pipeline history
  const pipelineHistory = await page.evaluate(() => {
    const tds = document.querySelectorAll('td');
    return Array.from(tds).map(td => td.textContent?.trim()).filter(t => t);
  });
  console.log(`\n  Pipeline table cells: ${pipelineHistory.join(' | ')}`);

  // ─── PEAD STRATEGY: check for "awaiting trades" ───
  console.log('\n=== PEAD DETAIL ===');
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const peadMetrics = await page.evaluate(() => {
    const metrics = [];
    const statCards = document.querySelectorAll('[class*="stat"], [class*="metric"], [class*="card"]');
    for (const card of statCards) {
      const text = card.textContent?.trim();
      if (text && text.length < 200) {
        const opacity = window.getComputedStyle(card).opacity;
        metrics.push({ text: text.substring(0, 100), opacity });
      }
    }
    return metrics;
  });
  peadMetrics.forEach(m => console.log(`    [opacity=${m.opacity}] ${m.text}`));

  // ─── MOMENTUM STRATEGY: check for "awaiting trades" ───
  console.log('\n=== MOMENTUM DETAIL ===');
  await page.goto(`${BASE}/strategies/momentum-quality`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const momMetrics = await page.evaluate(() => {
    const metrics = [];
    const statCards = document.querySelectorAll('[class*="stat"], [class*="metric"], [class*="card"]');
    for (const card of statCards) {
      const text = card.textContent?.trim();
      if (text && text.length < 200) {
        const opacity = window.getComputedStyle(card).opacity;
        metrics.push({ text: text.substring(0, 100), opacity });
      }
    }
    return metrics;
  });
  momMetrics.forEach(m => console.log(`    [opacity=${m.opacity}] ${m.text}`));

  // Check if "Not enough data" text is visible
  const notEnough = await page.evaluate(() => {
    return document.body.innerText.includes('Not enough data');
  });
  console.log(`\n  "Not enough data" visible: ${notEnough}`);

  // ─── Check for footer issues across pages ───
  console.log('\n=== FOOTER CHECK ===');
  for (const pg of ['/', '/privacy', '/terms', '/risk', '/docs']) {
    await page.goto(`${BASE}${pg}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const footerText = await page.evaluate(() => {
      const footer = document.querySelector('footer');
      return footer ? footer.textContent?.trim().substring(0, 200) : 'NO FOOTER FOUND';
    });
    console.log(`  ${pg}: ${footerText}`);
  }

  // ─── NAV BAR BADGE CHECK ───
  console.log('\n=== NAV BAR BADGES ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const navBadges = await page.evaluate(() => {
    const badges = document.querySelectorAll('[class*="badge"], [class*="chip"], [class*="tag"], [class*="label"]');
    return Array.from(badges).map(b => ({
      text: b.textContent?.trim(),
      class: b.className?.substring(0, 80),
      bg: window.getComputedStyle(b).backgroundColor,
      color: window.getComputedStyle(b).color
    }));
  });
  console.log(`  Badges found: ${navBadges.length}`);
  navBadges.forEach(b => console.log(`    "${b.text}" bg=${b.bg} color=${b.color}`));

  // Check the "Alpaca (Paper)" and "PAPER" badges in nav
  const navTexts = await page.evaluate(() => {
    const nav = document.querySelector('nav, header, [class*="navbar"], [class*="topbar"]');
    if (!nav) return 'NO NAV FOUND';
    return nav.textContent?.trim().substring(0, 300);
  });
  console.log(`\n  Nav text: ${navTexts}`);

  // ─── EARNINGS VOL STRATEGY: check truncation ───
  console.log('\n=== EARNINGS VOL CHECK ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Find the earnings vol strategy card
  const earningsCard = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.textContent?.includes('Earnings') && el.textContent?.includes('Vol') && el.children.length < 5) {
        const rect = el.getBoundingClientRect();
        return {
          text: el.textContent?.trim().substring(0, 100),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          overflow: window.getComputedStyle(el).overflow,
          tag: el.tagName,
          class: el.className?.substring(0, 80)
        };
      }
    }
    return null;
  });
  console.log(`  Earnings Vol card: ${JSON.stringify(earningsCard)}`);

  // Check for "Flagged" status badge
  const flaggedCards = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.textContent?.trim() === 'Flagged' && el.children.length === 0) {
        const rect = el.getBoundingClientRect();
        results.push({
          tag: el.tagName,
          class: el.className?.substring(0, 80),
          bg: window.getComputedStyle(el).backgroundColor,
          color: window.getComputedStyle(el).color,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y) }
        });
      }
    }
    return results;
  });
  console.log(`\n  "Flagged" badges: ${JSON.stringify(flaggedCards)}`);

  // Check for "Paused" label
  const pausedCards = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.textContent?.trim() === 'Paused' && el.children.length === 0) {
        results.push({
          tag: el.tagName,
          class: el.className?.substring(0, 80),
          bg: window.getComputedStyle(el).backgroundColor,
          color: window.getComputedStyle(el).color
        });
      }
    }
    return results;
  });
  console.log(`  "Paused" badges: ${JSON.stringify(pausedCards)}`);

  // ─── LOOK AT DETAILED DASHBOARD SECTIONS ───
  console.log('\n=== DASHBOARD SECTION SCREENSHOTS ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Clip: Portfolio hero area
  await page.screenshot({
    path: join(DIR, '41_dashboard_hero.png'),
    clip: { x: 0, y: 0, width: 1920, height: 120 }
  });
  console.log('  [SNAP] 41_dashboard_hero.png');

  // Clip: Strategy grid
  await page.screenshot({
    path: join(DIR, '42_dashboard_strategies.png'),
    clip: { x: 700, y: 60, width: 620, height: 420 }
  });
  console.log('  [SNAP] 42_dashboard_strategies.png');

  // Clip: Activity Feed
  await page.screenshot({
    path: join(DIR, '43_dashboard_activity.png'),
    clip: { x: 0, y: 60, width: 700, height: 150 }
  });
  console.log('  [SNAP] 43_dashboard_activity.png');

  // Clip: Open positions + Calendar
  await page.screenshot({
    path: join(DIR, '44_dashboard_positions.png'),
    clip: { x: 0, y: 180, width: 700, height: 320 }
  });
  console.log('  [SNAP] 44_dashboard_positions.png');

  // ─── CLOSER LOOK AT STRATEGY CARDS ───
  // Scroll so strategies are fully visible
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Clip: Earnings Vol specifically (should be around x:520, y:150 area)
  const earningsEl = await page.$('text=Earnings Vol');
  if (earningsEl) {
    const box = await earningsEl.boundingBox();
    if (box) {
      await page.screenshot({
        path: join(DIR, '45_earnings_vol_detail.png'),
        clip: { x: Math.max(0, box.x - 50), y: Math.max(0, box.y - 30), width: 300, height: 120 }
      });
      console.log('  [SNAP] 45_earnings_vol_detail.png');
    }
  }

  // Clip: Gap Fill specifically
  const gapEl = await page.$('text=Gap Fill');
  if (gapEl) {
    const box = await gapEl.boundingBox();
    if (box) {
      await page.screenshot({
        path: join(DIR, '46_gap_fill_detail.png'),
        clip: { x: Math.max(0, box.x - 50), y: Math.max(0, box.y - 30), width: 300, height: 120 }
      });
      console.log('  [SNAP] 46_gap_fill_detail.png');
    }
  }

  await browser.close();
  console.log('\n=== DETAIL AUDIT COMPLETE ===');
})();
