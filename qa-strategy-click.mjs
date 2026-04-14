import { chromium } from 'playwright';
import path from 'path';

const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/final-sweep';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });

  // Login
  await page.goto('https://tradingalpha.net', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.locator('#login-username').fill('admin');
  await page.locator('#login-password').fill('alphaDesk2025!');
  await page.locator('button[type="submit"]').click({ force: true });
  await page.waitForTimeout(5000);

  // Go to dashboard
  await page.goto('https://tradingalpha.net/dashboard', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(4000);

  // Click on a strategy card
  console.log('Looking for strategy to click...');
  const strategyCard = page.locator('p:has-text("Mean Reversion")').first();
  await strategyCard.click();
  await page.waitForTimeout(3000);

  console.log('URL after click:', page.url());
  const text = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Page content after click:', text);
  await page.screenshot({ path: path.join(DIR, 'verify-strategy-click.png'), fullPage: true });

  // Also check: does the dashboard have a strategy toggle?
  await page.goto('https://tradingalpha.net/dashboard', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(4000);

  // Look for any toggle/switch/view-mode buttons
  const toggleElements = await page.evaluate(() => {
    const all = document.querySelectorAll('button, [role="switch"], [role="checkbox"], input[type="checkbox"]');
    return Array.from(all).filter(el => {
      const text = (el.textContent || '').toLowerCase();
      const cls = (el.className?.toString?.() || '').toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      return text.includes('compact') || text.includes('expand') || text.includes('view') || text.includes('grid') || text.includes('list') ||
             cls.includes('toggle') || cls.includes('switch') || cls.includes('view-mode') ||
             aria.includes('toggle') || aria.includes('view') ||
             el.getAttribute('role') === 'switch';
    }).map(el => ({
      tag: el.tagName,
      text: el.textContent?.trim()?.substring(0, 40),
      cls: el.className?.toString?.()?.substring(0, 60),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      type: el.type
    }));
  });
  console.log('\nToggle/switch elements on dashboard:', JSON.stringify(toggleElements, null, 2));

  // Check for position sizing on trade page
  await page.goto('https://tradingalpha.net/trade', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(5000);

  const tradeFullText = await page.evaluate(() => document.body.innerText);
  console.log('\nTrade page - position sizing related text:');
  const lines = tradeFullText.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().includes('siz') || line.toLowerCase().includes('calcul') || line.toLowerCase().includes('risk per')) {
      console.log('  ', line.trim());
    }
  }

  // Check trade page tabs more carefully
  const tradeTabs = await page.evaluate(() => {
    const tabs = document.querySelectorAll('[role="tab"], button');
    return Array.from(tabs).filter(t => {
      const text = t.textContent?.trim() || '';
      return ['Trade', 'Positions', 'Orders', 'Journal', 'Watchlist', 'Screener', 'Signals', 'Options'].some(
        tab => text === tab || text.startsWith(tab)
      );
    }).map(t => t.textContent?.trim()?.substring(0, 30));
  });
  console.log('\nTrade page tabs found:', tradeTabs);

  // Check alerts delete functionality
  await page.goto('https://tradingalpha.net/alerts', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(4000);
  const alertsFullText = await page.evaluate(() => document.body.innerText);
  console.log('\nAlerts page full text:');
  console.log(alertsFullText.substring(0, 800));

  // Look for delete icon (trash/x) even if no text says "delete"
  const deleteElements = await page.evaluate(() => {
    const all = document.querySelectorAll('button, [role="button"]');
    return Array.from(all).filter(el => {
      const cls = el.className?.toString?.() || '';
      const aria = el.getAttribute('aria-label') || '';
      const svg = el.querySelector('svg');
      return cls.includes('delete') || cls.includes('trash') || cls.includes('remove') ||
             aria.includes('delete') || aria.includes('remove') || aria.includes('trash') ||
             (svg && (svg.innerHTML.includes('path') && el.textContent?.trim() === ''));
    }).map(el => ({
      text: el.textContent?.trim()?.substring(0, 20),
      cls: el.className?.toString?.()?.substring(0, 60),
      ariaLabel: el.getAttribute('aria-label')
    }));
  });
  console.log('\nDelete-like elements on alerts:', JSON.stringify(deleteElements));

  await browser.close();
})();
