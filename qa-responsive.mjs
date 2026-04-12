import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'https://tradingalpha.net';
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/responsive';
const USERNAME = 'admin';
const PASSWORD = 'GK1355$$gk';

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ---------- Viewports ----------
const VIEWPORTS = [
  { width: 1920, height: 1080, label: 'Full HD Desktop' },
  { width: 1366, height: 768,  label: 'Common Laptop' },
  { width: 1280, height: 720,  label: 'Small Laptop' },
  { width: 1024, height: 768,  label: 'iPad Landscape' },
  { width: 768,  height: 1024, label: 'iPad Portrait' },
  { width: 375,  height: 812,  label: 'iPhone' },
];

// ---------- Pages ----------
const PAGES = [
  { path: '/',                name: 'dashboard',       label: 'Dashboard' },
  { path: '/trade',           name: 'trade',           label: 'Trade' },
  { path: '/pipeline',        name: 'pipeline',        label: 'Pipeline' },
  { path: '/strategies/pead', name: 'strategies-pead', label: 'Strategies PEAD' },
];

// ---------- Key element selectors per page ----------
const KEY_ELEMENTS = {
  common: [
    { sel: 'nav, [role="navigation"], .nav-tabs, .MuiTabs-root, [class*="nav"], [class*="Nav"], [class*="sidebar"], [class*="Sidebar"]', name: 'Navigation tabs' },
    { sel: 'input[type="search"], input[placeholder*="earch"], input[placeholder*="ticker"], [class*="search"], [class*="Search"]', name: 'Search bar' },
  ],
  '/': [
    { sel: '[class*="portfolio"], [class*="Portfolio"], [class*="total"], [class*="value"], [class*="balance"]', name: 'Portfolio value' },
  ],
  '/trade': [
    { sel: 'canvas, svg, [class*="chart"], [class*="Chart"], .recharts-wrapper, .tradingview-widget, [class*="tradingview"]', name: 'Chart' },
    { sel: '[class*="watchlist"], [class*="Watchlist"], [class*="watch-list"]', name: 'Watchlist' },
  ],
  '/pipeline': [],
  '/strategies/pead': [],
};

// ---------- Login ----------
async function login(page) {
  console.log('\n=== Logging in ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const allInputs = await page.$$('input');
  if (allInputs.length >= 2) {
    await allInputs[0].fill(USERNAME);
    await allInputs[1].fill(PASSWORD);
  } else {
    await page.getByLabel(/username/i).fill(USERNAME);
    await page.getByLabel(/password/i).fill(PASSWORD);
  }
  await page.waitForTimeout(500);

  const signInBtn = await page.$('button:has-text("Sign In"), button:has-text("Login"), button:has-text("Sign in"), button[type="submit"]');
  if (signInBtn) {
    await signInBtn.click();
  } else if (allInputs.length >= 2) {
    await allInputs[1].press('Enter');
  }

  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('  Login completed. Current URL:', page.url());
}

// ---------- Responsive checks ----------
async function checkHorizontalOverflow(page) {
  return page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
}

async function countOverflowingElements(page) {
  return page.evaluate(() => {
    const all = document.querySelectorAll('*');
    let count = 0;
    const overflowing = [];
    for (const el of all) {
      if (el.scrollWidth > el.clientWidth + 1) { // +1 for rounding tolerance
        // Skip the root html/body as they are checked separately
        if (el.tagName === 'HTML' || el.tagName === 'BODY') continue;
        // Only count visible elements
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        // Skip elements with overflow:hidden/scroll/auto since they handle it
        if (['hidden', 'scroll', 'auto'].includes(style.overflowX)) continue;

        count++;
        if (overflowing.length < 10) {
          overflowing.push({
            tag: el.tagName.toLowerCase(),
            className: (el.className?.toString() || '').substring(0, 80),
            id: el.id || '',
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            text: (el.textContent || '').substring(0, 60).trim(),
          });
        }
      }
    }
    return { count, overflowing };
  });
}

async function findTruncatedText(page) {
  return page.evaluate(() => {
    const all = document.querySelectorAll('*');
    let count = 0;
    const truncated = [];
    for (const el of all) {
      // Only check leaf text nodes or short-content elements
      if (el.children.length > 3) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const isTextTruncated = (
        el.scrollWidth > el.clientWidth + 1 &&
        (style.textOverflow === 'ellipsis' || style.whiteSpace === 'nowrap' || style.overflow === 'hidden')
      );

      if (isTextTruncated) {
        count++;
        if (truncated.length < 10) {
          truncated.push({
            tag: el.tagName.toLowerCase(),
            className: (el.className?.toString() || '').substring(0, 80),
            text: (el.textContent || '').substring(0, 80).trim(),
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          });
        }
      }
    }
    return { count, truncated };
  });
}

async function checkKeyElements(page, pagePath) {
  const selectors = [...(KEY_ELEMENTS.common || []), ...(KEY_ELEMENTS[pagePath] || [])];
  const results = [];

  for (const { sel, name } of selectors) {
    const info = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return { found: false, visible: false, clipped: false };

      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const visible = (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0
      );

      // Check if clipped by viewport
      const clipped = (
        rect.right > window.innerWidth ||
        rect.bottom > window.innerHeight * 3 || // allow scrolling
        rect.left < -10 ||
        rect.top < -10
      );

      return {
        found: true,
        visible,
        clipped,
        rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
      };
    }, sel);

    results.push({ name, selector: sel, ...info });
  }

  return results;
}

