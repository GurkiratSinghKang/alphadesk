import { chromium } from 'playwright';
import { join } from 'path';

const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/qa-loop-visual';
const BASE = 'https://tradingalpha.net';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // ---- LOGIN ----
  console.log('=> Navigating to login...');
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);

  // Debug: dump all input elements
  const inputs = await page.evaluate(() => {
    return [...document.querySelectorAll('input')].map(i => ({
      type: i.type, name: i.name, id: i.id, placeholder: i.placeholder, class: i.className
    }));
  });
  console.log('Found inputs:', JSON.stringify(inputs, null, 2));

  // Try to fill using various selectors
  try {
    // Try by placeholder
    const userInput = await page.locator('input').first();
    const allInputs = await page.locator('input').all();
    console.log(`Total input count: ${allInputs.length}`);

    for (let i = 0; i < allInputs.length; i++) {
      const attrs = await allInputs[i].evaluate(el => ({
        type: el.type, name: el.name, placeholder: el.placeholder, id: el.id
      }));
      console.log(`  Input ${i}:`, JSON.stringify(attrs));
    }

    // Fill username - try the first text-like input
    for (const inp of allInputs) {
      const type = await inp.evaluate(el => el.type);
      if (type === 'text' || type === 'email' || type === '') {
        await inp.fill('admin');
        console.log('Filled username');
        break;
      }
    }

    // Fill password
    for (const inp of allInputs) {
      const type = await inp.evaluate(el => el.type);
      if (type === 'password') {
        await inp.fill('alphaDesk2025!');
        console.log('Filled password');
        break;
      }
    }

    // Click submit
    const submitBtn = await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")').first();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      console.log('Clicked submit');
    }

    await sleep(5000);
    console.log('Current URL after login:', page.url());
  } catch (e) {
    console.log('Login error:', e.message);
  }

  await page.screenshot({ path: join(DIR, '00-after-login.png'), fullPage: true });

  // Check if we're logged in
  const currentUrl = page.url();
  console.log('URL:', currentUrl);

  // If still on login page, try direct navigation
  if (currentUrl.includes('login')) {
    console.log('Still on login page, trying direct API login...');
    // Try API login
    const resp = await page.evaluate(async () => {
      const formData = new URLSearchParams();
      formData.append('username', 'admin');
      formData.append('password', 'alphaDesk2025!');
      const res = await fetch('/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });
      const data = await res.json();
      return { status: res.status, data };
    });
    console.log('API login response:', JSON.stringify(resp));

    if (resp.data && resp.data.access_token) {
      await page.evaluate((token) => {
        localStorage.setItem('token', token);
        localStorage.setItem('access_token', token);
      }, resp.data.access_token);
      console.log('Token saved to localStorage');
    }
  }

  // Set tour/welcome dismissal
  await page.evaluate(() => {
    localStorage.setItem('alphadesk-tour-complete', '1');
    localStorage.setItem('alphadesk-welcomed', '1');
  });

  // Navigate to dashboard
  console.log('=> Navigating to dashboard...');
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log('Nav error:', e.message));
  await sleep(4000);
  console.log('Dashboard URL:', page.url());

  // If redirected back to login, the token approach may have worked differently
  if (page.url().includes('login')) {
    console.log('Redirected to login. Trying cookie-based approach...');
    // Try setting token as cookie
    const resp2 = await page.evaluate(async () => {
      const formData = new URLSearchParams();
      formData.append('username', 'admin');
      formData.append('password', 'alphaDesk2025!');
      const res = await fetch('/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });
      return { status: res.status, text: await res.text() };
    });
    console.log('Second login attempt:', JSON.stringify(resp2));
  }

  await page.screenshot({ path: join(DIR, '01-dashboard-attempt.png'), fullPage: true });

  // ---- Helper to find and screenshot a section by text ----
  async function captureSection(searchTexts, filename) {
    for (const text of searchTexts) {
      try {
        const loc = page.getByText(text, { exact: false }).first();
        if (await loc.count() === 0) continue;

        await loc.scrollIntoViewIfNeeded();
        await sleep(500);

        const box = await loc.evaluate(e => {
          let node = e;
          for (let i = 0; i < 12; i++) {
            if (!node.parentElement) break;
            node = node.parentElement;
            const cl = (node.className || '').toLowerCase();
            const tag = node.tagName.toLowerCase();
            if (cl.includes('card') || cl.includes('widget') || cl.includes('panel') ||
                cl.includes('paper') || cl.includes('section') || cl.includes('grid-item') ||
                cl.includes('muipaper') || (tag === 'section') ||
                (node.dataset && node.dataset.grid)) {
              break;
            }
          }
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });

        if (box.width > 50 && box.height > 30) {
          await page.screenshot({
            path: join(DIR, filename),
            clip: {
              x: Math.max(0, Math.floor(box.x - 5)),
              y: Math.max(0, Math.floor(box.y - 5)),
              width: Math.min(1440, Math.ceil(box.width + 10)),
              height: Math.min(3000, Math.ceil(box.height + 10))
            }
          });
          console.log(`   Captured ${filename} (${Math.round(box.width)}x${Math.round(box.height)})`);
          return true;
        }
      } catch (e) {
        // continue to next text option
      }
    }
    console.log(`   Could not find section for ${filename}`);
    return false;
  }

  // ---- FULL DASHBOARD ----
  console.log('=> Full dashboard screenshot...');
  await page.screenshot({ path: join(DIR, '01-dashboard-full.png'), fullPage: true });

  // ---- SEGMENTED DASHBOARD ----
  console.log('=> Segmented dashboard screenshots...');
  const totalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`   Page height: ${totalHeight}px`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);

  const segments = Math.ceil(totalHeight / 800);
  for (let i = 0; i < Math.min(segments, 12); i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 800);
    await sleep(400);
    await page.screenshot({ path: join(DIR, `01-dash-seg-${String(i).padStart(2,'0')}.png`) });
  }

  // ---- INDIVIDUAL SECTIONS ----
  console.log('=> Capturing individual sections...');

  // Correlation Matrix
  await captureSection(['Correlation Matrix', 'Correlation', 'CORRELATION'], '02-correlation-matrix.png');

  // Strategy Cards
  await captureSection(['Strategy Performance', 'Strategies', 'Strategy', 'Active Strategies'], '03-strategy-cards.png');

  // Risk Dashboard
  await captureSection(['Risk Dashboard', 'Risk Overview', 'Risk Metrics', 'Portfolio Risk', 'Exposure'], '04-risk-dashboard.png');

  // Market Movers
  await captureSection(['Market Movers', 'Top Movers', 'Movers'], '05-market-movers.png');

  // Market Breadth
  await captureSection(['Market Breadth', 'Breadth', 'Advance/Decline'], '06-market-breadth.png');

  // Stress Test
  await captureSection(['Stress Test', 'Stress Scenarios', 'Scenario Analysis'], '07-stress-test.png');

  // P&L Attribution
  await captureSection(['P&L Attribution', 'PnL Attribution', 'P&L', 'Attribution', 'Profit & Loss'], '08-pnl-attribution.png');

  // Sector Treemap
  await captureSection(['Sector', 'Treemap', 'Sector Allocation', 'Sector Treemap'], '09-sector-treemap.png');

  // Ticker Tape
  console.log('=> Ticker tape (top area)...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await page.screenshot({ path: join(DIR, '10-ticker-tape.png'), clip: { x: 0, y: 0, width: 1440, height: 80 } });

  // Footer
  console.log('=> Footer (bottom area)...');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(1000);
  await page.screenshot({ path: join(DIR, '11-footer.png') });

  // ---- TRADE PAGE ----
  console.log('=> Navigating to trade page...');
  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  if (!page.url().includes('login')) {
    await page.screenshot({ path: join(DIR, '12-trade-full.png'), fullPage: true });

    // Segmented trade page
    const tradeHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let i = 0; i < Math.min(Math.ceil(tradeHeight / 800), 8); i++) {
      await page.evaluate((y) => window.scrollTo(0, y), i * 800);
      await sleep(400);
      await page.screenshot({ path: join(DIR, `12-trade-seg-${String(i).padStart(2,'0')}.png`) });
    }

    // Chart
    await captureSection(['Chart', 'Price Chart', 'TradingView'], '13-chart.png');

    // Options Chain
    await captureSection(['Options Chain', 'Options', 'Call', 'Put'], '14-options-chain.png');

    // Quick Order (B key)
    console.log('=> Testing B key...');
    await page.keyboard.press('b');
    await sleep(1500);
    await page.screenshot({ path: join(DIR, '15-quick-order.png') });
    await page.keyboard.press('Escape');
    await sleep(500);

    // Multi-timeframe
    console.log('=> Looking for multi-timeframe tab...');
    const allTabs = await page.locator('[role="tab"], button').all();
    for (const tab of allTabs) {
      const txt = await tab.textContent().catch(() => '');
      if (txt && (txt.toLowerCase().includes('multi') || txt.toLowerCase().includes('timeframe'))) {
        console.log(`   Found tab: "${txt}"`);
        await tab.click();
        await sleep(2000);
        await page.screenshot({ path: join(DIR, '16-multi-timeframe.png') });
        break;
      }
    }
  } else {
    console.log('Trade page redirected to login');
  }

  // ---- RESPONSIVE 800px ----
  console.log('=> Responsive test at 800px...');
  await page.setViewportSize({ width: 800, height: 600 });

  // Dashboard at 800px
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);
  await page.screenshot({ path: join(DIR, '17-responsive-dashboard-800.png'), fullPage: true });

  // Segments at 800px
  const respHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i < Math.min(Math.ceil(respHeight / 550), 10); i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 550);
    await sleep(400);
    await page.screenshot({ path: join(DIR, `17-resp-dash-seg-${String(i).padStart(2,'0')}.png`) });
  }

  // Trade at 800px
  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);
  if (!page.url().includes('login')) {
    await page.screenshot({ path: join(DIR, '18-responsive-trade-800.png'), fullPage: true });
    const trRespH = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let i = 0; i < Math.min(Math.ceil(trRespH / 550), 8); i++) {
      await page.evaluate((y) => window.scrollTo(0, y), i * 550);
      await sleep(400);
      await page.screenshot({ path: join(DIR, `18-resp-trade-seg-${String(i).padStart(2,'0')}.png`) });
    }
  }

  // ---- STRESS TEST INTERACTION ----
  console.log('=> Testing stress test expand...');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(2000);

  // Click on stress test scenario
  const stressItems = await page.getByText('Stress').all();
  for (const item of stressItems) {
    try {
      await item.scrollIntoViewIfNeeded();
      await item.click();
      await sleep(1000);
    } catch (e) {}
  }
  await page.screenshot({ path: join(DIR, '07-stress-test-expanded.png') });

  // ---- MARKET MOVERS TABS ----
  console.log('=> Testing Market Movers tabs...');
  const moversTabs = ['Gainers', 'Losers', 'Active', 'Most Active'];
  for (const tabName of moversTabs) {
    try {
      const tab = page.getByText(tabName, { exact: true }).first();
      if (await tab.count() > 0) {
        await tab.scrollIntoViewIfNeeded();
        await tab.click();
        await sleep(800);
        await page.screenshot({ path: join(DIR, `05-movers-${tabName.toLowerCase()}.png`) });
        console.log(`   Captured movers tab: ${tabName}`);
      }
    } catch (e) {}
  }

  console.log('=> AUDIT COMPLETE');
  await browser.close();
})();
