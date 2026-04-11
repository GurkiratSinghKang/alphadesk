import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'https://tradingalpha.net';
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/expert-ux';
const USERNAME = 'admin';
const PASSWORD = 'GK1355$$gk';

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function safeScreenshot(page, path, opts = {}) {
  try {
    await page.screenshot({ path, ...opts });
    console.log(`  [OK] ${path.split('/').pop()}`);
  } catch (e) {
    console.log(`  [FAIL] ${path.split('/').pop()}: ${e.message}`);
  }
}

async function cropSection(page, filename, clip) {
  await safeScreenshot(page, join(SCREENSHOT_DIR, filename), { clip });
}

async function fullPage(page, filename) {
  await safeScreenshot(page, join(SCREENSHOT_DIR, filename), { fullPage: true });
}

async function viewport(page, filename) {
  await safeScreenshot(page, join(SCREENSHOT_DIR, filename));
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ─── 1920x1080 Desktop Session ───────────────────────────────
  console.log('\n=== DESKTOP 1920x1080 SESSION ===');
  const desktopCtx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
    ignoreHTTPSErrors: true,
  });
  const page = await desktopCtx.newPage();

  // ─── LOGIN PAGE ──────────────────────────────────────────────
  console.log('\n--- Login Page ---');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await fullPage(page, '01-login-empty.png');
  await cropSection(page, '01-login-form-crop.png', { x: 560, y: 240, width: 800, height: 600 });

  // Fill credentials
  const inputs = await page.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].fill(USERNAME);
    await inputs[1].fill(PASSWORD);
  }
  await page.waitForTimeout(500);
  await fullPage(page, '01-login-filled.png');

  // Submit login
  const signInBtn = await page.$('button[type="submit"], button:has-text("Sign In"), button:has-text("Login")');
  if (signInBtn) {
    await signInBtn.click();
  }
  await page.waitForTimeout(5000);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('  Logged in, URL:', page.url());

  // ─── DASHBOARD PAGE ─────────────────────────────────────────
  console.log('\n--- Dashboard Page ---');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Full page
  await fullPage(page, '02-dashboard-full.png');
  await viewport(page, '02-dashboard-viewport.png');

  // Section crops
  await cropSection(page, '02-dash-topbar.png', { x: 0, y: 0, width: 1920, height: 44 });
  await cropSection(page, '02-dash-status-strip.png', { x: 0, y: 44, width: 1920, height: 30 });
  await cropSection(page, '02-dash-hero-section.png', { x: 0, y: 74, width: 1920, height: 280 });
  await cropSection(page, '02-dash-portfolio-hero.png', { x: 0, y: 74, width: 700, height: 280 });
  await cropSection(page, '02-dash-market-context.png', { x: 700, y: 74, width: 1220, height: 280 });
  await cropSection(page, '02-dash-mid-section.png', { x: 0, y: 340, width: 1920, height: 400 });
  await cropSection(page, '02-dash-positions-table.png', { x: 0, y: 340, width: 960, height: 400 });
  await cropSection(page, '02-dash-calendar.png', { x: 960, y: 340, width: 960, height: 400 });
  await cropSection(page, '02-dash-bottom-section.png', { x: 0, y: 700, width: 1920, height: 380 });
  await cropSection(page, '02-dash-strategy-grid.png', { x: 0, y: 700, width: 1300, height: 380 });
  await cropSection(page, '02-dash-activity-feed.png', { x: 1300, y: 700, width: 620, height: 380 });

  // Scroll down for below-fold content
  await page.evaluate(() => {
    const scrollable = document.querySelector('[data-radix-scroll-area-viewport]') || document.querySelector('main');
    if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
  });
  await page.waitForTimeout(1500);
  await viewport(page, '02-dashboard-scrolled.png');

  // ─── TRADE PAGE ──────────────────────────────────────────────
  console.log('\n--- Trade Page ---');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  await fullPage(page, '03-trade-full.png');
  await viewport(page, '03-trade-viewport.png');

  // Section crops
  await cropSection(page, '03-trade-watchlist.png', { x: 0, y: 44, width: 240, height: 1036 });
  await cropSection(page, '03-trade-chart.png', { x: 240, y: 44, width: 1000, height: 550 });
  await cropSection(page, '03-trade-options-chain.png', { x: 240, y: 550, width: 1000, height: 530 });
  await cropSection(page, '03-trade-analysis.png', { x: 1240, y: 44, width: 300, height: 1036 });
  await cropSection(page, '03-trade-order-panel.png', { x: 1540, y: 44, width: 380, height: 1036 });
  await cropSection(page, '03-trade-topbar-nav.png', { x: 0, y: 0, width: 1920, height: 44 });

  // Interact with watchlist - click a symbol if available
  const symbolBtn = await page.$('[class*="watchlist"] button, [class*="Watchlist"] button');
  if (symbolBtn) {
    await symbolBtn.click();
    await page.waitForTimeout(2000);
    await viewport(page, '03-trade-symbol-selected.png');
  }

  // Check hover states on watchlist items
  const watchlistItems = await page.$$('button:has-text("AAPL"), button:has-text("MSFT"), button:has-text("GOOGL")');
  for (const item of watchlistItems.slice(0, 1)) {
    await item.hover();
    await page.waitForTimeout(500);
    await cropSection(page, '03-trade-watchlist-hover.png', { x: 0, y: 44, width: 240, height: 400 });
  }

  // ─── PIPELINE PAGE ──────────────────────────────────────────
  console.log('\n--- Pipeline Page ---');
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  await fullPage(page, '04-pipeline-full.png');
  await viewport(page, '04-pipeline-viewport.png');

  // Section crops
  await cropSection(page, '04-pipeline-header.png', { x: 0, y: 44, width: 1920, height: 200 });
  await cropSection(page, '04-pipeline-table.png', { x: 0, y: 244, width: 1920, height: 600 });
  await cropSection(page, '04-pipeline-controls.png', { x: 0, y: 44, width: 1920, height: 100 });

  // Try expanding a pipeline row
  const expandBtn = await page.$('button:has(svg.lucide-chevron-right), button:has(svg.lucide-chevron-down)');
  if (expandBtn) {
    await expandBtn.click();
    await page.waitForTimeout(1500);
    await viewport(page, '04-pipeline-expanded.png');
    await cropSection(page, '04-pipeline-expanded-detail.png', { x: 0, y: 244, width: 1920, height: 600 });
  }

  // ─── STRATEGY DETAIL PAGES ──────────────────────────────────
  console.log('\n--- Strategy Detail Pages ---');
  const strategyIds = [
    'momentum-quality',
    'pead',
    'vrp-harvesting',
    'earnings-vol-premium',
    'regime-adaptive',
  ];

  for (const sid of strategyIds) {
    console.log(`  Strategy: ${sid}`);
    await page.goto(`${BASE_URL}/strategies/${sid}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    await fullPage(page, `05-strategy-${sid}-full.png`);
    await viewport(page, `05-strategy-${sid}-viewport.png`);

    // Crop header area
    await cropSection(page, `05-strategy-${sid}-header.png`, { x: 0, y: 44, width: 1920, height: 250 });

    // Scroll down for more content
    await page.evaluate(() => {
      const scrollable = document.querySelector('[data-radix-scroll-area-viewport]') || document.querySelector('main');
      if (scrollable) scrollable.scrollTop = 600;
    });
    await page.waitForTimeout(1000);
    await viewport(page, `05-strategy-${sid}-scrolled.png`);
  }

  // ─── COMMAND PALETTE ─────────────────────────────────────────
  console.log('\n--- Command Palette ---');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(1000);
  await viewport(page, '06-command-palette.png');
  await cropSection(page, '06-command-palette-crop.png', { x: 460, y: 150, width: 1000, height: 500 });

  // Type something to test search
  await page.keyboard.type('AAPL');
  await page.waitForTimeout(1000);
  await viewport(page, '06-command-palette-search.png');
  await page.keyboard.press('Escape');

  // ─── NOTIFICATION BELL ──────────────────────────────────────
  console.log('\n--- Notifications ---');
  const bellBtn = await page.$('button:has(svg.lucide-bell)');
  if (bellBtn) {
    await bellBtn.click();
    await page.waitForTimeout(1000);
    await viewport(page, '07-notifications.png');
    await cropSection(page, '07-notifications-crop.png', { x: 1400, y: 0, width: 520, height: 500 });
  }

  // ─── PROFILE MENU ──────────────────────────────────────────
  console.log('\n--- Profile Menu ---');
  const profileBtn = await page.$('button:has(svg.lucide-user), [class*="profile"], [class*="Profile"]');
  if (profileBtn) {
    await profileBtn.click();
    await page.waitForTimeout(1000);
    await viewport(page, '08-profile-menu.png');
    await cropSection(page, '08-profile-menu-crop.png', { x: 1600, y: 0, width: 320, height: 400 });
  }

  // ─── EMPTY STATES - Navigate to non-existent strategy ──────
  console.log('\n--- Empty States ---');
  await page.goto(`${BASE_URL}/strategies/nonexistent-strategy`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await viewport(page, '09-empty-state-strategy.png');

  // ─── HOVER STATES & MICRO-INTERACTIONS ─────────────────────
  console.log('\n--- Hover States ---');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Hover over nav items
  const navButtons = await page.$$('nav button');
  for (let i = 0; i < Math.min(navButtons.length, 3); i++) {
    await navButtons[i].hover();
    await page.waitForTimeout(400);
  }
  await cropSection(page, '10-hover-nav.png', { x: 0, y: 0, width: 500, height: 44 });

  // Hover over strategy cards
  const strategyCards = await page.$$('[class*="card"], [class*="Card"]');
  if (strategyCards.length > 0) {
    await strategyCards[0].hover();
    await page.waitForTimeout(400);
    await viewport(page, '10-hover-strategy-card.png');
  }

  // ─── LOADING STATES ────────────────────────────────────────
  console.log('\n--- Loading States ---');
  // Force a reload to catch loading state
  const loadingPromise = page.goto(`${BASE_URL}/`, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForTimeout(300);
  await viewport(page, '11-loading-state.png');
  await loadingPromise;

  // ─── 1366x768 LAPTOP SESSION ───────────────────────────────
  console.log('\n=== LAPTOP 1366x768 SESSION ===');
  const laptopCtx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    colorScheme: 'dark',
    ignoreHTTPSErrors: true,
  });
  const laptopPage = await laptopCtx.newPage();

  // Login on laptop viewport
  await laptopPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await laptopPage.waitForTimeout(2000);
  const laptopInputs = await laptopPage.$$('input');
  if (laptopInputs.length >= 2) {
    await laptopInputs[0].fill(USERNAME);
    await laptopInputs[1].fill(PASSWORD);
  }
  const laptopSignIn = await laptopPage.$('button[type="submit"], button:has-text("Sign In"), button:has-text("Login")');
  if (laptopSignIn) await laptopSignIn.click();
  await laptopPage.waitForTimeout(5000);
  await laptopPage.waitForLoadState('networkidle').catch(() => {});
  console.log('  Laptop logged in:', laptopPage.url());

  // Dashboard at laptop resolution
  await laptopPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await laptopPage.waitForTimeout(4000);
  await fullPage(laptopPage, '12-laptop-dashboard-full.png');
  await viewport(laptopPage, '12-laptop-dashboard-viewport.png');

  // Trade at laptop resolution
  await laptopPage.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await laptopPage.waitForTimeout(4000);
  await fullPage(laptopPage, '13-laptop-trade-full.png');
  await viewport(laptopPage, '13-laptop-trade-viewport.png');

  // Pipeline at laptop resolution
  await laptopPage.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await laptopPage.waitForTimeout(4000);
  await fullPage(laptopPage, '14-laptop-pipeline-full.png');
  await viewport(laptopPage, '14-laptop-pipeline-viewport.png');

  // Strategy detail at laptop resolution
  await laptopPage.goto(`${BASE_URL}/strategies/momentum-quality`, { waitUntil: 'networkidle', timeout: 30000 });
  await laptopPage.waitForTimeout(3000);
  await fullPage(laptopPage, '15-laptop-strategy-full.png');
  await viewport(laptopPage, '15-laptop-strategy-viewport.png');

  await laptopCtx.close();

  // ─── CSS/TYPOGRAPHY AUDIT ──────────────────────────────────
  console.log('\n=== CSS/TYPOGRAPHY AUDIT ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const cssAudit = await page.evaluate(() => {
    const results = {
      fontFamilies: new Set(),
      fontSizes: new Set(),
      fontWeights: new Set(),
      colors: new Set(),
      backgrounds: new Set(),
      borderColors: new Set(),
      spacingValues: new Set(),
      tabularNums: [],
      numberElements: [],
    };

    const elements = document.querySelectorAll('*');
    const sampleSize = Math.min(elements.length, 500);

    for (let i = 0; i < sampleSize; i++) {
      const el = elements[i];
      const style = getComputedStyle(el);
      results.fontFamilies.add(style.fontFamily.split(',')[0].trim());
      results.fontSizes.add(style.fontSize);
      results.fontWeights.add(style.fontWeight);

      if (style.color !== 'rgba(0, 0, 0, 0)') results.colors.add(style.color);
      if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') results.backgrounds.add(style.backgroundColor);
    }

    // Check for tabular-nums on numeric content
    const allTextElements = document.querySelectorAll('span, p, div, td, th');
    allTextElements.forEach(el => {
      const text = el.textContent?.trim() || '';
      if (/^\$?[\d,.]+%?$/.test(text) && text.length > 1) {
        const style = getComputedStyle(el);
        results.numberElements.push({
          text: text.substring(0, 30),
          fontVariantNumeric: style.fontVariantNumeric,
          fontFeatureSettings: style.fontFeatureSettings,
          fontFamily: style.fontFamily.split(',')[0].trim(),
        });
      }
    });

    return {
      fontFamilies: [...results.fontFamilies],
      fontSizes: [...results.fontSizes].sort(),
      fontWeights: [...results.fontWeights],
      colors: [...results.colors].slice(0, 20),
      backgrounds: [...results.backgrounds].slice(0, 15),
      numberElements: results.numberElements.slice(0, 15),
    };
  });

  console.log('  Font families:', cssAudit.fontFamilies);
  console.log('  Font sizes:', cssAudit.fontSizes.length, 'unique');
  console.log('  Font weights:', cssAudit.fontWeights);
  console.log('  Number elements with tabular-nums:',
    cssAudit.numberElements.filter(n => n.fontVariantNumeric?.includes('tabular')).length,
    '/', cssAudit.numberElements.length);

  // ─── COLOR AUDIT ───────────────────────────────────────────
  console.log('\n=== COLOR AUDIT ===');
  const colorAudit = await page.evaluate(() => {
    const results = {
      greenElements: [],
      redElements: [],
      contrastIssues: [],
    };

    function luminance(r, g, b) {
      const a = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }

    function parseColor(colorStr) {
      const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
      return null;
    }

    function contrastRatio(l1, l2) {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const textElements = document.querySelectorAll('span, p, div, td, th, button, a, h1, h2, h3, h4, h5, h6');
    const sampleSize = Math.min(textElements.length, 300);

    for (let i = 0; i < sampleSize; i++) {
      const el = textElements[i];
      const style = getComputedStyle(el);
      const textColor = parseColor(style.color);
      const bgColor = parseColor(style.backgroundColor);
      const text = el.textContent?.trim()?.substring(0, 50);

      if (textColor) {
        if (textColor.g > textColor.r * 1.5 && textColor.g > textColor.b * 1.5) {
          results.greenElements.push({ text, color: style.color });
        }
        if (textColor.r > textColor.g * 1.5 && textColor.r > textColor.b * 1.5) {
          results.redElements.push({ text, color: style.color });
        }
      }

      // Check contrast
      if (textColor && text && text.length > 0) {
        let parentBg = null;
        let parent = el.parentElement;
        while (parent && !parentBg) {
          const pbg = parseColor(getComputedStyle(parent).backgroundColor);
          if (pbg && (pbg.r > 0 || pbg.g > 0 || pbg.b > 0)) parentBg = pbg;
          parent = parent.parentElement;
        }
        if (parentBg) {
          const l1 = luminance(textColor.r, textColor.g, textColor.b);
          const l2 = luminance(parentBg.r, parentBg.g, parentBg.b);
          const ratio = contrastRatio(l1, l2);
          if (ratio < 3.0 && text.length > 0) {
            results.contrastIssues.push({ text, ratio: ratio.toFixed(2), color: style.color, bg: getComputedStyle(parent || el).backgroundColor });
          }
        }
      }
    }

    return results;
  });

  console.log('  Green elements:', colorAudit.greenElements.length);
  console.log('  Red elements:', colorAudit.redElements.length);
  console.log('  Low contrast issues:', colorAudit.contrastIssues.length);

  // ─── SPACING CONSISTENCY AUDIT ─────────────────────────────
  console.log('\n=== SPACING AUDIT ===');
  const spacingAudit = await page.evaluate(() => {
    const gaps = new Map();
    const paddings = new Map();
    const margins = new Map();

    const elements = document.querySelectorAll('div, section, main, aside, header, nav');
    const sampleSize = Math.min(elements.length, 200);

    for (let i = 0; i < sampleSize; i++) {
      const style = getComputedStyle(elements[i]);

      if (style.gap && style.gap !== 'normal') {
        gaps.set(style.gap, (gaps.get(style.gap) || 0) + 1);
      }

      const pad = `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`;
      if (pad !== '0px 0px 0px 0px') {
        paddings.set(pad, (paddings.get(pad) || 0) + 1);
      }
    }

    return {
      gaps: Object.fromEntries([...gaps].sort((a, b) => b[1] - a[1]).slice(0, 15)),
      paddings: Object.fromEntries([...paddings].sort((a, b) => b[1] - a[1]).slice(0, 15)),
    };
  });

  console.log('  Gap values:', Object.keys(spacingAudit.gaps).length, 'unique');
  console.log('  Padding values:', Object.keys(spacingAudit.paddings).length, 'unique');

  // ─── WRITE AUDIT DATA ──────────────────────────────────────
  const auditData = {
    timestamp: new Date().toISOString(),
    cssAudit,
    colorAudit: {
      greenCount: colorAudit.greenElements.length,
      redCount: colorAudit.redElements.length,
      greenSamples: colorAudit.greenElements.slice(0, 10),
      redSamples: colorAudit.redElements.slice(0, 10),
      contrastIssues: colorAudit.contrastIssues.slice(0, 20),
    },
    spacingAudit,
  };

  const { writeFileSync } = await import('fs');
  writeFileSync(join(SCREENSHOT_DIR, 'audit-data.json'), JSON.stringify(auditData, null, 2));
  console.log('\nAudit data saved to audit-data.json');

  await desktopCtx.close();
  await browser.close();
  console.log('\n=== DONE ===');
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
