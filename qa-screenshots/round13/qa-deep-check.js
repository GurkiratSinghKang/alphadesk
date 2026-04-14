const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round13';
const BASE_URL = 'https://tradingalpha.net';
const LOGIN_USER = 'admin';
const LOGIN_PASS = 'alphaDesk2025!';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Login
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);
  await page.type('input[type="text"], input[name="username"], input[placeholder*="ser"]', LOGIN_USER);
  await page.type('input[type="password"]', LOGIN_PASS);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await sleep(3000);

  // ===== DEEP CHECK #13: Market Indices =====
  console.log('\n=== DEEP CHECK #13: Market Indices ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  const indicesDeep = await page.evaluate(() => {
    const body = document.body.innerText;
    // Look for any index-like text with various possible names
    const patterns = ['S&P', 'SPX', 'SPY', 'SP500', 'NASDAQ', 'QQQ', 'NDX', 'DOW', 'DIA', 'DJIA', 'Russell', 'IWM',
      'Nasdaq', 'Dow Jones', 'S&P 500'];
    const found = {};
    for (const p of patterns) {
      if (body.includes(p)) found[p] = true;
    }

    // Get all text that looks like market data sections
    const marketSections = document.querySelectorAll('[class*="market"], [class*="index"], [class*="indices"], [class*="ticker"]');
    const sectionTexts = [];
    for (const el of marketSections) {
      sectionTexts.push(el.innerText.substring(0, 200));
    }

    // Look in the status strip / top bar area
    const header = document.querySelector('header, nav, [class*="header"], [class*="strip"], [class*="status"]');
    const headerText = header ? header.innerText : 'no header found';

    // Get full body text around "%" to find what indices are shown
    const lines = body.split('\n').filter(l => l.includes('%'));

    return { found, sectionTexts, headerText: headerText.substring(0, 500), percentLines: lines.slice(0, 20) };
  });

  console.log('Index names found:', JSON.stringify(indicesDeep.found));
  console.log('Market sections:', JSON.stringify(indicesDeep.sectionTexts));
  console.log('Header text:', indicesDeep.headerText);
  console.log('Lines with %:', JSON.stringify(indicesDeep.percentLines));

  // ===== DEEP CHECK #5: Allocation Donut + News =====
  console.log('\n=== DEEP CHECK #5: Allocation Donut + News ===');

  const donutDeep = await page.evaluate(() => {
    const body = document.body.innerText;
    // Search for allocation-related terms
    const terms = ['Allocation', 'allocation', 'Donut', 'donut', 'News', 'news', 'Headlines', 'headlines',
      'Sector Allocation', 'Portfolio Allocation', 'Asset Allocation'];
    const found = {};
    for (const t of terms) {
      if (body.includes(t)) found[t] = true;
    }

    // Look for chart containers
    const canvases = document.querySelectorAll('canvas');
    const canvasInfo = [];
    canvases.forEach(c => {
      const rect = c.getBoundingClientRect();
      canvasInfo.push({ w: rect.width, h: rect.height, class: c.className });
    });

    // Find all section headings
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="heading"]');
    const headingTexts = [];
    headings.forEach(h => {
      if (h.innerText.trim().length > 0 && h.innerText.trim().length < 100) {
        headingTexts.push(h.innerText.trim());
      }
    });

    return { found, canvasInfo, headingTexts };
  });

  console.log('Donut/News terms found:', JSON.stringify(donutDeep.found));
  console.log('Canvases:', JSON.stringify(donutDeep.canvasInfo));
  console.log('All headings:', JSON.stringify(donutDeep.headingTexts));

  // ===== DEEP CHECK #6: Sector Treemap =====
  console.log('\n=== DEEP CHECK #6: Sector Treemap ===');

  // Scroll down to see treemap
  await page.evaluate(() => window.scrollTo(0, 500));
  await sleep(1000);

  const treemapDeep = await page.evaluate(() => {
    const body = document.body.innerText;
    // Find sector section
    const sectorWords = ['Technology', 'Healthcare', 'Financial', 'Energy', 'Consumer',
      'Industrial', 'Materials', 'Utilities', 'Real Estate', 'Communication',
      'Info Tech', 'Comm Services', 'Cons Disc', 'Cons Staple', 'Industrials'];
    const found = {};
    for (const s of sectorWords) {
      if (body.includes(s)) found[s] = true;
    }

    // Look for treemap container
    const treemapEls = document.querySelectorAll('[class*="treemap"], [class*="sector"], [class*="heatmap"], [class*="grid"]');
    const elInfo = [];
    treemapEls.forEach(el => {
      const rect = el.getBoundingClientRect();
      elInfo.push({
        class: el.className.substring(0, 100),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        text: el.innerText.substring(0, 200)
      });
    });

    // Check for Daily/YTD toggle
    const hasDaily = body.includes('Daily') || body.includes('1D') || body.includes('daily');
    const hasYTD = body.includes('YTD') || body.includes('ytd');

    // Check for color coding (elements with red/green backgrounds)
    const coloredEls = document.querySelectorAll('[style*="background-color"], [class*="red"], [class*="green"], [class*="bg-"]');

    return { sectorWords: found, treemapEls: elInfo, hasDaily, hasYTD, coloredCount: coloredEls.length };
  });

  console.log('Sector words found:', JSON.stringify(treemapDeep.sectorWords));
  console.log('Treemap elements:', JSON.stringify(treemapDeep.treemapEls));
  console.log('Daily:', treemapDeep.hasDaily, 'YTD:', treemapDeep.hasYTD);
  console.log('Colored elements:', treemapDeep.coloredCount);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'deep-06-sector-treemap.png'), fullPage: false });

  // Scroll more to capture full treemap area
  await page.evaluate(() => window.scrollTo(0, 800));
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'deep-06-sector-treemap-scrolled.png'), fullPage: false });

  // ===== DEEP CHECK #3: Logo clickable =====
  console.log('\n=== DEEP CHECK #3: Logo clickable ===');

  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  const logoDeep = await page.evaluate(() => {
    // Get all elements in header/nav area
    const nav = document.querySelector('header, nav, [class*="header"], [class*="navbar"], [class*="topbar"], [class*="sidebar"]');
    const navHTML = nav ? nav.outerHTML.substring(0, 1000) : 'no nav';

    // Look for any links that go to /
    const homeLinks = document.querySelectorAll('a[href="/"], a[href="./"]');
    const homeLinkInfo = [];
    homeLinks.forEach(l => {
      homeLinkInfo.push({ href: l.href, text: l.innerText.trim().substring(0, 50), html: l.outerHTML.substring(0, 200) });
    });

    // Look for SVG icons in header
    const headerSvgs = nav ? nav.querySelectorAll('svg') : [];
    const svgInfo = [];
    headerSvgs.forEach(s => {
      const parent = s.parentElement;
      svgInfo.push({
        parentTag: parent.tagName,
        parentClass: parent.className ? String(parent.className).substring(0, 100) : '',
        isClickable: parent.tagName === 'A' || parent.tagName === 'BUTTON' || parent.hasAttribute('role')
      });
    });

    // Look for elements with "AlphaDesk" text
    const alphaEls = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.includes('AlphaDesk')) {
        const el = walker.currentNode.parentElement;
        alphaEls.push({
          tag: el.tagName,
          class: el.className ? String(el.className).substring(0, 100) : '',
          parentTag: el.parentElement ? el.parentElement.tagName : 'none',
          parentClass: el.parentElement && el.parentElement.className ? String(el.parentElement.className).substring(0, 100) : ''
        });
      }
    }

    return { navHTML: navHTML.substring(0, 500), homeLinks: homeLinkInfo, headerSvgs: svgInfo, alphaDesk: alphaEls };
  });

  console.log('Home links:', JSON.stringify(logoDeep.homeLinks));
  console.log('Header SVGs:', JSON.stringify(logoDeep.headerSvgs));
  console.log('AlphaDesk elements:', JSON.stringify(logoDeep.alphaDesk));

  // Try clicking with a more robust approach
  const navBefore = page.url();
  try {
    // Try clicking the first <a href="/">
    const clicked = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href="/"], a[href="./"]');
      if (links.length > 0) {
        links[0].click();
        return { clicked: true, href: links[0].href };
      }
      // Try clicking text "AlphaDesk"
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes('AlphaDesk')) {
          const el = walker.currentNode.parentElement;
          const link = el.closest('a');
          if (link) { link.click(); return { clicked: true, href: link.href }; }
          el.click();
          return { clicked: true, href: 'element clicked' };
        }
      }
      return { clicked: false };
    });

    await sleep(2000);
    const navAfter = page.url();
    console.log('Logo click result:', JSON.stringify(clicked));
    console.log('URL before:', navBefore, 'after:', navAfter);
    console.log('Navigated home:', navAfter === `${BASE_URL}/` || navAfter === BASE_URL);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'deep-03-logo-after.png'), fullPage: false });
  } catch(e) {
    console.log('Logo click error:', e.message);
  }

  // ===== DEEP CHECK #23: Profile menu =====
  console.log('\n=== DEEP CHECK #23: Profile menu ===');

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  const profileDeep = await page.evaluate(() => {
    // Get header/nav buttons
    const header = document.querySelector('header, nav, [class*="header"], [class*="topbar"]');
    const buttons = header ? header.querySelectorAll('button') : document.querySelectorAll('header button, nav button');
    const btnInfo = [];
    buttons.forEach(b => {
      btnInfo.push({
        text: b.innerText.trim().substring(0, 50),
        class: b.className ? String(b.className).substring(0, 100) : '',
        hasImg: !!b.querySelector('img'),
        hasSVG: !!b.querySelector('svg'),
        html: b.outerHTML.substring(0, 200)
      });
    });
    return { buttons: btnInfo };
  });

  console.log('Header buttons:', JSON.stringify(profileDeep.buttons));

  // Try clicking the last button (usually profile/avatar)
  try {
    const profileClicked = await page.evaluate(() => {
      const header = document.querySelector('header, nav, [class*="header"], [class*="topbar"]');
      const buttons = header ? [...header.querySelectorAll('button')] : [...document.querySelectorAll('header button, nav button')];
      // Find one that looks like profile (has avatar/svg, short text, at the end)
      for (let i = buttons.length - 1; i >= 0; i--) {
        const b = buttons[i];
        const text = b.innerText.trim();
        if (text.length <= 5 || text.includes('A') || b.querySelector('img, svg[class*="user"], [class*="avatar"]')) {
          b.click();
          return { clicked: true, text };
        }
      }
      // Just click the very last button
      if (buttons.length > 0) {
        buttons[buttons.length - 1].click();
        return { clicked: true, text: buttons[buttons.length - 1].innerText.trim() };
      }
      return { clicked: false };
    });

    console.log('Profile button click:', JSON.stringify(profileClicked));
    await sleep(1500);

    const menuContent = await page.evaluate(() => {
      const body = document.body.innerText;
      // Get everything that might be in a dropdown/popover
      const menus = document.querySelectorAll('[class*="dropdown"], [class*="popover"], [class*="menu"], [role="menu"], [class*="panel"]');
      const menuTexts = [];
      menus.forEach(m => {
        if (m.innerText.trim().length > 0) {
          menuTexts.push(m.innerText.substring(0, 300));
        }
      });

      const hasLogout = body.includes('Logout') || body.includes('Log out') || body.includes('Sign out') || body.includes('Log Out');
      const hasSettings = body.includes('Setting') || body.includes('Preference');
      const hasEquity = !!body.match(/\$[\d,]+/);

      return { menuTexts, hasLogout, hasSettings, hasEquity };
    });

    console.log('Menu content:', JSON.stringify(menuContent));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'deep-23-profile-menu.png'), fullPage: false });

    // Scroll within the menu to see if Logout is below fold
    await page.evaluate(() => {
      const menus = document.querySelectorAll('[class*="dropdown"], [class*="popover"], [class*="menu"], [role="menu"]');
      menus.forEach(m => { m.scrollTop = m.scrollHeight; });
    });
    await sleep(500);

    const afterScroll = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasLogout: body.includes('Logout') || body.includes('Log out') || body.includes('Sign out') || body.includes('Log Out')
      };
    });
    console.log('After scroll:', JSON.stringify(afterScroll));

  } catch(e) {
    console.log('Profile menu error:', e.message);
  }

  // ===== ADDITIONAL CHECKS: Look at dashboard more carefully =====
  console.log('\n=== Dashboard full text analysis ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  const dashFull = await page.evaluate(() => {
    return document.body.innerText.substring(0, 3000);
  });
  console.log('Dashboard text (first 3000 chars):\n', dashFull);

  // Get full page screenshot with scroll
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'deep-dashboard-top.png'), fullPage: false });

  await page.evaluate(() => window.scrollTo(0, 400));
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'deep-dashboard-mid.png'), fullPage: false });

  await page.evaluate(() => window.scrollTo(0, 800));
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'deep-dashboard-bottom.png'), fullPage: false });

  await page.evaluate(() => window.scrollTo(0, 1200));
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'deep-dashboard-far-bottom.png'), fullPage: false });

  // ===== Check #7 deeper: Best & Worst Trades =====
  console.log('\n=== DEEP CHECK #7: Strategy PEAD - Best/Worst Trades ===');
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  // Click Analytics tab
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button, [role="tab"]');
    for (const btn of buttons) {
      if (btn.innerText.includes('Analytics')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
  await sleep(2000);

  const analyticsText = await page.evaluate(() => document.body.innerText);
  console.log('Analytics page contains Best:', analyticsText.includes('Best'));
  console.log('Analytics page contains Worst:', analyticsText.includes('Worst'));
  console.log('Analytics text (relevant section):', analyticsText.substring(0, 2000));

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'deep-07-analytics.png'), fullPage: true });

  await browser.close();
  console.log('\n=== Deep checks complete ===');
})();
