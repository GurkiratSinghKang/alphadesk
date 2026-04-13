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

  // ─── PEAD: Full tab content screenshots ───
  console.log('\n=== PEAD TAB CONTENT ===');
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // About tab (default)
  await snap('80_pead_about_tab');

  // Click Positions tab
  const tabs = await page.$$('[role="tab"], button');
  for (const tab of tabs) {
    const text = await tab.textContent();
    if (text?.trim() === 'Positions') {
      await tab.click();
      await page.waitForTimeout(1500);
      await snap('81_pead_positions_tab');
      break;
    }
  }

  // Market Exposure tab
  for (const tab of tabs) {
    const text = await tab.textContent();
    if (text?.trim() === 'Market Exposure') {
      await tab.click();
      await page.waitForTimeout(1500);
      await snap('82_pead_exposure_tab');
      break;
    }
  }

  // Correlation tab
  for (const tab of tabs) {
    const text = await tab.textContent();
    if (text?.trim() === 'Correlation') {
      await tab.click();
      await page.waitForTimeout(1500);
      await snap('83_pead_correlation_tab');
      break;
    }
  }

  // Analytics tab
  for (const tab of tabs) {
    const text = await tab.textContent();
    if (text?.trim() === 'Analytics') {
      await tab.click();
      await page.waitForTimeout(1500);
      await snap('84_pead_analytics_tab');
      break;
    }
  }

  // ─── PEAD: Metric boxes detail ───
  console.log('\n=== PEAD METRICS DETAIL ===');
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Check the CALMAR RATIO specifically - "awaiting trades" label
  const metricLabels = await page.evaluate(() => {
    const results = [];
    const allSpans = document.querySelectorAll('span, p, div');
    for (const el of allSpans) {
      const text = el.textContent?.trim();
      if (el.children.length === 0 && text && text.length < 50) {
        const rect = el.getBoundingClientRect();
        if (rect.y > 180 && rect.y < 290 && rect.x > 80) {
          const cs = window.getComputedStyle(el);
          results.push({
            text,
            color: cs.color,
            fontSize: cs.fontSize,
            opacity: cs.opacity,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width) }
          });
        }
      }
    }
    return results;
  });
  console.log('  Metric area elements:');
  metricLabels.forEach(m => console.log(`    "${m.text}" color=${m.color} size=${m.fontSize} opacity=${m.opacity} at (${m.rect.x}, ${m.rect.y}) w=${m.rect.w}`));

  // ─── DASHBOARD: P&L percentage ghost text ───
  console.log('\n=== DASHBOARD P&L GHOST TEXT ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Get the exact styling of the (-0.18%) element
  const pctDetail = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    const results = [];
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text === '(-0.18%)' && el.children.length === 0) {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        results.push({
          text,
          color: cs.color,
          bgColor: cs.backgroundColor,
          opacity: cs.opacity,
          visibility: cs.visibility,
          zIndex: cs.zIndex,
          position: cs.position,
          parentTag: el.parentElement?.tagName,
          parentClass: el.parentElement?.className?.substring(0, 100),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
        });
      }
    }
    return results;
  });
  console.log('  Percentage elements:');
  pctDetail.forEach(p => console.log(`    "${p.text}" color=${p.color} opacity=${p.opacity} z=${p.zIndex} pos=${p.position} at (${p.rect.x}, ${p.rect.y}) ${p.rect.w}x${p.rect.h} parent=<${p.parentTag}> class="${p.parentClass}"`));

  // ─── PEAD vs. Dashboard: PEAD card shows +0.00% but PEAD detail shows +4.80% ───
  console.log('\n=== PEAD RETURN DISCREPANCY CHECK ===');
  // From strategy cards: PEAD shows "+0.00%"  (screenshot 61)
  // But the PEAD detail page header shows "+4.80%"
  // Let's verify both
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const peadCardReturn = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text?.startsWith('PEAD') && el.children.length >= 2 && el.children.length <= 10) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.width < 400 && rect.height > 50) {
          return el.textContent?.trim().substring(0, 100);
        }
      }
    }
    return 'NOT FOUND';
  });
  console.log(`  Dashboard PEAD card text: "${peadCardReturn}"`);

  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const peadDetailReturn = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text && /TOTAL RETURN|total return/i.test(text) && el.children.length <= 5) {
        return el.textContent?.trim().substring(0, 100);
      }
    }
    return 'NOT FOUND';
  });
  console.log(`  Detail page PEAD total return: "${peadDetailReturn}"`);

  // ─── TRADE PAGE: Verify exact error ───
  console.log('\n=== TRADE ERROR DETAIL ===');
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await snap('85_trade_error');

  // Check what the error boundary shows
  const tradeError = await page.evaluate(() => {
    return {
      fullText: document.body.innerText.substring(0, 1000),
      errorElements: (() => {
        const results = [];
        const allEls = document.querySelectorAll('*');
        for (const el of allEls) {
          const text = el.textContent?.trim();
          if (text && /Something went wrong|Cannot read|Error|toFixed/i.test(text) && el.children.length === 0) {
            results.push({ text: text.substring(0, 150), tag: el.tagName });
          }
        }
        return results;
      })()
    };
  });
  console.log('  Error elements:');
  tradeError.errorElements.forEach(e => console.log(`    <${e.tag}> "${e.text}"`));

  // ─── STATIC PAGES: check for navigation links ───
  console.log('\n=== STATIC PAGES NAV CHECK ===');
  for (const pg of ['/privacy', '/terms', '/risk', '/docs']) {
    await page.goto(`${BASE}${pg}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const pageCheck = await page.evaluate(() => {
      // Check for "Back to AlphaDesk" link
      const backLink = document.querySelector('a[href="/"], a[href="/login"]');
      const footer = document.querySelector('footer');
      const nav = document.querySelector('nav, header');

      return {
        hasBackLink: !!backLink,
        backLinkText: backLink?.textContent?.trim(),
        hasFooter: !!footer,
        footerText: footer?.textContent?.trim().substring(0, 100),
        hasNav: !!nav,
        title: document.title,
        h1Text: document.querySelector('h1')?.textContent?.trim(),
        bodyHasYear: document.body.innerText.includes('2026') || document.body.innerText.includes('2025')
      };
    });
    console.log(`\n  ${pg}:`);
    console.log(`    Title: ${pageCheck.title}`);
    console.log(`    H1: ${pageCheck.h1Text}`);
    console.log(`    Back link: ${pageCheck.hasBackLink} ("${pageCheck.backLinkText}")`);
    console.log(`    Footer: ${pageCheck.hasFooter} ("${pageCheck.footerText}")`);
    console.log(`    Has year: ${pageCheck.bodyHasYear}`);
  }

  // ─── DASHBOARD: Bottom section detail ───
  console.log('\n=== DASHBOARD BOTTOM SECTIONS ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  await snap('86_dashboard_bottom_detail');

  // Check sector heatmap labels
  const sectorLabels = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.y > 1380 && rect.y < 1600 && el.children.length === 0) {
        const text = el.textContent?.trim();
        if (text && text.length > 0 && text.length < 30) {
          const cs = window.getComputedStyle(el);
          results.push({
            text,
            fontSize: cs.fontSize,
            color: cs.color,
            overflow: cs.overflow,
            textOverflow: cs.textOverflow,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
          });
        }
      }
    }
    return results;
  });
  console.log('  Sector heatmap labels:');
  sectorLabels.forEach(l => {
    if (l.rect.w < 50 || l.textOverflow === 'ellipsis') {
      console.log(`    [POSSIBLY TRUNCATED] "${l.text}" w=${l.rect.w} size=${l.fontSize} overflow=${l.overflow} textOverflow=${l.textOverflow}`);
    } else {
      console.log(`    "${l.text}" w=${l.rect.w} size=${l.fontSize}`);
    }
  });

  // ─── Check PEAD card shows +4.80% not +0.00% ───
  console.log('\n=== VERIFY PEAD CARD VALUE ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Find all percentage values in strategy card area
  const stratPcts = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.x > 1100 && el.children.length === 0) {
        const text = el.textContent?.trim();
        if (text && /^[+-]?\d+\.\d+%$/.test(text)) {
          const cs = window.getComputedStyle(el);
          results.push({
            text,
            color: cs.color,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y) }
          });
        }
      }
    }
    return results;
  });
  console.log('  Strategy card percentages:');
  stratPcts.forEach(p => console.log(`    "${p.text}" color=${p.color} at (${p.rect.x}, ${p.rect.y})`));

  await browser.close();
  console.log('\n=== FINAL AUDIT COMPLETE ===');
})();