// ---------- Main ----------
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Login at full desktop size first
  await login(page);

  // Store auth cookies
  const cookies = await context.cookies();

  const results = { viewports: [], issues: [], summary: {} };
  let totalIssues = 0;

  for (const vp of VIEWPORTS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`VIEWPORT: ${vp.width}x${vp.height} (${vp.label})`);
    console.log('='.repeat(60));

    // Create a new context per viewport so the size is clean
    const vpContext = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ignoreHTTPSErrors: true,
    });
    await vpContext.addCookies(cookies);
    const vpPage = await vpContext.newPage();

    const vpResult = {
      width: vp.width,
      height: vp.height,
      label: vp.label,
      pages: [],
    };

    for (const pg of PAGES) {
      console.log(`\n  --- ${pg.label} (${pg.path}) ---`);

      try {
        await vpPage.goto(`${BASE_URL}${pg.path}`, { waitUntil: 'networkidle', timeout: 30000 });
      } catch (e) {
        console.log(`  [WARN] Navigation timeout, continuing: ${e.message.substring(0, 80)}`);
        // Continue anyway, page may have loaded partially
      }
      await vpPage.waitForTimeout(3000);

      // Screenshot
      const screenshotName = `${pg.name}-${vp.width}x${vp.height}.png`;
      await vpPage.screenshot({
        path: join(SCREENSHOT_DIR, screenshotName),
        fullPage: true,
      });
      console.log(`  Screenshot: ${screenshotName}`);

      // 1. Horizontal overflow
      const horizontalOverflow = await checkHorizontalOverflow(vpPage);
      console.log(`  Horizontal overflow: ${horizontalOverflow}`);

      // 2. Overflowing elements
      const { count: overflowCount, overflowing: overflowDetails } = await countOverflowingElements(vpPage);
      console.log(`  Overflowing elements: ${overflowCount}`);
      if (overflowDetails.length > 0) {
        for (const o of overflowDetails.slice(0, 5)) {
          console.log(`    -> <${o.tag}> class="${o.className}" scrollW=${o.scrollWidth} clientW=${o.clientWidth}`);
        }
      }

      // 3. Key elements
      const keyElements = await checkKeyElements(vpPage, pg.path);
      for (const ke of keyElements) {
        const status = !ke.found ? 'NOT FOUND' : (!ke.visible ? 'HIDDEN' : (ke.clipped ? 'CLIPPED' : 'OK'));
        const icon = status === 'OK' ? 'OK' : 'ISSUE';
        console.log(`  [${icon}] ${ke.name}: ${status}`);
        if (status !== 'OK' && status !== 'NOT FOUND') {
          totalIssues++;
          results.issues.push({
            viewport: `${vp.width}x${vp.height}`,
            page: pg.path,
            element: ke.name,
            status,
            rect: ke.rect,
          });
        }
      }

      // 4. Truncated text
      const { count: truncatedCount, truncated: truncatedDetails } = await findTruncatedText(vpPage);
      console.log(`  Truncated text elements: ${truncatedCount}`);
      if (truncatedDetails.length > 0) {
        for (const t of truncatedDetails.slice(0, 5)) {
          console.log(`    -> <${t.tag}> "${t.text.substring(0, 40)}" scrollW=${t.scrollWidth} clientW=${t.clientWidth}`);
        }
      }

      // 5. Page-level DOM dimensions
      const dims = await vpPage.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      }));

      const pageResult = {
        path: pg.path,
        name: pg.name,
        screenshot: screenshotName,
        horizontalOverflow,
        overflowingElements: overflowCount,
        overflowDetails: overflowDetails.slice(0, 5),
        truncatedText: truncatedCount,
        truncatedDetails: truncatedDetails.slice(0, 5),
        keyElements,
        dimensions: dims,
      };

      vpResult.pages.push(pageResult);

      if (horizontalOverflow) {
        totalIssues++;
        results.issues.push({
          viewport: `${vp.width}x${vp.height}`,
          page: pg.path,
          element: 'page',
          status: 'HORIZONTAL_OVERFLOW',
          scrollWidth: dims.scrollWidth,
          clientWidth: dims.clientWidth,
        });
      }
    }

    results.viewports.push(vpResult);
    await vpContext.close();
  }

  // ---------- Summary ----------
  console.log(`\n${'='.repeat(60)}`);
  console.log('RESPONSIVE AUDIT SUMMARY');
  console.log('='.repeat(60));

  // Identify breakpoints where UI becomes unusable
  const breakpoints = [];
  for (const vp of results.viewports) {
    let vpIssueCount = 0;
    let hasOverflow = false;
    let hiddenCritical = [];

    for (const pg of vp.pages) {
      if (pg.horizontalOverflow) { vpIssueCount++; hasOverflow = true; }
      vpIssueCount += pg.overflowingElements;

      for (const ke of pg.keyElements) {
        if (!ke.visible && ke.found) {
          vpIssueCount++;
          hiddenCritical.push(`${ke.name} on ${pg.path}`);
        }
      }
    }

    if (vpIssueCount > 5 || hasOverflow || hiddenCritical.length > 0) {
      breakpoints.push({
        viewport: `${vp.width}x${vp.height}`,
        label: vp.label,
        issueCount: vpIssueCount,
        horizontalOverflow: hasOverflow,
        hiddenCriticalElements: hiddenCritical,
        severity: vpIssueCount > 10 ? 'CRITICAL' : vpIssueCount > 5 ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  results.summary = {
    totalViewports: VIEWPORTS.length,
    totalPages: PAGES.length,
    totalTests: VIEWPORTS.length * PAGES.length,
    totalIssues,
    problematicBreakpoints: breakpoints,
    timestamp: new Date().toISOString(),
  };

  console.log(`\nTotal viewports tested: ${VIEWPORTS.length}`);
  console.log(`Total pages tested per viewport: ${PAGES.length}`);
  console.log(`Total issues found: ${totalIssues}`);

  if (breakpoints.length > 0) {
    console.log('\n--- PROBLEMATIC BREAKPOINTS ---');
    for (const bp of breakpoints) {
      console.log(`  [${bp.severity}] ${bp.viewport} (${bp.label}): ${bp.issueCount} issues`);
      if (bp.horizontalOverflow) console.log(`    -> Horizontal overflow detected`);
      for (const h of bp.hiddenCriticalElements) {
        console.log(`    -> Hidden: ${h}`);
      }
    }
  } else {
    console.log('\nNo critical breakpoints found - UI appears responsive across all tested sizes.');
  }

  // Overflow summary per viewport
  console.log('\n--- OVERFLOW SUMMARY ---');
  for (const vp of results.viewports) {
    const overflows = vp.pages.filter(p => p.horizontalOverflow);
    const totalOverflowing = vp.pages.reduce((s, p) => s + p.overflowingElements, 0);
    const totalTruncated = vp.pages.reduce((s, p) => s + p.truncatedText, 0);
    console.log(`  ${vp.width}x${vp.height}: pageOverflow=${overflows.length}/${vp.pages.length} | elemOverflow=${totalOverflowing} | truncated=${totalTruncated}`);
  }

  // Save results
  const resultsPath = join(SCREENSHOT_DIR, 'results.json');
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${resultsPath}`);

  await browser.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
