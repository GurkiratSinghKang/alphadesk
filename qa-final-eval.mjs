import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
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
const OUT = '/Users/GK/Downloads/alphadesk/qa-screenshots/final-eval';
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

mkdirSync(OUT, { recursive: true });

// Collect all observations for the final evaluation
const observations = {};

function observe(page, section, note) {
  if (!observations[page]) observations[page] = {};
  if (!observations[page][section]) observations[page][section] = [];
  observations[page][section].push(note);
  console.log(`  [${page}/${section}] ${note}`);
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  const inputs = await page.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].fill(USERNAME);
    await inputs[1].fill(PASSWORD);
  }
  const btn = await page.$('button:has-text("Sign In"), button:has-text("Log In"), button[type="submit"]');
  if (btn) await btn.click();
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('Logged in, URL:', page.url());
}

async function safeScreenshot(page, name, opts = {}) {
  try {
    await page.screenshot({ path: join(OUT, name), ...opts });
    console.log(`  -> saved ${name}`);
  } catch (e) {
    console.log(`  !! screenshot failed: ${name} — ${e.message}`);
  }
}

async function cropSection(page, name, clip) {
  // Guard against out-of-bounds clips
  const vp = page.viewportSize();
  const safeClip = {
    x: Math.max(0, clip.x),
    y: Math.max(0, clip.y),
    width: Math.min(clip.width, vp.width - Math.max(0, clip.x)),
    height: Math.min(clip.height, (vp.height * 5) - Math.max(0, clip.y)), // allow for scroll
  };
  if (safeClip.width <= 0 || safeClip.height <= 0) {
    console.log(`  !! crop skipped (out of bounds): ${name}`);
    return;
  }
  await safeScreenshot(page, name, { clip: safeClip });
}

async function getPageMetrics(page) {
  return page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const allText = body.innerText || '';
    const allElements = document.querySelectorAll('*');

    // Gather font sizes in use
    const fontSizes = new Set();
    const fontWeights = new Set();
    const colors = new Set();
    const bgColors = new Set();
    let emptyElements = 0;
    let hiddenElements = 0;

    for (let i = 0; i < Math.min(allElements.length, 500); i++) {
      const el = allElements[i];
      const style = window.getComputedStyle(el);
      fontSizes.add(style.fontSize);
      fontWeights.add(style.fontWeight);
      if (el.textContent?.trim() === '' && el.children.length === 0) emptyElements++;
      if (style.display === 'none' || style.visibility === 'hidden') hiddenElements++;
    }

    return {
      pageHeight: Math.max(body.scrollHeight, html.scrollHeight),
      pageWidth: Math.max(body.scrollWidth, html.scrollWidth),
      elementCount: allElements.length,
      textLength: allText.length,
      fontSizeCount: fontSizes.size,
      fontWeightCount: fontWeights.size,
      emptyElements,
      hiddenElements,
      hasScrollbar: html.scrollWidth > window.innerWidth,
      horizontalOverflow: html.scrollWidth - window.innerWidth,
      bodyText: allText.substring(0, 5000),
    };
  });
}

async function checkHoverEffects(page) {
  const results = [];
  // Try hovering buttons
  const buttons = await page.$$('button');
  for (let i = 0; i < Math.min(buttons.length, 5); i++) {
    try {
      const before = await buttons[i].evaluate(el => {
        const s = window.getComputedStyle(el);
        return { bg: s.backgroundColor, color: s.color, transform: s.transform, boxShadow: s.boxShadow, cursor: s.cursor };
      });
      await buttons[i].hover();
      await page.waitForTimeout(300);
      const after = await buttons[i].evaluate(el => {
        const s = window.getComputedStyle(el);
        return { bg: s.backgroundColor, color: s.color, transform: s.transform, boxShadow: s.boxShadow, cursor: s.cursor };
      });
      const changed = before.bg !== after.bg || before.transform !== after.transform || before.boxShadow !== after.boxShadow;
      results.push({ index: i, changed, cursor: after.cursor });
    } catch {}
  }

  // Try hovering table rows
  const rows = await page.$$('tr, [role="row"]');
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    try {
      const before = await rows[i].evaluate(el => window.getComputedStyle(el).backgroundColor);
      await rows[i].hover();
      await page.waitForTimeout(200);
      const after = await rows[i].evaluate(el => window.getComputedStyle(el).backgroundColor);
      results.push({ type: 'row', changed: before !== after });
    } catch {}
  }

  return results;
}

