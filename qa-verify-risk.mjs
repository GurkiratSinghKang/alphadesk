import { chromium } from 'playwright';
import path from 'path';

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/final-sweep';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });

  // Check /risk directly (not logged in)
  console.log('--- Testing /risk (unauthenticated) ---');
  const resp1 = await page.goto('https://tradingalpha.net/risk', { waitUntil: 'networkidle', timeout: 15000 });
  console.log('Status:', resp1?.status());
  console.log('URL:', page.url());
  const text1 = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Content:', text1);
  await page.screenshot({ path: path.join(DIR, 'verify-risk-unauth.png'), fullPage: true });

  // Login first, then check /risk
  console.log('\n--- Logging in ---');
  await page.goto('https://tradingalpha.net', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.locator('#login-username').fill(QA_USERNAME);
  await page.locator('#login-password').fill(getQaPassword());
  await page.locator('button[type="submit"]').click({ force: true });
  await page.waitForTimeout(5000);

  console.log('\n--- Testing /risk (authenticated) ---');
  const resp2 = await page.goto('https://tradingalpha.net/risk', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);
  console.log('Status:', resp2?.status());
  console.log('URL:', page.url());
  const text2 = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Content:', text2);
  await page.screenshot({ path: path.join(DIR, 'verify-risk-auth.png'), fullPage: true });

  // Check if "loading" class items are visible or hidden
  console.log('\n--- Checking loading elements on analytics ---');
  await page.goto('https://tradingalpha.net/analytics', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(8000);
  const loadingEls = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const results = [];
    for (const el of all) {
      const cls = el.className?.toString?.() || '';
      if (cls.toLowerCase().includes('loading') || cls.toLowerCase().includes('spinner')) {
        const rect = el.getBoundingClientRect();
        results.push({
          tag: el.tagName,
          cls: cls.substring(0, 80),
          visible: rect.width > 0 && rect.height > 0 && el.offsetParent !== null,
          text: el.textContent?.trim()?.substring(0, 50),
          display: window.getComputedStyle(el).display,
          opacity: window.getComputedStyle(el).opacity
        });
      }
    }
    return results;
  });
  console.log('Loading elements:', JSON.stringify(loadingEls, null, 2));

  // Check strategy detail -- are strategies clickable on dashboard?
  console.log('\n--- Checking strategy clickability ---');
  await page.goto('https://tradingalpha.net/dashboard', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(4000);

  // Find strategy cards and check if they have onClick handlers
  const stratCards = await page.evaluate(() => {
    // Look for text that matches strategy names
    const allEls = document.querySelectorAll('*');
    const results = [];
    const stratNames = ['Momentum Alpha', 'Mean Reversion', 'Pair Trading', 'Alpha Trading', 'Charles Alpha', 'Swing Trading'];
    for (const el of allEls) {
      const text = el.textContent?.trim() || '';
      for (const name of stratNames) {
        if (text === name || (text.startsWith(name) && text.length < name.length + 20)) {
          const clickable = el.onclick !== null || el.closest('a') !== null || el.closest('button') !== null ||
                            el.closest('[role="button"]') !== null || el.style.cursor === 'pointer' ||
                            window.getComputedStyle(el).cursor === 'pointer';
          results.push({
            text: text.substring(0, 40),
            tag: el.tagName,
            clickable,
            cursor: window.getComputedStyle(el).cursor,
            parentTag: el.parentElement?.tagName,
            parentCls: el.parentElement?.className?.toString?.()?.substring(0, 60)
          });
          break;
        }
      }
    }
    return results;
  });
  console.log('Strategy cards:', JSON.stringify(stratCards, null, 2));

  await browser.close();
})();
