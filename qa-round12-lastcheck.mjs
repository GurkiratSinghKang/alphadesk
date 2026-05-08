import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round12';
const BASE_URL = 'https://tradingalpha.net';

function log(msg) { console.log(`[INFO] ${msg}`); }

async function ss(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Login
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  const inputs = await page.$$('input');
  await inputs[0].fill(QA_USERNAME);
  await inputs[1].fill(getQaPassword());
  await page.click('button:has-text("Sign In")');
  await page.waitForTimeout(5000);

  // ===== 1: NVDA via command palette - verify chart header =====
  log('\n=== Command Palette -> NVDA -> Chart Update Check ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Record initial chart header
  const initialHeader = await page.evaluate(() => {
    // Get the main chart symbol text near top
    const body = document.body.innerText;
    const match = body.match(/(?:Trade\n.*\n)([A-Z]{2,5})\s*[\$·]/s) || body.match(/^([A-Z]{2,5})\s*\$/m);
    return {
      text: body.substring(0, 600),
      matchedSymbol: match ? match[1] : null,
    };
  });
  log(`Initial chart header symbol: ${initialHeader.matchedSymbol}`);

  // Open command palette
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(1000);

  // Find the input in the palette dialog
  const dialogInput = await page.$('[role="dialog"] input, [data-slot="dialog"] input, [class*="cmdk"] input');
  if (dialogInput) {
    await dialogInput.fill('NVDA');
    await page.waitForTimeout(1500);

    // Click NVDA result - need to find the one that says "NVDA" directly, not the ETFs
    const results = await page.$$('[role="option"]');
    log(`Command palette results: ${results.length}`);

    for (const r of results) {
      const text = await r.textContent();
      if (text.includes('Nvidia Corp') || (text.startsWith('NVDA') && !text.includes('ETF'))) {
        log(`Clicking: "${text.trim().substring(0, 50)}"`);
        // Use force click since the overlay might intercept
        await r.evaluate(el => el.click());
        break;
      }
    }

    await page.waitForTimeout(4000);
    await ss(page, 'lastcheck-01-after-nvda-select');

    const afterNvda = await page.evaluate(() => {
      const body = document.body.innerText;
      // Look for the chart header symbol - should be near "Trade" nav
      const headerMatch = body.match(/([A-Z]{2,5})\s*\$[\d,.]+\s*[+-]?[\d,.]+/);
      return {
        url: window.location.href,
        headerSymbol: headerMatch ? headerMatch[1] : null,
        first500: body.substring(0, 500),
      };
    });

    log(`After NVDA select - URL: ${afterNvda.url}`);
    log(`After NVDA select - Chart header symbol: ${afterNvda.headerSymbol}`);

    if (afterNvda.headerSymbol === 'SPY' || afterNvda.headerSymbol === initialHeader.matchedSymbol) {
      log('** BUG: Chart did NOT update to NVDA after command palette selection **');
    } else if (afterNvda.headerSymbol === 'NVDA') {
      log('Chart correctly updated to NVDA');
    } else {
      log(`Chart shows ${afterNvda.headerSymbol} (unknown state)`);
    }
  } else {
    log('Could not find command palette input');
  }

  // Close any overlay
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ===== 2: Click NVDA in watchlist directly =====
  log('\n=== Watchlist Click -> NVDA ===');
  try {
    // Find NVDA text in the watchlist on left side
    const watchlistItems = await page.$$('[class*="watchlist"] [role="button"], [class*="watchlist"] tr, [class*="watchlist"] li');
    log(`Watchlist items: ${watchlistItems.length}`);

    // Try clicking the NVDA row in the watchlist
    const nvdaRow = await page.$('text=NVDA >> xpath=ancestor::*[contains(@class,"cursor") or @role="button"]');
    if (!nvdaRow) {
      // Try a broader approach - find elements near NVDA text
      const allClickables = await page.evaluate(() => {
        const nvdaEls = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent.trim() === 'NVDA') {
            const parent = walker.currentNode.parentElement;
            if (parent) {
              const rect = parent.getBoundingClientRect();
              nvdaEls.push({
                tag: parent.tagName,
                text: parent.textContent.substring(0, 50),
                x: rect.x, y: rect.y, w: rect.width, h: rect.height,
                cursor: window.getComputedStyle(parent).cursor,
              });
            }
          }
        }
        return nvdaEls;
      });
      log(`NVDA elements: ${JSON.stringify(allClickables)}`);

      // Click the first one with cursor:pointer
      for (const el of allClickables) {
        if (el.cursor === 'pointer' || el.tag === 'BUTTON' || el.tag === 'A') {
          await page.click(`text=NVDA`, { position: { x: 5, y: 5 } });
          await page.waitForTimeout(4000);
          break;
        }
      }
    } else {
      await nvdaRow.click();
      await page.waitForTimeout(4000);
    }

    await ss(page, 'lastcheck-02-watchlist-nvda');
    const afterWatchlistClick = await page.evaluate(() => {
      const body = document.body.innerText;
      const match = body.match(/([A-Z]{2,5})\s*\$[\d,.]+\s*[+-]?[\d,.]+/);
      return match ? match[1] : null;
    });
    log(`After watchlist NVDA click, chart shows: ${afterWatchlistClick}`);
  } catch (e) {
    log(`Watchlist NVDA: ${e.message}`);
  }

  // ===== 3: Strategy detail page breadcrumb =====
  log('\n=== Strategy Page Breadcrumb ===');
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  const breadcrumbs = await page.evaluate(() => {
    const allLinks = document.querySelectorAll('a');
    const crumbs = [];
    allLinks.forEach(l => {
      const text = l.textContent.trim();
      const href = l.getAttribute('href') || '';
      if (text.includes('Dashboard') || text.includes('Back') || href === '/' || text.includes('Home')) {
        crumbs.push({ text, href });
      }
    });
    // Also check the actual breadcrumb-like text at the top
    const body = document.body.innerText;
    const bcMatch = body.match(/(?:←|<|Back|Dashboard).*?(?=\n)/);
    return { crumbs, breadcrumbText: bcMatch ? bcMatch[0] : null, pageHeader: body.substring(0, 300) };
  });
  log(`Breadcrumbs: ${JSON.stringify(breadcrumbs.crumbs)}`);
  log(`Breadcrumb text: ${breadcrumbs.breadcrumbText}`);
  log(`Page header: ${breadcrumbs.pageHeader.substring(0, 200)}`);

  // Check "Dashboard" in the nav/breadcrumb
  const hasDashboardLink = await page.$('a[href="/"]');
  log(`Has link to /: ${!!hasDashboardLink}`);

  // ===== 4: Try submitting a limit order =====
  log('\n=== Limit Order Submission ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  try {
    // Click Order tab
    await page.click('button:has-text("Order")');
    await page.waitForTimeout(1000);

    // Set to Limit order
    const orderTypeSelect = await page.$('select');
    if (orderTypeSelect) {
      // Check current options
      const options = await orderTypeSelect.evaluate(el => Array.from(el.options).map(o => o.text));
      log(`Order type options: ${JSON.stringify(options)}`);
    }

    // Click Limit button/option
    const limitBtn = await page.$('button:has-text("Limit")');
    if (limitBtn) {
      await limitBtn.click();
      await page.waitForTimeout(500);
    }

    // Set quantity
    const qtyInput = await page.$('#order-quantity');
    if (qtyInput) {
      await qtyInput.fill('1');
      await page.waitForTimeout(300);
    }

    // Set limit price
    const priceInput = await page.$('#order-price');
    if (priceInput) {
      await priceInput.fill('250');
      await page.waitForTimeout(300);
    }

    await ss(page, 'lastcheck-03-limit-order-filled');

    // Find and click the submit button (green Buy button)
    const submitBtn = await page.$('button:has-text("Buy 1")');
    if (!submitBtn) {
      // Try the general buy button
      const buyButton = await page.$('button[class*="bg-emerald"], button[class*="green"], button:has-text("Buy")');
      if (buyButton) {
        const btnText = await buyButton.textContent();
        log(`Submit button text: "${btnText.trim()}"`);
        await buyButton.click();
        await page.waitForTimeout(3000);
        await ss(page, 'lastcheck-04-order-submitted');
        log('Order submitted');

        // Check for success/error toast
        const toast = await page.evaluate(() => {
          const toasts = document.querySelectorAll('[class*="toast"], [class*="Toast"], [role="alert"], [class*="notification"]');
          return Array.from(toasts).map(t => t.textContent.trim());
        });
        log(`Toast messages: ${JSON.stringify(toast)}`);
      }
    } else {
      await submitBtn.click();
      await page.waitForTimeout(3000);
      await ss(page, 'lastcheck-04-order-submitted');
      log('Limit order submitted');
    }

    // Check Orders tab for the new order
    const ordersTab = await page.$('button:has-text("Orders")');
    if (ordersTab) {
      await ordersTab.click();
      await page.waitForTimeout(1000);
      await ss(page, 'lastcheck-05-orders-tab');

      const orders = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        return Array.from(rows).map(row => {
          const cells = row.querySelectorAll('td');
          return Array.from(cells).map(c => c.textContent.trim());
        });
      });
      log(`Orders: ${JSON.stringify(orders.slice(0, 5))}`);
    }
  } catch (e) {
    log(`Limit order: ${e.message}`);
  }

  // ===== 5: Settings page - does it actually show settings or just dashboard? =====
  log('\n=== Settings Page Behavior ===');
  // Earlier test showed Settings click goes to / (dashboard).
  // Let's verify: does it open a modal or navigate to a page?
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  try {
    // Click the profile "A" button
    const avatarBtn = await page.$('button:has-text("A"):not([class*="tab"])');
    const allBtns = await page.$$('button');
    for (const btn of allBtns) {
      const text = (await btn.textContent()).trim();
      const width = await btn.evaluate(el => el.getBoundingClientRect().width);
      if (text === 'A' && width < 50) {
        await btn.click();
        await page.waitForTimeout(500);

        // Click Settings
        const settingsItem = await page.$('[role="menuitem"]:has-text("Settings")');
        if (settingsItem) {
          // Track navigation/modal appearance
          const beforeUrl = page.url();
          await settingsItem.click();
          await page.waitForTimeout(2000);
          const afterUrl = page.url();

          // Check if a settings modal/dialog appeared
          const settingsDialog = await page.evaluate(() => {
            const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="settings"]');
            return {
              dialogCount: dialogs.length,
              texts: Array.from(dialogs).map(d => d.textContent.substring(0, 100)),
            };
          });

          log(`Settings: beforeUrl=${beforeUrl}, afterUrl=${afterUrl}`);
          log(`Settings dialogs: ${JSON.stringify(settingsDialog)}`);
          await ss(page, 'lastcheck-06-settings');

          if (beforeUrl === afterUrl && settingsDialog.dialogCount === 0) {
            log('** Settings click does nothing visible - no page change or modal **');
          }
        }
        break;
      }
    }
  } catch (e) {
    log(`Settings: ${e.message}`);
  }

  // ===== 6: NVDA text in strategy page breadcrumb =====
  log('\n=== Confirm strategy pages have "Dashboard" breadcrumb ===');
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await ss(page, 'lastcheck-07-strategy-breadcrumb');

  const bcInfo = await page.evaluate(() => {
    const body = document.body.innerText.substring(0, 150);
    // Check for "Dashboard" text that's a link
    const dashLink = document.querySelector('a[href="/"]');
    const allLinks = document.querySelectorAll('a');
    const navLinks = Array.from(allLinks).filter(l => {
      const href = l.getAttribute('href') || '';
      return href === '/' || href.includes('dashboard');
    });
    return {
      topText: body,
      dashLink: dashLink ? { text: dashLink.textContent, href: dashLink.getAttribute('href') } : null,
      navLinksToHome: navLinks.map(l => ({ text: l.textContent.trim().substring(0, 30), href: l.getAttribute('href') })),
    };
  });
  log(`Strategy page top: ${bcInfo.topText.substring(0, 100)}`);
  log(`Dashboard link: ${JSON.stringify(bcInfo.dashLink)}`);
  log(`All nav links to home: ${JSON.stringify(bcInfo.navLinksToHome)}`);

  await browser.close();
  log('\nLast check complete.');
})();
