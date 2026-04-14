import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round14';
const BASE = 'https://tradingalpha.net';

function log(msg) { console.log(`[QA3] ${msg}`); }

async function screenshot(page, name, opts = {}) {
  const fpath = path.join(DIR, `${name}.png`);
  if (opts.fullPage) await page.screenshot({ path: fpath, fullPage: true });
  else if (opts.clip) await page.screenshot({ path: fpath, clip: opts.clip });
  else await page.screenshot({ path: fpath });
  log(`Screenshot: ${name}.png`);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  // Robust login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Debug: what inputs exist
  const loginForm = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.map(i => ({ type: i.type, name: i.name, placeholder: i.placeholder, id: i.id }));
  });
  log('Login form inputs: ' + JSON.stringify(loginForm));

  // Fill username
  const uInput = await page.$('input[placeholder*="username" i], input[placeholder*="user" i], input[type="text"], input[name="username"]');
  if (uInput) {
    await uInput.click({ clickCount: 3 });
    await page.keyboard.type('admin');
  }

  // Fill password
  const pInput = await page.$('input[type="password"], input[name="password"], input[placeholder*="password" i]');
  if (pInput) {
    await pInput.click({ clickCount: 3 });
    await page.keyboard.type('alphaDesk2025!');
  }

  // Debug: what buttons exist
  const loginBtns = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.map(b => ({ text: b.textContent.trim(), type: b.type, disabled: b.disabled }));
  });
  log('Login buttons: ' + JSON.stringify(loginBtns));

  // Click Sign In button
  const signInClicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes('sign in') || text.includes('login') || text.includes('log in')) {
        btn.click();
        return btn.textContent.trim();
      }
    }
    // Fallback: click first button
    if (btns.length > 0) {
      btns[0].click();
      return 'fallback: ' + btns[0].textContent.trim();
    }
    return null;
  });
  log('Clicked: ' + signInClicked);

  // Wait for navigation
  await new Promise(r => setTimeout(r, 5000));
  log('After login URL: ' + page.url());

  // If still on login, try submitting the form directly
  if (page.url().includes('/login')) {
    log('Still on login, trying form submit...');
    await page.evaluate(() => {
      const form = document.querySelector('form');
      if (form) form.submit();
    });
    await new Promise(r => setTimeout(r, 3000));
    log('After form submit URL: ' + page.url());
  }

  // If still on login, try keyboard Enter
  if (page.url().includes('/login')) {
    log('Trying Enter key...');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 3000));
    log('After Enter URL: ' + page.url());
  }

  // Navigate to dashboard directly (cookie should be set)
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  log('Dashboard URL: ' + page.url());

  const isLoggedIn = !page.url().includes('/login');
  if (!isLoggedIn) {
    log('FATAL: Could not log in. Checking cookies...');
    const cookies = await page.cookies();
    log('Cookies: ' + JSON.stringify(cookies.map(c => c.name)));
    await screenshot(page, 'login-debug');
    await browser.close();
    return;
  }

  log('Successfully logged in!');

  // ====================================
  // TRADE PAGE - deep analysis
  // ====================================
  log('=== TRADE PAGE DEEP ===');
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  log('Trade page URL: ' + page.url());

  // Full page screenshot
  await screenshot(page, 'trade-deep-full', { fullPage: true });

  // List ALL visible buttons
  const allBtns = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns
      .filter(b => b.offsetParent !== null)
      .map(b => {
        const r = b.getBoundingClientRect();
        return {
          text: b.textContent.trim().substring(0, 40),
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
          bg: window.getComputedStyle(b).backgroundColor
        };
      });
  });
  log('ALL buttons on trade page:');
  allBtns.forEach(b => log(`  "${b.text}" at (${b.x},${b.y}) ${b.w}x${b.h} bg=${b.bg}`));

  // Check right sidebar tabs
  const sidebarInfo = await page.evaluate(() => {
    const body = document.body.innerText;
    // Look for text in the right sidebar area
    const rightEls = [];
    document.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.left > 1300 && r.top < 100 && el.textContent.trim().length < 20 && el.textContent.trim().length > 0) {
        rightEls.push({ text: el.textContent.trim(), tag: el.tagName, left: Math.round(r.left), top: Math.round(r.top) });
      }
    });
    // Deduplicate
    const seen = new Set();
    return rightEls.filter(e => {
      const key = e.text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  log('Right sidebar elements: ' + JSON.stringify(sidebarInfo));

  // Click "Order" tab in right sidebar
  const orderClicked = await page.evaluate(() => {
    const els = document.querySelectorAll('button, a, span, div');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const text = el.textContent.trim();
      if (r.left > 1300 && r.top < 100 && text === 'Order') {
        el.click();
        return true;
      }
    }
    // Try broader match
    for (const el of els) {
      const text = el.textContent.trim();
      if (text === 'Order' || text === '📋 Order') {
        el.click();
        return true;
      }
    }
    return false;
  });

  log('Order tab clicked: ' + orderClicked);
  await new Promise(r => setTimeout(r, 2000));
  await screenshot(page, 'trade-order-panel');

  // Now check for BUY/SELL buttons in order panel
  const orderPanelState = await page.evaluate(() => {
    const body = document.body.innerText;
    const rightText = [];
    document.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.left > 1200 && el.children.length === 0 && el.textContent.trim().length > 0 && el.textContent.trim().length < 30) {
        rightText.push(el.textContent.trim());
      }
    });
    return { uniqueText: [...new Set(rightText)] };
  });
  log('Order panel content: ' + JSON.stringify(orderPanelState.uniqueText));

  // Screenshot the right panel area
  await screenshot(page, 'trade-right-panel', { clip: { x: 1300, y: 0, width: 620, height: 1080 } });

  // Check bottom panel (Options chain area)
  const bottomPanel = await page.evaluate(() => {
    const els = [];
    document.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top > 650 && r.top < 700 && el.children.length === 0 && el.textContent.trim().length > 0 && el.textContent.trim().length < 20) {
        els.push({ text: el.textContent.trim(), left: Math.round(r.left), top: Math.round(r.top) });
      }
    });
    const seen = new Set();
    return els.filter(e => { if (seen.has(e.text)) return false; seen.add(e.text); return true; });
  });
  log('Bottom panel tabs: ' + JSON.stringify(bottomPanel));

  // Screenshot bottom panel
  await screenshot(page, 'trade-bottom-panel', { clip: { x: 0, y: 620, width: 1300, height: 460 } });

  // Options chain check
  const optionsData = await page.evaluate(() => {
    // Find options tab and click it
    const els = document.querySelectorAll('button, a, span, div');
    for (const el of els) {
      const text = el.textContent.trim();
      if (/^Options$|SPY Options/i.test(text)) {
        const r = el.getBoundingClientRect();
        if (r.top > 600) {
          el.click();
          return { clicked: text, top: r.top };
        }
      }
    }
    return null;
  });
  log('Options click: ' + JSON.stringify(optionsData));
  await new Promise(r => setTimeout(r, 2000));
  await screenshot(page, 'trade-options-chain');

  // Check ATM highlight
  const optionsLayout = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    let optionsTable = null;
    tables.forEach(t => {
      const headers = Array.from(t.querySelectorAll('th')).map(h => h.textContent.trim());
      if (headers.some(h => /strike|call|put|bid|ask/i.test(h))) {
        const rows = Array.from(t.querySelectorAll('tbody tr'));
        const rowData = rows.map(r => {
          const cls = typeof r.className === 'string' ? r.className : '';
          const bg = window.getComputedStyle(r).backgroundColor;
          const isHighlighted = cls.includes('atm') || cls.includes('highlight') || cls.includes('primary') ||
                                (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== 'rgb(0, 0, 0)' && bg !== 'rgb(15, 23, 42)' && bg !== 'rgb(30, 41, 59)');
          return {
            text: r.textContent.trim().substring(0, 40),
            highlighted: isHighlighted,
            bg,
            cls: cls.substring(0, 40)
          };
        });
        optionsTable = { headers, rowCount: rows.length, highlightedRows: rowData.filter(r => r.highlighted), sampleRows: rowData.slice(0, 3) };
      }
    });
    return optionsTable;
  });
  log('Options table: ' + JSON.stringify(optionsLayout));

  // Symbol switching verification
  log('=== SYMBOL SWITCHING ===');
  // Type in watchlist search
  const watchlistInput = await page.$('input[placeholder*="Add symbol" i], input[placeholder*="search" i], input[placeholder*="symbol" i]');
  if (watchlistInput) {
    await watchlistInput.click({ clickCount: 3 });
    await page.keyboard.type('AAPL');
    await new Promise(r => setTimeout(r, 1500));
    await screenshot(page, 'symbol-search-dropdown');

    // Check dropdown
    const dropdownItems = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="dropdown"] *, [class*="suggest"] *, [class*="result"] *, [role="option"], [role="listbox"] *');
      return Array.from(items).filter(i => i.children.length === 0 && i.textContent.trim().length > 0)
        .map(i => i.textContent.trim()).slice(0, 5);
    });
    log('Search dropdown items: ' + JSON.stringify(dropdownItems));

    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));
  }

  // Click AAPL in watchlist if present
  const aaplClicked = await page.evaluate(() => {
    const items = document.querySelectorAll('tr, li, div');
    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (r.left < 200 && r.top > 100 && /^AAPL/i.test(item.textContent.trim())) {
        item.click();
        return item.textContent.trim().substring(0, 30);
      }
    }
    return null;
  });
  log('Clicked AAPL in watchlist: ' + aaplClicked);
  await new Promise(r => setTimeout(r, 3000));

  // Verify header updated
  const headerAfterAAPL = await page.evaluate(() => {
    const els = document.querySelectorAll('h1, h2, h3, [class*="symbol"], [class*="ticker"]');
    for (const el of els) {
      if (el.textContent.includes('AAPL') || el.textContent.includes('$')) {
        return el.textContent.trim().substring(0, 50);
      }
    }
    return document.body.innerText.match(/[A-Z]{2,5}\s+\$[\d,.]+/)?.[0] || 'not found';
  });
  log('Header after AAPL click: ' + headerAfterAAPL);
  await screenshot(page, 'trade-after-aapl');

  // Switch to MSFT
  const msftClicked = await page.evaluate(() => {
    const items = document.querySelectorAll('tr, li, div');
    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (r.left < 200 && r.top > 100 && /^MSFT/i.test(item.textContent.trim())) {
        item.click();
        return item.textContent.trim().substring(0, 30);
      }
    }
    return null;
  });
  log('Clicked MSFT: ' + msftClicked);
  await new Promise(r => setTimeout(r, 3000));
  const headerAfterMSFT = await page.evaluate(() => {
    return document.body.innerText.match(/[A-Z]{2,5}\s+\$[\d,.]+/)?.[0] || 'not found';
  });
  log('Header after MSFT click: ' + headerAfterMSFT);
  await screenshot(page, 'trade-after-msft');

  // ====================================
  // PIPELINE - Run Pipeline click
  // ====================================
  log('=== PIPELINE ===');
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Find Run Pipeline button
  const pipelineBtns = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.filter(b => b.offsetParent !== null).map(b => ({
      text: b.textContent.trim().substring(0, 40),
      x: Math.round(b.getBoundingClientRect().left),
      y: Math.round(b.getBoundingClientRect().top)
    }));
  });
  log('Pipeline buttons: ' + JSON.stringify(pipelineBtns));

  // Click Run Pipeline
  const runClicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      if (/run/i.test(btn.textContent.trim())) {
        btn.click();
        return btn.textContent.trim();
      }
    }
    return null;
  });
  log('Run Pipeline clicked: ' + runClicked);
  await new Promise(r => setTimeout(r, 4000));
  await screenshot(page, 'pipeline-after-run');

  // Check for toast/status change
  const pipelineStatus = await page.evaluate(() => {
    const toasts = document.querySelectorAll('[class*="toast"], [class*="Toastify"], [role="alert"], [class*="notification"]');
    const toastTexts = Array.from(toasts).map(t => t.textContent.trim());
    const body = document.body.innerText;
    const hasRunning = /running|started|progress|completed|error|failed/i.test(body);
    return { toastTexts, hasRunning, bodySnippet: body.substring(0, 200) };
  });
  log('Pipeline after run: ' + JSON.stringify(pipelineStatus));

  // ====================================
  // DASHBOARD - detailed section screenshots
  // ====================================
  log('=== DASHBOARD SECTIONS ===');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Full dashboard with scroll
  await screenshot(page, 'dash-full-top');

  // Activity feed - check what's actually in it
  const feedContent = await page.evaluate(() => {
    // Find the Activity Feed section
    const headings = document.querySelectorAll('h2, h3, h4, h5, h6');
    let feedSection = null;
    headings.forEach(h => {
      if (/activity.*feed|feed/i.test(h.textContent)) {
        feedSection = h.closest('section, div[class], [class*="card"]');
      }
    });

    if (!feedSection) return { found: false };

    const items = feedSection.querySelectorAll('div > div, li');
    const feedItems = [];
    items.forEach(item => {
      const text = item.textContent.trim();
      if (text.length > 10 && text.length < 300) {
        feedItems.push(text.substring(0, 120));
      }
    });

    // Check for "news" or "headline" keywords
    const hasNewsContent = feedItems.some(i => /headline|reuters|bloomberg|cnbc|breaking/i.test(i));
    const hasMarketNews = feedItems.some(i => /market.*news|news.*market/i.test(i));

    return { found: true, itemCount: feedItems.length, items: feedItems.slice(0, 8), hasNewsContent, hasMarketNews };
  });
  log('Activity Feed content: ' + JSON.stringify(feedContent));

  // Strategy sparklines - check which have real data vs flat/empty
  const sparklineCheck = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="card"]');
    const results = [];
    cards.forEach(card => {
      const nameEl = card.querySelector('h3, h4, [class*="name"], [class*="title"]');
      if (!nameEl) return;
      const name = nameEl.textContent.trim();
      if (name.length > 30 || name.length < 3) return;

      const svgs = card.querySelectorAll('svg');
      const canvases = card.querySelectorAll('canvas');
      let hasSparkline = false;
      let sparklineType = 'none';

      svgs.forEach(svg => {
        const paths = svg.querySelectorAll('path, polyline, line');
        if (paths.length > 0) {
          hasSparkline = true;
          sparklineType = 'svg';
          // Check if path has real data (not just a flat line)
          paths.forEach(p => {
            const d = p.getAttribute('d') || '';
            const points = d.split(/[MLCQZmlcqz]/);
            if (points.length <= 2) sparklineType = 'flat/empty';
          });
        }
      });

      if (canvases.length > 0) {
        hasSparkline = true;
        sparklineType = 'canvas';
      }

      results.push({ name, hasSparkline, sparklineType });
    });
    return results;
  });
  log('Strategy sparkline check:');
  sparklineCheck.forEach(s => log(`  ${s.name}: sparkline=${s.hasSparkline}, type=${s.sparklineType}`));

  // Market indices sparkline check
  const indexUICheck = await page.evaluate(() => {
    const body = document.body.innerText;
    const spyPrice = body.match(/SPY[\s\S]*?\$[\d,.]+/)?.[0]?.substring(0, 40);
    const qqqPrice = body.match(/QQQ[\s\S]*?\$[\d,.]+/)?.[0]?.substring(0, 40);
    const iwmPrice = body.match(/IWM[\s\S]*?\$[\d,.]+/)?.[0]?.substring(0, 40);

    // Look for sparkline elements near index display
    const indexArea = document.querySelectorAll('[class*="index"], [class*="indices"], [class*="market"]');
    let sparkFound = 0;
    indexArea.forEach(area => {
      const svgs = area.querySelectorAll('svg');
      const canvases = area.querySelectorAll('canvas');
      sparkFound += svgs.length + canvases.length;
    });

    return { spyPrice, qqqPrice, iwmPrice, sparkFound };
  });
  log('Index UI: ' + JSON.stringify(indexUICheck));

  // Scroll to bottom to see sectors, allocation, headlines
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 1000));
  await screenshot(page, 'dash-bottom');

  // Sector treemap - tile size analysis
  const treemapCheck = await page.evaluate(() => {
    // Find treemap container
    const containers = document.querySelectorAll('[class*="treemap"], [class*="heatmap"], [class*="sector"]');
    let tiles = [];
    containers.forEach(c => {
      const children = c.querySelectorAll('div[style], [class*="tile"], [class*="cell"]');
      children.forEach(child => {
        const r = child.getBoundingClientRect();
        if (r.width > 20 && r.height > 20 && r.width < 500) {
          tiles.push({ w: Math.round(r.width), h: Math.round(r.height), text: child.textContent.trim().substring(0, 20) });
        }
      });
    });

    const uniqueWidths = new Set(tiles.map(t => t.w));
    return { tileCount: tiles.length, uniqueWidths: uniqueWidths.size, tiles: tiles.slice(0, 8) };
  });
  log('Treemap tiles: ' + JSON.stringify(treemapCheck));

  // Check Allocation + Headlines side by side
  const sideCheck = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h2, h3, h4, h5'));
    const alloc = headings.find(h => /allocation/i.test(h.textContent));
    const headlines = headings.find(h => /headline/i.test(h.textContent));

    if (alloc && headlines) {
      const ar = alloc.getBoundingClientRect();
      const hr = headlines.getBoundingClientRect();
      return {
        allocPos: { left: Math.round(ar.left), top: Math.round(ar.top) },
        headlinesPos: { left: Math.round(hr.left), top: Math.round(hr.top) },
        sideBySide: Math.abs(ar.top - hr.top) < 60
      };
    }
    return { allocFound: !!alloc, headlinesFound: !!headlines };
  });
  log('Allocation + Headlines layout: ' + JSON.stringify(sideCheck));

  // ===== STRATEGY DETAIL - deeper check =====
  log('=== STRATEGY DETAIL ===');
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Check positions tab clickable rows
  const posTabClicked = await page.evaluate(() => {
    const tabs = document.querySelectorAll('button, [role="tab"]');
    for (const t of tabs) {
      if (/position/i.test(t.textContent.trim())) {
        t.click();
        return true;
      }
    }
    return false;
  });
  await new Promise(r => setTimeout(r, 2000));

  const posRowsClickable = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    const results = [];
    rows.forEach(r => {
      const style = window.getComputedStyle(r);
      const cursor = style.cursor;
      const text = r.textContent.trim().substring(0, 40);
      results.push({ text, cursor, hasOnClick: !!r.onclick });
    });
    return results;
  });
  log('Position rows clickable: ' + JSON.stringify(posRowsClickable));
  await screenshot(page, 'strategy-positions-clickable');

  // Analytics - Best/Worst
  const analyticsClicked = await page.evaluate(() => {
    const tabs = document.querySelectorAll('button, [role="tab"]');
    for (const t of tabs) {
      if (/analytic/i.test(t.textContent.trim())) { t.click(); return true; }
    }
    return false;
  });
  await new Promise(r => setTimeout(r, 2000));

  const analyticsContent = await page.evaluate(() => {
    const body = document.body.innerText;
    const hasBestTrades = /best.*trade/i.test(body);
    const hasWorstTrades = /worst.*trade/i.test(body);
    const hasMonthly = /monthly.*return/i.test(body);
    const hasHoldTime = /hold.*time/i.test(body);
    const hasWinLoss = /win.*loss|win.*rate/i.test(body);
    return { hasBestTrades, hasWorstTrades, hasMonthly, hasHoldTime, hasWinLoss };
  });
  log('Analytics content: ' + JSON.stringify(analyticsContent));
  await screenshot(page, 'strategy-analytics-detail');

  await browser.close();
  log('=== PART 3 COMPLETE ===');
})();
