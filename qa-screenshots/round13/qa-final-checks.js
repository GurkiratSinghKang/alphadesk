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

  // ===== RECHECK #3: Logo click with correct approach =====
  console.log('\n=== RECHECK #3: Logo click ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  const urlBefore = page.url();

  // The logo is a div with cursor-pointer class containing "AlphaDesk" text
  // It does NOT have an <a> tag, so we need to look for client-side navigation
  const logoResult = await page.evaluate(() => {
    // Find the div with cursor-pointer containing AlphaDesk
    const divs = document.querySelectorAll('div.cursor-pointer, [class*="cursor-pointer"]');
    for (const d of divs) {
      if (d.innerText.includes('AlphaDesk') || d.querySelector('[class*="zap"]')) {
        d.click();
        return { clicked: true, text: d.innerText.trim() };
      }
    }
    // Fallback: look for the span with AlphaDesk text
    const spans = document.querySelectorAll('span');
    for (const s of spans) {
      if (s.innerText.trim() === 'AlphaDesk') {
        const parent = s.closest('[class*="cursor"]') || s.parentElement;
        parent.click();
        return { clicked: true, text: 'span AlphaDesk' };
      }
    }
    return { clicked: false };
  });

  await sleep(2000);
  const urlAfter = page.url();
  console.log('Logo result:', JSON.stringify(logoResult));
  console.log(`URL: ${urlBefore} -> ${urlAfter}`);
  console.log('Navigated home:', urlAfter.endsWith('/') || urlAfter === BASE_URL);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final-03-logo.png'), fullPage: false });

  // ===== RECHECK #23: Profile menu with correct button targeting =====
  console.log('\n=== RECHECK #23: Profile menu ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Click the avatar button (the one with aria-label="User menu" and text "A")
  const profileClick = await page.evaluate(() => {
    const btn = document.querySelector('[aria-label="User menu"], [data-slot="dropdown-menu-trigger"]');
    if (btn) {
      btn.click();
      return { clicked: true, label: btn.getAttribute('aria-label') };
    }
    return { clicked: false };
  });
  console.log('Profile click:', JSON.stringify(profileClick));
  await sleep(1500);

  // Now check the dropdown menu content
  const menuContent = await page.evaluate(() => {
    // Look for dropdown menu items
    const menuItems = document.querySelectorAll('[role="menuitem"], [data-slot="dropdown-menu-item"]');
    const items = [];
    menuItems.forEach(m => items.push(m.innerText.trim()));

    const body = document.body.innerText;
    const hasLogout = body.includes('Log out') || body.includes('Logout') || body.includes('Sign out');
    const hasEquity = !!body.match(/Equity|Portfolio|Balance/i);

    return { items, hasLogout, hasEquity };
  });
  console.log('Menu items:', JSON.stringify(menuContent.items));
  console.log('Has logout:', menuContent.hasLogout);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final-23-profile-menu.png'), fullPage: false });

  // ===== RECHECK #5: Allocation + News together =====
  console.log('\n=== RECHECK #5: Allocation + News side by side ===');
  await page.keyboard.press('Escape');
  await sleep(500);

  // Scroll to the bottom section where indices, sectors, headlines, allocation are
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1000);

  const bottomSection = await page.evaluate(() => {
    const body = document.body.innerText;
    const hasHeadlines = body.includes('HEADLINES');
    const hasAllocation = body.includes('ALLOCATION');
    const hasIndices = body.includes('MARKET INDICES');
    const hasSector = body.includes('SECTOR PERFORMANCE');

    // Check if HEADLINES and ALLOCATION sections are visible
    const allH = document.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="heading"]');
    let headlinesVisible = false;
    let allocationVisible = false;
    for (const h of allH) {
      const t = h.innerText.trim().toUpperCase();
      if (t === 'HEADLINES') {
        const rect = h.getBoundingClientRect();
        headlinesVisible = rect.width > 0 && rect.height > 0;
      }
      if (t === 'ALLOCATION') {
        const rect = h.getBoundingClientRect();
        allocationVisible = rect.width > 0 && rect.height > 0;
      }
    }

    return { hasHeadlines, hasAllocation, hasIndices, hasSector, headlinesVisible, allocationVisible };
  });
  console.log('Bottom section:', JSON.stringify(bottomSection));
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final-05-allocation-news.png'), fullPage: false });

  // ===== RECHECK #6: Sector treemap detail =====
  console.log('\n=== RECHECK #6: Sector treemap hover ===');

  // Scroll to sector performance area
  const sectorPos = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.innerText && el.innerText.trim() === 'SECTOR PERFORMANCE') {
        const rect = el.getBoundingClientRect();
        return { top: rect.top + window.scrollY, found: true };
      }
    }
    return { found: false };
  });

  if (sectorPos.found) {
    await page.evaluate((y) => window.scrollTo(0, y - 50), sectorPos.top);
    await sleep(500);
  }

  const sectorDetail = await page.evaluate(() => {
    const body = document.body.innerText;
    // Get the full sector performance text
    const sectorIdx = body.indexOf('SECTOR PERFORMANCE');
    const sectorText = sectorIdx >= 0 ? body.substring(sectorIdx, sectorIdx + 800) : 'not found';

    // Check for variable-sized tiles (treemap style)
    // Look for sector containers with different widths/heights
    const sectorEls = document.querySelectorAll('[class*="sector"] > div, [class*="treemap"] > div');
    const sizes = [];
    sectorEls.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        sizes.push({ w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    });

    // Check for colored backgrounds indicating gradient
    const coloredSectors = [];
    const allDivs = document.querySelectorAll('div');
    for (const d of allDivs) {
      const bg = window.getComputedStyle(d).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        const text = d.innerText.trim();
        if (text.includes('%') && text.length < 100) {
          coloredSectors.push({ text: text.substring(0, 60), bg });
        }
      }
    }

    // Check sector section height
    const sectorSection = document.querySelector('[class*="sector-perf"], [class*="treemap"]');
    const sectionHeight = sectorSection ? sectorSection.getBoundingClientRect().height : 0;

    return { sectorText, tileSizes: sizes.slice(0, 10), coloredSectors: coloredSectors.slice(0, 5), sectionHeight };
  });

  console.log('Sector text:', sectorDetail.sectorText);
  console.log('Tile sizes:', JSON.stringify(sectorDetail.tileSizes));
  console.log('Colored sectors:', JSON.stringify(sectorDetail.coloredSectors));
  console.log('Section height:', sectorDetail.sectionHeight);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final-06-sector.png'), fullPage: false });

  // Try hovering over a sector to check tooltip
  const hoverResult = await page.evaluate(() => {
    // Find sector performance items to hover
    const items = document.querySelectorAll('[class*="sector"] [class*="item"], [class*="treemap"] > div > div');
    if (items.length > 0) {
      const rect = items[0].getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
    }
    return { found: false };
  });

  if (hoverResult.found) {
    await page.mouse.move(hoverResult.x, hoverResult.y);
    await sleep(1000);
    const tooltip = await page.evaluate(() => {
      const tips = document.querySelectorAll('[role="tooltip"], [class*="tooltip"], [class*="popover"]');
      const tipTexts = [];
      tips.forEach(t => tipTexts.push(t.innerText.trim()));
      return tipTexts;
    });
    console.log('Tooltip text:', JSON.stringify(tooltip));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final-06-sector-hover.png'), fullPage: false });
  }

  // ===== RECHECK #4: Economic Calendar expandable (deeper) =====
  console.log('\n=== RECHECK #4: Economic Calendar expandable ===');

  // Navigate back and scroll to economic calendar
  const econPos = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.innerText && el.innerText.trim() === 'Economic Calendar') {
        const rect = el.getBoundingClientRect();
        return { top: rect.top + window.scrollY, found: true };
      }
    }
    return { found: false };
  });

  if (econPos.found) {
    await page.evaluate((y) => window.scrollTo(0, y - 50), econPos.top);
    await sleep(500);
  }

  // Click on FOMC Meeting Minutes
  const econClick = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.innerText && el.innerText.includes('FOMC') && el.innerText.length < 200) {
        el.click();
        return { clicked: true, text: el.innerText.trim().substring(0, 100) };
      }
    }
    return { clicked: false };
  });
  console.log('FOMC click:', JSON.stringify(econClick));
  await sleep(1000);

  // Check if description expanded
  const econExpand = await page.evaluate(() => {
    const body = document.body.innerText;
    // Look for expanded description text near FOMC
    const fomcIdx = body.indexOf('FOMC');
    const nearFomc = fomcIdx >= 0 ? body.substring(fomcIdx, fomcIdx + 500) : '';
    // A description would typically be longer text explaining the event
    const hasDescription = nearFomc.includes('minutes') || nearFomc.includes('committee') || nearFomc.includes('policy') || nearFomc.includes('rate') || nearFomc.includes('federal');
    return { nearFomc: nearFomc.substring(0, 300), hasDescription };
  });
  console.log('FOMC expanded:', JSON.stringify(econExpand));
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final-04-econ-calendar.png'), fullPage: false });

  // ===== Check #1 deeper: Activity Feed item count =====
  console.log('\n=== RECHECK #1: Activity Feed items ===');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);

  const feedDetail = await page.evaluate(() => {
    const body = document.body.innerText;
    const feedIdx = body.indexOf('Activity Feed');
    const feedText = feedIdx >= 0 ? body.substring(feedIdx, feedIdx + 1500) : '';

    // Count distinct event entries
    const eventPatterns = feedText.match(/Apr \d+|Pipeline completed|Rejected:|candidate\(s\) rejected/g);
    const hasNoNews = !feedText.includes('Headline') && !feedText.includes('headline') && !feedText.includes('Reuters') && !feedText.includes('Bloomberg');
    const hasTimestamps = !!feedText.match(/\d+:\d+ [AP]M/);
    const itemCount = (feedText.match(/Apr \d+ \d+:\d+/g) || []).length;

    return {
      feedText: feedText.substring(0, 800),
      eventCount: eventPatterns ? eventPatterns.length : 0,
      hasNoNews,
      hasTimestamps,
      itemCount
    };
  });

  console.log('Feed text:', feedDetail.feedText);
  console.log('Event count:', feedDetail.eventCount, 'Has timestamps:', feedDetail.hasTimestamps, 'No news:', feedDetail.hasNoNews, 'Items:', feedDetail.itemCount);

  // ===== Check positions clickability on strategy page =====
  console.log('\n=== CHECK #7b: Strategy positions clickable ===');
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Click Positions tab
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button, [role="tab"]');
    for (const btn of buttons) {
      if (btn.innerText.includes('Positions')) { btn.click(); return; }
    }
  });
  await sleep(1500);

  const posInfo = await page.evaluate(() => {
    const body = document.body.innerText;
    const hasEntry = body.includes('Entry') || body.includes('entry') || body.includes('Avg');
    const hasCurrent = body.includes('Current') || body.includes('current') || body.includes('Price');
    const hasPnL = body.includes('P&L') || body.includes('P/L') || body.includes('Gain');
    const hasDaysHeld = body.includes('Days') || body.includes('days') || body.includes('Held');
    const hasMRK = body.includes('MRK');
    return { hasEntry, hasCurrent, hasPnL, hasDaysHeld, hasMRK };
  });
  console.log('Positions tab:', JSON.stringify(posInfo));
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final-07-positions.png'), fullPage: false });

  // Try clicking a position
  const posClick = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr, [class*="position"], [class*="row"]');
    for (const r of rows) {
      if (r.innerText.includes('MRK')) {
        r.click();
        return { clicked: true };
      }
    }
    return { clicked: false };
  });
  await sleep(2000);
  const posUrl = page.url();
  console.log('Position click:', JSON.stringify(posClick), 'URL:', posUrl);

  // ===== Extra: Full-page dashboard screenshot =====
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final-dashboard-full.png'), fullPage: true });

  await browser.close();
  console.log('\n=== Final checks complete ===');
})();
