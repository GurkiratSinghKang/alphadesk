import { chromium } from 'playwright';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
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
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/visual-audit';
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

// Read existing findings
let existingFindings = [];
try {
  const existing = JSON.parse(readFileSync(join(SCREENSHOT_DIR, 'findings.json'), 'utf8'));
  existingFindings = existing.findings || [];
} catch {}

const newFindings = [];

function addFinding(page, category, description, severity, screenshot = null) {
  const finding = {
    id: `F${String(existingFindings.length + newFindings.length + 1).padStart(3, '0')}`,
    page,
    category,
    description,
    severity,
    screenshot,
    timestamp: new Date().toISOString(),
  };
  newFindings.push(finding);
  console.log(`  [${severity.toUpperCase()}] ${finding.id}: ${description}`);
  return finding;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Login
  console.log('=== Logging in ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  const allInputs = await page.$$('input');
  await allInputs[0].fill(USERNAME);
  await allInputs[1].fill(PASSWORD);
  await page.waitForTimeout(300);
  const signInBtn = await page.$('button:has-text("Sign In")');
  await signInBtn.click();
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('  Logged in. URL:', page.url());

  // ======== DASHBOARD DEEP INSPECTION ========
  console.log('\n=== DASHBOARD DEEP INSPECTION ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check the Portfolio Value area
  const portfolioText = await page.evaluate(() => {
    const body = document.body.innerText;
    const lines = body.split('\n').filter(l => l.trim());
    return lines.slice(0, 50).join('\n');
  });
  console.log('  Dashboard top text:\n', portfolioText.substring(0, 500));

  // Check strategy cards details
  const stratCards = await page.evaluate(() => {
    const cards = [];
    // Find all strategy cards in the right panel
    const allText = document.body.innerText;
    return allText;
  });

  // Check for "N/A" values that might be placeholders
  const naMatches = (stratCards.match(/N\/A/g) || []);
  if (naMatches.length > 0) {
    console.log(`  Found ${naMatches.length} "N/A" values`);
  }

  // Check the Activity Feed and Open Positions more carefully
  // Take a large screenshot of dashboard bottom half
  const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'dashboard-bottom-detail.png') });

  // Check market status indicator
  const marketStatusCheck = await page.evaluate(() => {
    const body = document.body.innerText;
    const results = {};
    // Check for market regime text
    results.hasRegime = body.includes('Regime');
    results.hasMarketStatus = body.includes('Market') || body.includes('market');
    // Check for properly formatted dollar amounts
    const dollarAmounts = body.match(/\$[\d,.]+/g) || [];
    results.dollarAmounts = dollarAmounts;
    // Check for percentage values
    const percentages = body.match(/[+-]?\d+\.?\d*%/g) || [];
    results.percentages = percentages;
    return results;
  });
  console.log('  Dollar amounts found:', marketStatusCheck.dollarAmounts?.length);
  console.log('  Percentages found:', marketStatusCheck.percentages?.length);

  // ======== TRADE PAGE DEEP INSPECTION ========
  console.log('\n=== TRADE PAGE DEEP INSPECTION ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Options chain - check if right side (calls/puts) has real data vs 0.01 placeholders
  const optionsCheck = await page.evaluate(() => {
    const allText = document.body.innerText;
    const lines = allText.split('\n');
    const results = {
      zeroPointOneCount: 0,
      optionsLines: [],
    };
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes('0.01') && !trimmed.includes('$0.01')) {
        results.zeroPointOneCount++;
        results.optionsLines.push(trimmed.substring(0, 120));
      }
    }
    return results;
  });
  if (optionsCheck.zeroPointOneCount > 3) {
    addFinding('Trade', 'data-quality', `Options chain has ${optionsCheck.zeroPointOneCount} rows showing 0.01 values on put side - likely stale/missing data`, 'medium', 'trade-fullpage.png');
  }
  console.log('  Options 0.01 count:', optionsCheck.zeroPointOneCount);

  // Check if tab overflow is visible
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'trade-tabs-overflow.png'),
    clip: { x: 0, y: 0, width: 1920, height: 30 }
  });

  // Check right panel (Technical/Fundamental panel) for cutoff
  const rightPanelCheck = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    const results = { cutoff: [], tabOverflow: false };
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      const text = el.textContent?.trim()?.substring(0, 60) || '';
      // Elements partially off-screen on the right
      if (rect.left < 1920 && rect.right > 1920 && rect.width > 30 && text.length > 0) {
        results.cutoff.push({
          text,
          right: Math.round(rect.right),
          tag: el.tagName,
          cls: el.className?.toString()?.substring(0, 60) || '',
        });
      }
    }
    return results;
  });
  if (rightPanelCheck.cutoff.length > 0) {
    console.log('  Elements cut off on right side:', rightPanelCheck.cutoff.length);
    for (const c of rightPanelCheck.cutoff.slice(0, 5)) {
      console.log(`    ${c.tag}: "${c.text}" (right: ${c.right}px)`);
    }
  }

  // Check the trade entry form (bottom right)
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'trade-entry-form.png'),
    clip: { x: 1550, y: 800, width: 370, height: 280 }
  });

  // Check the watchlist panel (left side)
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'trade-watchlist.png'),
    clip: { x: 0, y: 20, width: 280, height: 600 }
  });

  // Check the right panel at higher detail
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'trade-right-panel.png'),
    clip: { x: 1640, y: 20, width: 280, height: 800 }
  });

  // ======== PIPELINE PAGE DEEP INSPECTION ========
  console.log('\n=== PIPELINE PAGE DEEP INSPECTION ===');
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check "Today's Pipeline Run" section for empty steps
  const pipelineRunCheck = await page.evaluate(() => {
    const allText = document.body.innerText;
    const results = {
      hasSteps: false,
      stepTexts: [],
      emptyStepCount: 0,
    };
    // Find pipeline step elements
    const steps = document.querySelectorAll('[class*="step"], [class*="pipeline"]');
    for (const step of steps) {
      const text = step.innerText?.trim();
      if (text) results.stepTexts.push(text.substring(0, 100));
    }
    // Check for "0" counts in pipeline steps
    const zeroMatches = allText.match(/\b0\b/g) || [];
    results.zeroCount = zeroMatches.length;
    return results;
  });
  console.log('  Pipeline step texts:', pipelineRunCheck.stepTexts.length);

  // Take detail shot of pipeline steps
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'pipeline-steps-detail.png'),
    clip: { x: 0, y: 90, width: 1920, height: 120 }
  });

  // Check the history section
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'pipeline-history-detail.png'),
    clip: { x: 0, y: 200, width: 1920, height: 150 }
  });

  // Check performance summary cards
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'pipeline-performance-detail.png'),
    clip: { x: 0, y: 350, width: 1920, height: 150 }
  });

  // Check for the "N/A" win rate
  const pipelineText = await page.evaluate(() => document.body.innerText);
  if (pipelineText.includes('N/A')) {
    addFinding('Pipeline', 'data-quality', 'Win Rate shows "N/A" - should compute from trade history (2 trades exist)', 'low', 'pipeline-fullpage.png');
  }

  // ======== STRATEGIES/PEAD DEEP INSPECTION ========
  console.log('\n=== STRATEGIES/PEAD DEEP INSPECTION ===');
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check strategy header
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'pead-header-detail.png'),
    clip: { x: 50, y: 30, width: 1820, height: 80 }
  });

  // Check the equity curve chart area
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'pead-equity-curve.png'),
    clip: { x: 50, y: 80, width: 1400, height: 300 }
  });

  // Check stats panel (right side)
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'pead-stats-panel.png'),
    clip: { x: 1400, y: 80, width: 500, height: 300 }
  });

  // Check the tabs below chart
  const peadTabsCheck = await page.evaluate(() => {
    const tabs = document.querySelectorAll('[role="tab"], button[class*="tab"]');
    return Array.from(tabs).map(t => ({
      text: t.textContent?.trim(),
      active: t.getAttribute('data-state') || t.getAttribute('aria-selected') || '',
      cls: t.className?.substring(0, 60),
    }));
  });
  console.log('  PEAD tabs:', peadTabsCheck.map(t => `${t.text}(${t.active})`).join(', '));

  // Check the performance return value
  const peadReturnCheck = await page.evaluate(() => {
    const body = document.body.innerText;
    // Look for return values
    const returns = body.match(/[+-]?\d+\.?\d*%\s*\([+-]?\$[\d,.]+\)/g) || [];
    return { returns, bodySnippet: body.substring(0, 1000) };
  });
  console.log('  PEAD returns found:', peadReturnCheck.returns);

  // Check the About and Positions tabs
  const tabs = await page.$$('[role="tab"], button');
  for (const tab of tabs) {
    const text = await tab.textContent();
    if (text?.trim() === 'Positions' || text?.trim() === 'Active Positions') {
      await tab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'pead-positions-tab.png'), fullPage: true });

      // Check positions content
      const posContent = await page.evaluate(() => {
        const body = document.body.innerText;
        return body.includes('No positions') || body.includes('No active') ? 'empty' : 'has-data';
      });
      console.log('  PEAD Positions tab:', posContent);
      break;
    }
  }

  // Click the Sector Exposure tab
  for (const tab of tabs) {
    const text = await tab.textContent();
    if (text?.includes('Sector')) {
      await tab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'pead-sector-tab.png'), fullPage: true });
      break;
    }
  }

  // Click Correlation tab
  for (const tab of tabs) {
    const text = await tab.textContent();
    if (text?.includes('Correlation') || text?.includes('Corr')) {
      await tab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'pead-correlation-tab.png'), fullPage: true });
      break;
    }
  }

  // Click Analytics tab
  for (const tab of tabs) {
    const text = await tab.textContent();
    if (text?.includes('Analytics') || text?.includes('Analytic')) {
      await tab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'pead-analytics-tab.png'), fullPage: true });
      break;
    }
  }

  // ======== STRATEGIES/MOMENTUM-QUALITY DEEP INSPECTION ========
  console.log('\n=== STRATEGIES/MOMENTUM-QUALITY DEEP INSPECTION ===');
  await page.goto(`${BASE_URL}/strategies/momentum-quality`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Main chart area - should show "Not enough data for equity curve"
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'momentum-chart-area.png'),
    clip: { x: 50, y: 80, width: 1400, height: 300 }
  });

  const momText = await page.evaluate(() => document.body.innerText);
  if (momText.includes('Not enough data')) {
    addFinding('Strategies Momentum Quality', 'empty-chart', 'Equity curve chart shows "Not enough data for equity curve" - empty placeholder visible in main chart area', 'medium', 'momentum-chart-area.png');
  }

  // Check stats panel
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'momentum-stats-panel.png'),
    clip: { x: 1400, y: 80, width: 500, height: 300 }
  });

  // Check the stat values for missing data
  const momStatCheck = await page.evaluate(() => {
    const body = document.body.innerText;
    const results = {
      hasEmptyStats: false,
      statValues: [],
    };
    // Look for stat labels and their values
    const patterns = [
      /Total Return.*?([\d.%+-]+|N\/A|-)/,
      /Sharpe.*?([\d.+-]+|N\/A|-)/,
      /Win Rate.*?([\d.%+-]+|N\/A|-)/,
      /Max Drawdown.*?([\d.%+-]+|N\/A|-)/,
    ];
    for (const p of patterns) {
      const match = body.match(p);
      if (match) results.statValues.push(match[0].substring(0, 60));
    }
    return results;
  });
  console.log('  Momentum stat values:', momStatCheck.statValues);

  // Check tabs on momentum page
  const momTabs = await page.$$('[role="tab"], button');
  for (const tab of momTabs) {
    const text = await tab.textContent();
    if (text?.trim() === 'Positions' || text?.trim() === 'Active Positions') {
      await tab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'momentum-positions-tab.png'), fullPage: true });
      break;
    }
  }

  // ======== CROSS-PAGE CHECKS ========
  console.log('\n=== CROSS-PAGE VISUAL CONSISTENCY CHECKS ===');

  // Check navigation bar consistency across pages
  for (const path of ['/', '/trade', '/pipeline', '/strategies/pead']) {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const navCheck = await page.evaluate((currentPath) => {
      const nav = document.querySelector('nav, header, [class*="nav"], [class*="header"]');
      if (!nav) return { found: false };
      const rect = nav.getBoundingClientRect();
      const activeLinks = document.querySelectorAll('a[class*="active"], a[aria-current], [class*="nav"] a[class*="active"]');
      return {
        found: true,
        height: Math.round(rect.height),
        width: Math.round(rect.width),
        activeCount: activeLinks.length,
        activeTexts: Array.from(activeLinks).map(a => a.textContent?.trim()),
        path: currentPath,
      };
    }, path);
    console.log(`  Nav on ${path}: h=${navCheck.height}, active: ${navCheck.activeTexts}`);
  }

  // ======== DASHBOARD SCROLL + BOTTOM CHECK ========
  console.log('\n=== DASHBOARD SCROLLED VIEW ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check the heatmap / calendar area (April P&L)
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'dashboard-heatmap-detail.png'),
    clip: { x: 400, y: 280, width: 700, height: 300 }
  });

  // Check the strategy cards on the right
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'dashboard-strategy-cards-detail.png'),
    clip: { x: 1200, y: 40, width: 700, height: 600 }
  });

  // Check the open positions section
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'dashboard-positions-detail.png'),
    clip: { x: 0, y: 270, width: 600, height: 300 }
  });

  // Check the activity feed
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'dashboard-activity-feed.png'),
    clip: { x: 0, y: 80, width: 700, height: 200 }
  });

  // Look for the equity curve on top
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'dashboard-equity-curve-top.png'),
    clip: { x: 0, y: 0, width: 1920, height: 50 }
  });

  // Check the "MARKET SERVICES" footer area
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'dashboard-scrolled-bottom-detail.png') });

  // ======== FINAL: RESPONSIVE BREAKPOINT CHECK ========
  console.log('\n=== NARROW VIEWPORT CHECK (1366x768) ===');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'dashboard-1366x768.png'), fullPage: true });

  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'trade-1366x768.png'), fullPage: true });

  // Check for overflow at smaller viewport
  const smallOverflow = await page.evaluate(() => {
    const results = [];
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth + 5 && rect.width > 50) {
        const tag = el.tagName.toLowerCase();
        const cls = el.className?.toString().substring(0, 80) || '';
        results.push({ tag, cls, right: Math.round(rect.right), viewportWidth: window.innerWidth });
      }
    }
    return results.slice(0, 10);
  });
  if (smallOverflow.length > 0) {
    addFinding('Trade (1366px)', 'responsive-overflow', `${smallOverflow.length} elements overflow at 1366px viewport width`, 'medium', 'trade-1366x768.png');
  }

  await browser.close();

  // Merge findings
  const allFindings = [...existingFindings, ...newFindings];
  const report = {
    audit: {
      target: BASE_URL,
      date: new Date().toISOString(),
      viewport: '1920x1080 + 1366x768',
      pages: ['/', '/trade', '/pipeline', '/strategies/pead', '/strategies/momentum-quality'],
    },
    summary: {
      totalFindings: allFindings.length,
      bySeverity: {
        critical: allFindings.filter(f => f.severity === 'critical').length,
        high: allFindings.filter(f => f.severity === 'high').length,
        medium: allFindings.filter(f => f.severity === 'medium').length,
        low: allFindings.filter(f => f.severity === 'low').length,
      },
      byCategory: {},
      byPage: {},
    },
    findings: allFindings,
  };

  for (const f of allFindings) {
    report.summary.byCategory[f.category] = (report.summary.byCategory[f.category] || 0) + 1;
    report.summary.byPage[f.page] = (report.summary.byPage[f.page] || 0) + 1;
  }

  writeFileSync(join(SCREENSHOT_DIR, 'findings.json'), JSON.stringify(report, null, 2));
  console.log('\n=== PASS 2 COMPLETE ===');
  console.log(`New findings: ${newFindings.length}`);
  console.log(`Total findings: ${allFindings.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
