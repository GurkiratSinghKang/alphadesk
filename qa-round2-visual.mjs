import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE_URL = 'https://tradingalpha.net';
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round2';
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

mkdirSync(SCREENSHOT_DIR, { recursive: true });

let screenshotIndex = 0;
function nextName(label) {
  const idx = String(screenshotIndex++).padStart(2, '0');
  return join(SCREENSHOT_DIR, `${idx}-${label}.png`);
}

async function screenshot(page, label, opts = {}) {
  const path = nextName(label);
  await page.screenshot({ path, fullPage: opts.fullPage ?? true, ...opts });
  console.log(`  [SCREENSHOT] ${path}`);
  return path;
}

async function login(page) {
  console.log('\n=== Step 1: Login Page ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await screenshot(page, 'login-page');

  // Fill credentials
  const allInputs = await page.$$('input');
  if (allInputs.length >= 2) {
    await allInputs[0].fill(USERNAME);
    await allInputs[1].fill(PASSWORD);
  }
  await page.waitForTimeout(500);
  await screenshot(page, 'login-filled');

  // Submit
  const signInBtn = await page.$('button:has-text("Sign In"), button:has-text("Login"), button:has-text("Sign in"), button[type="submit"]');
  if (signInBtn) {
    await signInBtn.click();
  } else if (allInputs.length >= 2) {
    await allInputs[1].press('Enter');
  }

  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});
  await screenshot(page, 'post-login');
  console.log('  Current URL:', page.url());
}