async function checkColorUsage(page) {
  return page.evaluate(() => {
    const results = { greenRed: [], blueActions: [], mutedLabels: [] };
    const allEls = document.querySelectorAll('*');
    for (let i = 0; i < Math.min(allEls.length, 800); i++) {
      const el = allEls[i];
      const style = window.getComputedStyle(el);
      const text = el.textContent?.trim() || '';
      const color = style.color;
      const bg = style.backgroundColor;

      // Check P&L colors (should be green/red)
      if (text.match(/^[+-]?\$?\d+[\d,.]*%?$/) || text.match(/^[+-]\d/)) {
        results.greenRed.push({ text: text.substring(0, 30), color, bg, tag: el.tagName });
      }

      // Check button colors
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
        results.blueActions.push({ text: text.substring(0, 30), color, bg, tag: el.tagName });
      }

      // Check labels
      if (el.tagName === 'LABEL' || el.classList?.contains('label') || el.classList?.contains('text-muted') || el.classList?.contains('text-gray')) {
        results.mutedLabels.push({ text: text.substring(0, 30), color, tag: el.tagName });
      }
    }
    return results;
  });
}

async function evaluatePage(page, pageName, route) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`EVALUATING: ${pageName} (${route})`);
  console.log('='.repeat(60));

  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // 1) Full page screenshot at 1920x1080
  await safeScreenshot(page, `${pageName}-full.png`, { fullPage: true });
  await safeScreenshot(page, `${pageName}-viewport.png`);

  // 2) Collect metrics
  const metrics = await getPageMetrics(page);
  console.log(`  Page height: ${metrics.pageHeight}px, elements: ${metrics.elementCount}, H-overflow: ${metrics.horizontalOverflow}px`);

  // 3) Check for key UI patterns
  const bodyText = metrics.bodyText;

  // -- HERO VALUE (portfolio value) --
  const hasPortfolioValue = bodyText.match(/\$[\d,]+\.?\d*/g);
  if (hasPortfolioValue) {
    observe(pageName, 'hero-value', `Found dollar values: ${hasPortfolioValue.slice(0, 5).join(', ')}`);
  }

  // -- Placeholder data --
  const placeholders = bodyText.match(/\$?--[\.-]*/g);
  if (placeholders && placeholders.length > 0) {
    observe(pageName, 'placeholder', `Found ${placeholders.length} placeholder values: ${placeholders.slice(0, 5).join(', ')}`);
  }

  // -- Empty states --
  const emptyPatterns = bodyText.match(/(no data|no results|nothing|empty|no [\w]+ found|no [\w]+ yet|get started)/gi);
  if (emptyPatterns) {
    observe(pageName, 'empty-states', `Found empty state text: ${emptyPatterns.join(', ')}`);
  }

  // 4) Section crops based on page
  const vp = page.viewportSize();

  // Top nav / header
  await cropSection(page, `${pageName}-header.png`, { x: 0, y: 0, width: vp.width, height: 80 });

  // Top status bar area (usually below header)
  await cropSection(page, `${pageName}-statusbar.png`, { x: 0, y: 40, width: vp.width, height: 50 });

  if (pageName === 'dashboard') {
    // Hero section with portfolio value
    await cropSection(page, `${pageName}-hero.png`, { x: 0, y: 60, width: vp.width, height: 250 });
    // Main content area (charts/positions)
    await cropSection(page, `${pageName}-main-content.png`, { x: 0, y: 280, width: vp.width, height: 500 });
    // Left panel
    await cropSection(page, `${pageName}-left-panel.png`, { x: 0, y: 60, width: 400, height: 700 });
    // Center area
    await cropSection(page, `${pageName}-center.png`, { x: 400, y: 60, width: 800, height: 700 });
    // Right panel
    await cropSection(page, `${pageName}-right-panel.png`, { x: 1200, y: 60, width: 720, height: 700 });
    // Bottom section
    await cropSection(page, `${pageName}-bottom.png`, { x: 0, y: 700, width: vp.width, height: 380 });

    // Check for economic calendar
    const hasCalendar = bodyText.match(/calendar|event|fomc|cpi|gdp|nfp|economic/gi);
    observe(pageName, 'economic-calendar', hasCalendar
      ? `Economic calendar elements found: ${hasCalendar.slice(0, 5).join(', ')}`
      : 'No economic calendar text found on dashboard');

    // Scroll down to check below fold
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(1000);
    await safeScreenshot(page, `${pageName}-scrolled.png`);
    const metricsScrolled = await getPageMetrics(page);
    observe(pageName, 'below-fold', `Content extends to ${metricsScrolled.pageHeight}px total`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

  } else if (pageName === 'trade') {
    // Chart area
    await cropSection(page, `${pageName}-chart-area.png`, { x: 0, y: 50, width: 1400, height: 600 });
    // Chart header (symbol, price, alerts)
    await cropSection(page, `${pageName}-chart-header.png`, { x: 0, y: 50, width: 1400, height: 60 });
    // Right sidebar (order panel)
    await cropSection(page, `${pageName}-order-panel.png`, { x: 1300, y: 50, width: 620, height: 700 });
    // Drawing toolbar area
    await cropSection(page, `${pageName}-toolbar.png`, { x: 0, y: 50, width: 60, height: 600 });
    // Bottom panel (positions/orders)
    await cropSection(page, `${pageName}-bottom-panel.png`, { x: 0, y: 650, width: vp.width, height: 430 });
    // Watchlist panel
    await cropSection(page, `${pageName}-watchlist.png`, { x: 0, y: 50, width: 300, height: 700 });

    // Check for chart type selector
    const chartTypeSelector = await page.$$('[class*="chart-type"], [data-testid*="chart-type"], button:has-text("Candle"), button:has-text("Line"), button:has-text("Area")');
    observe(pageName, 'chart-type-selector', chartTypeSelector.length > 0
      ? `Chart type selector found (${chartTypeSelector.length} elements)`
      : 'No chart type selector buttons found');

    // Check for drawing toolbar
    const drawingTools = await page.$$('[class*="drawing"], [class*="toolbar"], button:has-text("Fib")');
    const drawingText = bodyText.match(/fib|fibonacci|trend|draw|line tool|horizontal/gi);
    observe(pageName, 'drawing-toolbar', (drawingTools.length > 0 || drawingText)
      ? `Drawing toolbar indicators found`
      : 'No drawing toolbar indicators found');

    // Check for BUY/SELL buttons
    const buyBtn = await page.$('button:has-text("BUY"), button:has-text("Buy"), [class*="buy"]');
    const sellBtn = await page.$('button:has-text("SELL"), button:has-text("Sell"), [class*="sell"]');
    observe(pageName, 'buy-sell-buttons', (buyBtn && sellBtn)
      ? 'BUY and SELL buttons both found'
      : `BUY: ${!!buyBtn}, SELL: ${!!sellBtn}`);

    // Check for price alert bell
    const alertBell = await page.$$('[class*="alert"], [class*="bell"], button[aria-label*="alert"], svg[class*="bell"]');
    const bellText = bodyText.match(/alert|bell|notification|price alert/gi);
    observe(pageName, 'price-alert-bell', (alertBell.length > 0 || bellText)
      ? 'Price alert indicator found'
      : 'No price alert bell found');

    // Check for position sizing calculator
    const posSizing = bodyText.match(/position size|risk|calculator|lot size|shares|quantity/gi);
    observe(pageName, 'position-sizing', posSizing
      ? `Position sizing elements: ${posSizing.slice(0, 5).join(', ')}`
      : 'No position sizing calculator text found');

    // Check for AI trade journal
    const journal = bodyText.match(/journal|trade log|ai journal|trade journal|notes/gi);
    observe(pageName, 'ai-trade-journal', journal
      ? `AI trade journal elements: ${journal.join(', ')}`
      : 'No AI trade journal text found');

    // Check for interactive screener
    const screener = bodyText.match(/screener|scan|filter|screen/gi);
    observe(pageName, 'screener', screener
      ? `Screener elements: ${screener.join(', ')}`
      : 'No screener text found');

  } else if (pageName === 'pipeline') {
    // Main content
    await cropSection(page, `${pageName}-main.png`, { x: 0, y: 60, width: vp.width, height: 500 });
    // Left sidebar
    await cropSection(page, `${pageName}-sidebar.png`, { x: 0, y: 60, width: 300, height: 700 });
    // Content area
    await cropSection(page, `${pageName}-content.png`, { x: 300, y: 60, width: 1620, height: 700 });
    // Bottom area
    await cropSection(page, `${pageName}-bottom.png`, { x: 0, y: 600, width: vp.width, height: 480 });

    // Check for strategy builder
    const stratBuilder = bodyText.match(/strategy builder|build strategy|create strategy|new strategy|builder/gi);
    observe(pageName, 'strategy-builder', stratBuilder
      ? `Strategy builder elements: ${stratBuilder.join(', ')}`
      : 'No strategy builder text found');

    // Check for backtesting engine
    const backtest = bodyText.match(/backtest|back.?test|simulate|historical|backtesting engine/gi);
    observe(pageName, 'backtesting-engine', backtest
      ? `Backtesting elements: ${backtest.join(', ')}`
      : 'No backtesting engine text found');

  } else if (pageName.startsWith('strategy-')) {
    // Strategy detail hero
    await cropSection(page, `${pageName}-hero.png`, { x: 0, y: 60, width: vp.width, height: 250 });
    // Performance chart
    await cropSection(page, `${pageName}-chart.png`, { x: 0, y: 250, width: vp.width, height: 400 });
    // Stats/metrics
    await cropSection(page, `${pageName}-stats.png`, { x: 0, y: 60, width: 600, height: 300 });
    // Positions/trades table
    await cropSection(page, `${pageName}-table.png`, { x: 0, y: 600, width: vp.width, height: 480 });
  }

  // 5) Color usage check
  const colorData = await checkColorUsage(page);
  if (colorData.greenRed.length > 0) {
    observe(pageName, 'color-pnl', `Found ${colorData.greenRed.length} numeric values with colors`);
  }
  if (colorData.blueActions.length > 0) {
    observe(pageName, 'color-buttons', `Found ${colorData.blueActions.length} buttons`);
  }

  // 6) Hover effects check
  const hoverResults = await checkHoverEffects(page);
  const hoverChanges = hoverResults.filter(r => r.changed);
  observe(pageName, 'hover-effects', `${hoverChanges.length}/${hoverResults.length} elements change on hover`);

  // 7) Check for loading states
  const loaders = await page.$$('[class*="loading"], [class*="spinner"], [class*="skeleton"], [role="progressbar"]');
  observe(pageName, 'loading-states', `Found ${loaders.length} loading indicators in DOM`);

  return metrics;
}

