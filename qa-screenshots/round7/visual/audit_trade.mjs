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

  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

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

  // ─── TRADE PAGE: Multiple attempts ───
  console.log('\n=== TRADE PAGE: Attempt 1 ===');
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  const tradeState1 = await page.evaluate(() => {
    const hasError = document.body.innerText.includes('Something went wrong');
    return { hasError, text: document.body.innerText.substring(0, 300) };
  });
  console.log(`  Error: ${tradeState1.hasError}`);
  await snap('90_trade_attempt1');

  if (tradeState1.hasError) {
    console.log('  Clicking Try Again...');
    const tryAgainBtn = await page.$('button:has-text("Try Again")');
    if (tryAgainBtn) {
      await tryAgainBtn.click();
      await page.waitForTimeout(5000);
      await snap('91_trade_after_retry');
    }
  }

  // If trade page loaded, let's examine it
  const tradeLoaded = await page.evaluate(() => {
    return !document.body.innerText.includes('Something went wrong');
  });

  if (tradeLoaded) {
    console.log('\n=== TRADE PAGE LOADED - DETAILED INSPECTION ===');

    // Check for issues on the trade page
    const tradeIssues = await page.evaluate(() => {
      const results = [];
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        const text = el.textContent?.trim();
        if (text && el.children.length === 0 && text.length < 80) {
          if (/undefined|null|NaN|\[object|demoLabel/i.test(text)) {
            results.push({ text, tag: el.tagName, class: el.className?.substring(0, 50) });
          }
        }
      }
      return results;
    });
    console.log(`  Code artifact issues: ${tradeIssues.length}`);
    tradeIssues.forEach(i => console.log(`    "${i.text}" <${i.tag}>`));

    // Check the watchlist panel
    await page.screenshot({
      path: join(DIR, '92_trade_watchlist.png'),
      clip: { x: 0, y: 0, width: 200, height: 1080 }
    });
    console.log('  [SNAP] 92_trade_watchlist.png');

    // Check the chart area
    await page.screenshot({
      path: join(DIR, '93_trade_chart.png'),
      clip: { x: 200, y: 0, width: 1100, height: 600 }
    });
    console.log('  [SNAP] 93_trade_chart.png');

    // Check the order/options panel
    await page.screenshot({
      path: join(DIR, '94_trade_right_panel.png'),
      clip: { x: 1300, y: 0, width: 620, height: 1080 }
    });
    console.log('  [SNAP] 94_trade_right_panel.png');

    // Check the bottom section (options chain / positions)
    await page.screenshot({
      path: join(DIR, '95_trade_bottom.png'),
      clip: { x: 0, y: 600, width: 1300, height: 480 }
    });
    console.log('  [SNAP] 95_trade_bottom.png');

    // Check the ticker header area
    await page.screenshot({
      path: join(DIR, '96_trade_ticker_header.png'),
      clip: { x: 0, y: 20, width: 600, height: 50 }
    });
    console.log('  [SNAP] 96_trade_ticker_header.png');

    // Check P&L and position labels
    const tradePnlItems = await page.evaluate(() => {
      const results = [];
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        const text = el.textContent?.trim();
        if (text && el.children.length === 0) {
          // P&L values
          if (/^-?\$\d/.test(text) || /loss|gain|profit/i.test(text)) {
            const cs = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
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
    console.log('  P&L values on trade page:');
    tradePnlItems.forEach(p => console.log(`    "${p.text}" color=${p.color} at (${p.rect.x}, ${p.rect.y})`));

  } else {
    console.log('\n  Trade page still showing error.');

    // Navigate directly and try a few more times
    console.log('\n=== TRADE: Hard refresh attempt ===');
    await page.goto(`${BASE}/trade`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    await snap('91_trade_hard_refresh');

    const tradeState2 = await page.evaluate(() => {
      return { hasError: document.body.innerText.includes('Something went wrong'), text: document.body.innerText.substring(0, 300) };
    });
    console.log(`  Still error: ${tradeState2.hasError}`);
  }

  // ─── DASHBOARD: Check the "Regime" value for consistency ───
  console.log('\n=== REGIME BAR CHECK ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const regimeData = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    const results = [];
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text && el.children.length === 0 && /Bull|Bear|Neutral|Regime/i.test(text) && text.length < 50) {
        const rect = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        results.push({ text, color: cs.color, rect: { x: Math.round(rect.x), y: Math.round(rect.y) } });
      }
    }
    return results;
  });
  console.log('  Regime elements:');
  regimeData.forEach(r => console.log(`    "${r.text}" color=${r.color} at (${r.rect.x}, ${r.rect.y})`));

  // ─── DOCS: check for missing footer ───
  console.log('\n=== DOCS FOOTER CHECK ===');
  await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await snap('97_docs_bottom');

  // Check all links in docs page
  const docsLinks = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    return Array.from(links).map(l => ({
      text: l.textContent?.trim().substring(0, 50),
      href: l.getAttribute('href'),
      broken: false
    }));
  });
  console.log('  Docs page links:');
  docsLinks.forEach(l => console.log(`    "${l.text}" -> ${l.href}`));

  // ─── DASHBOARD: PEAD card shows "+0.00%" check ───
  console.log('\n=== PEAD CARD RETURN VALUE CHECK ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Earlier we saw PEAD card shows "+4.80%" but the earlier screenshot 61 shows "+0.00%"
  // Let me recheck - it may have changed with live data
  const peadCardCheck = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent?.trim();
      if (text && text.startsWith('PEAD') && el.children.length >= 2) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 200 && rect.width < 400) {
          // Get all visible text in this card
          const spans = el.querySelectorAll('span, p, div');
          const texts = [];
          for (const s of spans) {
            if (s.children.length === 0 && s.textContent?.trim().length > 0) {
              texts.push({ text: s.textContent.trim(), color: window.getComputedStyle(s).color });
            }
          }
          return { cardText: text.substring(0, 100), children: texts };
        }
      }
    }
    return null;
  });
  console.log(`  PEAD card: ${JSON.stringify(peadCardCheck, null, 2)}`);

  // ─── Print all console errors ───
  console.log('\n=== ALL CONSOLE ERRORS ===');
  consoleErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e.substring(0, 200)}`));

  await browser.close();
  console.log('\n=== TRADE AUDIT COMPLETE ===');
})();
