const puppeteer = require('puppeteer');
const path = require('path');

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round13';
const BASE_URL = 'https://tradingalpha.net';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();

  // Login
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  await page.type('input[type="text"], input[name="username"], input[placeholder*="ser"]', 'admin');
  await page.type('input[type="password"]', 'alphaDesk2025!');
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await sleep(3000);

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  // Check sector treemap container height
  const sectorHeight = await page.evaluate(() => {
    // Find the container that holds the treemap tiles
    const allDivs = document.querySelectorAll('div');
    for (const d of allDivs) {
      const text = d.innerText.trim();
      if (text.startsWith('Technology') && text.includes('Financials') && text.includes('NVDA') && !text.includes('MARKET INDICES')) {
        const rect = d.getBoundingClientRect();
        if (rect.height > 50 && rect.height < 300) {
          return { height: Math.round(rect.height), width: Math.round(rect.width) };
        }
      }
    }
    // Also check SECTOR PERFORMANCE as a whole section
    for (const d of allDivs) {
      const text = d.innerText.trim();
      if (text.startsWith('SECTOR PERFORMANCE') && text.length < 600) {
        const rect = d.getBoundingClientRect();
        return { height: Math.round(rect.height), width: Math.round(rect.width), text: text.substring(0, 100) };
      }
    }
    return null;
  });
  console.log('Sector treemap container:', JSON.stringify(sectorHeight));

  // Check the hover tooltip - it appears as a detail panel, not a standard tooltip
  // From the data: last element in tileSizes was a detail panel 125x83 with "Technology +2.13% today +0.90% YTD Leader: NVDA"
  // This confirms hover functionality works but uses inline panel not role="tooltip"

  // Check FOMC expand (we know it works: height went from 48 to 83.5 and description appeared)
  // "Federal Reserve policy decisions on interest rates. High impact on bonds, USD, and equities."

  // Check portfolio value from profile dropdown
  const profileVal = await page.evaluate(() => {
    const btn = document.querySelector('[aria-label="User menu"]');
    if (btn) btn.click();
    return true;
  });
  await sleep(1500);

  const menuData = await page.evaluate(() => {
    const items = document.querySelectorAll('[role="menuitem"], [data-slot="dropdown-menu-item"]');
    const texts = [];
    items.forEach(i => texts.push(i.innerText.trim()));

    // Look for equity in the menu area
    const body = document.body.innerText;
    const equityMatch = body.match(/Equity[:\s]*\$[\d,]+\.?\d*/i) || body.match(/Portfolio[:\s]*\$[\d,]+\.?\d*/i);

    // Check all text near "admin" in menu
    const menus = document.querySelectorAll('[role="menu"], [class*="dropdown-menu"]');
    const menuText = [];
    menus.forEach(m => menuText.push(m.innerText));

    return { items: texts, equityMatch: equityMatch ? equityMatch[0] : null, menuText };
  });
  console.log('Profile menu items:', JSON.stringify(menuData.items));
  console.log('Equity in menu:', menuData.equityMatch);
  console.log('Full menu text:', JSON.stringify(menuData.menuText));

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'verify-profile-menu.png'), fullPage: false });

  await browser.close();
})();
