import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import path from 'path';

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE = 'https://tradingalpha.net';
const SSDIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round7/workflows';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Login first
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  const inputs = await page.$$('input');
  for (const inp of inputs) {
    const type = await inp.getAttribute('type');
    if (type === 'password') await inp.fill(getQaPassword());
    else if (type === 'text' || type === 'email' || !type) await inp.fill(QA_USERNAME);
  }
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  // Get auth cookie
  const cookies = await context.cookies();
  const authCookie = cookies.find(c => c.name === 'access_token');
  console.log('Auth cookie:', authCookie ? `found (${authCookie.value.substring(0, 20)}...)` : 'NOT FOUND');

  // Test the bars API directly
  console.log('\n=== TESTING API ENDPOINTS ===');

  // Test bars endpoint
  const barsResp = await page.evaluate(async () => {
    try {
      const resp = await fetch('/api/v1/market/bars/SPY?timeframe=1d&limit=10', { credentials: 'include' });
      const text = await resp.text();
      return { status: resp.status, body: text.substring(0, 1000) };
    } catch (e) {
      return { status: -1, body: e.message };
    }
  });
  console.log(`Bars API: status=${barsResp.status}`);
  console.log(`Bars response: ${barsResp.body}`);

  // Test quotes endpoint
  const quoteResp = await page.evaluate(async () => {
    try {
      const resp = await fetch('/api/v1/market/quotes/SPY', { credentials: 'include' });
      const text = await resp.text();
      return { status: resp.status, body: text.substring(0, 500) };
    } catch (e) {
      return { status: -1, body: e.message };
    }
  });
  console.log(`\nQuote API: status=${quoteResp.status}`);
  console.log(`Quote response: ${quoteResp.body}`);

  // Navigate to /trade and capture all errors + network requests
  console.log('\n=== LOADING /trade PAGE ===');
  const networkLog = [];
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/')) {
      const body = await resp.text().catch(() => '(no body)');
      networkLog.push({ url: resp.url(), status: resp.status(), body: body.substring(0, 300) });
    }
  });

  const jsErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') jsErrors.push(msg.text());
  });

  page.on('pageerror', err => {
    jsErrors.push(`PAGE ERROR: ${err.message}`);
  });

  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));

  // Screenshot the error state
  await page.screenshot({ path: path.join(SSDIR, 'diag-trade-error.png'), fullPage: false });

  console.log('\nNetwork requests to API:');
  for (const req of networkLog) {
    console.log(`  ${req.status} ${req.url}`);
    console.log(`    ${req.body}`);
  }

  console.log('\nJS Errors:');
  for (const err of jsErrors) {
    console.log(`  ${err.substring(0, 200)}`);
  }

  // Try clicking "Try Again" button
  console.log('\n=== CLICKING TRY AGAIN ===');
  const tryAgainBtn = await page.$('button:has-text("Try Again")');
  if (tryAgainBtn) {
    // Clear errors
    jsErrors.length = 0;
    networkLog.length = 0;

    await tryAgainBtn.click();
    await new Promise(r => setTimeout(r, 5000));
    await page.screenshot({ path: path.join(SSDIR, 'diag-trade-retry.png'), fullPage: false });

    console.log('After retry - Network requests:');
    for (const req of networkLog) {
      console.log(`  ${req.status} ${req.url}`);
      console.log(`    ${req.body}`);
    }
    console.log('After retry - JS Errors:');
    for (const err of jsErrors) {
      console.log(`  ${err.substring(0, 200)}`);
    }
  }

  await browser.close();
})();