async function captureDashboard(page) {
  console.log('\n=== Step 2: Dashboard (/) ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await screenshot(page, 'dashboard-full');

  // Scroll down to capture below-fold content
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(1000);
  await screenshot(page, 'dashboard-scrolled-mid');

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await screenshot(page, 'dashboard-scrolled-bottom');

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Find strategy links for later navigation
  const strategyLinks = await page.$$eval('a[href*="/strategies/"]', els =>
    els.map(e => ({ href: e.getAttribute('href'), text: e.textContent?.trim().substring(0, 60) }))
  );
  console.log('  Strategy links found:', JSON.stringify(strategyLinks));
  return strategyLinks;
}

async function captureTradePage(page) {
  console.log('\n=== Step 3: Trade Page Full ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await screenshot(page, 'trade-full');

  // === Bottom Panel Tabs ===
  console.log('\n=== Step 4: Trade Page - Bottom Panel Tabs ===');
  const bottomTabs = ['Trade', 'Positions', 'Orders', 'Journal', 'Calendar'];
  for (const tabName of bottomTabs) {
    console.log(`  Clicking bottom tab: ${tabName}`);
    // Try multiple selectors for tabs
    const tab = await page.$(`button:has-text("${tabName}"), [role="tab"]:has-text("${tabName}"), div:has-text("${tabName}") >> nth=0`);
    if (tab) {
      try {
        await tab.click();
        await page.waitForTimeout(1500);
        await screenshot(page, `trade-bottom-${tabName.toLowerCase()}`);
      } catch (e) {
        console.log(`    Could not click ${tabName}: ${e.message.substring(0, 100)}`);
        await screenshot(page, `trade-bottom-${tabName.toLowerCase()}-error`);
      }
    } else {
      console.log(`    Tab "${tabName}" not found`);
      // Try broader search
      const buttons = await page.$$eval('button', els => els.map(e => e.textContent?.trim().substring(0, 40)));
      console.log(`    Available buttons: ${buttons.join(', ')}`);
    }
  }

  // === Right Panel Tabs ===
  console.log('\n=== Step 5: Trade Page - Right Panel Tabs ===');
  const rightTabs = ['Technical', 'Fundamental', 'Sentiment', 'Chat', 'Order'];
  for (const tabName of rightTabs) {
    console.log(`  Clicking right tab: ${tabName}`);
    // Look for tabs in the right panel area
    const allButtons = await page.$$('button');
    let clicked = false;
    for (const btn of allButtons) {
      const text = await btn.textContent().catch(() => '');
      if (text?.trim() === tabName || text?.includes(tabName)) {
        try {
          await btn.click();
          await page.waitForTimeout(1500);
          await screenshot(page, `trade-right-${tabName.toLowerCase()}`);
          clicked = true;
          break;
        } catch (e) {
          console.log(`    Error clicking: ${e.message.substring(0, 100)}`);
        }
      }
    }
    if (!clicked) {
      // Try role=tab
      const tabs = await page.$$('[role="tab"]');
      for (const t of tabs) {
        const text = await t.textContent().catch(() => '');
        if (text?.includes(tabName)) {
          try {
            await t.click();
            await page.waitForTimeout(1500);
            await screenshot(page, `trade-right-${tabName.toLowerCase()}`);
            clicked = true;
            break;
          } catch (e) {
            console.log(`    Tab click error: ${e.message.substring(0, 100)}`);
          }
        }
      }
    }
    if (!clicked) {
      console.log(`    Right tab "${tabName}" not found`);
    }
  }
}

async function capturePipeline(page) {
  console.log('\n=== Step 6: Pipeline Page ===');
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await screenshot(page, 'pipeline-full');

  // Scroll to see full content
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(1000);
  await screenshot(page, 'pipeline-scrolled');
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function captureStrategyDetail(page, strategyLinks) {
  console.log('\n=== Step 7: Strategy Detail Page ===');

  // Try each strategy link
  let navigated = false;
  const strategyPaths = [
    ...(strategyLinks || []).map(l => l.href),
    '/strategies/pead',
    '/strategies/momentum-quality',
    '/strategies/mean-reversion',
  ];

  for (const path of strategyPaths) {
    if (!path) continue;
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    console.log(`  Trying strategy: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(3000);

      // Check if we got an error page
      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '');
      if (bodyText.includes('404') || bodyText.includes('not found')) {
        console.log(`    Got 404 for ${path}`);
        continue;
      }

      await screenshot(page, 'strategy-detail-top');
      navigated = true;

      // Scroll to see more
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
      await page.waitForTimeout(1000);
      await screenshot(page, 'strategy-detail-mid');

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      await screenshot(page, 'strategy-detail-bottom');

      // Check for tabs on strategy page
      const tabs = await page.$$('[role="tab"], button');
      for (const t of tabs) {
        const text = await t.textContent().catch(() => '');
        if (text && ['Backtest', 'Holdings', 'Performance', 'Trades', 'Signals', 'Research'].some(k => text.includes(k))) {
          console.log(`  Clicking strategy tab: ${text.trim()}`);
          try {
            await t.click();
            await page.waitForTimeout(1500);
            await screenshot(page, `strategy-tab-${text.trim().toLowerCase().replace(/\s+/g, '-')}`);
          } catch (e) {
            console.log(`    Tab click error: ${e.message.substring(0, 80)}`);
          }
        }
      }
      break;
    } catch (e) {
      console.log(`    Navigation error: ${e.message.substring(0, 100)}`);
    }
  }

  if (!navigated) {
    // Go to dashboard and click a strategy card
    console.log('  No direct strategy links worked. Trying to click from dashboard...');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Try clicking strategy cards
    const cards = await page.$$('a[href*="strateg"], div[class*="strateg"], [class*="card"]');
    if (cards.length > 0) {
      await cards[0].click();
      await page.waitForTimeout(3000);
      await screenshot(page, 'strategy-detail-from-card');
    } else {
      console.log('  No strategy cards found on dashboard');
    }
  }
}

async function captureCommandPalette(page) {
  console.log('\n=== Step 8: Command Palette ===');
  // First ensure we're on a logged-in page
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Try Ctrl+K / Cmd+K
  try {
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(1500);
    await screenshot(page, 'command-palette-meta-k');

    // Close it
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch (e) {
    console.log(`  Meta+K failed: ${e.message.substring(0, 80)}`);
  }

  try {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(1500);
    await screenshot(page, 'command-palette-ctrl-k');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch (e) {
    console.log(`  Ctrl+K failed: ${e.message.substring(0, 80)}`);
  }

  // Also try clicking search bar/icon if visible
  const searchBtn = await page.$('button:has-text("Search"), [aria-label*="search" i], [aria-label*="Search" i], input[placeholder*="Search" i], [class*="search" i]');
  if (searchBtn) {
    try {
      await searchBtn.click();
      await page.waitForTimeout(1500);
      await screenshot(page, 'command-palette-search-click');
      await page.keyboard.press('Escape');
    } catch (e) {
      console.log(`  Search click failed: ${e.message.substring(0, 80)}`);
    }
  } else {
    console.log('  No search button found');
  }
}

async function captureProfileMenu(page) {
  console.log('\n=== Step 9: Profile Menu ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Look for avatar/profile button in top-right
  const profileSelectors = [
    'button:has(img[alt*="avatar" i])',
    'button:has(img[alt*="profile" i])',
    'button:has(img[alt*="user" i])',
    '[class*="avatar"]',
    '[class*="Avatar"]',
    'button:has(span:has-text("A"))',  // Initial "A" for admin
    'button:has(svg) >> nth=-1',  // Last button with icon (usually profile)
    'header button >> nth=-1',  // Last button in header
    'nav button >> nth=-1',  // Last button in nav
  ];

  for (const sel of profileSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const box = await el.boundingBox();
        if (box && box.x > 800) { // Likely in top-right area
          console.log(`  Found profile element with selector: ${sel}`);
          await el.click();
          await page.waitForTimeout(1500);
          await screenshot(page, 'profile-menu-open');
          await page.keyboard.press('Escape');
          return;
        }
      }
    } catch (e) {
      // Try next selector
    }
  }

  // Broader approach: click all buttons in the top-right area
  const allButtons = await page.$$('button');
  for (let i = allButtons.length - 1; i >= Math.max(0, allButtons.length - 5); i--) {
    const box = await allButtons[i].boundingBox().catch(() => null);
    if (box && box.x > 900 && box.y < 80) {
      console.log(`  Clicking button at (${box.x}, ${box.y})`);
      await allButtons[i].click();
      await page.waitForTimeout(1500);
      await screenshot(page, 'profile-menu-attempt');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  }
}

async function runVisualChecks(page, pageName) {
  const issues = [];

  // 1. Check for bad text patterns
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  const badPatterns = [
    { pattern: /\bNaN\b/g, label: 'NaN value displayed' },
    { pattern: /\bundefined\b/g, label: 'undefined displayed' },
    { pattern: /\[object Object\]/g, label: '[object Object] displayed' },
    { pattern: /\bInfinity\b/g, label: 'Infinity displayed' },
    { pattern: /lorem ipsum/gi, label: 'Placeholder text (Lorem Ipsum)' },
    { pattern: /TODO/g, label: 'TODO in UI text' },
    { pattern: /FIXME/g, label: 'FIXME in UI text' },
    { pattern: /placeholder/gi, label: 'Placeholder text' },
  ];

  for (const { pattern, label } of badPatterns) {
    const matches = bodyText.match(pattern);
    if (matches) {
      issues.push({ page: pageName, issue: label, count: matches.length, severity: 'HIGH' });
    }
  }

  // 2. Check for overflow issues
  const overflows = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth + 5 && rect.width > 50) {
        results.push({
          tag: el.tagName,
          class: el.className?.toString().substring(0, 60),
          right: Math.round(rect.right),
          vw: window.innerWidth,
        });
      }
    });
    return results.slice(0, 10);
  });
  if (overflows.length > 0) {
    issues.push({ page: pageName, issue: `${overflows.length} elements overflow viewport`, severity: 'MEDIUM', details: overflows });
  }

  // 3. Check contrast issues (text too light on background)
  const contrastIssues = await page.evaluate(() => {
    const results = [];
    const textEls = document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, td, th, li, a, label, button');
    for (const el of textEls) {
      const style = window.getComputedStyle(el);
      const color = style.color;
      const bg = style.backgroundColor;
      // Parse rgba values
      const parseColor = (c) => {
        const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
      };
      const fg = parseColor(color);
      const bgC = parseColor(bg);
      if (fg && bgC && bgC.a !== 0) {
        // Simple luminance check
        const lum = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        const diff = Math.abs(lum(fg) - lum(bgC));
        if (diff < 30 && el.textContent?.trim().length > 0) {
          results.push({
            text: el.textContent.trim().substring(0, 40),
            fg: color,
            bg: bg,
            diff,
          });
        }
      }
    }
    return results.slice(0, 5);
  });
  if (contrastIssues.length > 0) {
    issues.push({ page: pageName, issue: `${contrastIssues.length} potential contrast issues`, severity: 'LOW', details: contrastIssues });
  }

  // 4. Check for empty containers (visible but no content)
  const emptyContainers = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('div, section, main, article').forEach(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.height > 100 && rect.width > 200 &&
          el.children.length === 0 &&
          !el.textContent?.trim() &&
          style.display !== 'none' &&
          style.visibility !== 'hidden') {
        results.push({
          tag: el.tagName,
          class: el.className?.toString().substring(0, 60),
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        });
      }
    });
    return results.slice(0, 5);
  });
  if (emptyContainers.length > 0) {
    issues.push({ page: pageName, issue: `${emptyContainers.length} large empty containers`, severity: 'MEDIUM', details: emptyContainers });
  }

  // 5. Check for z-index stacking issues (elements behind others)
  const hiddenElements = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('button, a, input, select, textarea').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const topEl = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
          results.push({
            blocked: el.tagName + '.' + (el.className?.toString().substring(0, 40) || ''),
            by: topEl.tagName + '.' + (topEl.className?.toString().substring(0, 40) || ''),
            text: el.textContent?.trim().substring(0, 30) || '',
          });
        }
      }
    });
    return results.slice(0, 5);
  });
  if (hiddenElements.length > 0) {
    issues.push({ page: pageName, issue: `${hiddenElements.length} interactive elements potentially blocked`, severity: 'HIGH', details: hiddenElements });
  }

  // 6. Console errors
  // Already captured in main flow

  return issues;
}

async function main() {
  console.log('=== AlphaDesk Visual QA - Round 2 ===');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ message: msg.text().substring(0, 200), url: page.url() });
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push({ message: err.message.substring(0, 200), url: page.url(), type: 'pageerror' });
  });

  const allIssues = [];

  try {
    // Step 1: Login
    await login(page);
    const loginIssues = await runVisualChecks(page, 'login');
    allIssues.push(...loginIssues);

    // Step 2: Dashboard
    const strategyLinks = await captureDashboard(page);
    const dashIssues = await runVisualChecks(page, 'dashboard');
    allIssues.push(...dashIssues);

    // Step 3-5: Trade page with all tabs
    await captureTradePage(page);
    const tradeIssues = await runVisualChecks(page, 'trade');
    allIssues.push(...tradeIssues);

    // Step 6: Pipeline
    await capturePipeline(page);
    const pipelineIssues = await runVisualChecks(page, 'pipeline');
    allIssues.push(...pipelineIssues);

    // Step 7: Strategy detail
    await captureStrategyDetail(page, strategyLinks);
    const stratIssues = await runVisualChecks(page, 'strategy-detail');
    allIssues.push(...stratIssues);

    // Step 8: Command palette
    await captureCommandPalette(page);

    // Step 9: Profile menu
    await captureProfileMenu(page);

  } catch (e) {
    console.error('\n[FATAL ERROR]', e.message);
    await screenshot(page, 'fatal-error');
  }

  // Summary
  console.log('\n\n========================================');
  console.log('        VISUAL QA SUMMARY - ROUND 2');
  console.log('========================================\n');

  console.log(`Total screenshots taken: ${screenshotIndex}`);
  console.log(`Console errors: ${consoleErrors.length}`);
  console.log(`Visual issues found: ${allIssues.length}\n`);

  if (allIssues.length > 0) {
    console.log('--- Issues ---');
    for (const issue of allIssues) {
      console.log(`  [${issue.severity}] ${issue.page}: ${issue.issue}${issue.count ? ` (x${issue.count})` : ''}`);
      if (issue.details) {
        for (const d of issue.details.slice(0, 3)) {
          console.log(`    -> ${JSON.stringify(d)}`);
        }
      }
    }
  }

  if (consoleErrors.length > 0) {
    console.log('\n--- Console Errors ---');
    for (const err of consoleErrors.slice(0, 20)) {
      console.log(`  ${err.url}: ${err.message}`);
    }
  }

  console.log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);
  console.log(`Finished: ${new Date().toISOString()}`);

  await browser.close();
}

main().catch(e => {
  console.error('Script failed:', e);
  process.exit(1);
});
