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

  // Trade page
  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  // Right side tabs with force click
  const rightTabs = ['Tech', 'Fund', 'Sent', 'Chat', 'Order', 'MTF'];
  for (const tabName of rightTabs) {
    try {
      const tab = page.getByText(tabName, { exact: true }).first();
      if (await tab.count() > 0) {
        await tab.click({ force: true, timeout: 5000 });
        await sleep(1500);
        await page.screenshot({ path: join(DIR, `19-right-tab-${tabName.toLowerCase()}.png`) });
        console.log(`  Captured right tab: ${tabName}`);
      }
    } catch (e) {
      console.log(`  Error on tab ${tabName}: ${e.message.substring(0, 80)}`);
    }
  }

  // ATM highlight check via evaluation
  console.log('=> ATM strike check...');
  const atmInfo = await page.evaluate(() => {
    // Find all rows in options table area
    const tables = document.querySelectorAll('table');
    const result = { atmStrike: null, strikeRows: [], isHighlighted: false };

    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td, th');
        const cellTexts = [...cells].map(c => c.textContent.trim());
        const strikeCell = cellTexts.find(t => /^[0-9]{3}$/.test(t) || /^[0-9]{3,4}$/.test(t));
        if (strikeCell) {
          const bg = window.getComputedStyle(row).backgroundColor;
          const hasHighlight = row.classList.toString().toLowerCase().includes('atm') ||
            row.classList.toString().toLowerCase().includes('highlight') ||
            row.classList.toString().toLowerCase().includes('active');
          result.strikeRows.push({
            strike: strikeCell,
            bg: bg,
            classes: row.className.substring(0, 60),
            highlighted: hasHighlight
          });
          if (hasHighlight) {
            result.atmStrike = strikeCell;
            result.isHighlighted = true;
          }
        }
      }
    }
    return result;
  });
  console.log('ATM Info:', JSON.stringify(atmInfo, null, 2));

  // Dashboard: check for footer text
  console.log('=> Footer text check...');
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);

  const footerCheck = await page.evaluate(() => {
    // Search all text nodes for "AlphaDesk" footer text
    const allText = document.body.innerText;
    const lines = allText.split('\n');
    const footerLines = lines.filter(l => l.toLowerCase().includes('alphadesk') && (l.includes('v') || l.includes('powered') || l.includes('©')));

    // Also check for footer element
    const footerEls = document.querySelectorAll('footer');
    const footerData = [...footerEls].map(f => ({
      text: f.textContent.trim().substring(0, 100),
      visible: f.offsetHeight > 0,
      offsetTop: f.offsetTop,
      height: f.offsetHeight
    }));

    return { footerLines, footerElements: footerData, bodyScrollHeight: document.body.scrollHeight };
  });
  console.log('Footer check:', JSON.stringify(footerCheck, null, 2));

  // Scroll to absolute bottom and screenshot
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight + 1000));
  await sleep(1000);
  await page.screenshot({ path: join(DIR, '11e-absolute-bottom.png') });

  // Check for the "AlphaDesk v1.0" text anywhere
  const versionText = page.getByText('AlphaDesk v').first();
  if (await versionText.count() > 0) {
    await versionText.scrollIntoViewIfNeeded();
    await sleep(300);
    const vBox = await versionText.boundingBox();
    if (vBox) {
      console.log(`  Version text at: y=${vBox.y}, height=${vBox.height}`);
      await page.screenshot({
        path: join(DIR, '11f-version-text.png'),
        clip: { x: 0, y: Math.max(0, vBox.y - 20), width: 1440, height: 60 }
      });
    }
  }

  // Responsive: check which elements overflow at 800px
  console.log('=> Overflow analysis at 800px...');
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);

  const overflowElements = await page.evaluate(() => {
    const results = [];
    const all = document.querySelectorAll('*');
    const viewportWidth = window.innerWidth;
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.right > viewportWidth + 5 && rect.width > 50) {
        results.push({
          tag: el.tagName,
          class: (el.className || '').toString().substring(0, 80),
          width: Math.round(rect.width),
          right: Math.round(rect.right),
          overflow: Math.round(rect.right - viewportWidth),
          text: el.textContent.trim().substring(0, 40)
        });
      }
    }
    // Deduplicate by keeping only the most specific (smallest width)
    return results.sort((a, b) => a.width - b.width).slice(0, 10);
  });
  console.log('Overflow elements at 800px:', JSON.stringify(overflowElements, null, 2));

  // Trade page overflow at 800px
  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);

  const tradeOverflow = await page.evaluate(() => {
    const results = [];
    const all = document.querySelectorAll('*');
    const viewportWidth = window.innerWidth;
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.right > viewportWidth + 5 && rect.width > 50) {
        results.push({
          tag: el.tagName,
          class: (el.className || '').toString().substring(0, 80),
          width: Math.round(rect.width),
          right: Math.round(rect.right),
          overflow: Math.round(rect.right - viewportWidth)
        });
      }
    }
    return results.sort((a, b) => a.width - b.width).slice(0, 10);
  });
  console.log('Trade page overflow at 800px:', JSON.stringify(tradeOverflow, null, 2));

  console.log('=> DONE');
  await browser.close();
})();
