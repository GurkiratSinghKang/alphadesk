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

  // Go to trade page
  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  // Find and click MTF tab
  console.log('=> Looking for MTF tab...');
  const mtfTab = page.getByText('MTF', { exact: true }).first();
  if (await mtfTab.count() > 0) {
    console.log('  Found MTF tab');
    await mtfTab.click();
    await sleep(2000);
    await page.screenshot({ path: join(DIR, '16-mtf-tab.png'), fullPage: true });

    // Closeup of the MTF area (right side panel)
    const mtfBox = await mtfTab.evaluate(e => {
      let node = e;
      for (let i = 0; i < 8; i++) {
        if (node.parentElement) node = node.parentElement;
        if (node.offsetHeight > 300) break;
      }
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.screenshot({
      path: join(DIR, '16b-mtf-closeup.png'),
      clip: { x: Math.max(0, mtfBox.x - 5), y: Math.max(0, mtfBox.y - 5), width: Math.min(1440, mtfBox.width + 10), height: Math.min(900, mtfBox.height + 10) }
    });
  } else {
    console.log('  MTF tab not found');
  }

  // Analysis tab content - right side tabs
  console.log('=> Right side panel tabs...');
  // The right side panel has tabs: Tech, Fund, Sent, Chat, Order, MTF
  const rightTabs = ['Tech', 'Fund', 'Sent', 'Chat', 'Order', 'MTF'];
  for (const tabName of rightTabs) {
    const tab = page.getByText(tabName, { exact: true }).first();
    if (await tab.count() > 0) {
      await tab.click();
      await sleep(1500);
      await page.screenshot({ path: join(DIR, `19-right-tab-${tabName.toLowerCase()}.png`) });
      console.log(`  Captured right tab: ${tabName}`);
    }
  }

  // Check if options chain has ATM row highlighted
  console.log('=> Checking ATM highlight in options chain...');
  // Get current SPY price from header
  const priceText = await page.evaluate(() => {
    const el = document.querySelector('[class*="price"], h1, h2');
    return el ? el.textContent : null;
  });
  console.log('  Price from page:', priceText);

  // Look for highlighted row in options chain
  const atmHighlighted = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr, [role="row"]');
    let highlightedRows = [];
    for (const row of rows) {
      const style = window.getComputedStyle(row);
      const bg = style.backgroundColor;
      // Check if the row has a distinctive background (highlighting)
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== 'rgb(0, 0, 0)') {
        const text = row.textContent.trim().substring(0, 100);
        if (text.match(/\d{3}/)) {
          highlightedRows.push({ bg, text: text.substring(0, 80) });
        }
      }
    }
    return highlightedRows.slice(0, 5);
  });
  console.log('  Highlighted rows:', JSON.stringify(atmHighlighted, null, 2));

  // Scroll options chain down to see ATM strike
  console.log('=> Scrolling options chain for more strikes...');
  const optionsTable = page.locator('table').first();
  if (await optionsTable.count() > 0) {
    // Scroll the options table area
    await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      for (const t of tables) {
        const parent = t.parentElement;
        if (parent && parent.scrollHeight > parent.clientHeight) {
          parent.scrollTop = parent.scrollHeight / 2;
        }
      }
    });
    await sleep(500);
    await page.screenshot({ path: join(DIR, '14c-options-scrolled.png') });
  }

  // Dashboard footer - explicitly search for it
  console.log('=> Dashboard footer check...');
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);

  // Dump the page bottom
  const bottomContent = await page.evaluate(() => {
    const body = document.body;
    const children = body.children;
    const last3 = [];
    for (let i = Math.max(0, children.length - 5); i < children.length; i++) {
      const el = children[i];
      last3.push({
        tag: el.tagName,
        class: el.className,
        text: el.textContent.trim().substring(0, 100),
        height: el.offsetHeight
      });
    }
    return last3;
  });
  console.log('  Bottom elements:', JSON.stringify(bottomContent, null, 2));

  // Also check the trade page footer
  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);
  const tradeFooter = await page.evaluate(() => {
    const footers = document.querySelectorAll('footer, [class*="footer"], [class*="Footer"]');
    const texts = [];
    footers.forEach(f => texts.push({ text: f.textContent.trim().substring(0, 100), visible: f.offsetHeight > 0 }));
    return texts;
  });
  console.log('  Trade page footers:', JSON.stringify(tradeFooter));

  // Final: take a bottom-of-page screenshot of trade page
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(500);
  await page.screenshot({ path: join(DIR, '11d-trade-footer.png') });

  console.log('=> DONE');
  await browser.close();
})();
