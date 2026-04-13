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

  // ─── STRATEGY CARDS: Check each one individually ───
  console.log('\n=== STRATEGY CARDS DETAILED CHECK ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Get all strategy card details
  const strategyCards = await page.evaluate(() => {
    const results = [];
    // Look for strategy-related containers
    const allDivs = document.querySelectorAll('div, article, section');
    for (const div of allDivs) {
      const text = div.textContent?.trim();
      // Strategy cards typically have names like "Momentum", "PEAD", "VRP", etc.
      if (text && div.children.length >= 2 && div.children.length <= 10) {
        const stratNames = ['Momentum', 'PEAD', 'VRP Harvesting', 'Earnings Vol', 'Regime Adaptive',
          'Claude Alpha', 'Mean Reversion', 'VCP Breakout', 'Pairs Trading', 'Dividend Capture',
          'Sector Rotation', 'Gap Fill'];
        for (const name of stratNames) {
          if (text.startsWith(name) || text.includes(name)) {
            const rect = div.getBoundingClientRect();
            if (rect.width > 100 && rect.width < 400 && rect.height > 50 && rect.height < 200) {
              // Check for truncated text
              const allSpans = div.querySelectorAll('span, p, div');
              const truncated = [];
              for (const span of allSpans) {
                if (span.scrollWidth > span.clientWidth) {
                  truncated.push({
                    text: span.textContent?.trim().substring(0, 50),
                    scrollWidth: span.scrollWidth,
                    clientWidth: span.clientWidth
                  });
                }
              }
              results.push({
                name,
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                fullText: text.substring(0, 150),
                truncated
              });
              break;
            }
          }
        }
      }
    }
    return results;
  });
  console.log(`  Found ${strategyCards.length} strategy cards`);
  strategyCards.forEach(c => {
    console.log(`\n  ${c.name}: ${c.rect.w}x${c.rect.h} at (${c.rect.x}, ${c.rect.y})`);
    console.log(`    Text: ${c.fullText}`);
    if (c.truncated.length) {
      c.truncated.forEach(t => console.log(`    [TRUNCATED] "${t.text}" scrollW=${t.scrollWidth} clientW=${t.clientWidth}`));
    }
  });

  // ─── HERO SECTION: P&L with "(est.)" or percentage ───
  console.log('\n=== P&L HERO DETAIL ===');
  const heroDetail = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    const results = [];
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text && el.children.length === 0) {
        // Look for percentage values, est, demo text
        if (/\(est\.\)|Demo|demo|estimated/i.test(text)) {
          results.push({ text, tag: el.tagName, class: el.className?.substring(0, 50) });
        }
        // Check for green text rendering issue on the P&L hero bar
        if (/(-?\d+\.\d+%)/.test(text)) {
          const color = window.getComputedStyle(el).color;
          const rect = el.getBoundingClientRect();
          results.push({
            text,
            color,
            tag: el.tagName,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y) }
          });
        }
      }
    }
    return results;
  });
  heroDetail.forEach(h => console.log(`    ${h.text} -> color: ${h.color} at (${h.rect?.x}, ${h.rect?.y})`));

  // ─── CHECK P&L hero bar in detail ───
  // The nav bar shows "-$181.03" but there seems to be extra green text after it
  console.log('\n=== NAV BAR P&L CHECK ===');
  const navPnl = await page.evaluate(() => {
    // Look specifically at the P&L area at the top
    const allEls = document.querySelectorAll('*');
    const results = [];
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      // Only elements in the top 40px (nav bar area)
      if (rect.y < 40 && rect.x > 0 && rect.x < 200 && el.children.length === 0) {
        const text = el.textContent?.trim();
        if (text && text.length > 0 && text.length < 50) {
          const color = window.getComputedStyle(el).color;
          const opacity = window.getComputedStyle(el).opacity;
          const visibility = window.getComputedStyle(el).visibility;
          const display = window.getComputedStyle(el).display;
          results.push({
            text, color, opacity, visibility, display,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width) }
          });
        }
      }
    }
    return results;
  });
  navPnl.forEach(n => console.log(`    "${n.text}" color=${n.color} opacity=${n.opacity} vis=${n.visibility} display=${n.display} at x=${n.rect.x} w=${n.rect.w}`));

  // ─── DAY P&L with green text after red number ───
  // I noticed in screenshot 43 that "-$181.03" has some green text right after it
  console.log('\n=== DAY P&L EXACT TEXT ===');
  const dayPnlDetail = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text && text.includes('$181') && el.children.length <= 3) {
        const rect = el.getBoundingClientRect();
        // Get all child text nodes
        const childTexts = [];
        for (const child of el.childNodes) {
          if (child.nodeType === 3) childTexts.push({ type: 'text', text: child.textContent });
          else if (child.nodeType === 1) {
            childTexts.push({
              type: 'element',
              tag: child.tagName,
              text: child.textContent?.trim(),
              color: window.getComputedStyle(child).color,
              fontSize: window.getComputedStyle(child).fontSize
            });
          }
        }
        results.push({
          fullText: text.substring(0, 100),
          tag: el.tagName,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width) },
          children: childTexts
        });
      }
    }
    return results;
  });
  dayPnlDetail.forEach(d => {
    console.log(`\n  "${d.fullText}" <${d.tag}> at (${d.rect.x}, ${d.rect.y}) w=${d.rect.w}`);
    d.children.forEach(c => console.log(`    child: ${c.type} "${c.text}" color=${c.color} fontSize=${c.fontSize}`));
  });

  // ─── SECTOR PERFORMANCE BOX ───
  console.log('\n=== SECTOR PERFORMANCE HEATMAP ===');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);

  const sectorBox = await page.$('text=Sector Performance');
  if (sectorBox) {
    const parent = await sectorBox.evaluateHandle(el => el.closest('section') || el.closest('div[class*="card"]') || el.parentElement?.parentElement);
    const box = await parent.asElement()?.boundingBox();
    if (box) {
      await page.screenshot({
        path: join(DIR, '50_sector_heatmap.png'),
        clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(600, box.width + 20), height: Math.min(400, box.height + 20) }
      });
      console.log('  [SNAP] 50_sector_heatmap.png');
    }
  }

  // ─── MARKET INDICES BOX ───
  const indicesEl = await page.$('text=Market Indices');
  if (indicesEl) {
    const parent = await indicesEl.evaluateHandle(el => el.closest('section') || el.closest('div[class*="card"]') || el.parentElement?.parentElement);
    const box = await parent.asElement()?.boundingBox();
    if (box) {
      await page.screenshot({
        path: join(DIR, '51_market_indices.png'),
        clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(400, box.width + 20), height: Math.min(300, box.height + 20) }
      });
      console.log('  [SNAP] 51_market_indices.png');
    }
  }

  // ─── OPEN POSITIONS SECTION ───
  console.log('\n=== OPEN POSITIONS ===');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const openPosEl = await page.$('text=Open Positions');
  if (openPosEl) {
    const parent = await openPosEl.evaluateHandle(el => el.closest('section') || el.closest('[class*="card"]') || el.parentElement?.parentElement);
    const box = await parent.asElement()?.boundingBox();
    if (box) {
      await page.screenshot({
        path: join(DIR, '52_open_positions.png'),
        clip: { x: Math.max(0, box.x - 5), y: Math.max(0, box.y - 5), width: Math.min(500, box.width + 10), height: Math.min(250, box.height + 10) }
      });
      console.log('  [SNAP] 52_open_positions.png');
    }
  }

  // ─── CALENDAR SECTION ───
  const calEl = await page.$('text=April P&L');
  if (calEl) {
    const parent = await calEl.evaluateHandle(el => el.closest('section') || el.closest('[class*="card"]') || el.parentElement?.parentElement?.parentElement);
    const box = await parent.asElement()?.boundingBox();
    if (box) {
      await page.screenshot({
        path: join(DIR, '53_calendar.png'),
        clip: { x: Math.max(0, box.x - 5), y: Math.max(0, box.y - 5), width: Math.min(600, box.width + 10), height: Math.min(350, box.height + 10) }
      });
      console.log('  [SNAP] 53_calendar.png');
    }
  }

  // ─── ECONOMIC CALENDAR ───
  const econEl = await page.$('text=Economic Calendar');
  if (econEl) {
    const parent = await econEl.evaluateHandle(el => el.closest('section') || el.closest('[class*="card"]') || el.parentElement?.parentElement);
    const box = await parent.asElement()?.boundingBox();
    if (box) {
      await page.screenshot({
        path: join(DIR, '54_economic_calendar.png'),
        clip: { x: Math.max(0, box.x - 5), y: Math.max(0, box.y - 5), width: Math.min(500, box.width + 10), height: Math.min(500, box.height + 10) }
      });
      console.log('  [SNAP] 54_economic_calendar.png');
    }
  }

  // ─── PEAD: Check for loading indicators ───
  console.log('\n=== PEAD METRIC BOXES ===');
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Check for "awaiting trades" text
  const awaitingTexts = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text && /awaiting|loading|pending|coming soon/i.test(text) && el.children.length === 0) {
        results.push({ text, tag: el.tagName });
      }
    }
    return results;
  });
  console.log(`  Awaiting/loading texts: ${JSON.stringify(awaitingTexts)}`);

  // Get metric boxes
  const metricBoxes = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('[class*="rounded"], [class*="border"]');
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.width < 400 && rect.height > 40 && rect.height < 120 && rect.y > 150 && rect.y < 350) {
        const text = el.textContent?.trim();
        if (text && text.length < 100) {
          results.push({
            text,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
          });
        }
      }
    }
    return results;
  });
  console.log(`  Metric boxes found: ${metricBoxes.length}`);
  metricBoxes.forEach(m => console.log(`    "${m.text}" ${m.rect.w}x${m.rect.h} at (${m.rect.x}, ${m.rect.y})`));

  // ─── MOMENTUM: check "Not enough data" ───
  console.log('\n=== MOMENTUM CHART AREA ===');
  await page.goto(`${BASE}/strategies/momentum-quality`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Screenshot the chart area with "Not enough data"
  const chartArea = await page.evaluate(() => {
    const el = document.querySelector('[class*="chart"], canvas, svg');
    if (el) {
      const rect = el.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
    }
    return null;
  });
  if (chartArea) {
    await page.screenshot({
      path: join(DIR, '55_momentum_chart.png'),
      clip: { x: chartArea.x, y: chartArea.y, width: chartArea.w, height: chartArea.h }
    });
    console.log(`  [SNAP] 55_momentum_chart.png at (${chartArea.x}, ${chartArea.y}) ${chartArea.w}x${chartArea.h}`);
  }

  // Check the metric values (should say "awaiting trades" for metrics with no data)
  const momMetricValues = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text && (text === 'awaiting trades' || text === 'Awaiting trades' || text.includes('awaiting')) && el.children.length === 0) {
        results.push({ text, tag: el.tagName, class: el.className?.substring(0, 60) });
      }
    }
    return results;
  });
  console.log(`  "Awaiting trades" elements: ${momMetricValues.length}`);
  momMetricValues.forEach(m => console.log(`    "${m.text}" <${m.tag}> class="${m.class}"`));

  // ─── LOGIN PAGE: check footer and copyright ───
  console.log('\n=== LOGIN PAGE DETAIL ===');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const loginFooter = await page.evaluate(() => {
    const el = document.querySelector('footer');
    if (el) return el.textContent?.trim();
    // Check for copyright text anywhere
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.textContent?.includes('2026') || el.textContent?.includes('copyright') || el.textContent?.includes('AlphaDesk')) {
        const rect = el.getBoundingClientRect();
        if (rect.y > 900 && el.children.length < 5) {
          return el.textContent?.trim();
        }
      }
    }
    return 'NOT FOUND';
  });
  console.log(`  Login footer: ${loginFooter}`);

  // Check login page year in copyright
  const copyrightYear = await page.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/\d{4}\s+AlphaDesk/);
    return match ? match[0] : 'Not found';
  });
  console.log(`  Copyright year: ${copyrightYear}`);

  await browser.close();
  console.log('\n=== DETAIL AUDIT 2 COMPLETE ===');
})();
