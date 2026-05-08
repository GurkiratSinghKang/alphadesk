import puppeteer from 'puppeteer';
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

const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round14';
const BASE = 'https://tradingalpha.net';

function log(msg) { console.log(`[QA2] ${msg}`); }

async function screenshot(page, name, opts = {}) {
  const fpath = path.join(DIR, `${name}.png`);
  if (opts.fullPage) {
    await page.screenshot({ path: fpath, fullPage: true });
  } else if (opts.clip) {
    await page.screenshot({ path: fpath, clip: opts.clip });
  } else {
    await page.screenshot({ path: fpath });
  }
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

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  const usernameInput = await page.$('input[type="text"], input[name="username"]');
  const passwordInput = await page.$('input[type="password"]');
  if (usernameInput && passwordInput) {
    await usernameInput.click({ clickCount: 3 });
    await usernameInput.type(QA_USERNAME);
    await passwordInput.click({ clickCount: 3 });
    await passwordInput.type(getQaPassword());
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
        submitBtn.click()
      ]);
    }
    await new Promise(r => setTimeout(r, 3000));
    if (page.url().includes('/login')) {
      // Try again with different submit button
      const allBtns = await page.$$('button');
      for (const btn of allBtns) {
        const text = await page.evaluate(b => b.textContent.trim(), btn);
        if (/sign|log|enter/i.test(text)) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
            btn.click()
          ]);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  log('Logged in, on: ' + page.url());

  // ===== TRADE PAGE DEEP DIVE =====
  log('=== TRADE PAGE DEEP DIVE ===');
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  // Get detailed layout info
  const tradeLayout = await page.evaluate(() => {
    const allButtons = Array.from(document.querySelectorAll('button'));
    const buttonTexts = allButtons.map(b => ({
      text: b.textContent.trim().substring(0, 30),
      visible: b.offsetParent !== null,
      classes: (typeof b.className === 'string' ? b.className : '').substring(0, 60),
      rect: b.getBoundingClientRect()
    }));

    const allTabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const tabTexts = allTabs.map(t => ({
      text: t.textContent.trim(),
      classes: (typeof t.className === 'string' ? t.className : '').substring(0, 60)
    }));

    // Look for BUY/SELL specifically
    const buyBtns = allButtons.filter(b => /buy/i.test(b.textContent.trim()));
    const sellBtns = allButtons.filter(b => /sell/i.test(b.textContent.trim()));

    // Right panel tabs
    const rightPanelEls = document.querySelectorAll('[class*="panel"], [class*="sidebar"], [class*="right"]');
    let rightPanelInfo = [];
    rightPanelEls.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.left > 900) {
        rightPanelInfo.push({
          classes: (typeof el.className === 'string' ? el.className : '').substring(0, 60),
          text: el.textContent.substring(0, 100),
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        });
      }
    });

    return {
      allButtonTexts: buttonTexts.filter(b => b.visible).map(b => `${b.text} [${b.rect.left.toFixed(0)},${b.rect.top.toFixed(0)}]`),
      tabTexts,
      buyBtns: buyBtns.map(b => ({ text: b.textContent.trim(), visible: b.offsetParent !== null, rect: b.getBoundingClientRect() })),
      sellBtns: sellBtns.map(b => ({ text: b.textContent.trim(), visible: b.offsetParent !== null, rect: b.getBoundingClientRect() })),
      rightPanelCount: rightPanelInfo.length
    };
  });

  log('All visible buttons: ' + JSON.stringify(tradeLayout.allButtonTexts));
  log('Buy buttons: ' + JSON.stringify(tradeLayout.buyBtns));
  log('Sell buttons: ' + JSON.stringify(tradeLayout.sellBtns));
  log('Tabs: ' + JSON.stringify(tradeLayout.tabTexts));

  // Now look at the right sidebar more carefully
  const rightSidebar = await page.evaluate(() => {
    // The right sidebar contains tabs: Tech, Fund, Sent, Chat, Order
    const body = document.body.innerText;
    const hasTech = /Tech/i.test(body);
    const hasFund = /Fund/i.test(body);
    const hasSent = /Sent/i.test(body);
    const hasChat = /Chat/i.test(body);
    const hasOrder = /Order/i.test(body);

    // Try clicking Order tab
    const allEls = document.querySelectorAll('button, a, [role="tab"], span');
    let orderEl = null;
    for (const el of allEls) {
      if (el.textContent.trim() === 'Order' || el.textContent.trim() === '📋 Order') {
        orderEl = { text: el.textContent.trim(), tag: el.tagName };
        el.click();
        break;
      }
    }

    return { hasTech, hasFund, hasSent, hasChat, hasOrder, orderEl };
  });

  log('Right sidebar tabs: ' + JSON.stringify(rightSidebar));

  await new Promise(r => setTimeout(r, 1500));
  await screenshot(page, '17-order-panel-deep');

  // Check what's in the order panel now
  const orderPanel = await page.evaluate(() => {
    const body = document.body.innerText;
    const hasBuyButton = /\bBUY\b/.test(body);
    const hasSellButton = /\bSELL\b/.test(body);
    const hasQty = /quantity|qty|shares/i.test(body);
    const hasOrderType = /market|limit|stop/i.test(body);

    // Look for Buy/Sell in button-like elements specifically
    const btns = document.querySelectorAll('button');
    let greenBtn = null, redBtn = null;
    btns.forEach(b => {
      const style = window.getComputedStyle(b);
      const bg = style.backgroundColor;
      const text = b.textContent.trim();
      if (/buy/i.test(text)) greenBtn = { text, bg, visible: b.offsetParent !== null, w: b.getBoundingClientRect().width };
      if (/sell/i.test(text)) redBtn = { text, bg, visible: b.offsetParent !== null, w: b.getBoundingClientRect().width };
    });

    return { hasBuyButton, hasSellButton, hasQty, hasOrderType, greenBtn, redBtn };
  });

  log('Order panel: ' + JSON.stringify(orderPanel));

  // Screenshot the right side panel area
  await screenshot(page, '16-buysell-area', { clip: { x: 1300, y: 0, width: 620, height: 1080 } });

  // ===== BOTTOM TABS (Options, etc) =====
  const bottomArea = await page.evaluate(() => {
    // Look at the bottom area of trade page
    const allText = document.body.innerText;
    const hasOptions = /Options/i.test(allText);

    // Find elements at bottom of screen
    const bottomEls = [];
    document.querySelectorAll('button, a, [role="tab"]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top > 600) {
        bottomEls.push({ text: el.textContent.trim().substring(0, 30), tag: el.tagName, top: rect.top.toFixed(0) });
      }
    });

    return { hasOptions, bottomEls };
  });

  log('Bottom area elements: ' + JSON.stringify(bottomArea.bottomEls.slice(0, 15)));

  // Click Options tab at the bottom
  const optionsClicked = await page.evaluate(() => {
    const els = document.querySelectorAll('button, a, [role="tab"], span');
    for (const el of els) {
      const text = el.textContent.trim();
      if (text === 'Options' || /^SPY Options$/i.test(text) || /options/i.test(text)) {
        const rect = el.getBoundingClientRect();
        if (rect.top > 500) { // bottom area
          el.click();
          return { clicked: text, top: rect.top };
        }
      }
    }
    return null;
  });

  if (optionsClicked) {
    log('Clicked options: ' + JSON.stringify(optionsClicked));
    await new Promise(r => setTimeout(r, 2000));
  }

  await screenshot(page, '18-options-deep', { clip: { x: 0, y: 600, width: 1920, height: 480 } });

  // Check for ATM highlight strength
  const atmCheck = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr');
    let atmRow = null;
    rows.forEach(row => {
      const style = window.getComputedStyle(row);
      const bg = style.backgroundColor;
      const cls = typeof row.className === 'string' ? row.className : '';
      if (cls.includes('atm') || cls.includes('highlight') || cls.includes('bg-primary')) {
        atmRow = { classes: cls.substring(0, 80), bg };
      }
    });

    // Also check for any highlighted rows
    let highlightedRows = 0;
    rows.forEach(row => {
      const bg = window.getComputedStyle(row).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== 'rgb(0, 0, 0)') {
        highlightedRows++;
      }
    });

    return { atmRow, highlightedRows };
  });

  log('ATM check: ' + JSON.stringify(atmCheck));

  // ===== SYMBOL SWITCHING - verify chart actually updates =====
  log('=== SYMBOL SWITCHING VERIFICATION ===');

  // First note current symbol/price
  const initialState = await page.evaluate(() => {
    const body = document.body.innerText;
    const symbolMatch = body.match(/([A-Z]{1,5})\s+\$[\d,]+\.\d{2}/);
    return symbolMatch ? symbolMatch[0] : body.substring(0, 100);
  });
  log('Initial state: ' + initialState);

  // Type AAPL into search
  const searchInput = await page.$('input[placeholder*="symbol" i], input[placeholder*="search" i], input[placeholder*="Add symbol" i]');
  if (searchInput) {
    await searchInput.click({ clickCount: 3 });
    await searchInput.type('AAPL');
    await new Promise(r => setTimeout(r, 1500));

    // Check for dropdown
    const dropdown = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="dropdown"] li, [class*="suggestion"], [class*="search-result"], [role="option"], [role="listbox"] li');
      return Array.from(items).map(i => i.textContent.trim().substring(0, 30)).slice(0, 5);
    });
    log('Search dropdown: ' + JSON.stringify(dropdown));

    if (dropdown.length > 0) {
      // Click first result
      await page.evaluate(() => {
        const items = document.querySelectorAll('[class*="dropdown"] li, [class*="suggestion"], [class*="search-result"], [role="option"], [role="listbox"] li');
        if (items[0]) items[0].click();
      });
    } else {
      await page.keyboard.press('Enter');
    }
    await new Promise(r => setTimeout(r, 3000));

    const afterSwitch = await page.evaluate(() => {
      const body = document.body.innerText;
      const symbolMatch = body.match(/([A-Z]{1,5})\s+\$[\d,]+\.\d{2}/);
      return symbolMatch ? symbolMatch[0] : 'no match';
    });
    log('After AAPL switch: ' + afterSwitch);
    await screenshot(page, '14b-symbol-AAPL-verify');
  }

  // ===== PIPELINE - Run Pipeline button =====
  log('=== PIPELINE - RUN BUTTON ===');
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Click Run Pipeline
  const runPipeline = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      if (/run.*pipeline|run/i.test(btn.textContent.trim())) {
        btn.click();
        return btn.textContent.trim();
      }
    }
    return null;
  });

  log('Run Pipeline clicked: ' + runPipeline);
  await new Promise(r => setTimeout(r, 3000));
  await screenshot(page, '22-pipeline-run-result');

  // Check if anything changed (toast, status, etc.)
  const afterRun = await page.evaluate(() => {
    const body = document.body.innerText;
    const hasToast = document.querySelector('[class*="toast"], [class*="notification"], [class*="alert"], [role="alert"]');
    const hasRunning = /running|started|progress|processing/i.test(body);
    return { hasToast: !!hasToast, toastText: hasToast?.textContent?.trim().substring(0, 100), hasRunning };
  });
  log('After Run Pipeline: ' + JSON.stringify(afterRun));

  // ===== DASHBOARD — Better section screenshots =====
  log('=== DASHBOARD DETAILED SECTIONS ===');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  // Full page screenshot first
  const pageHeight = await page.evaluate(() => document.body.scrollHeight);
  log('Dashboard height: ' + pageHeight);

  // Activity Feed
  const activityBounds = await page.evaluate(() => {
    const feedEl = document.querySelector('[class*="activity"], [class*="feed"]');
    if (feedEl) {
      const rect = feedEl.getBoundingClientRect();
      return { x: rect.x, y: rect.y + window.scrollY, w: rect.width, h: rect.height };
    }
    return null;
  });

  if (activityBounds) {
    await page.evaluate(y => window.scrollTo(0, y - 20), activityBounds.y);
    await new Promise(r => setTimeout(r, 300));
    await screenshot(page, '03b-activity-feed-section', { clip: { x: 0, y: 0, width: 960, height: Math.min(activityBounds.h + 40, 500) } });
  }

  // Check activity feed for news contamination detail
  const activityDetail = await page.evaluate(() => {
    const feedItems = document.querySelectorAll('[class*="feed"] > div, [class*="activity"] li, [class*="activity"] > div > div');
    const items = [];
    feedItems.forEach(item => {
      items.push(item.textContent.trim().substring(0, 80));
    });

    // Also check body text around "news" keywords
    const body = document.body.innerText;
    const newsMatches = [];
    const lines = body.split('\n');
    lines.forEach((line, i) => {
      if (/headline|reuters|bloomberg|cnbc|news/i.test(line)) {
        newsMatches.push({ line: i, text: line.trim().substring(0, 80) });
      }
    });

    return { feedItems: items.slice(0, 10), newsMatches };
  });

  log('Activity feed items: ' + JSON.stringify(activityDetail.feedItems));
  log('News matches in page: ' + JSON.stringify(activityDetail.newsMatches));

  // Strategy cards - scroll to them and take proper screenshot
  await page.evaluate(() => {
    const grid = document.querySelector('[class*="strateg"]');
    if (grid) grid.scrollIntoView({ behavior: 'instant' });
  });
  await new Promise(r => setTimeout(r, 500));
  await screenshot(page, '04c-strategies-visible');

  // Count strategy cards more precisely
  const stratCards = await page.evaluate(() => {
    const allText = document.body.innerText;
    const strategies = [
      'Momentum + Quality', 'PEAD', 'VRP Harvesting', 'Earnings Vol',
      'Regime Adaptive', 'Claude Alpha', 'Mean Reversion', 'VCP Breakout',
      'Pairs Trading', 'Dividend Capture', 'Sector Rotation', 'Gap Fill',
      'Manual'
    ];
    const found = strategies.filter(s => allText.includes(s));
    const notFound = strategies.filter(s => !allText.includes(s));

    // Check sparklines in strategy area - look for SVG paths or canvas elements
    const stratSection = document.querySelector('[class*="strategies"], [class*="strateg"]');
    let svgPaths = 0, canvases = 0;
    if (stratSection) {
      svgPaths = stratSection.querySelectorAll('svg path, svg polyline').length;
      canvases = stratSection.querySelectorAll('canvas').length;
    }

    return { found, notFound, svgPaths, canvases };
  });

  log('Strategies found: ' + JSON.stringify(stratCards.found));
  log('Strategies NOT found: ' + JSON.stringify(stratCards.notFound));
  log(`Strategy sparklines: ${stratCards.svgPaths} SVG paths, ${stratCards.canvases} canvases`);

  // Market Indices section
  await page.evaluate(() => {
    const els = document.querySelectorAll('h2, h3, h4');
    for (const el of els) {
      if (/market.*ind|indices/i.test(el.textContent)) {
        el.scrollIntoView({ behavior: 'instant' });
        break;
      }
    }
  });
  await new Promise(r => setTimeout(r, 500));
  await screenshot(page, '07b-market-indices-section');

  // Check index sparklines in the UI
  const indexSparkUI = await page.evaluate(() => {
    const body = document.body.innerText;
    const spyMatch = body.match(/SPY[^]*?\$[\d,.]+/);
    const qqqMatch = body.match(/QQQ[^]*?\$[\d,.]+/);
    const iwmMatch = body.match(/IWM[^]*?\$[\d,.]+/);

    // Check for SVG sparklines near indices
    const indexSection = document.querySelector('[class*="indices"], [class*="market-ind"]');
    let sparkCount = 0;
    if (indexSection) {
      sparkCount = indexSection.querySelectorAll('svg, canvas, [class*="spark"]').length;
    }

    return {
      spy: spyMatch?.[0]?.substring(0, 30),
      qqq: qqqMatch?.[0]?.substring(0, 30),
      iwm: iwmMatch?.[0]?.substring(0, 30),
      sparkCount
    };
  });

  log('Index UI sparklines: ' + JSON.stringify(indexSparkUI));

  // Sector treemap detail
  await page.evaluate(() => {
    const els = document.querySelectorAll('h2, h3, h4');
    for (const el of els) {
      if (/sector|treemap|heatmap|performance/i.test(el.textContent)) {
        el.scrollIntoView({ behavior: 'instant' });
        break;
      }
    }
  });
  await new Promise(r => setTimeout(r, 500));
  await screenshot(page, '08c-sector-treemap-detail');

  // Check leader stocks
  const sectorDetail = await page.evaluate(() => {
    const body = document.body.innerText;
    // Check for individual stock tickers within sector tiles
    const tickers = body.match(/\b[A-Z]{1,5}\b/g) || [];
    const sectorStocks = tickers.filter(t =>
      ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'GS', 'XOM', 'CVX', 'JNJ', 'UNH', 'PFE', 'LLY'].includes(t)
    );
    return { leaderStocks: [...new Set(sectorStocks)] };
  });
  log('Sector leader stocks: ' + JSON.stringify(sectorDetail.leaderStocks));

  // Allocation donut + Headlines side by side check
  await page.evaluate(() => {
    const els = document.querySelectorAll('h2, h3, h4');
    for (const el of els) {
      if (/allocation|headline/i.test(el.textContent)) {
        el.scrollIntoView({ behavior: 'instant' });
        break;
      }
    }
  });
  await new Promise(r => setTimeout(r, 500));
  await screenshot(page, '09b-allocation-headlines-detail');

  const allocLayout = await page.evaluate(() => {
    const headings = document.querySelectorAll('h2, h3, h4, h5');
    let allocHead = null, headlinesHead = null;
    headings.forEach(h => {
      const rect = h.getBoundingClientRect();
      if (/allocation/i.test(h.textContent)) allocHead = { left: rect.left, top: rect.top };
      if (/headline/i.test(h.textContent)) headlinesHead = { left: rect.left, top: rect.top };
    });

    const sideBySide = allocHead && headlinesHead && Math.abs(allocHead.top - headlinesHead.top) < 50;
    return { allocHead, headlinesHead, sideBySide };
  });
  log('Allocation + Headlines layout: ' + JSON.stringify(allocLayout));

  // ===== LANDING PAGE - product preview check =====
  log('=== LANDING PAGE DETAIL ===');
  // Open new tab without auth to see landing
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1920, height: 1080 });
  await page2.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const landingDetail = await page2.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const imgInfo = imgs.map(i => ({ src: i.src, alt: i.alt, w: i.naturalWidth, h: i.naturalHeight }));

    // Check for feature cards
    const cards = document.querySelectorAll('[class*="card"], [class*="feature"]');
    const cardTexts = Array.from(cards).map(c => c.textContent.trim().substring(0, 40));

    // Check for preview/mockup below cards
    const allEls = document.querySelectorAll('img, video, iframe, canvas, [class*="preview"], [class*="mockup"], [class*="screenshot"]');
    const previewEls = [];
    allEls.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top > 300 && rect.height > 100) { // Below hero area and substantial
        previewEls.push({ tag: el.tagName, src: el.src?.substring(0, 60), top: rect.top, h: rect.height, classes: (typeof el.className === 'string' ? el.className : '').substring(0, 40) });
      }
    });

    return { imgInfo, cardTexts, previewEls };
  });

  log('Landing page images: ' + JSON.stringify(landingDetail.imgInfo));
  log('Landing feature cards: ' + JSON.stringify(landingDetail.cardTexts));
  log('Landing preview elements: ' + JSON.stringify(landingDetail.previewEls));

  await screenshot(page2, '28b-landing-detail', { fullPage: true });
  await page2.close();

  await browser.close();
  log('=== PART 2 COMPLETE ===');
})();