async function main() {
  console.log('Starting Final UI/UX Evaluation');
  console.log('Target: https://tradingalpha.net');
  console.log('Resolution: 1920x1080 (primary), 1366x768 (responsive check)');
  console.log('');

  const browser = await chromium.launch({ headless: true });

  // ============================================================
  // PHASE 1: Full evaluation at 1920x1080
  // ============================================================
  const ctx1080 = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await ctx1080.newPage();

  await login(page);

  const allMetrics = {};

  // Dashboard
  allMetrics['dashboard'] = await evaluatePage(page, 'dashboard', '/');

  // Trade
  allMetrics['trade'] = await evaluatePage(page, 'trade', '/trade');

  // Pipeline
  allMetrics['pipeline'] = await evaluatePage(page, 'pipeline', '/pipeline');

  // Strategy: PEAD
  allMetrics['strategy-pead'] = await evaluatePage(page, 'strategy-pead', '/strategies/pead');

  // Strategy: Momentum Quality
  allMetrics['strategy-momentum'] = await evaluatePage(page, 'strategy-momentum', '/strategies/momentum-quality');

  // ============================================================
  // PHASE 2: Cross-page consistency checks
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('CROSS-PAGE CONSISTENCY CHECKS');
  console.log('='.repeat(60));

  // Compare font patterns across pages
  const pages = ['/', '/trade', '/pipeline', '/strategies/pead', '/strategies/momentum-quality'];
  const crossPageData = [];

  for (const route of pages) {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const nav = document.querySelector('nav, [class*="nav"], [class*="sidebar"], [role="navigation"]');
      const navBg = nav ? window.getComputedStyle(nav).backgroundColor : 'none';

      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => {
        const s = window.getComputedStyle(h);
        return { text: h.textContent?.trim().substring(0, 40), size: s.fontSize, weight: s.fontWeight, color: s.color };
      });

      const cards = Array.from(document.querySelectorAll('[class*="card"], [class*="Card"], [class*="panel"], [class*="Panel"]')).slice(0, 10).map(c => {
        const s = window.getComputedStyle(c);
        return { bg: s.backgroundColor, border: s.border, borderRadius: s.borderRadius, boxShadow: s.boxShadow };
      });

      const buttons = Array.from(document.querySelectorAll('button')).slice(0, 10).map(b => {
        const s = window.getComputedStyle(b);
        return { text: b.textContent?.trim().substring(0, 20), bg: s.backgroundColor, color: s.color, borderRadius: s.borderRadius, fontSize: s.fontSize };
      });

      // Check for consistent spacing
      const gaps = new Set();
      document.querySelectorAll('[class*="grid"], [class*="flex"]').forEach(el => {
        const s = window.getComputedStyle(el);
        if (s.gap && s.gap !== 'normal') gaps.add(s.gap);
      });

      return { navBg, headings, cards, buttons, gaps: Array.from(gaps) };
    });

    crossPageData.push({ route, data });
  }

  // Analyze consistency
  const navBgs = crossPageData.map(d => d.data.navBg);
  const uniqueNavBgs = new Set(navBgs);
  observe('cross-page', 'nav-consistency', `Nav backgrounds: ${uniqueNavBgs.size} unique (${Array.from(uniqueNavBgs).join(', ')})`);

  const allCardBorderRadii = crossPageData.flatMap(d => d.data.cards.map(c => c.borderRadius));
  const uniqueRadii = new Set(allCardBorderRadii);
  observe('cross-page', 'card-consistency', `Card border-radius values: ${uniqueRadii.size} unique (${Array.from(uniqueRadii).slice(0, 5).join(', ')})`);

  const allBtnRadii = crossPageData.flatMap(d => d.data.buttons.map(b => b.borderRadius));
  const uniqueBtnRadii = new Set(allBtnRadii);
  observe('cross-page', 'button-consistency', `Button border-radius values: ${uniqueBtnRadii.size} unique (${Array.from(uniqueBtnRadii).slice(0, 5).join(', ')})`);

  const allGaps = crossPageData.flatMap(d => d.data.gaps);
  const uniqueGaps = new Set(allGaps);
  observe('cross-page', 'spacing-consistency', `Grid/flex gap values: ${uniqueGaps.size} unique (${Array.from(uniqueGaps).slice(0, 8).join(', ')})`);

  await ctx1080.close();

  // ============================================================
  // PHASE 3: Responsive check at 1366x768
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('RESPONSIVE CHECK: 1366x768');
  console.log('='.repeat(60));

  const ctxSmall = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  });
  const pageSm = await ctxSmall.newPage();

  // Login at smaller viewport
  await pageSm.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await pageSm.waitForTimeout(2500);
  const smInputs = await pageSm.$$('input');
  if (smInputs.length >= 2) {
    await smInputs[0].fill(USERNAME);
    await smInputs[1].fill(PASSWORD);
  }
  const smBtn = await pageSm.$('button:has-text("Sign In"), button:has-text("Log In"), button[type="submit"]');
  if (smBtn) await smBtn.click();
  await pageSm.waitForTimeout(4000);
  await pageSm.waitForLoadState('networkidle').catch(() => {});

  const responsivePages = [
    { name: 'dashboard', route: '/' },
    { name: 'trade', route: '/trade' },
    { name: 'pipeline', route: '/pipeline' },
    { name: 'strategy-pead', route: '/strategies/pead' },
    { name: 'strategy-momentum', route: '/strategies/momentum-quality' },
  ];

  for (const rp of responsivePages) {
    await pageSm.goto(`${BASE_URL}${rp.route}`, { waitUntil: 'networkidle', timeout: 30000 });
    await pageSm.waitForTimeout(3000);

    await safeScreenshot(pageSm, `responsive-${rp.name}-1366.png`, { fullPage: true });
    await safeScreenshot(pageSm, `responsive-${rp.name}-viewport-1366.png`);

    const smMetrics = await getPageMetrics(pageSm);

    observe('responsive', rp.name,
      `H-overflow: ${smMetrics.horizontalOverflow}px, page-height: ${smMetrics.pageHeight}px, hasScrollbar: ${smMetrics.hasScrollbar}`);

    // Check for text truncation or overlap
    const truncated = await pageSm.evaluate(() => {
      let truncatedCount = 0;
      let overflowCount = 0;
      document.querySelectorAll('*').forEach(el => {
        const s = window.getComputedStyle(el);
        if (s.overflow === 'hidden' && s.textOverflow === 'ellipsis') truncatedCount++;
        if (el.scrollWidth > el.clientWidth + 2) overflowCount++;
      });
      return { truncatedCount, overflowCount };
    });

    observe('responsive', `${rp.name}-truncation`,
      `Truncated elements: ${truncated.truncatedCount}, Overflowing: ${truncated.overflowCount}`);
  }

  await ctxSmall.close();

  // ============================================================
  // PHASE 4: Detailed element-level checks
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('DETAILED ELEMENT CHECKS');
  console.log('='.repeat(60));

  const ctxDetail = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const pageDetail = await ctxDetail.newPage();

  // Login again
  await pageDetail.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await pageDetail.waitForTimeout(2500);
  const dInputs = await pageDetail.$$('input');
  if (dInputs.length >= 2) {
    await dInputs[0].fill(USERNAME);
    await dInputs[1].fill(PASSWORD);
  }
  const dBtn = await pageDetail.$('button:has-text("Sign In"), button:has-text("Log In"), button[type="submit"]');
  if (dBtn) await dBtn.click();
  await pageDetail.waitForTimeout(4000);
  await pageDetail.waitForLoadState('networkidle').catch(() => {});

  // -- Dashboard deep dive --
  await pageDetail.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await pageDetail.waitForTimeout(3000);

  // Check for the $100K hero value
  const heroValue = await pageDetail.evaluate(() => {
    const largeTexts = [];
    document.querySelectorAll('*').forEach(el => {
      const s = window.getComputedStyle(el);
      const size = parseFloat(s.fontSize);
      const text = el.textContent?.trim() || '';
      if (size >= 24 && text.match(/\$[\d,]+/)) {
        largeTexts.push({ text: text.substring(0, 60), size: s.fontSize, weight: s.fontWeight, tag: el.tagName, color: s.color });
      }
    });
    return largeTexts;
  });
  observe('dashboard', 'hero-value-detail', heroValue.length > 0
    ? `Large $ values: ${heroValue.map(h => `"${h.text}" @ ${h.size}/${h.weight}`).join('; ')}`
    : 'No large dollar value found (missing hero?)');

  // Check typography hierarchy
  const typographyHierarchy = await pageDetail.evaluate(() => {
    const headings = [];
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(tag => {
      document.querySelectorAll(tag).forEach(el => {
        const s = window.getComputedStyle(el);
        headings.push({ tag, text: el.textContent?.trim().substring(0, 40), size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight });
      });
    });
    return headings;
  });
  observe('dashboard', 'typography', `Heading hierarchy: ${typographyHierarchy.map(h => `${h.tag}="${h.text}" ${h.size}/${h.weight}`).join('; ') || 'No semantic headings found'}`);

  // Check number formatting (tabular figures)
  const numberFormatting = await pageDetail.evaluate(() => {
    const numberEls = [];
    document.querySelectorAll('*').forEach(el => {
      const text = el.textContent?.trim() || '';
      if (text.match(/^\$?[\d,.]+%?$/) && el.children.length === 0) {
        const s = window.getComputedStyle(el);
        numberEls.push({
          text,
          fontFamily: s.fontFamily.substring(0, 40),
          fontVariantNumeric: s.fontVariantNumeric,
          fontFeatureSettings: s.fontFeatureSettings,
          letterSpacing: s.letterSpacing,
        });
      }
    });
    return numberEls.slice(0, 10);
  });
  const hasTabularNums = numberFormatting.some(n =>
    n.fontVariantNumeric?.includes('tabular') ||
    n.fontFeatureSettings?.includes('tnum')
  );
  observe('dashboard', 'tabular-numbers', hasTabularNums
    ? 'Tabular numeric figures detected'
    : `No tabular-nums CSS found. Font families: ${[...new Set(numberFormatting.map(n => n.fontFamily))].join(', ')}`);

  // -- Trade page deep dive --
  await pageDetail.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await pageDetail.waitForTimeout(4000);

  // Try clicking chart type buttons if present
  const chartTypeButtons = await pageDetail.$$('button:has-text("Candle"), button:has-text("Line"), button:has-text("Area"), [class*="chart-type"] button');
  if (chartTypeButtons.length > 0) {
    for (const ctBtn of chartTypeButtons) {
      try {
        const label = await ctBtn.textContent();
        await ctBtn.click();
        await pageDetail.waitForTimeout(1500);
        await safeScreenshot(pageDetail, `trade-chart-type-${label.trim().toLowerCase()}.png`);
        observe('trade', 'chart-type-interaction', `Clicked "${label.trim()}" chart type - captured screenshot`);
      } catch {}
    }
  } else {
    observe('trade', 'chart-type-interaction', 'No chart type buttons found to test');
  }

  // Check for floating BUY/SELL buttons on chart
  const floatingBtns = await pageDetail.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const buySell = btns.filter(b => {
      const text = b.textContent?.trim().toUpperCase();
      const s = window.getComputedStyle(b);
      return (text === 'BUY' || text === 'SELL') && (s.position === 'fixed' || s.position === 'absolute' || s.position === 'sticky');
    });
    return buySell.map(b => ({
      text: b.textContent?.trim(),
      position: window.getComputedStyle(b).position,
      bg: window.getComputedStyle(b).backgroundColor,
      zIndex: window.getComputedStyle(b).zIndex,
    }));
  });
  observe('trade', 'floating-buy-sell', floatingBtns.length > 0
    ? `Floating BUY/SELL: ${JSON.stringify(floatingBtns)}`
    : 'No floating BUY/SELL buttons found (may be inline)');

  // Check order tab for position sizing
  const orderTabs = await pageDetail.$$('button:has-text("Order"), [role="tab"]:has-text("Order"), button:has-text("Position")');
  for (const tab of orderTabs) {
    try {
      await tab.click();
      await pageDetail.waitForTimeout(1000);
      observe('trade', 'order-tab', `Clicked order tab: "${await tab.textContent()}"`);
    } catch {}
  }
  await safeScreenshot(pageDetail, 'trade-order-tab.png');

  // Try interacting with drawing tools
  const drawButtons = await pageDetail.$$('button:has-text("Draw"), button:has-text("Fib"), [class*="draw"] button, [class*="tool"] button');
  for (const db of drawButtons.slice(0, 3)) {
    try {
      const label = await db.textContent();
      await db.click();
      await pageDetail.waitForTimeout(500);
      observe('trade', 'drawing-tool-click', `Clicked drawing tool: "${label.trim()}"`);
    } catch {}
  }
  await safeScreenshot(pageDetail, 'trade-drawing-tools-active.png');

  // -- Pipeline page deep dive --
  await pageDetail.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await pageDetail.waitForTimeout(3000);

  // Check for strategy builder and backtest UI
  const pipelineTabs = await pageDetail.$$('button, [role="tab"]');
  for (const pt of pipelineTabs.slice(0, 10)) {
    try {
      const text = (await pt.textContent())?.trim().toLowerCase() || '';
      if (text.includes('build') || text.includes('backtest') || text.includes('create') || text.includes('strategy') || text.includes('test')) {
        await pt.click();
        await pageDetail.waitForTimeout(1500);
        await safeScreenshot(pageDetail, `pipeline-tab-${text.replace(/[^a-z]/g, '-')}.png`);
        observe('pipeline', 'tab-content', `Clicked tab: "${text}" - captured`);
      }
    } catch {}
  }

  await ctxDetail.close();
  await browser.close();

  // ============================================================
  // WRITE RESULTS
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('WRITING RESULTS');
  console.log('='.repeat(60));

  writeFileSync(join(OUT, 'observations.json'), JSON.stringify(observations, null, 2));
  writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(allMetrics, null, 2));
  writeFileSync(join(OUT, 'cross-page.json'), JSON.stringify(crossPageData, null, 2));

  console.log('Observations saved.');
  console.log('All screenshots saved to:', OUT);
  console.log('\nDone!');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
