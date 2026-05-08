import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
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
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/expert-ux';
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const findings = [];
function finding(page, category, detail, severity = 'info') {
  const f = { page, category, detail, severity, ts: new Date().toISOString() };
  findings.push(f);
  console.log(`  [${severity.toUpperCase()}] ${category}: ${detail}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // ═══════════════════════════════════════════════════════════
  // 1. LOGIN
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 1. LOGIN ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '01-login-page.png'), fullPage: true });

  const inputs = await page.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].fill(USERNAME);
    await inputs[1].fill(PASSWORD);
  }
  await page.screenshot({ path: join(SCREENSHOT_DIR, '01b-login-filled.png'), fullPage: true });

  const signInBtn = await page.$('button:has-text("Sign In")');
  if (signInBtn) await signInBtn.click();
  await page.waitForTimeout(5000);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('  Logged in, URL:', page.url());
  await page.screenshot({ path: join(SCREENSHOT_DIR, '01c-post-login.png'), fullPage: true });

  if (page.url().includes('/login')) {
    finding('Login', 'login-fail', 'Still on login page after submit', 'critical');
  } else {
    finding('Login', 'login-success', `Redirected to ${page.url()}`, 'info');
  }

  // ═══════════════════════════════════════════════════════════
  // 2. DASHBOARD - Full Page Overview
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 2. DASHBOARD ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '02-dashboard-full.png'), fullPage: true });

  // Status Strip analysis
  const statusStrip = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasPlaceholderPnl: body.includes('$--.--'),
      hasPlaceholderRegime: body.includes('---'),
      hasPlaceholderVix: body.includes('--.-'),
      hasLive: body.includes('LIVE'),
      hasOffline: body.includes('OFFLINE'),
      hasPaper: body.includes('Paper'),
      pnlText: body.match(/P&L\s*[^\n]+/)?.[0] || 'not found',
      regimeText: body.match(/Regime\s*[^\n]+/)?.[0] || 'not found',
      vixText: body.match(/VIX\s*[^\n]+/)?.[0] || 'not found',
    };
  });
  console.log('  Status strip:', JSON.stringify(statusStrip));

  if (statusStrip.hasPlaceholderPnl) finding('Dashboard', 'placeholder-pnl', 'P&L shows $--.-- placeholder', 'high');
  if (statusStrip.hasPlaceholderRegime) finding('Dashboard', 'placeholder-regime', 'Regime shows --- placeholder', 'medium');
  if (statusStrip.hasPlaceholderVix) finding('Dashboard', 'placeholder-vix', 'VIX shows --.- placeholder', 'medium');
  if (statusStrip.hasOffline) finding('Dashboard', 'ws-offline', 'WebSocket shows OFFLINE status', 'high');

  // Dashboard sections analysis
  const dashContent = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      // Portfolio Hero
      hasPortfolioValue: /\$[\d,]+\.?\d*/.test(body),
      portfolioValueMatch: body.match(/\$[\d,]+\.?\d*/g)?.slice(0, 5),
      // Strategy cards
      hasStrategies: body.includes('Active') || body.includes('Paused'),
      strategyNames: ['Momentum', 'PEAD', 'VRP', 'Earnings Vol', 'Regime', 'Claude Alpha', 'Mean Reversion', 'VCP'].filter(s => body.includes(s)),
      // Positions
      hasPositions: body.includes('Open Positions') || body.includes('Position'),
      // Calendar
      hasCalendar: body.includes('P&L') && (body.includes('Apr') || body.includes('April')),
      // Market Context
      hasSPX: body.includes('S&P') || body.includes('SPX'),
      hasNasdaq: body.includes('NASDAQ') || body.includes('Nasdaq') || body.includes('QQQ'),
      // News/Activity
      hasNewsFeed: body.includes('News') || body.includes('Activity') || body.includes('Signal'),
      // Sectors
      hasSectors: body.includes('Sector') || body.includes('Technology') || body.includes('Healthcare'),
      fullText: body.substring(0, 3000),
    };
  });
  console.log('  Portfolio values found:', dashContent.portfolioValueMatch?.slice(0, 3));
  console.log('  Strategies visible:', dashContent.strategyNames);
  console.log('  Has positions:', dashContent.hasPositions);
  console.log('  Has calendar:', dashContent.hasCalendar);
  console.log('  Has market context:', dashContent.hasSPX, dashContent.hasNasdaq);

  // Screenshot key regions
  await page.screenshot({ path: join(SCREENSHOT_DIR, '02b-dashboard-top-half.png'), clip: { x: 0, y: 0, width: 1920, height: 540 } });
  await page.screenshot({ path: join(SCREENSHOT_DIR, '02c-dashboard-bottom-half.png'), clip: { x: 0, y: 540, width: 1920, height: 540 } });

  // Check strategy card SVG sparklines
  const sparklines = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="card"]');
    const results = [];
    for (const card of cards) {
      const text = card.innerText?.trim();
      const svgs = card.querySelectorAll('svg');
      let hasRealPath = false;
      for (const svg of svgs) {
        const paths = svg.querySelectorAll('path');
        for (const p of paths) {
          const d = p.getAttribute('d') || '';
          if (d.length > 30 && !d.includes('NaN')) hasRealPath = true;
        }
      }
      if (text && text.length > 5 && text.length < 500) {
        results.push({ text: text.substring(0, 60), hasSVG: svgs.length > 0, hasRealPath });
      }
    }
    return results;
  });
  for (const s of sparklines) {
    if (s.hasSVG && !s.hasRealPath && (s.text.includes('Active') || s.text.includes('Paused'))) {
      finding('Dashboard', 'dead-sparkline', `Strategy card "${s.text.substring(0, 40)}" has SVG but no data path`, 'medium');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 3. TRADE PAGE - Full Workstation
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 3. TRADE PAGE ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '03-trade-full.png'), fullPage: true });

  // Analyze trade page layout
  const tradeLayout = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      // Watchlist
      hasWatchlist: body.includes('Watchlist') || body.includes('AAPL') || body.includes('MSFT'),
      watchlistSymbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'SPY'].filter(s => body.includes(s)),
      // Chart
      hasChart: body.includes('Chart') || body.includes('1D') || body.includes('5m'),
      hasTimeframes: body.includes('1m') || body.includes('5m') || body.includes('1H') || body.includes('4H'),
      // Analysis panel
      hasAnalysis: body.includes('Technical') || body.includes('Fundamental') || body.includes('Sentiment'),
      hasScoreGauges: body.includes('Score') || body.includes('/100'),
      // Options
      hasOptions: body.includes('Options') || body.includes('Strike') || body.includes('Call') || body.includes('Put'),
      hasGreeks: body.includes('Delta') || body.includes('Gamma') || body.includes('Theta') || body.includes('Vega'),
      hasIV: body.includes('IV') || body.includes('Implied'),
      // Order entry
      hasOrderEntry: body.includes('Order') || body.includes('Buy') || body.includes('Sell'),
      hasMarketOrder: body.includes('Market') || body.includes('Limit') || body.includes('Stop'),
      // News/Sentiment/Chat
      hasNews: body.includes('News') || body.includes('Sent') || body.includes('Sentiment'),
      hasChat: body.includes('Chat') || body.includes('Claude') || body.includes('AI'),
      // Positions/Orders
      hasPositions: body.includes('Positions') || body.includes('Orders') || body.includes('Journal'),
      fullText: body.substring(0, 4000),
    };
  });
  console.log('  Watchlist symbols:', tradeLayout.watchlistSymbols);
  console.log('  Has chart:', tradeLayout.hasChart);
  console.log('  Has analysis:', tradeLayout.hasAnalysis);
  console.log('  Has options:', tradeLayout.hasOptions, '| Greeks:', tradeLayout.hasGreeks);
  console.log('  Has order entry:', tradeLayout.hasOrderEntry);
  console.log('  Has chat/AI:', tradeLayout.hasChat);

  // Screenshot trade page sections
  // Left: Watchlist
  await page.screenshot({ path: join(SCREENSHOT_DIR, '03b-trade-watchlist.png'), clip: { x: 0, y: 40, width: 250, height: 700 } });
  // Center: Chart
  await page.screenshot({ path: join(SCREENSHOT_DIR, '03c-trade-chart.png'), clip: { x: 240, y: 40, width: 1100, height: 500 } });
  // Right: Analysis panel
  await page.screenshot({ path: join(SCREENSHOT_DIR, '03d-trade-analysis.png'), clip: { x: 1350, y: 40, width: 570, height: 700 } });
  // Bottom: Options chain
  await page.screenshot({ path: join(SCREENSHOT_DIR, '03e-trade-options.png'), clip: { x: 0, y: 540, width: 1540, height: 540 } });

  // Interact with analysis tabs
  const analysisTabs = ['Fund', 'Sent', 'Chat'];
  for (const tabName of analysisTabs) {
    const tab = await page.$(`button:has-text("${tabName}")`);
    if (tab) {
      await tab.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: join(SCREENSHOT_DIR, `03f-trade-tab-${tabName.toLowerCase()}.png`), clip: { x: 1350, y: 40, width: 570, height: 700 } });
      console.log(`  Clicked ${tabName} tab`);
    }
  }

  // Check bottom tabs: Positions, Orders, Journal
  const bottomTabs = ['Positions', 'Orders', 'Journal'];
  for (const tabName of bottomTabs) {
    const tab = await page.$(`button:has-text("${tabName}")`);
    if (tab) {
      await tab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SCREENSHOT_DIR, `03g-trade-bottom-${tabName.toLowerCase()}.png`), clip: { x: 240, y: 780, width: 1300, height: 300 } });
      console.log(`  Clicked ${tabName} bottom tab`);
    }
  }

  // Try clicking a different symbol in watchlist
  const symbolButtons = await page.$$('button:has-text("MSFT"), button:has-text("GOOGL"), button:has-text("TSLA")');
  if (symbolButtons.length > 0) {
    await symbolButtons[0].click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '03h-trade-switched-symbol.png'), fullPage: true });
    console.log('  Switched to another symbol');
  }

  // Try the order entry panel
  const orderPanel = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasQty: body.includes('Qty') || body.includes('Quantity') || body.includes('Shares'),
      hasPrice: body.includes('Price') || body.includes('Limit'),
      hasBuyBtn: body.includes('BUY') || body.includes('Buy'),
      hasSellBtn: body.includes('SELL') || body.includes('Sell'),
      hasOrderTypes: body.includes('Market') && body.includes('Limit'),
    };
  });
  console.log('  Order panel:', JSON.stringify(orderPanel));

  // ═══════════════════════════════════════════════════════════
  // 4. TRADE - Options Chain Deep Dive
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 4. OPTIONS CHAIN ===');
  const optionsData = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasExpiries: body.includes('Exp') || body.includes('expir'),
      hasStrikes: /\d{3}\.?\d*/.test(body),
      hasBidAsk: body.includes('Bid') || body.includes('Ask'),
      hasVolOI: body.includes('Vol') || body.includes('OI') || body.includes('Open Int'),
      hasIVColumn: body.includes('IV') || body.includes('iv'),
      hasDelta: body.includes('Delta') || body.includes('delta'),
      hasGamma: body.includes('Gamma'),
      hasTheta: body.includes('Theta'),
      hasVega: body.includes('Vega'),
      chainText: body.match(/Strike[\s\S]{0,1000}/)?.[0]?.substring(0, 500) || 'no chain found',
    };
  });
  console.log('  Options chain features:', JSON.stringify(optionsData));

  // ═══════════════════════════════════════════════════════════
  // 5. PIPELINE PAGE
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 5. PIPELINE ===');
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '05-pipeline-full.png'), fullPage: true });

  const pipelineData = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      // Pipeline flow
      hasFlowDiagram: body.includes('Screened') || body.includes('Analyzed') || body.includes('Signals') || body.includes('Orders'),
      hasRunButton: body.includes('Run Pipeline') || body.includes('Trigger'),
      // Pipeline history
      hasHistory: body.includes('History') || body.includes('Previous') || body.includes('Last Run'),
      hasTimestamps: /\d{4}-\d{2}-\d{2}/.test(body) || /\d+\s*(min|hour|sec)/.test(body),
      // Strategy signals
      hasSignals: body.includes('Buy') || body.includes('Sell') || body.includes('Hold'),
      hasCounts: /Screened.*\d+|Analyzed.*\d+/i.test(body),
      // Status
      hasStatus: body.includes('Running') || body.includes('Completed') || body.includes('Idle') || body.includes('idle'),
      hasLastRun: body.includes('last run') || body.includes('Last Run') || body.includes('ago'),
      // Positions
      hasPositions: body.includes('Positions') || body.includes('Symbol'),
      fullText: body.substring(0, 3000),
    };
  });
  console.log('  Pipeline features:', JSON.stringify(pipelineData));

  // Screenshot pipeline sections
  await page.screenshot({ path: join(SCREENSHOT_DIR, '05b-pipeline-top.png'), clip: { x: 0, y: 40, width: 1920, height: 500 } });
  await page.screenshot({ path: join(SCREENSHOT_DIR, '05c-pipeline-bottom.png'), clip: { x: 0, y: 500, width: 1920, height: 580 } });

  // Try expanding pipeline run details
  const expandBtns = await page.$$('button:has-text("Details"), button:has-text("View"), [class*="chevron"], [class*="expand"]');
  if (expandBtns.length > 0) {
    await expandBtns[0].click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '05d-pipeline-expanded.png'), fullPage: true });
    console.log('  Expanded pipeline details');
  }

  // Try run pipeline button
  const runPipelineBtn = await page.$('button:has-text("Run Pipeline"), button:has-text("Trigger")');
  if (runPipelineBtn) {
    finding('Pipeline', 'run-button-present', 'Run Pipeline button is visible and clickable', 'info');
    // We won't actually click it to avoid side effects - just note it's there
  }

  // ═══════════════════════════════════════════════════════════
  // 6. STRATEGY DETAIL PAGES - Visit each strategy
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 6. STRATEGY PAGES ===');
  const strategyIds = [
    'momentum-quality', 'pead', 'vrp-harvesting', 'earnings-vol-premium',
    'regime-adaptive', 'claude-alpha', 'mean-reversion', 'vcp-breakout'
  ];

  for (const sid of strategyIds) {
    console.log(`\n  --- Strategy: ${sid} ---`);
    await page.goto(`${BASE_URL}/strategies/${sid}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, `06-strategy-${sid}.png`), fullPage: true });

    const stratData = await page.evaluate((stratId) => {
      const body = document.body.innerText;
      return {
        id: stratId,
        hasEquityCurve: body.includes('equity') || body.includes('Equity') || document.querySelectorAll('svg path').length > 0,
        hasPerformanceStats: body.includes('Total Return') || body.includes('Sharpe') || body.includes('Max Drawdown'),
        totalReturn: body.match(/Total Return[:\s]*([\d.%+-]+)/i)?.[1] || 'not found',
        sharpe: body.match(/Sharpe[:\s]*([\d.+-]+)/i)?.[1] || 'not found',
        maxDD: body.match(/Max Drawdown[:\s]*([\d.%+-]+)/i)?.[1] || 'not found',
        winRate: body.match(/Win Rate[:\s]*([\d.%]+)/i)?.[1] || 'not found',
        hasStatus: body.includes('Active') || body.includes('Paused'),
        hasTrades: body.includes('Trades') || body.includes('Trade History'),
        hasPositions: body.includes('Positions'),
        hasAnalytics: body.includes('Analytics'),
        hasThesis: body.includes('thesis') || body.includes('Thesis') || body.includes('Edge') || body.includes('edge'),
        hasRiskProfile: body.includes('Risk') || body.includes('risk'),
        hasParameters: body.includes('Parameters') || body.includes('Entry') || body.includes('Exit'),
        hasBenchmark: body.includes('Benchmark') || body.includes('S&P') || body.includes('SPY'),
        textSnippet: body.substring(0, 1500),
      };
    }, sid);

    console.log(`  Stats: Return=${stratData.totalReturn}, Sharpe=${stratData.sharpe}, DD=${stratData.maxDD}, WR=${stratData.winRate}`);
    console.log(`  Has equity curve: ${stratData.hasEquityCurve}, Trades: ${stratData.hasTrades}, Analytics: ${stratData.hasAnalytics}`);
    console.log(`  Has thesis: ${stratData.hasThesis}, Risk: ${stratData.hasRiskProfile}, Params: ${stratData.hasParameters}`);

    if (!stratData.hasPerformanceStats) {
      finding('Strategy', 'missing-stats', `${sid}: No performance stats visible`, 'high');
    }

    // Click through tabs on first two strategies
    if (['momentum-quality', 'pead'].includes(sid)) {
      const tabs = ['Positions', 'Analytics', 'Trades'];
      for (const tabName of tabs) {
        const tab = await page.$(`button:has-text("${tabName}")`);
        if (tab) {
          await tab.click();
          await page.waitForTimeout(2000);
          await page.screenshot({ path: join(SCREENSHOT_DIR, `06b-strategy-${sid}-${tabName.toLowerCase()}.png`), fullPage: true });
          console.log(`  ${sid} -> ${tabName} tab`);

          const tabContent = await page.evaluate((tn) => {
            const body = document.body.innerText;
            return {
              hasNoData: body.includes('No ') && (body.includes('positions') || body.includes('trades') || body.includes('data')),
              hasData: body.includes('Symbol') || body.includes('$') || body.includes('%'),
              noDataMsg: body.match(/No[\w\s]+(?:positions|trades|data)[^.]*\.?/g),
            };
          }, tabName);

          if (tabContent.hasNoData) {
            finding('Strategy', 'empty-tab', `${sid}/${tabName}: Shows "${tabContent.noDataMsg?.[0]}"`, 'medium');
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 7. COMMAND PALETTE
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 7. COMMAND PALETTE ===');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Try Ctrl+K
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '07-command-palette.png'), fullPage: true });

  const cmdPalette = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasSearch: body.includes('Search') || body.includes('search'),
      hasCommands: body.includes('Command') || body.includes('command'),
      isVisible: document.querySelector('[role="dialog"], [class*="command"], [class*="palette"]') !== null,
    };
  });
  console.log('  Command palette visible:', cmdPalette.isVisible);

  // Type a search
  await page.keyboard.type('AAPL');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '07b-command-palette-search.png'), fullPage: true });
  await page.keyboard.press('Escape');

  // ═══════════════════════════════════════════════════════════
  // 8. ALERTS/NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 8. ALERTS ===');
  const bellBtn = await page.$('button:has(svg.lucide-bell), button:has-text("Alerts")');
  if (bellBtn) {
    await bellBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '08-alerts.png'), fullPage: true });
    console.log('  Alerts panel opened');
    await page.keyboard.press('Escape');
  }

  // ═══════════════════════════════════════════════════════════
  // 9. TRADE PAGE - DEEPER ANALYSIS
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 9. TRADE DEEP DIVE ===');
  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Test order entry flow
  const orderEntryAnalysis = await page.evaluate(() => {
    const body = document.body.innerText;
    const inputs = document.querySelectorAll('input');
    const buttons = document.querySelectorAll('button');
    const orderBtns = Array.from(buttons).filter(b =>
      b.innerText?.includes('BUY') || b.innerText?.includes('SELL') ||
      b.innerText?.includes('Buy') || b.innerText?.includes('Sell') ||
      b.innerText?.includes('Place') || b.innerText?.includes('Submit')
    );
    return {
      inputCount: inputs.length,
      orderBtnCount: orderBtns.length,
      orderBtnTexts: orderBtns.map(b => b.innerText?.trim()),
      hasPriceInput: Array.from(inputs).some(i => i.placeholder?.toLowerCase().includes('price') || i.getAttribute('name')?.includes('price')),
      hasQtyInput: Array.from(inputs).some(i => i.placeholder?.toLowerCase().includes('qty') || i.placeholder?.toLowerCase().includes('quantity') || i.getAttribute('name')?.includes('qty')),
      hasMarketLimit: body.includes('Market') && body.includes('Limit'),
      hasStopLoss: body.includes('Stop Loss') || body.includes('Stop'),
      hasTakeProfit: body.includes('Take Profit') || body.includes('Target'),
    };
  });
  console.log('  Order entry:', JSON.stringify(orderEntryAnalysis));

  // Try the AI Chat tab
  const chatTab = await page.$('button:has-text("Chat")');
  if (chatTab) {
    await chatTab.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '09-ai-chat.png'), clip: { x: 1350, y: 40, width: 570, height: 700 } });

    // Check for chat input
    const chatInput = await page.$('input[placeholder*="Ask"], input[placeholder*="ask"], input[placeholder*="Claude"], textarea');
    if (chatInput) {
      await chatInput.fill('What is your analysis of AAPL?');
      await page.screenshot({ path: join(SCREENSHOT_DIR, '09b-ai-chat-typed.png'), clip: { x: 1350, y: 40, width: 570, height: 700 } });

      // Try sending the message
      const sendBtn = await page.$('button:has(svg.lucide-send), button:has-text("Send")');
      if (sendBtn) {
        await sendBtn.click();
        await page.waitForTimeout(5000);
        await page.screenshot({ path: join(SCREENSHOT_DIR, '09c-ai-chat-response.png'), clip: { x: 1350, y: 40, width: 570, height: 700 } });
        console.log('  AI chat message sent');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 10. TRADE - News & Sentiment
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 10. NEWS & SENTIMENT ===');
  const newsTab = await page.$('button:has-text("Fund")');
  if (newsTab) {
    await newsTab.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '10-fundamentals.png'), clip: { x: 1350, y: 40, width: 570, height: 700 } });
  }
  const sentTab = await page.$('button:has-text("Sent")');
  if (sentTab) {
    await sentTab.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '10b-sentiment.png'), clip: { x: 1350, y: 40, width: 570, height: 700 } });

    const sentimentData = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasNewsItems: body.includes('ago') || body.includes('min') || body.includes('hour'),
        hasSentimentScore: body.includes('score') || body.includes('Score') || body.includes('Bullish') || body.includes('Bearish'),
        hasNewsSources: body.includes('Reuters') || body.includes('Bloomberg') || body.includes('CNBC') || body.includes('WSJ'),
        newsText: body.substring(body.indexOf('Sent'), body.indexOf('Sent') + 1000),
      };
    });
    console.log('  Sentiment:', JSON.stringify(sentimentData));
  }

  // ═══════════════════════════════════════════════════════════
  // 11. TRADE - Full page with all panels visible
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 11. TRADE FULL LAYOUT ===');
  // Switch back to Tech tab
  const techTab = await page.$('button:has-text("Tech")');
  if (techTab) {
    await techTab.click();
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: join(SCREENSHOT_DIR, '11-trade-final-layout.png'), fullPage: true });

  // ═══════════════════════════════════════════════════════════
  // 12. DATA QUALITY CHECKS
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 12. DATA QUALITY ===');
  const dataQuality = await page.evaluate(() => {
    const body = document.body.innerText;

    // Check for NaN, undefined, null displayed
    const hasNaN = body.includes('NaN');
    const hasUndefined = body.includes('undefined');
    const hasNull = body.includes('null') && !body.includes('nullable');

    // Check for stale prices (look at timestamps)
    const timestamps = body.match(/\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?/g);
    const dateStrings = body.match(/\d{4}-\d{2}-\d{2}/g);

    // Check for zero prices
    const prices = body.match(/\$\d+\.?\d*/g);
    const zeroPrices = prices?.filter(p => p === '$0' || p === '$0.00' || p === '$0.0');

    return {
      hasNaN,
      hasUndefined,
      hasNull,
      timestampCount: timestamps?.length || 0,
      dateStringCount: dateStrings?.length || 0,
      priceCount: prices?.length || 0,
      zeroPriceCount: zeroPrices?.length || 0,
      samplePrices: prices?.slice(0, 8),
      sampleDates: dateStrings?.slice(0, 5),
    };
  });
  console.log('  Data quality:', JSON.stringify(dataQuality));

  if (dataQuality.hasNaN) finding('Trade', 'nan-displayed', 'NaN visible in the UI', 'critical');
  if (dataQuality.hasUndefined) finding('Trade', 'undefined-displayed', 'undefined visible in the UI', 'critical');
  if (dataQuality.zeroPriceCount > 0) finding('Trade', 'zero-prices', `${dataQuality.zeroPriceCount} zero-value prices displayed`, 'high');

  // ═══════════════════════════════════════════════════════════
  // 13. KEYBOARD SHORTCUTS
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 13. KEYBOARD SHORTCUTS ===');
  await page.keyboard.press('?');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '13-shortcuts-overlay.png'), fullPage: true });

  const shortcutsVisible = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasShortcuts: body.includes('Ctrl+K') || body.includes('shortcut') || body.includes('Shortcut'),
      hasKeyBindings: body.includes('Ctrl') || body.includes('Alt') || body.includes('Cmd'),
    };
  });
  console.log('  Shortcuts overlay:', JSON.stringify(shortcutsVisible));
  await page.keyboard.press('Escape');

  // ═══════════════════════════════════════════════════════════
  // 14. MOBILE / RESPONSIVE CHECK (narrower viewport)
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== 14. RESPONSIVE CHECK ===');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '14-responsive-dashboard.png'), fullPage: true });

  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '14b-responsive-trade.png'), fullPage: true });

  // Reset viewport
  await page.setViewportSize({ width: 1920, height: 1080 });

  // ═══════════════════════════════════════════════════════════
  // SAVE RESULTS
  // ═══════════════════════════════════════════════════════════
  console.log('\n=== DONE ===');
  console.log(`Total findings: ${findings.length}`);

  writeFileSync(join(SCREENSHOT_DIR, 'findings.json'), JSON.stringify({ findings, timestamp: new Date().toISOString() }, null, 2));
  console.log('Findings saved to findings.json');

  // Detailed console summary
  console.log('\n===== TRADING EXPERT EVALUATION SUMMARY =====');
  console.log('\nDashboard:');
  console.log('  Status strip:', statusStrip);
  console.log('  Portfolio values:', dashContent.portfolioValueMatch?.slice(0, 3));
  console.log('  Strategies found:', dashContent.strategyNames);

  console.log('\nTrade Page:');
  console.log('  Watchlist symbols:', tradeLayout.watchlistSymbols);
  console.log('  Options available:', tradeLayout.hasOptions);
  console.log('  Greeks:', tradeLayout.hasGreeks);
  console.log('  Order entry:', orderEntryAnalysis);

  console.log('\nPipeline:');
  console.log('  Flow diagram:', pipelineData.hasFlowDiagram);
  console.log('  History:', pipelineData.hasHistory);
  console.log('  Run button:', pipelineData.hasRunButton);

  console.log('\nData Quality:');
  console.log('  NaN:', dataQuality.hasNaN);
  console.log('  Undefined:', dataQuality.hasUndefined);
  console.log('  Sample prices:', dataQuality.samplePrices);

  await browser.close();
  console.log('\nBrowser closed. All screenshots saved to:', SCREENSHOT_DIR);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
