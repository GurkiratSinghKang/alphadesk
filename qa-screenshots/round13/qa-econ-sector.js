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

  // Go to dashboard
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  // ===== ECONOMIC CALENDAR: Click FOMC to expand =====
  console.log('=== Economic Calendar expand test ===');

  // Scroll to economic calendar
  await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.innerText && el.innerText.trim() === 'Economic Calendar') {
        el.scrollIntoView({ block: 'start' });
        break;
      }
    }
  });
  await sleep(500);

  // Take before screenshot
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'econ-before-click.png'), fullPage: false });

  // Find and click FOMC
  const fomcRect = await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      const t = el.innerText || '';
      if (t.includes('FOMC Meeting Minutes') && !t.includes('Non-Farm') && el.children.length < 10) {
        const rect = el.getBoundingClientRect();
        if (rect.height < 100 && rect.height > 10) {
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, h: rect.height, tag: el.tagName, class: String(el.className).substring(0, 100) };
        }
      }
    }
    return null;
  });
  console.log('FOMC element:', JSON.stringify(fomcRect));

  if (fomcRect) {
    await page.mouse.click(fomcRect.x, fomcRect.y);
    await sleep(1500);

    // Check if anything expanded
    const afterClick = await page.evaluate((origH) => {
      const els = document.querySelectorAll('*');
      for (const el of els) {
        const t = el.innerText || '';
        if (t.includes('FOMC Meeting Minutes') && !t.includes('Non-Farm') && el.children.length < 10) {
          const rect = el.getBoundingClientRect();
          if (rect.height > origH + 5) {
            return { expanded: true, newH: rect.height, text: t.substring(0, 300) };
          }
        }
      }
      // Check for any new expanded/description elements
      const descs = document.querySelectorAll('[class*="expand"], [class*="description"], [class*="detail"], [class*="content"][class*="open"], [data-state="open"]');
      const descTexts = [];
      descs.forEach(d => descTexts.push(d.innerText.substring(0, 200)));
      return { expanded: false, descriptions: descTexts };
    }, fomcRect.h);
    console.log('After click:', JSON.stringify(afterClick));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'econ-after-click.png'), fullPage: false });
  }

  // ===== SECTOR TREEMAP: Hover for tooltip =====
  console.log('\n=== Sector Treemap hover test ===');

  // Scroll to sector performance
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(500);

  // Find the Technology sector tile
  const techTile = await page.evaluate(() => {
    const allDivs = document.querySelectorAll('div');
    for (const d of allDivs) {
      const text = d.innerText.trim();
      // Look for a tile that says "Technology" with a compact text
      if (text.startsWith('Technology') && text.includes('%') && text.length < 80) {
        const rect = d.getBoundingClientRect();
        if (rect.width > 30 && rect.height > 20 && rect.width < 500) {
          const bg = window.getComputedStyle(d).backgroundColor;
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            bg,
            text: text.substring(0, 80)
          };
        }
      }
    }
    return null;
  });
  console.log('Tech tile:', JSON.stringify(techTile));

  if (techTile) {
    await page.mouse.move(techTile.x, techTile.y);
    await sleep(1500);

    const tooltip = await page.evaluate(() => {
      const tips = document.querySelectorAll('[role="tooltip"], [class*="tooltip"], [data-state="open"], [class*="popover"]');
      const results = [];
      tips.forEach(t => results.push({ text: t.innerText.trim().substring(0, 200), class: String(t.className).substring(0, 100) }));
      return results;
    });
    console.log('Tooltip after hover:', JSON.stringify(tooltip));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'sector-hover-tooltip.png'), fullPage: false });
  }

  // Check the sector tile sizes (are they different = treemap style?)
  const tileSizes = await page.evaluate(() => {
    // Find all direct children of sector performance container
    const allDivs = document.querySelectorAll('div');
    const sectorContainer = [];
    for (const d of allDivs) {
      const text = d.innerText.trim();
      if (text.startsWith('Technology') && text.includes('Financials') && text.includes('NVDA')) {
        // This is likely the sector performance container
        const children = d.children;
        const sizes = [];
        for (const c of children) {
          const r = c.getBoundingClientRect();
          if (r.width > 20 && r.height > 20) {
            const bg = window.getComputedStyle(c).backgroundColor;
            sizes.push({
              text: c.innerText.trim().substring(0, 40),
              w: Math.round(r.width),
              h: Math.round(r.height),
              bg
            });
          }
        }
        if (sizes.length > 0) return sizes;
      }
    }
    return [];
  });
  console.log('Tile sizes (treemap check):', JSON.stringify(tileSizes));

  // Check if sector heights are different (true treemap) or same (grid)
  if (tileSizes.length > 1) {
    const heights = tileSizes.map(t => t.h);
    const widths = tileSizes.map(t => t.w);
    const allSameHeight = heights.every(h => Math.abs(h - heights[0]) < 5);
    const allSameWidth = widths.every(w => Math.abs(w - widths[0]) < 5);
    console.log('All same height:', allSameHeight, 'All same width:', allSameWidth);
    console.log('Heights:', heights);
    console.log('Widths:', widths);
    if (!allSameHeight || !allSameWidth) {
      console.log('TREEMAP CONFIRMED: tiles have different sizes');
    } else {
      console.log('GRID LAYOUT: tiles are uniform, not a true treemap');
    }
  }

  // ===== Check the YTD toggle =====
  console.log('\n=== YTD Toggle test ===');
  const ytdClicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      if (b.innerText.trim() === 'YTD') {
        b.click();
        return true;
      }
    }
    return false;
  });
  console.log('YTD clicked:', ytdClicked);
  await sleep(1000);

  const ytdData = await page.evaluate(() => {
    const body = document.body.innerText;
    const sectorIdx = body.indexOf('SECTOR PERFORMANCE');
    return sectorIdx >= 0 ? body.substring(sectorIdx, sectorIdx + 500) : 'not found';
  });
  console.log('After YTD toggle:', ytdData);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'sector-ytd-toggle.png'), fullPage: false });

  await browser.close();
  console.log('\n=== Done ===');
})();
