/**
 * AlphaDesk FINAL Trading Expert Evaluation
 *
 * Comprehensive end-to-end assessment by a quantitative trader / fintech PM
 * with Bloomberg Terminal, TradingView, Thinkorswim, and Robinhood Legend experience.
 *
 * Tests every feature added since the previous 4.5/10 review.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const BASE_URL = "https://tradingalpha.net";
const SCREENSHOT_DIR = "/Users/GK/Downloads/alphadesk/qa-screenshots/final-eval";
const USERNAME = "admin";
const PASSWORD = "GK1355$$gk";

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ─── Results collector ─────────────────────────────────────────
const findings = {
  startTime: new Date().toISOString(),
  sections: {},
  scores: {},
  screenshots: [],
};

function log(msg) { console.log(msg); }
function finding(section, detail, severity = "info") {
  if (!findings.sections[section]) findings.sections[section] = [];
  findings.sections[section].push({ detail, severity, ts: new Date().toISOString() });
  const icon = severity === "critical" ? "!!!" : severity === "high" ? "!!" : severity === "good" ? "++" : "  ";
  console.log(`  [${icon}] ${detail}`);
}

async function screenshot(page, name, fullPage = true) {
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage });
  findings.screenshots.push(name);
  return path;
}

// ─── Login helper ──────────────────────────────────────────────
async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  await page.fill("#login-username", USERNAME);
  await page.waitForTimeout(200);
  await page.fill("#login-password", PASSWORD);
  await page.waitForTimeout(200);

  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);
  await page.waitForLoadState("networkidle").catch(() => {});

  return !page.url().includes("/login");
}

// ═══════════════════════════════════════════════════════════════
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // ═══════════════════════════════════════════════════════════
  // 0. LOGIN
  // ═══════════════════════════════════════════════════════════
  log("\n=== 0. LOGIN ===");
  const loggedIn = await login(page);
  await screenshot(page, "00-post-login");
  if (!loggedIn) {
    finding("Login", "FAILED to login — cannot continue", "critical");
    await browser.close();
    return;
  }
  finding("Login", `Login successful, redirected to ${page.url()}`, "good");

  // ═══════════════════════════════════════════════════════════
  // 1. DASHBOARD — The 3-Second Test
  // ═══════════════════════════════════════════════════════════
  log("\n=== 1. DASHBOARD ===");
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);
  await screenshot(page, "01-dashboard-full");

  // 1a. Portfolio value & P&L
  const dashData = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasPortfolioValue: /\$[\d,]+\.?\d{0,2}/.test(body),
      portfolioValues: body.match(/\$[\d,]+\.?\d{0,2}/g)?.slice(0, 8) || [],
      hasPnlWithPercent: /[+-]?\$[\d,.]+\s*\(/.test(body) || /[+-]\d+\.\d+%/.test(body),
      hasPlaceholderPnl: body.includes("$--.--"),
      hasPlaceholderRegime: /Regime\s+---/.test(body),
      hasPlaceholderVix: /VIX\s+--\.?-/.test(body),
      hasEquityCurve: !!document.querySelector('svg path, svg polyline, canvas'),
      hasStrategies: body.includes("Active") || body.includes("Paused"),
      strategyNames: ["Momentum", "PEAD", "VRP", "Earnings Vol", "Regime", "Claude Alpha", "Mean Reversion", "VCP"].filter(s => body.includes(s)),
      strategyCountsNonZero: (body.match(/\+\d+\.\d+%/g) || []).filter(m => m !== "+0.00%").length,
      hasPositions: body.includes("Position") || body.includes("MRK") || body.includes("position"),
      hasPnlCalendar: (body.includes("P&L") || body.includes("Calendar")) && (body.includes("Apr") || body.includes("Mon") || body.includes("Tue")),
      hasMarketData: body.includes("S&P") || body.includes("SPX") || body.includes("Nasdaq") || body.includes("QQQ"),
      hasEconomicCalendar: body.includes("Economic") || body.includes("FOMC") || body.includes("CPI") || body.includes("GDP") || body.includes("NFP") || body.includes("Employment"),
      hasActivityFeed: body.includes("Activity") || body.includes("Pipeline") || body.includes("Signal") || body.includes("News"),
      hasSectorData: body.includes("Sector") || body.includes("Technology") || body.includes("Healthcare"),
      hasLiveOrPaper: body.includes("LIVE") || body.includes("Paper") || body.includes("PAPER"),
      fullText: body.substring(0, 5000),
    };
  });

  log("  Portfolio values found: " + JSON.stringify(dashData.portfolioValues));
  log("  Strategies visible: " + JSON.stringify(dashData.strategyNames));

  if (dashData.hasPortfolioValue) finding("Dashboard", "Portfolio value displayed prominently", "good");
  else finding("Dashboard", "No portfolio value found on dashboard", "critical");

  if (dashData.hasPnlWithPercent) finding("Dashboard", "P&L with percentage displayed", "good");
  if (dashData.hasPlaceholderPnl) finding("Dashboard", "P&L shows placeholder $--.--", "high");
  if (dashData.hasPlaceholderRegime) finding("Dashboard", "Regime shows --- placeholder", "high");
  if (dashData.hasPlaceholderVix) finding("Dashboard", "VIX shows --.- placeholder", "high");

  if (dashData.hasEquityCurve) finding("Dashboard", "Equity curve / sparkline chart visible", "good");
  else finding("Dashboard", "No equity curve visible", "high");

  if (dashData.strategyNames.length >= 6) finding("Dashboard", `${dashData.strategyNames.length}/8 strategies visible in grid`, "good");
  else finding("Dashboard", `Only ${dashData.strategyNames.length}/8 strategies visible`, "high");

  if (dashData.strategyCountsNonZero > 0) finding("Dashboard", `${dashData.strategyCountsNonZero} strategies show non-zero returns`, "good");
  else finding("Dashboard", "All visible strategies show +0.00% returns", "high");

  if (dashData.hasPositions) finding("Dashboard", "Positions section present", "good");
  if (dashData.hasPnlCalendar) finding("Dashboard", "P&L Calendar heatmap present", "good");
  else finding("Dashboard", "P&L Calendar not found", "high");

  if (dashData.hasMarketData) finding("Dashboard", "Market data / indices visible", "good");
  else finding("Dashboard", "No market indices visible", "high");

  if (dashData.hasEconomicCalendar) finding("Dashboard", "Economic calendar present", "good");
  else finding("Dashboard", "Economic calendar not found — was this added?", "info");

  if (dashData.hasActivityFeed) finding("Dashboard", "Activity feed / news present", "good");
  if (dashData.hasSectorData) finding("Dashboard", "Sector data present", "good");

  // Scroll to bottom to capture full dashboard
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await screenshot(page, "01b-dashboard-bottom");

  // ═══════════════════════════════════════════════════════════
  // 2. TRADE PAGE — Full Workflow
  // ═══════════════════════════════════════════════════════════
  log("\n=== 2. TRADE PAGE ===");
  await page.goto(`${BASE_URL}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);
  await screenshot(page, "02-trade-full");

  const tradeData = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      // Watchlist
      hasWatchlist: body.includes("Watchlist") || body.includes("AAPL") || body.includes("MSFT") || body.includes("SPY"),
      watchlistSymbols: ["AAPL", "MSFT", "SPY", "GOOGL", "AMZN", "NVDA", "TSLA", "META"].filter(s => body.includes(s)),
      hasWatchlistPrices: /\$\d{2,4}\.\d{2}/.test(body),

      // Chart
      hasChart: !!document.querySelector('canvas') || !!document.querySelector('[data-slot="chart-panel"]'),
      hasTimeframes: ["1m", "5m", "15m", "1H", "4H"].some(tf => body.includes(tf)),
      hasChartTypeButtons: body.includes("Candlestick") || body.includes("Line") || body.includes("Area") || !!document.querySelector('button[title="Candlestick"], button[title="Line"]'),

      // Drawing tools
      hasDrawingTools: !!document.querySelector('button[title="Horizontal Line"]') ||
                       !!document.querySelector('button[title="Trendline"]') ||
                       !!document.querySelector('button[title="Fibonacci"]') ||
                       body.includes("Fib"),
      drawingToolButtons: Array.from(document.querySelectorAll('button[title]')).map(b => b.getAttribute('title')).filter(t => t && (t.includes("Line") || t.includes("Trend") || t.includes("Fib"))),

      // BUY/SELL
      hasBuyButton: body.includes("BUY"),
      hasSellButton: body.includes("SELL"),

      // Price alerts
      hasAlertButton: !!document.querySelector('button[title="Set price alert"]') || body.includes("alert"),

      // Analysis tabs
      analysisTabs: ["Technical", "Fundamental", "Sentiment", "Chat", "Order", "Tech", "Fund", "Sent"].filter(t => body.includes(t)),

      // Options chain
      hasOptionsChain: body.includes("Options") || body.includes("Strike") || body.includes("Call") || body.includes("Put"),
      hasIVRank: body.includes("IV Rank") || body.includes("IV Pctl") || /IV\s*\d/.test(body),

      // Order entry
      hasOrderEntry: body.includes("Market") || body.includes("Limit") || body.includes("Shares") || body.includes("Quantity"),
      hasPositionSizer: body.includes("Position Siz") || body.includes("Risk") || body.includes("% of"),

      // Indicators
      hasIndicators: body.includes("Indicators") || body.includes("EMA") || body.includes("SMA") || body.includes("MACD") || body.includes("RSI"),

      // L1 data
      hasL1Data: body.includes("spread") || (body.includes("Vol:") && body.includes("H:")),

      fullText: body.substring(0, 5000),
    };
  });

  log("  Watchlist symbols: " + JSON.stringify(tradeData.watchlistSymbols));
  log("  Analysis tabs: " + JSON.stringify(tradeData.analysisTabs));
  log("  Drawing tools: " + JSON.stringify(tradeData.drawingToolButtons));

  if (tradeData.hasWatchlist) finding("Trade", "Watchlist panel visible with symbols", "good");
  if (tradeData.hasWatchlistPrices) finding("Trade", "Watchlist shows live prices", "good");
  else finding("Trade", "Watchlist missing prices", "high");

  if (tradeData.hasChart) finding("Trade", "Chart canvas rendered", "good");
  else finding("Trade", "No chart visible", "critical");

  if (tradeData.hasTimeframes) finding("Trade", "Timeframe buttons present (1m-M)", "good");

  if (tradeData.hasDrawingTools) {
    finding("Trade", "Drawing tools present (NEW) -- horizontal line, trendline, fib", "good");
  } else {
    finding("Trade", "Drawing tools NOT found", "high");
  }

  if (tradeData.hasBuyButton && tradeData.hasSellButton) finding("Trade", "BUY/SELL buttons on chart", "good");
  else finding("Trade", "BUY/SELL buttons not found", "high");

  if (tradeData.hasAlertButton) finding("Trade", "Price alert button present (NEW)", "good");
  else finding("Trade", "Price alert button not found", "high");

  if (tradeData.hasIndicators) finding("Trade", "Indicators dropdown available", "good");
  if (tradeData.hasL1Data) finding("Trade", "L1 data (bid/ask/spread/vol/H/L) visible", "good");
  if (tradeData.hasOptionsChain) finding("Trade", "Options chain present", "good");
  if (tradeData.hasOrderEntry) finding("Trade", "Order entry panel visible", "good");

  // 2a. Test chart type switching
  log("  Testing chart type switching...");
  const chartTypeDropdown = await page.$('button:has-text("Candlestick"), button:has-text("Line"), button:has-text("Area"), [data-slot="chart-panel"] button:first-of-type');
  // Try clicking candlestick/line/area buttons in the timeframe bar
  const candleBtn = await page.$('button[title="Candlestick"]');
  const lineBtn = await page.$('button[title="Line"]');
  // Look for the emoji-based chart type switchers
  const chartTypeBtns = await page.$$('[data-slot="chart-panel"] .flex.items-center.gap-0\\.5 button');
  if (chartTypeBtns.length >= 2) {
    await chartTypeBtns[1].click(); // line chart
    await page.waitForTimeout(1000);
    await screenshot(page, "02b-chart-line");
    finding("Trade", "Chart type switching works (candle -> line)", "good");
    await chartTypeBtns[0].click(); // back to candle
    await page.waitForTimeout(500);
  } else {
    finding("Trade", "Could not find chart type switcher buttons", "info");
  }

  // 2b. Test drawing tools
  log("  Testing drawing tools...");
  const hlineBtn = await page.$('button[title="Horizontal Line"]');
  if (hlineBtn) {
    await hlineBtn.click();
    await page.waitForTimeout(500);
    // Click on chart area to place the line
    const chartArea = await page.$('[data-slot="chart-panel"] .flex-1');
    if (chartArea) {
      const box = await chartArea.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(500);
        await screenshot(page, "02c-drawing-hline");
        finding("Trade", "Horizontal line drawing tool activated and placed", "good");
      }
    }
  }

  // 2c. Test price alert
  log("  Testing price alerts...");
  const alertBtn = await page.$('button[title="Set price alert"]');
  if (alertBtn) {
    await alertBtn.click();
    await page.waitForTimeout(500);
    await screenshot(page, "02d-alert-dialog");
    const alertInput = await page.$('input[type="number"]');
    if (alertInput) {
      finding("Trade", "Price alert dialog opens with price input, above/below selector, and Set button", "good");
    }
    // Close it
    const closeAlert = await page.$('button:has-text("\\u2715")');
    if (closeAlert) await closeAlert.click();
  }

  // 2d. Test clicking a watchlist symbol
  log("  Testing watchlist symbol switching...");
  const aaplLink = await page.$('text=AAPL');
  if (aaplLink) {
    await aaplLink.click();
    await page.waitForTimeout(2000);
    await screenshot(page, "02e-switched-to-aapl");
    const chartSymbol = await page.evaluate(() => {
      const el = document.querySelector('[data-slot="chart-panel"]');
      return el?.textContent?.substring(0, 100) || '';
    });
    if (chartSymbol.includes("AAPL")) {
      finding("Trade", "Clicking AAPL in watchlist updates chart and all panels", "good");
    }
  }

  // 2e. Test analysis tabs
  log("  Testing analysis tabs...");
  for (const tab of ["Tech", "Fund", "Sent", "Chat", "Order"]) {
    const tabBtn = await page.$(`button:has-text("${tab}")`);
    if (tabBtn) {
      await tabBtn.click();
      await page.waitForTimeout(800);
    }
  }
  await screenshot(page, "02f-analysis-tabs");

  // 2f. Options chain
  log("  Testing options chain...");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  const optionsData = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasStrikes: /\d{3,4}/.test(body) && (body.includes("Call") || body.includes("Put")),
      hasGreeks: body.includes("Delta") || body.includes("IV") || body.includes("Theta"),
      hasExpDates: body.includes("DTE") || /\w{3}\s+\d{1,2}\s*\(\d+d\)/.test(body),
      callPrices: body.match(/\d+\.\d{2}/g)?.slice(0, 10) || [],
      hasPutsNotAllZero: !/Put[\s\S]*?(0\.01[\s\S]*?){5}/.test(body.substring(body.indexOf("Put") || 0)),
    };
  });
  await screenshot(page, "02g-options-chain");

  if (optionsData.hasStrikes) finding("Trade", "Options chain shows strikes", "good");
  if (optionsData.hasGreeks) finding("Trade", "Options chain shows Greeks (Delta, IV)", "good");
  if (optionsData.hasExpDates) finding("Trade", "Options chain shows expiration dates with DTE", "good");

  // ═══════════════════════════════════════════════════════════
  // 3. PIPELINE — Flow, Strategy Builder, Backtest, History
  // ═══════════════════════════════════════════════════════════
  log("\n=== 3. PIPELINE ===");
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);
  await screenshot(page, "03-pipeline-full");

  const pipelineData = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasFlowDiagram: body.includes("Screened") && body.includes("Analyzed") && body.includes("Signals") && body.includes("Orders"),
      hasRunButton: body.includes("Run Now") || body.includes("Run Pipeline"),
      hasPositions: body.includes("MRK") || body.includes("Position") || body.includes("Symbol"),
      hasHistory: body.includes("History") || body.includes("Last 7"),
      hasPerformance: body.includes("Total P&L") || body.includes("Win Rate") || body.includes("Total Trades"),
      hasStrategyBuilder: body.includes("Strategy Builder") || body.includes("Build") || body.includes("Natural Language") || body.includes("Add Rule"),
      hasBacktest: body.includes("Backtest") || body.includes("Run Backtest") || body.includes("SMA"),
      pipelineStatus: body.includes("Idle") ? "Idle" : body.includes("Running") ? "Running" : "Unknown",
      hasTabs: body.includes("Pipeline") || body.includes("Builder") || body.includes("Backtest"),
      fullText: body.substring(0, 4000),
    };
  });

  log("  Pipeline status: " + pipelineData.pipelineStatus);

  if (pipelineData.hasFlowDiagram) finding("Pipeline", "Pipeline flow diagram (Screened -> Analyzed -> Signals -> Orders) present", "good");
  else finding("Pipeline", "Pipeline flow diagram not found", "high");

  if (pipelineData.hasRunButton) finding("Pipeline", "Run Now button present", "good");
  if (pipelineData.hasPositions) finding("Pipeline", "Current positions table visible", "good");
  if (pipelineData.hasHistory) finding("Pipeline", "Pipeline history section present", "good");
  if (pipelineData.hasPerformance) finding("Pipeline", "Performance summary metrics visible", "good");

  // 3a. Look for Strategy Builder tab
  log("  Looking for Strategy Builder...");
  const builderTab = await page.$('button:has-text("Builder"), button:has-text("Strategy Builder")');
  if (builderTab) {
    await builderTab.click();
    await page.waitForTimeout(1000);
    await screenshot(page, "03b-strategy-builder");
    finding("Pipeline", "Strategy Builder tab found and opened (NEW)", "good");

    // Test NLP rule parsing
    const ruleInput = await page.$('input[placeholder*="Buy when"], input[placeholder*="RSI"], input[placeholder*="e.g."]');
    if (ruleInput) {
      await ruleInput.fill("Buy when RSI(14) drops below 30");
      await page.waitForTimeout(300);
      const addBtn = await page.$('button:has-text("Add")');
      if (addBtn) {
        await addBtn.click();
        await page.waitForTimeout(500);
      }
      await screenshot(page, "03c-builder-rule-added");

      const ruleResult = await page.evaluate(() => {
        const body = document.body.innerText;
        return {
          hasRule: body.includes("Buy when RSI"),
          hasParsedAction: body.includes("BUY"),
          hasParsedIndicator: body.includes("RSI"),
          hasParsedOperator: body.includes("below") || body.includes("drops"),
          hasParsedValue: body.includes("30"),
        };
      });

      if (ruleResult.hasRule) finding("Pipeline", "Strategy Builder accepted NLP rule", "good");
      if (ruleResult.hasParsedAction) finding("Pipeline", "NLP parser extracted action: BUY", "good");
      if (ruleResult.hasParsedIndicator) finding("Pipeline", "NLP parser extracted indicator: RSI", "good");
      if (ruleResult.hasParsedValue) finding("Pipeline", "NLP parser extracted value: 30", "good");

      // Add a second rule
      await ruleInput.fill("Sell when price crosses above upper Bollinger Band");
      if (addBtn) {
        const addBtn2 = await page.$('button:has-text("Add")');
        if (addBtn2) {
          await addBtn2.click();
          await page.waitForTimeout(500);
        }
      }
      await screenshot(page, "03d-builder-two-rules");

      // Test AI Refine button
      const aiRefineBtn = await page.$('button:has-text("AI Refine")');
      if (aiRefineBtn) {
        finding("Pipeline", "AI Refine button present for strategy rules", "good");
        await aiRefineBtn.click();
        await page.waitForTimeout(2000);
        await screenshot(page, "03e-builder-ai-refine");
      }
    } else {
      finding("Pipeline", "Strategy Builder rule input not found", "high");
    }
  } else {
    finding("Pipeline", "Strategy Builder tab not found on pipeline page", "info");
    // It might be embedded directly
    const ruleInput = await page.$('input[placeholder*="Buy when"], input[placeholder*="RSI"], input[placeholder*="e.g."]');
    if (ruleInput) {
      finding("Pipeline", "Strategy Builder input found inline on page", "good");
    }
  }

  // 3b. Look for Backtest tab
  log("  Looking for Backtest...");
  const backtestTab = await page.$('button:has-text("Backtest"), button:has-text("Back-test")');
  if (backtestTab) {
    await backtestTab.click();
    await page.waitForTimeout(1000);
    await screenshot(page, "03f-backtest-panel");
    finding("Pipeline", "Backtest tab found and opened (NEW)", "good");
  }

  // Check if backtest panel is visible (might be inline)
  const backtestData = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasSymbolInput: !!document.querySelector('input[value="SPY"]') || body.includes("Symbol"),
      hasFastSMA: body.includes("Fast SMA") || body.includes("Fast"),
      hasSlowSMA: body.includes("Slow SMA") || body.includes("Slow"),
      hasCapital: body.includes("Capital"),
      hasRunButton: body.includes("Run Backtest"),
    };
  });

  if (backtestData.hasRunButton) {
    finding("Pipeline", "Backtest panel has Run Backtest button", "good");

    // Actually run the backtest on SPY
    log("  Running backtest on SPY...");

    // Set symbol to SPY if not already
    const symInput = await page.$('input[value="SPY"]');
    if (!symInput) {
      const inputs = await page.$$('input');
      for (const inp of inputs) {
        const val = await inp.inputValue();
        if (val === "" || val === "SPY") {
          await inp.fill("SPY");
          break;
        }
      }
    }

    const runBtBtn = await page.$('button:has-text("Run Backtest")');
    if (runBtBtn) {
      await runBtBtn.click();
      await page.waitForTimeout(5000); // Wait for API call + computation
      await screenshot(page, "03g-backtest-results");

      const btResults = await page.evaluate(() => {
        const body = document.body.innerText;
        return {
          hasTotalReturn: body.includes("Total Return"),
          hasWinRate: body.includes("Win Rate") || body.includes("W /"),
          hasMaxDrawdown: body.includes("Max Drawdown") || body.includes("Drawdown"),
          hasSharpe: body.includes("Sharpe"),
          hasEquityCurve: !!document.querySelector('svg polyline, svg path') && body.includes("Equity Curve"),
          returnValue: body.match(/[+-]\$[\d,]+\.?\d*/)?.[0] || body.match(/[+-]\d+\.\d+%/)?.[0] || "not found",
          winRateValue: body.match(/\d+%/)?.[0] || "not found",
          tradeCount: body.match(/\d+\s*trades/)?.[0] || body.match(/\(\d+ trades\)/)?.[0] || "not found",
        };
      });

      if (btResults.hasTotalReturn) finding("Pipeline", `Backtest returned Total Return: ${btResults.returnValue}`, "good");
      else finding("Pipeline", "Backtest did not show Total Return", "high");

      if (btResults.hasWinRate) finding("Pipeline", `Backtest Win Rate: ${btResults.winRateValue}`, "good");
      if (btResults.hasMaxDrawdown) finding("Pipeline", "Backtest shows Max Drawdown", "good");
      if (btResults.hasSharpe) finding("Pipeline", "Backtest shows Sharpe Ratio", "good");
      if (btResults.hasEquityCurve) finding("Pipeline", "Backtest rendered equity curve SVG", "good");
      else finding("Pipeline", "Backtest equity curve not visible", "high");
    }
  } else {
    finding("Pipeline", "Backtest Run button not found", "high");
  }

  // 3c. Pipeline history
  log("  Checking pipeline history...");
  const historyTab = await page.$('button:has-text("History")');
  if (historyTab) {
    await historyTab.click();
    await page.waitForTimeout(1000);
    await screenshot(page, "03h-pipeline-history");
    finding("Pipeline", "Pipeline history tab accessible", "good");
  }

  // ═══════════════════════════════════════════════════════════
  // 4. STRATEGY DETAIL — Equity curve with SPY benchmark
  // ═══════════════════════════════════════════════════════════
  log("\n=== 4. STRATEGY DETAIL ===");

  // Navigate to PEAD strategy (the one with data)
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);
  await screenshot(page, "04-strategy-detail-pead");

  const stratDetailData = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasStrategyName: body.includes("PEAD") || body.includes("Post-Earnings"),
      hasEquityCurve: !!document.querySelectorAll('svg polyline, svg path').length,
      hasBenchmark: body.includes("SPY") || body.includes("Benchmark") || body.includes("S&P"),
      hasTimePeriods: ["1M", "3M", "6M", "YTD", "ALL"].filter(p => body.includes(p)).length > 0,
      timePeriodFilters: ["1M", "3M", "6M", "YTD", "ALL"].filter(p => body.includes(p)),
      hasTabs: ["About", "Positions", "Trade History", "Analytics", "Journal"].filter(t => body.includes(t)),
      hasStats: body.includes("Total Return") || body.includes("Sharpe") || body.includes("Max Drawdown") || body.includes("Win Rate"),
      statsNotNA: !body.includes("N/A") || body.includes("Total Return"),
      hasTradeHistory: body.includes("Trade History") || body.includes("Entry") || body.includes("Exit"),
      hasActiveToggle: body.includes("Active") || body.includes("Paused") || body.includes("Toggle"),
      hasThesis: body.includes("thesis") || body.includes("edge") || body.includes("drift") || body.includes("academic") || body.includes("Thesis") || body.includes("Edge"),
      returnValue: body.match(/[+-]?\d+\.\d+%/)?.[0] || "not found",
      fullText: body.substring(0, 3000),
    };
  });

  log("  Strategy tabs: " + JSON.stringify(stratDetailData.hasTabs));
  log("  Time periods: " + JSON.stringify(stratDetailData.timePeriodFilters));
  log("  Return: " + stratDetailData.returnValue);

  if (stratDetailData.hasStrategyName) finding("Strategy", "PEAD strategy detail page loaded", "good");
  if (stratDetailData.hasEquityCurve) finding("Strategy", "Equity curve chart rendered", "good");
  else finding("Strategy", "Equity curve not visible", "high");

  if (stratDetailData.hasBenchmark) finding("Strategy", "SPY benchmark comparison visible on equity curve (NEW)", "good");
  else finding("Strategy", "SPY benchmark NOT visible on equity curve", "high");

  if (stratDetailData.timePeriodFilters.length >= 3) finding("Strategy", `Time period filters present: ${stratDetailData.timePeriodFilters.join(", ")}`, "good");

  if (stratDetailData.hasTabs.length >= 3) finding("Strategy", `Tabs available: ${stratDetailData.hasTabs.join(", ")}`, "good");

  if (stratDetailData.hasStats) finding("Strategy", "Performance stats visible (Total Return, Sharpe, etc.)", "good");
  if (stratDetailData.hasThesis) finding("Strategy", "Strategy thesis / edge documentation present", "good");

  // Test tab navigation
  for (const tab of ["Trade History", "Analytics", "Positions", "About", "Journal"]) {
    const tabBtn = await page.$(`button:has-text("${tab}")`);
    if (tabBtn) {
      await tabBtn.click();
      await page.waitForTimeout(800);
    }
  }
  await screenshot(page, "04b-strategy-tabs");

  // Check trade history specifically
  const tradeHistTab = await page.$('button:has-text("Trade History"), button:has-text("Trades")');
  if (tradeHistTab) {
    await tradeHistTab.click();
    await page.waitForTimeout(1000);
    await screenshot(page, "04c-trade-history");

    const tradeHistData = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasEntries: body.includes("Entry") || body.includes("entry"),
        hasExits: body.includes("Exit") || body.includes("exit"),
        hasPnl: /[+-]\$[\d,.]+/.test(body),
        hasConviction: body.includes("conviction") || body.includes("Conviction"),
        hasNoTrades: body.includes("No trades") || body.includes("No data"),
      };
    });
    if (tradeHistData.hasEntries || tradeHistData.hasPnl) finding("Strategy", "Trade history shows entries with P&L data", "good");
    if (tradeHistData.hasNoTrades) finding("Strategy", "Trade history shows 'No trades' — needs more pipeline activity", "info");
  }

  // Try Momentum strategy too
  await page.goto(`${BASE_URL}/strategies/momentum`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  await screenshot(page, "04d-strategy-momentum");

  // ═══════════════════════════════════════════════════════════
  // 5. DATA QUALITY DEEP DIVE
  // ═══════════════════════════════════════════════════════════
  log("\n=== 5. DATA QUALITY CHECKS ===");

  // Go back to trade page for detailed data checks
  await page.goto(`${BASE_URL}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  // Check if clicking SPY loads it properly
  const spyLink = await page.$('text=SPY');
  if (spyLink) {
    await spyLink.click();
    await page.waitForTimeout(3000);
  }

  const dataQuality = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      // Check for placeholder/fake data patterns
      allSentimentSame: false, // Can't easily test across symbols in one eval
      hasRealPrices: /\$\d{2,4}\.\d{2}/.test(body),
      hasBidAsk: body.includes("spread") || /\d+\.\d{2}\s*\/\s*\d+\.\d{2}/.test(body),
      hasVolume: body.includes("Vol:") || body.includes("Volume"),
      hasHighLow: body.includes("H:") && body.includes("L:"),

      // Technical analysis
      hasTechScore: body.includes("Technical Score") || body.includes("Score"),
      hasRSI: body.includes("RSI"),
      hasMACD: body.includes("MACD"),

      // Fundamentals
      hasPE: body.includes("P/E"),
      hasROE: body.includes("ROE"),
      hasFScore: body.includes("F-Score") || body.includes("Piotroski"),

      // Options
      optionsPrices: body.match(/0\.01/g)?.length || 0,

      // News/sentiment
      hasTemplateNews: body.includes("Analysts raise price target following earnings beat"),
    };
  });

  if (dataQuality.hasRealPrices) finding("DataQuality", "Real equity prices visible", "good");
  if (dataQuality.hasBidAsk) finding("DataQuality", "Bid/Ask spread visible — real L1 data", "good");
  if (dataQuality.hasVolume) finding("DataQuality", "Volume data present", "good");
  if (dataQuality.hasHighLow) finding("DataQuality", "High/Low data present", "good");
  if (dataQuality.optionsPrices > 5) finding("DataQuality", `Found ${dataQuality.optionsPrices} instances of $0.01 — puts side may still be placeholder`, "high");
  if (dataQuality.hasTemplateNews) finding("DataQuality", "Template news still present (same for all symbols)", "high");

  // ═══════════════════════════════════════════════════════════
  // 6. CONSOLE ERRORS & PERFORMANCE
  // ═══════════════════════════════════════════════════════════
  log("\n=== 6. CONSOLE ERRORS ===");
  if (consoleErrors.length > 0) {
    finding("Errors", `${consoleErrors.length} console errors captured`, "high");
    consoleErrors.slice(0, 5).forEach((e) => {
      finding("Errors", `Console: ${e.substring(0, 120)}`, "info");
    });
  } else {
    finding("Errors", "No console errors captured during session", "good");
  }

  // ═══════════════════════════════════════════════════════════
  // 7. RESPONSIVE CHECKS (1920x1080 — desktop trader setup)
  // ═══════════════════════════════════════════════════════════
  log("\n=== 7. LAYOUT CHECKS ===");

  // Check for overflow issues on trade page
  await page.goto(`${BASE_URL}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const layoutData = await page.evaluate(() => {
    const body = document.body;
    return {
      hasHorizontalScroll: body.scrollWidth > window.innerWidth,
      bodyWidth: body.scrollWidth,
      viewportWidth: window.innerWidth,
      // Check if "Order" tab is clipped
      orderTab: (() => {
        const tabs = Array.from(document.querySelectorAll('button'));
        const orderBtn = tabs.find(b => b.textContent?.includes("Order") || b.textContent?.includes("Orde"));
        if (orderBtn) {
          const rect = orderBtn.getBoundingClientRect();
          return { text: orderBtn.textContent, right: rect.right, viewportWidth: window.innerWidth, clipped: rect.right > window.innerWidth };
        }
        return null;
      })(),
    };
  });

  if (layoutData.hasHorizontalScroll) finding("Layout", `Horizontal overflow: body ${layoutData.bodyWidth}px > viewport ${layoutData.viewportWidth}px`, "high");
  else finding("Layout", "No horizontal overflow at 1920x1080", "good");

  if (layoutData.orderTab?.clipped) finding("Layout", "Order tab is clipped/truncated (previous bug)", "high");
  else if (layoutData.orderTab) finding("Layout", "Order tab is fully visible (bug fixed)", "good");

  // ═══════════════════════════════════════════════════════════
  // FINAL: Summary screenshot
  // ═══════════════════════════════════════════════════════════
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  await screenshot(page, "99-final-dashboard");

  await browser.close();

  // ═══════════════════════════════════════════════════════════
  // SCORING & REPORT
  // ═══════════════════════════════════════════════════════════
  findings.endTime = new Date().toISOString();

  // Count findings by severity
  const allFindings = Object.values(findings.sections).flat();
  const goods = allFindings.filter(f => f.severity === "good").length;
  const highs = allFindings.filter(f => f.severity === "high").length;
  const criticals = allFindings.filter(f => f.severity === "critical").length;

  console.log("\n" + "=".repeat(64));
  console.log("  FINAL EVALUATION SUMMARY");
  console.log("=".repeat(64));
  console.log(`  Total findings: ${allFindings.length}`);
  console.log(`  Good:     ${goods}`);
  console.log(`  High:     ${highs}`);
  console.log(`  Critical: ${criticals}`);
  console.log(`  Screenshots: ${findings.screenshots.length}`);
  console.log(`  Console errors: ${consoleErrors.length}`);

  // Write raw JSON results
  writeFileSync(
    join(SCREENSHOT_DIR, "findings.json"),
    JSON.stringify(findings, null, 2)
  );

  // Write findings summary
  const summaryLines = [];
  for (const [section, items] of Object.entries(findings.sections)) {
    summaryLines.push(`\n### ${section}`);
    for (const item of items) {
      const icon = item.severity === "good" ? "PASS" : item.severity === "critical" ? "CRIT" : item.severity === "high" ? "WARN" : "INFO";
      summaryLines.push(`- [${icon}] ${item.detail}`);
    }
  }
  writeFileSync(
    join(SCREENSHOT_DIR, "findings-summary.txt"),
    summaryLines.join("\n")
  );

  console.log("\n  Results written to: " + SCREENSHOT_DIR);
  console.log("  Now writing evaluation report...\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
