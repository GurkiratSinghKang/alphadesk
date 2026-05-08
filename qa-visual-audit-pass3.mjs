import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'fs';
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

let existingFindings = [];
try {
  const existing = JSON.parse(readFileSync(join(SCREENSHOT_DIR, 'findings.json'), 'utf8'));
  existingFindings = existing.findings || [];
} catch {}

const newFindings = [];

function addFinding(page, category, description, severity, screenshot = null) {
  const finding = {
    id: `F${String(existingFindings.length + newFindings.length + 1).padStart(3, '0')}`,
    page, category, description, severity, screenshot,
    timestamp: new Date().toISOString(),
  };
  newFindings.push(finding);
  console.log(`  [${severity.toUpperCase()}] ${finding.id}: ${description}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Login
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  const allInputs = await page.$$('input');
  await allInputs[0].fill(USERNAME);
  await allInputs[1].fill(PASSWORD);
  const signInBtn = await page.$('button:has-text("Sign In")');
  await signInBtn.click();
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('Logged in:', page.url());

  // ===== DASHBOARD: Top status bar =====
  console.log('\n=== DASHBOARD TOP BAR ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Capture the secondary nav bar with P&L, Regime, VIX
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'dashboard-status-bar.png'),
    clip: { x: 0, y: 40, width: 1920, height: 30 }
  });

  // Check status bar text content
  const statusBar = await page.evaluate(() => {
    const body = document.body.innerText;
    const results = {};
    // Look for placeholder patterns
    results.hasDashDash = body.includes('$--.--') || body.includes('--.-');
    results.hasTripleDash = body.includes('---');
    results.pnlMatch = body.match(/P&L\s*\$([^\n]+)/)?.[1]?.trim();
    results.regimeMatch = body.match(/Regime\s*([^\n]+)/)?.[1]?.trim();
    results.vixMatch = body.match(/VIX\s*([^\n]+)/)?.[1]?.trim();
    return results;
  });
  console.log('  Status bar values:', JSON.stringify(statusBar));

  if (statusBar.hasDashDash || statusBar.hasTripleDash) {
    addFinding('Dashboard', 'placeholder-data', `Top status bar shows placeholder values: P&L="${statusBar.pnlMatch}", Regime="${statusBar.regimeMatch}", VIX="${statusBar.vixMatch}"`, 'high', 'dashboard-status-bar.png');
  }

  // ===== DASHBOARD: Open Positions heatmap =====
  console.log('\n=== DASHBOARD OPEN POSITIONS & HEATMAP ===');
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'dashboard-open-positions-heatmap.png'),
    clip: { x: 0, y: 290, width: 1200, height: 320 }
  });

  // Check the calendar heatmap for actual data
  const heatmapCheck = await page.evaluate(() => {
    const body = document.body.innerText;
    const results = {};
    // Check for April P&L
    results.hasAprilPnl = body.includes('April P&L');
    // Look for heatmap values
    results.heatmapValues = body.match(/[+-]\$[\d,.]+\s*\(/g)?.slice(0, 5);
    // Check MRK position
    results.hasMRK = body.includes('MRK');
    results.mrkDetails = body.match(/MRK[\s\S]{0,100}/)?.[0]?.substring(0, 100);
    return results;
  });
  console.log('  Heatmap data:', JSON.stringify(heatmapCheck));

  // ===== DASHBOARD: Strategy sparklines =====
  console.log('\n=== DASHBOARD STRATEGY CARDS ===');
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'dashboard-all-strategies.png'),
    clip: { x: 1200, y: 200, width: 720, height: 500 }
  });

  // Check strategy cards for missing sparklines
  const strategyCheck = await page.evaluate(() => {
    const body = document.body.innerText;
    const results = { strategies: [] };
    // Find all strategy cards
    const cards = document.querySelectorAll('[class*="card"]');
    for (const card of cards) {
      const text = card.innerText?.trim();
      const svgs = card.querySelectorAll('svg');
      const hasSVG = svgs.length > 0;
      // Check SVG has actual path data
      let hasPathData = false;
      for (const svg of svgs) {
        const paths = svg.querySelectorAll('path');
        for (const p of paths) {
          const d = p.getAttribute('d') || '';
          if (d.length > 20 && !d.includes('NaN')) hasPathData = true;
        }
      }
      if (text?.length > 5 && text?.length < 300) {
        results.strategies.push({
          text: text.substring(0, 80),
          hasSVG,
          hasPathData,
          svgCount: svgs.length,
        });
      }
    }
    return results;
  });
  for (const s of strategyCheck.strategies) {
    console.log(`  Card: "${s.text.substring(0, 50)}" SVG=${s.hasSVG} PathData=${s.hasPathData}`);
    if (s.hasSVG && !s.hasPathData && s.text.includes('Active')) {
      addFinding('Dashboard', 'missing-sparkline', `Strategy card "${s.text.substring(0, 30)}" has SVG but no path data - missing sparkline chart`, 'medium', 'dashboard-all-strategies.png');
    }
  }

  // ===== PEAD: Performance stats =====
  console.log('\n=== PEAD STATS PANEL ===');
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Capture stats panel area more precisely
  const peadStats = await page.evaluate(() => {
    const body = document.body.innerText;
    const results = {};
    // Find all stat blocks
    const statPatterns = [
      /Total Return[:\s]*([\d.%+-]+|N\/A)/i,
      /Sharpe[:\s]*([\d.+-]+|N\/A)/i,
      /Max Drawdown[:\s]*([\d.%+-]+|N\/A)/i,
      /Win Rate[:\s]*([\d.%]+|N\/A)/i,
      /Total Trades[:\s]*(\d+|N\/A)/i,
      /Avg Win[:\s]*([\d.%$+-]+|N\/A)/i,
      /Avg Loss[:\s]*([\d.%$+-]+|N\/A)/i,
    ];
    for (const p of statPatterns) {
      const match = body.match(p);
      if (match) results[match[0].split(/[:\s]/)[0]] = match[1];
    }
    // Also look at return display
    results.returnDisplay = body.match(/[+-]?\d+\.?\d*%\s*\([+-]?\$[\d,.]+\)/g);
    return results;
  });
  console.log('  PEAD stats:', JSON.stringify(peadStats));

  // Check the stat blocks visually
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'pead-stat-blocks.png'),
    clip: { x: 60, y: 355, width: 1800, height: 50 }
  });

  // ===== PEAD: Positions tab content =====
  console.log('\n=== PEAD POSITIONS TAB ===');
  // Click Positions tab
  const posTab = await page.$('button:has-text("Positions")');
  if (posTab) {
    await posTab.click();
    await page.waitForTimeout(2000);

    const posContent = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasNoPositions: body.includes('No past positions') || body.includes('No open positions') || body.includes('No positions'),
        positionText: body.match(/No[\w\s]+positions[\w\s]*/g),
        text: body.substring(body.indexOf('Positions'), body.indexOf('Positions') + 500),
      };
    });
    console.log('  Positions content:', posContent.positionText);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'pead-positions-content.png'),
      clip: { x: 50, y: 380, width: 1400, height: 200 }
    });
  }

  // ===== PEAD: Analytics tab =====
  console.log('\n=== PEAD ANALYTICS TAB ===');
  const analyticsTab = await page.$('button:has-text("Analytics")');
  if (analyticsTab) {
    await analyticsTab.click();
    await page.waitForTimeout(2000);

    const analyticsContent = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasNoData: body.includes('No monthly return') || body.includes('data yet') || body.includes('No data'),
        monthlyReturns: body.includes('Monthly Returns'),
        winLossStreaks: body.includes('Win/Loss Streaks') || body.includes('Streaks'),
        holdTime: body.includes('Hold Time'),
        text: body.substring(body.indexOf('Analytics'), body.indexOf('Analytics') + 500),
      };
    });
    console.log('  Analytics:', JSON.stringify(analyticsContent));

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'pead-analytics-content.png'),
      clip: { x: 50, y: 380, width: 1800, height: 300 }
    });
  }

  // ===== TRADE: Check all tab panel sections =====
  console.log('\n=== TRADE BOTTOM TABS CHECK ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Check the right-side tabs
  const rightTabs = ['Fund', 'Sent', 'Chat'];
  for (const tabName of rightTabs) {
    const tab = await page.$(`button:has-text("${tabName}")`);
    if (tab) {
      await tab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: join(SCREENSHOT_DIR, `trade-right-${tabName.toLowerCase()}.png`),
        clip: { x: 1640, y: 50, width: 280, height: 700 }
      });
    }
  }

  // Check positions tab on trade page
  const positionsTab = await page.$('button:has-text("Positions")');
  if (positionsTab) {
    await positionsTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'trade-positions-tab.png'),
      clip: { x: 260, y: 780, width: 1380, height: 300 }
    });
  }

  // Check orders tab
  const ordersTab = await page.$('button:has-text("Orders")');
  if (ordersTab) {
    await ordersTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'trade-orders-tab.png'),
      clip: { x: 260, y: 780, width: 1380, height: 300 }
    });
  }

  // Check journal tab
  const journalTab = await page.$('button:has-text("Journal")');
  if (journalTab) {
    await journalTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'trade-journal-tab.png'),
      clip: { x: 260, y: 780, width: 1380, height: 300 }
    });
  }

  // ===== TRADE: Check "Order" tab that's being cut off =====
  console.log('\n=== TRADE RIGHT-PANEL OVERFLOW ===');
  // The "Order" tab was detected as overflowing - capture it
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'trade-right-panel-tabs.png'),
    clip: { x: 1630, y: 55, width: 300, height: 40 }
  });

  // ===== MOMENTUM: Check all stat blocks =====
  console.log('\n=== MOMENTUM STRATEGY DETAILS ===');
  await page.goto(`${BASE_URL}/strategies/momentum-quality`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Capture the stat blocks row
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'momentum-stat-blocks.png'),
    clip: { x: 60, y: 340, width: 1800, height: 60 }
  });

  const momStatValues = await page.evaluate(() => {
    // Find all stat-like blocks
    const body = document.body.innerText;
    const lines = body.split('\n').filter(l => l.trim());
    const statBlock = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes('Total Return') || line.includes('Sharpe') || line.includes('Max Drawdown') ||
          line.includes('Win Rate') || line.includes('Total Trades')) {
        statBlock.push(`${line}: ${lines[i+1]?.trim() || 'MISSING'}`);
      }
    }
    return { statBlock, fullText: body.substring(0, 2000) };
  });
  console.log('  Momentum stats:', momStatValues.statBlock);

  // Check if stat values show dashes or zeros
  for (const stat of momStatValues.statBlock) {
    if (stat.includes('--') || stat.includes('N/A') || stat.includes('MISSING')) {
      addFinding('Strategies Momentum Quality', 'missing-stats', `Stat block shows placeholder: "${stat}"`, 'medium', 'momentum-stat-blocks.png');
    }
  }

  // ===== FINAL: Check for hydration mismatch details =====
  console.log('\n=== HYDRATION ERROR CHECK ===');
  // React error #418 = hydration mismatch
  addFinding('All Pages', 'hydration-error', 'React hydration mismatch error #418 fires on every page load - indicates server/client HTML mismatch. Likely caused by dynamic data (timestamps, prices) rendered differently on server vs client.', 'medium', null);

  await browser.close();

  // Merge findings
  const allFindings = [...existingFindings, ...newFindings];
  const report = {
    audit: {
      target: BASE_URL,
      date: new Date().toISOString(),
      viewport: '1920x1080 + 1366x768',
      pages: ['/', '/trade', '/pipeline', '/strategies/pead', '/strategies/momentum-quality'],
      passes: 3,
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
  console.log('\n=== PASS 3 COMPLETE ===');
  console.log(`New findings: ${newFindings.length}`);
  console.log(`Total findings: ${allFindings.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
