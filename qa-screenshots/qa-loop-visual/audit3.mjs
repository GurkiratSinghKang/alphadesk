import { chromium } from 'playwright';
import { join } from 'path';

const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/qa-loop-visual';
const BASE = 'https://tradingalpha.net';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Login
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(1500);
  await page.locator('#login-username').fill('admin');
  await page.locator('#login-password').fill('alphaDesk2025!');
  await page.locator('button[type="submit"]').click();
  await sleep(3000);

  await page.evaluate(() => {
    localStorage.setItem('alphadesk-tour-complete', '1');
    localStorage.setItem('alphadesk-welcomed', '1');
  });
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  // --- SECTOR TREEMAP (in Market Context area) ---
  console.log('=> Sector Treemap in Market Context...');
  const sectorPerf = page.getByText('SECTOR PERFORMANCE').first();
  if (await sectorPerf.count() > 0) {
    await sectorPerf.scrollIntoViewIfNeeded();
    await sleep(500);
    const box = await sectorPerf.evaluate(e => {
      let node = e;
      for (let i = 0; i < 6; i++) {
        if (node.parentElement) node = node.parentElement;
        const cl = (node.className || '').toLowerCase();
        if (cl.includes('card') || cl.includes('paper') || cl.includes('context') || cl.includes('market')) break;
      }
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.screenshot({
      path: join(DIR, '09-sector-treemap-real.png'),
      clip: { x: Math.max(0, box.x - 5), y: Math.max(0, box.y - 5), width: Math.min(1440, box.width + 10), height: Math.min(900, box.height + 10) }
    });
    console.log(`  Captured sector area ${box.width}x${box.height}`);
  }

  // --- Full Market Context section ---
  console.log('=> Market Context section...');
  const mktCtx = page.getByText('Market Context').first();
  if (await mktCtx.count() > 0) {
    await mktCtx.scrollIntoViewIfNeeded();
    await sleep(500);
    const box = await mktCtx.evaluate(e => {
      let node = e;
      for (let i = 0; i < 8; i++) {
        if (node.parentElement) node = node.parentElement;
        const cl = (node.className || '').toLowerCase();
        if (cl.includes('card') || cl.includes('paper') || cl.includes('widget') || (node.offsetHeight > 300 && cl.includes('grid'))) break;
      }
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.screenshot({
      path: join(DIR, '09b-market-context.png'),
      clip: { x: Math.max(0, box.x - 5), y: Math.max(0, box.y - 5), width: Math.min(1440, box.width + 10), height: Math.min(900, box.height + 10) }
    });
  }

  // --- Stress Test (click to expand) ---
  console.log('=> Stress Test expand...');
  const stressBtn = page.getByText('Stress Test').first();
  if (await stressBtn.count() > 0) {
    await stressBtn.scrollIntoViewIfNeeded();
    await sleep(300);
    // Take before-click screenshot
    await page.screenshot({ path: join(DIR, '07b-stress-collapsed.png') });
    await stressBtn.click();
    await sleep(2000);
    await page.screenshot({ path: join(DIR, '07c-stress-expanded.png') });

    // Capture the expanded section
    const stressBox = await stressBtn.evaluate(e => {
      let node = e;
      for (let i = 0; i < 10; i++) {
        if (node.parentElement) node = node.parentElement;
        if (node.offsetHeight > 200) break;
      }
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    if (stressBox.height > 50) {
      await page.screenshot({
        path: join(DIR, '07d-stress-expanded-closeup.png'),
        clip: { x: Math.max(0, stressBox.x - 5), y: Math.max(0, stressBox.y - 5), width: Math.min(1440, stressBox.width + 10), height: Math.min(1200, stressBox.height + 10) }
      });
    }
  }

  // --- Footer ---
  console.log('=> Footer...');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(1000);
  // Check for footer element
  const footerEl = await page.locator('footer, [class*="footer"], [class*="Footer"]').first();
  if (await footerEl.count() > 0) {
    const fBox = await footerEl.boundingBox();
    if (fBox) {
      await page.screenshot({
        path: join(DIR, '11b-footer-closeup.png'),
        clip: { x: fBox.x, y: Math.max(0, fBox.y - 5), width: fBox.width, height: fBox.height + 10 }
      });
      console.log(`  Footer found: ${fBox.width}x${fBox.height} at y=${fBox.y}`);
    }
  } else {
    console.log('  No footer element found, checking text...');
    const footerText = page.getByText('AlphaDesk v').first();
    if (await footerText.count() > 0) {
      await footerText.scrollIntoViewIfNeeded();
      const fBox = await footerText.boundingBox();
      await page.screenshot({
        path: join(DIR, '11b-footer-closeup.png'),
        clip: { x: 0, y: Math.max(0, fBox.y - 10), width: 1440, height: 50 }
      });
    }
  }

  // --- Scroll to very bottom and take screenshot ---
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(500);
  await page.screenshot({ path: join(DIR, '11c-bottom-of-page.png') });

  // --- Check if market breadth gauge has actual rendering ---
  console.log('=> Market Breadth gauge check...');
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);
  const breadth = page.getByText('Market Breadth').first();
  if (await breadth.count() > 0) {
    await breadth.scrollIntoViewIfNeeded();
    await sleep(500);
    const bBox = await breadth.evaluate(e => {
      let node = e;
      for (let i = 0; i < 10; i++) {
        if (node.parentElement) node = node.parentElement;
        const cl = (node.className || '').toLowerCase();
        if (cl.includes('card') || cl.includes('paper') || cl.includes('widget') || cl.includes('breadth')) break;
      }
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.screenshot({
      path: join(DIR, '06b-market-breadth-closeup.png'),
      clip: { x: Math.max(0, bBox.x - 5), y: Math.max(0, bBox.y - 5), width: Math.min(800, bBox.width + 10), height: Math.min(600, bBox.height + 10) }
    });
    console.log(`  Market breadth card: ${bBox.width}x${bBox.height}`);
  }

  // --- TRADE PAGE: multi-timeframe + options chain ATM ---
  console.log('=> Trade page details...');
  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(3000);

  // List all tabs
  const allBtns = await page.locator('button, [role="tab"]').all();
  const tabTexts = [];
  for (const b of allBtns) {
    const txt = await b.textContent().catch(() => '');
    if (txt && txt.trim().length > 0 && txt.trim().length < 30) tabTexts.push(txt.trim());
  }
  console.log('All buttons/tabs:', tabTexts.join(' | '));

  // Options chain: look for ATM row
  console.log('=> Options chain ATM highlight check...');
  const optionsArea = page.getByText('SPY Options').first();
  if (await optionsArea.count() > 0) {
    await optionsArea.scrollIntoViewIfNeeded();
    await sleep(500);
    const oBox = await optionsArea.evaluate(e => {
      let node = e;
      for (let i = 0; i < 8; i++) {
        if (node.parentElement) node = node.parentElement;
        if (node.offsetHeight > 200) break;
      }
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.screenshot({
      path: join(DIR, '14b-options-chain-closeup.png'),
      clip: { x: Math.max(0, oBox.x - 5), y: Math.max(0, oBox.y - 5), width: Math.min(1440, oBox.width + 10), height: Math.min(600, oBox.height + 10) }
    });
  }

  // Check chart header price vs chart
  const headerPrice = await page.locator('text=/\\$[0-9]+\\.[0-9]+/').first().textContent().catch(() => 'not found');
  console.log('Header price text:', headerPrice);

  // Try multi-timeframe tab
  for (const tabText of tabTexts) {
    if (tabText.toLowerCase().includes('multi') || tabText.toLowerCase().includes('timeframe') || tabText.toLowerCase().includes('analysis')) {
      console.log(`  Clicking tab: "${tabText}"`);
      await page.getByText(tabText, { exact: true }).first().click().catch(() => {});
      await sleep(2000);
      await page.screenshot({ path: join(DIR, `16-tab-${tabText.replace(/\s/g, '-').toLowerCase()}.png`) });
    }
  }

  // Check the "Analysis" tab specifically
  const analysisTab = page.getByText('Analysis', { exact: true }).first();
  if (await analysisTab.count() > 0) {
    await analysisTab.click();
    await sleep(2000);
    await page.screenshot({ path: join(DIR, '16-analysis-tab.png'), fullPage: true });
  }

  // Responsive trade page closer look
  console.log('=> Responsive trade 800px closer look...');
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);

  // Check for horizontal overflow
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  console.log(`  Horizontal overflow at 800px: ${hasOverflow}`);

  // Capture the nav bar at 800px
  await page.screenshot({ path: join(DIR, '18b-trade-800-top.png'), clip: { x: 0, y: 0, width: 800, height: 100 } });

  // Check dashboard overflow at 800px
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);
  const dashOverflow = await page.evaluate(() => {
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  console.log('  Dashboard 800px overflow:', JSON.stringify(dashOverflow));

  console.log('=> DONE');
  await browser.close();
})();
