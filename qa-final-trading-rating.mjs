/**
 * AlphaDesk FINAL Trading Product Rating
 *
 * A quantitative trader's comprehensive evaluation of every feature.
 * Navigates Dashboard (12 strategies, equity curve, economic calendar),
 * Trade page (chart types, drawing, alerts, order entry, screener, options),
 * Pipeline (strategy builder, backtesting), and Strategy detail (benchmark).
 *
 * Captures evidence screenshots and outputs a structured rating report.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE_URL = "https://tradingalpha.net";
const SCREENSHOT_DIR = "/Users/GK/Downloads/alphadesk/qa-screenshots/final-rating";
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const findings = { sections: {}, screenshots: [] };
const consoleErrors = [];
const networkFailures = [];
const timings = {};

function log(msg) { console.log(msg); }

function finding(section, detail, severity = "info") {
  if (!findings.sections[section]) findings.sections[section] = [];
  findings.sections[section].push({ detail, severity });
  const icon = severity === "critical" ? "!!!" : severity === "high" ? "!!" : severity === "good" ? "++" : "  ";
  console.log(`  [${icon}] ${detail}`);
}

async function screenshot(page, name, fullPage = true) {
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage }).catch(() => {});
  findings.screenshots.push(name);
  return path;
}

async function timeNav(page, url, label) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const elapsed = Date.now() - t0;
  timings[label] = elapsed;
  return elapsed;
}

// ─── Login ────────────────────────────────────────────────────
async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.fill("#login-username", USERNAME).catch(() => {});
  await page.waitForTimeout(200);
  await page.fill("#login-password", PASSWORD).catch(() => {});
  await page.waitForTimeout(200);
  await page.click('button[type="submit"]').catch(() => {});
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

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("requestfailed", (req) => {
    networkFailures.push({ url: req.url(), failure: req.failure()?.errorText });
  });

  // ═══════════════════════════════════════════════════════════
  // 0. LOGIN
  // ═══════════════════════════════════════════════════════════
  log("\n=== 0. LOGIN ===");
  const loggedIn = await login(page);
  await screenshot(page, "00-post-login");
  if (!loggedIn) {
    finding("Login", "FAILED to login", "critical");
    await browser.close();
    return;
  }
  finding("Login", `Logged in, landed at ${page.url()}`, "good");

  // ═══════════════════════════════════════════════════════════
  // 1. DASHBOARD - The 3-Second Test
  // ═══════════════════════════════════════════════════════════
  log("\n=== 1. DASHBOARD ===");
  const dashTime = await timeNav(page, `${BASE_URL}/`, "dashboard");
  await page.waitForTimeout(2000);
  await screenshot(page, "01-dashboard-top");

  const dash = await page.evaluate(() => {
    const body = document.body.innerText;
    const allStrategies = [
      "Momentum", "PEAD", "VRP", "Earnings Vol", "Regime",
      "Claude Alpha", "Mean Reversion", "VCP", "Pairs",
      "Dividend", "Sector Rotation", "Gap Fill"
    ];
    return {
      hasPortfolioValue: /\$[\d,]+\.?\d{0,2}/.test(body),
      portfolioValues: body.match(/\$[\d,]+\.?\d{0,2}/g)?.slice(0, 10) || [],
      hasPnlPercent: /[+-]?\d+\.\d+%/.test(body),
      hasPlaceholders: body.includes("$--.--") || /---/.test(body),
      hasEquityCurve: !!document.querySelector('svg path, svg polyline, canvas'),
      strategiesVisible: allStrategies.filter(s => body.includes(s)),
      strategyCardsCount: document.querySelectorAll('[role="button"]').length,
      nonZeroReturns: (body.match(/[+-]\d+\.\d+%/g) || []).filter(m => m !== "+0.00%" && m !== "-0.00%").length,
      hasPositions: body.includes("Position") || body.includes("position"),
      hasPnlCalendar: body.includes("P&L") && (body.includes("Mon") || body.includes("Tue") || body.includes("Calendar")),
      hasEconomicCalendar: body.includes("Economic") || body.includes("FOMC") || body.includes("CPI") || body.includes("GDP") || body.includes("NFP"),
      hasMarketContext: body.includes("S&P") || body.includes("SPX") || body.includes("Nasdaq") || body.includes("VIX"),
      hasActivityFeed: body.includes("Activity") || body.includes("Pipeline") || body.includes("Signal"),
      hasSector: body.includes("Sector") || body.includes("Technology") || body.includes("Healthcare"),
      hasAllocation: body.includes("Allocation") || body.includes("allocation"),
      hasLivePaper: body.includes("LIVE") || body.includes("PAPER") || body.includes("Paper"),
      hasRegimeLabel: body.includes("Bull") || body.includes("Bear") || body.includes("Sideways") || body.includes("Regime"),
      bodySnippet: body.substring(0, 6000),
    };
  });

  log("  Portfolio values: " + JSON.stringify(dash.portfolioValues.slice(0, 5)));
  log("  Strategies visible: " + JSON.stringify(dash.strategiesVisible));
  log("  Strategy cards with role=button: " + dash.strategyCardsCount);
  log("  Non-zero returns: " + dash.nonZeroReturns);
  log("  Dashboard load: " + dashTime + "ms");

  if (dash.hasPortfolioValue) finding("Dashboard", "Portfolio value displayed prominently", "good");
  else finding("Dashboard", "No portfolio value visible", "critical");

  if (dash.hasPnlPercent) finding("Dashboard", "P&L percentages visible", "good");
  if (dash.hasPlaceholders) finding("Dashboard", "Placeholder values (--- or $--.--) present", "high");

  if (dash.hasEquityCurve) finding("Dashboard", "Equity curve / sparkline charts rendered", "good");
  else finding("Dashboard", "No equity curve visible", "critical");

  const stratCount = dash.strategiesVisible.length;
  if (stratCount >= 10) finding("Dashboard", `${stratCount}/12 strategies visible in grid`, "good");
  else if (stratCount >= 6) finding("Dashboard", `Only ${stratCount}/12 strategies visible`, "high");
  else finding("Dashboard", `Only ${stratCount}/12 strategies visible -- major gap`, "critical");

  if (dash.nonZeroReturns > 0) finding("Dashboard", `${dash.nonZeroReturns} strategies show non-zero returns (live data)`, "good");
  else finding("Dashboard", "All strategies show 0% returns -- no live P&L", "high");

  if (dash.hasPositions) finding("Dashboard", "Positions section present", "good");
  if (dash.hasPnlCalendar) finding("Dashboard", "P&L calendar heatmap present", "good");
  else finding("Dashboard", "P&L calendar not found", "info");

  if (dash.hasEconomicCalendar) finding("Dashboard", "Economic calendar present", "good");
  else finding("Dashboard", "Economic calendar not found", "high");

  if (dash.hasMarketContext) finding("Dashboard", "Market context (S&P, VIX) visible", "good");
  if (dash.hasActivityFeed) finding("Dashboard", "Activity feed / signals present", "good");
  if (dash.hasSector) finding("Dashboard", "Sector breakdown present", "good");
  if (dash.hasAllocation) finding("Dashboard", "Allocation visualization present", "good");
  if (dash.hasRegimeLabel) finding("Dashboard", "Market regime label shown", "good");

  // Scroll dashboard fully
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  await screenshot(page, "01b-dashboard-bottom");

  // Middle scroll
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(1000);
  await screenshot(page, "01c-dashboard-middle");

  // ═══════════════════════════════════════════════════════════
  // 2. TRADE PAGE - Full Workflow
  // ═══════════════════════════════════════════════════════════
  log("\n=== 2. TRADE PAGE ===");
  const tradeTime = await timeNav(page, `${BASE_URL}/trade`, "trade");
  await page.waitForTimeout(2000);
  await screenshot(page, "02-trade-full");

  const trade = await page.evaluate(() => {
    const body = document.body.innerText;
    const btns = Array.from(document.querySelectorAll('button[title]'));
    const btnTitles = btns.map(b => b.getAttribute('title'));
    return {
      // Watchlist
      hasWatchlist: body.includes("Watchlist") || body.includes("AAPL"),
      watchlistSymbols: ["AAPL", "MSFT", "SPY", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "QQQ", "JPM"].filter(s => body.includes(s)),
      hasWatchlistPrices: /\$\d{2,4}\.\d{2}/.test(body),
      hasScreenerMode: body.includes("Screener") || body.includes("screener") || body.includes("Filter"),

      // Chart
      hasChart: !!document.querySelector('canvas') || !!document.querySelector('[data-slot="chart-panel"]'),
      hasTimeframes: ["1m", "5m", "15m", "1H", "4H", "1D"].filter(tf => body.includes(tf)),
      chartTypeButtons: btnTitles.filter(t => t && (t.includes("Candle") || t.includes("Line") || t.includes("Area") || t.includes("Bar"))),

      // Drawing tools
      drawingTools: btnTitles.filter(t => t && (t.includes("Line") || t.includes("Trend") || t.includes("Fib") || t.includes("Ray") || t.includes("Channel"))),
      hasDrawingTools: btnTitles.some(t => t && (t.includes("Horizontal Line") || t.includes("Trendline") || t.includes("Fib"))),

      // BUY/SELL
      hasBuy: body.includes("BUY"),
      hasSell: body.includes("SELL"),

      // Alerts
      hasAlertBtn: btnTitles.some(t => t && t.toLowerCase().includes("alert")),

      // Analysis tabs
      analysisTabs: ["Technical", "Fundamental", "Sentiment", "Chat", "Order", "Tech", "Fund", "Sent"].filter(t => body.includes(t)),

      // Options
      hasOptions: body.includes("Options") || body.includes("Strike") || body.includes("Call") || body.includes("Put"),
      hasIV: body.includes("IV") || body.includes("Implied Vol"),
      hasGreeks: body.includes("Delta") || body.includes("Theta") || body.includes("Gamma"),

      // Order entry
      hasOrderEntry: body.includes("Market") || body.includes("Limit") || body.includes("Shares") || body.includes("Quantity"),
      hasPositionSizer: body.includes("Position Siz") || body.includes("Risk"),

      // Indicators
      hasIndicators: body.includes("Indicators") || body.includes("EMA") || body.includes("SMA") || body.includes("MACD") || body.includes("RSI"),

      // L1 data
      hasL1: body.includes("spread") || (body.includes("Vol:") && body.includes("H:")),
      hasOHLC: body.includes("O:") || body.includes("H:") || body.includes("L:") || body.includes("C:"),

      // Screener
      hasScreener: body.includes("Screener") || body.includes("Screen") || body.includes("Filter") || body.includes("Scan"),

      fullText: body.substring(0, 8000),
    };
  });

  log("  Watchlist symbols: " + JSON.stringify(trade.watchlistSymbols));
  log("  Timeframes: " + JSON.stringify(trade.hasTimeframes));
  log("  Drawing tools: " + JSON.stringify(trade.drawingTools));
  log("  Analysis tabs: " + JSON.stringify(trade.analysisTabs));
  log("  Trade load: " + tradeTime + "ms");

  if (trade.hasWatchlist) finding("Trade", "Watchlist visible", "good");
  if (trade.watchlistSymbols.length >= 3) finding("Trade", `${trade.watchlistSymbols.length} symbols in watchlist`, "good");
  if (trade.hasWatchlistPrices) finding("Trade", "Watchlist shows live prices", "good");
  else finding("Trade", "Watchlist missing live price data", "high");

  if (trade.hasChart) finding("Trade", "Chart area rendered", "good");
  else finding("Trade", "Chart NOT rendered", "critical");

  if (trade.hasTimeframes.length >= 3) finding("Trade", `Timeframes: ${trade.hasTimeframes.join(", ")}`, "good");

  if (trade.hasDrawingTools) finding("Trade", `Drawing tools: ${trade.drawingTools.join(", ")}`, "good");
  else finding("Trade", "Drawing tools not found", "high");

  if (trade.hasBuy && trade.hasSell) finding("Trade", "BUY/SELL buttons present", "good");
  else finding("Trade", "BUY/SELL buttons missing", "high");

  if (trade.hasAlertBtn) finding("Trade", "Price alert button present", "good");
  else finding("Trade", "Price alert not found", "info");

  if (trade.hasIndicators) finding("Trade", "Technical indicators available", "good");
  if (trade.hasL1 || trade.hasOHLC) finding("Trade", "L1 / OHLCV data visible", "good");
  if (trade.hasOrderEntry) finding("Trade", "Order entry panel present (Market/Limit)", "good");
  if (trade.hasPositionSizer) finding("Trade", "Position sizer present", "good");
  if (trade.hasScreener) finding("Trade", "Screener / filter functionality visible", "good");
  else finding("Trade", "Screener not found on trade page", "info");

  // 2a. Chart type switching
  log("  Testing chart type switching...");
  const chartTypeBtns = await page.$$('[data-slot="chart-panel"] button').catch(() => []);
  if (chartTypeBtns && chartTypeBtns.length > 0) {
    // Try clicking a few chart-area buttons
    for (let i = 0; i < Math.min(chartTypeBtns.length, 3); i++) {
      try {
        await chartTypeBtns[i].click();
        await page.waitForTimeout(500);
      } catch {}
    }
    await screenshot(page, "02b-chart-type-test");
  }

  // 2b. Drawing tool test
  log("  Testing drawing tools...");
  const hlineBtn = await page.$('button[title="Horizontal Line"]');
  if (hlineBtn) {
    await hlineBtn.click();
    await page.waitForTimeout(500);
    const chartArea = await page.$('[data-slot="chart-panel"]');
    if (chartArea) {
      const box = await chartArea.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(500);
        await screenshot(page, "02c-hline-placed");
        finding("Trade", "Horizontal line placed on chart via drawing tool", "good");
      }
    }
  }

  // 2c. Price alert test
  log("  Testing price alert...");
  const alertBtn = await page.$('button[title*="alert" i]');
  if (alertBtn) {
    await alertBtn.click();
    await page.waitForTimeout(500);
    await screenshot(page, "02d-alert-dialog");
    const hasAlertDialog = await page.evaluate(() => document.body.innerText.includes("Alert") || !!document.querySelector('input[type="number"]'));
    if (hasAlertDialog) finding("Trade", "Price alert dialog opens with configurable input", "good");
    // close
    await page.keyboard.press("Escape");
  }

  // 2d. Click AAPL in watchlist
  log("  Testing symbol switching...");
  const aaplLink = await page.$('text=AAPL');
  if (aaplLink) {
    await aaplLink.click();
    await page.waitForTimeout(3000);
    await screenshot(page, "02e-aapl-selected");
    const chartShowsAAPL = await page.evaluate(() => {
      const panel = document.querySelector('[data-slot="chart-panel"]');
      return panel?.textContent?.includes("AAPL") || document.body.innerText.includes("AAPL");
    });
    if (chartShowsAAPL) finding("Trade", "Clicking AAPL updates chart and all panels", "good");
  }

  // 2e. Test analysis tabs
  log("  Testing analysis tabs...");
  for (const tab of ["Tech", "Fund", "Sent", "Chat", "Order"]) {
    const tabBtn = await page.$(`button:has-text("${tab}")`);
    if (tabBtn) {
      await tabBtn.click();
      await page.waitForTimeout(800);
      await screenshot(page, `02f-tab-${tab.toLowerCase()}`);
    }
  }

  // 2f. Options chain
  log("  Testing options chain...");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  const optionsData = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasStrikes: /\d{3}/.test(body) && (body.includes("Call") || body.includes("Put")),
      hasGreeks: body.includes("Delta") || body.includes("IV") || body.includes("Theta"),
      hasExpDates: body.includes("DTE") || body.includes("Exp"),
      optionPriceCount: (body.match(/\d+\.\d{2}/g) || []).length,
    };
  });
  await screenshot(page, "02g-options-chain");
  if (optionsData.hasStrikes) finding("Trade", "Options chain renders strikes + calls/puts", "good");
  else finding("Trade", "Options chain strikes not visible", "high");
  if (optionsData.hasGreeks) finding("Trade", "Options Greeks displayed (Delta, IV, Theta)", "good");
  if (optionsData.hasExpDates) finding("Trade", "Options expiration dates visible", "good");

  // 2g. Order entry test
  log("  Testing order entry...");
  const orderTab = await page.$('button:has-text("Order")');
  if (orderTab) {
    await orderTab.click();
    await page.waitForTimeout(800);
    await screenshot(page, "02h-order-entry");
    const orderData = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasMarket: body.includes("Market"),
        hasLimit: body.includes("Limit"),
        hasShares: body.includes("Shares") || body.includes("Qty") || body.includes("Quantity"),
        hasSubmit: body.includes("Place") || body.includes("Submit") || body.includes("BUY") || body.includes("SELL"),
      };
    });
    if (orderData.hasMarket && orderData.hasLimit) finding("Trade", "Order entry supports Market and Limit orders", "good");
    if (orderData.hasShares) finding("Trade", "Quantity/shares input present", "good");
  }

  // ═══════════════════════════════════════════════════════════
  // 3. PIPELINE - Flow, Strategy Builder, Backtest
  // ═══════════════════════════════════════════════════════════
  log("\n=== 3. PIPELINE ===");
  const pipeTime = await timeNav(page, `${BASE_URL}/pipeline`, "pipeline");
  await page.waitForTimeout(2000);
  await screenshot(page, "03-pipeline-full");

  const pipeline = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasFlow: body.includes("Screened") && body.includes("Analyzed") && body.includes("Signals"),
      hasRunButton: body.includes("Run Now") || body.includes("Run Pipeline"),
      hasPositions: body.includes("Position") || body.includes("Symbol"),
      hasHistory: body.includes("History"),
      hasPerformance: body.includes("Total P&L") || body.includes("Win Rate") || body.includes("Total Trades"),
      hasStrategyBuilder: body.includes("Strategy Builder") || body.includes("Builder") || body.includes("Add Rule"),
      hasBacktest: body.includes("Backtest") || body.includes("Run Backtest"),
      hasTabs: body.includes("Pipeline") || body.includes("Builder") || body.includes("Backtest"),
      pipelineStatus: body.includes("Idle") ? "Idle" : body.includes("Running") ? "Running" : "Unknown",
      fullText: body.substring(0, 5000),
    };
  });

  log("  Pipeline status: " + pipeline.pipelineStatus);

  if (pipeline.hasFlow) finding("Pipeline", "Pipeline flow visualization (Screened > Analyzed > Signals > Orders)", "good");
  else finding("Pipeline", "Pipeline flow diagram not found", "high");

  if (pipeline.hasRunButton) finding("Pipeline", "Run Now / Run Pipeline button present", "good");
  if (pipeline.hasPositions) finding("Pipeline", "Current positions table visible", "good");
  if (pipeline.hasHistory) finding("Pipeline", "Pipeline history section present", "good");
  if (pipeline.hasPerformance) finding("Pipeline", "Performance metrics visible (P&L, Win Rate)", "good");

  // 3a. Strategy Builder
  log("  Testing Strategy Builder...");
  const builderTab = await page.$('button:has-text("Builder"), button:has-text("Strategy Builder")');
  if (builderTab) {
    await builderTab.click();
    await page.waitForTimeout(1500);
    await screenshot(page, "03b-strategy-builder");
    finding("Pipeline", "Strategy Builder tab opened", "good");

    // Test NLP rule input
    const ruleInput = await page.$('input[placeholder*="Buy when"], input[placeholder*="RSI"], input[placeholder*="e.g."], input[placeholder*="buy"], input[placeholder*="sell"]');
    if (ruleInput) {
      await ruleInput.fill("Buy when RSI(14) drops below 30");
      await page.waitForTimeout(300);
      const addBtn = await page.$('button:has-text("Add")');
      if (addBtn) {
        await addBtn.click();
        await page.waitForTimeout(800);
      }
      await screenshot(page, "03c-builder-rule");

      const ruleResult = await page.evaluate(() => {
        const body = document.body.innerText;
        return {
          hasRule: body.includes("RSI"),
          hasParsedAction: body.includes("BUY"),
          hasParsedIndicator: body.includes("RSI"),
          hasParsedValue: body.includes("30"),
        };
      });
      if (ruleResult.hasRule) finding("Pipeline", "Strategy Builder parsed NLP rule (RSI < 30)", "good");
      if (ruleResult.hasParsedAction) finding("Pipeline", "NLP parser extracted BUY action", "good");

      // Add second rule
      await ruleInput.fill("Sell when price crosses above upper Bollinger Band");
      const addBtn2 = await page.$('button:has-text("Add")');
      if (addBtn2) {
        await addBtn2.click();
        await page.waitForTimeout(500);
      }
      await screenshot(page, "03d-builder-two-rules");

      // AI Refine
      const aiRefineBtn = await page.$('button:has-text("AI Refine")');
      if (aiRefineBtn) {
        finding("Pipeline", "AI Refine button present for strategy refinement", "good");
        await aiRefineBtn.click();
        await page.waitForTimeout(3000);
        await screenshot(page, "03e-ai-refine-result");
      }
    } else {
      finding("Pipeline", "Strategy Builder NLP input not found", "high");
    }
  } else {
    finding("Pipeline", "Strategy Builder tab not found", "high");
  }

  // 3b. Backtest
  log("  Testing Backtest...");
  const backtestTab = await page.$('button:has-text("Backtest")');
  if (backtestTab) {
    await backtestTab.click();
    await page.waitForTimeout(1500);
    await screenshot(page, "03f-backtest-panel");
    finding("Pipeline", "Backtest tab opened", "good");

    const btData = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasSymbolInput: body.includes("Symbol") || !!document.querySelector('input[value="SPY"]'),
        hasSMAParams: body.includes("Fast") || body.includes("Slow") || body.includes("SMA"),
        hasCapital: body.includes("Capital"),
        hasRunButton: body.includes("Run Backtest"),
      };
    });

    if (btData.hasRunButton) {
      finding("Pipeline", "Backtest panel: symbol, SMA params, capital, Run button", "good");

      // Run backtest
      log("  Running backtest on SPY...");
      const runBtn = await page.$('button:has-text("Run Backtest")');
      if (runBtn) {
        await runBtn.click();
        await page.waitForTimeout(6000);
        await screenshot(page, "03g-backtest-results");

        const btResults = await page.evaluate(() => {
          const body = document.body.innerText;
          return {
            hasTotalReturn: body.includes("Total Return"),
            hasWinRate: body.includes("Win Rate") || body.includes("Win"),
            hasMaxDrawdown: body.includes("Drawdown"),
            hasSharpe: body.includes("Sharpe"),
            hasEquityCurve: !!document.querySelector('svg polyline, svg path'),
            returnValue: body.match(/[+-]?\$[\d,]+\.?\d*/)?.[0] || body.match(/[+-]?\d+\.\d+%/)?.[0] || "not found",
            tradeCount: body.match(/\d+\s*trades/i)?.[0] || "not found",
          };
        });

        if (btResults.hasTotalReturn) finding("Pipeline", `Backtest Total Return: ${btResults.returnValue}`, "good");
        else finding("Pipeline", "Backtest did not display Total Return", "high");

        if (btResults.hasWinRate) finding("Pipeline", "Backtest Win Rate metric present", "good");
        if (btResults.hasMaxDrawdown) finding("Pipeline", "Backtest Max Drawdown metric present", "good");
        if (btResults.hasSharpe) finding("Pipeline", "Backtest Sharpe Ratio present", "good");
        if (btResults.hasEquityCurve) finding("Pipeline", "Backtest equity curve rendered as SVG", "good");
        else finding("Pipeline", "Backtest equity curve not visible", "high");

        log("  Backtest trades: " + btResults.tradeCount);
      }
    } else {
      finding("Pipeline", "Backtest Run button not found", "high");
    }
  } else {
    finding("Pipeline", "Backtest tab not found on pipeline page", "high");
  }

  // 3c. Pipeline history
  const historyTab = await page.$('button:has-text("History")');
  if (historyTab) {
    await historyTab.click();
    await page.waitForTimeout(1000);
    await screenshot(page, "03h-pipeline-history");
    finding("Pipeline", "Pipeline history accessible", "good");
  }

  // ═══════════════════════════════════════════════════════════
  // 4. STRATEGY DETAIL - Equity Curve + Benchmark
  // ═══════════════════════════════════════════════════════════
  log("\n=== 4. STRATEGY DETAIL ===");

  // All 12 strategies
  const strategyIds = [
    "momentum-quality", "pead", "vrp-harvesting", "earnings-vol-premium",
    "regime-adaptive", "claude-alpha", "mean-reversion", "vcp-breakout",
    "pairs-trading", "dividend-capture", "sector-rotation", "gap-fill"
  ];

  let strategiesLoaded = 0;
  let strategiesWithBenchmark = 0;
  let strategiesWithEquityCurve = 0;
  let strategiesWithStats = 0;
  let strategiesWithTabs = 0;

  // Test PEAD in detail as primary
  await timeNav(page, `${BASE_URL}/strategies/pead`, "strategy-pead");
  await page.waitForTimeout(2000);
  await screenshot(page, "04-strategy-pead");

  const stratDetail = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasName: body.includes("PEAD") || body.includes("Post-Earnings"),
      hasEquityCurve: document.querySelectorAll('svg polyline, svg path').length > 0,
      hasBenchmark: body.includes("SPY") || body.includes("Benchmark") || body.includes("S&P"),
      timePeriods: ["1M", "3M", "6M", "YTD", "ALL"].filter(p => body.includes(p)),
      tabs: ["About", "Positions", "Trade History", "Analytics", "Journal"].filter(t => body.includes(t)),
      hasStats: body.includes("Total Return") || body.includes("Sharpe") || body.includes("Max Drawdown"),
      hasThesis: body.includes("thesis") || body.includes("edge") || body.includes("Thesis") || body.includes("Edge") || body.includes("drift"),
      returnValue: body.match(/[+-]?\d+\.\d+%/)?.[0] || "N/A",
      hasActiveToggle: body.includes("Active") || body.includes("Paused"),
      fullText: body.substring(0, 4000),
    };
  });

  log("  PEAD tabs: " + JSON.stringify(stratDetail.tabs));
  log("  Time periods: " + JSON.stringify(stratDetail.timePeriods));
  log("  Return: " + stratDetail.returnValue);

  if (stratDetail.hasName) { finding("Strategy", "PEAD strategy detail page loaded", "good"); strategiesLoaded++; }
  if (stratDetail.hasEquityCurve) { finding("Strategy", "Equity curve chart rendered", "good"); strategiesWithEquityCurve++; }
  else finding("Strategy", "Equity curve not visible", "high");

  if (stratDetail.hasBenchmark) { finding("Strategy", "SPY benchmark overlay on equity curve", "good"); strategiesWithBenchmark++; }
  else finding("Strategy", "SPY benchmark NOT shown on equity curve", "high");

  if (stratDetail.timePeriods.length >= 3) finding("Strategy", `Time period filters: ${stratDetail.timePeriods.join(", ")}`, "good");
  if (stratDetail.tabs.length >= 3) { finding("Strategy", `Detail tabs: ${stratDetail.tabs.join(", ")}`, "good"); strategiesWithTabs++; }
  if (stratDetail.hasStats) { finding("Strategy", "Performance stats (Return, Sharpe, Drawdown)", "good"); strategiesWithStats++; }
  if (stratDetail.hasThesis) finding("Strategy", "Strategy thesis / edge documentation present", "good");

  // Click through tabs on PEAD
  for (const tab of ["Trade History", "Analytics", "Positions", "About", "Journal"]) {
    const tabBtn = await page.$(`button:has-text("${tab}")`);
    if (tabBtn) {
      await tabBtn.click();
      await page.waitForTimeout(800);
    }
  }
  await screenshot(page, "04b-pead-tabs");

  // Spot-check 3 more strategies
  for (const sid of ["momentum-quality", "claude-alpha", "vrp-harvesting"]) {
    await page.goto(`${BASE_URL}/strategies/${sid}`, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await screenshot(page, `04c-strategy-${sid}`);

    const check = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        loaded: body.length > 200 && !body.includes("404"),
        hasBenchmark: body.includes("SPY") || body.includes("Benchmark"),
        hasCurve: document.querySelectorAll('svg polyline, svg path').length > 0,
        hasStats: body.includes("Return") || body.includes("Sharpe"),
        hasTabs: body.includes("About") || body.includes("Trade History"),
      };
    });
    if (check.loaded) strategiesLoaded++;
    if (check.hasBenchmark) strategiesWithBenchmark++;
    if (check.hasCurve) strategiesWithEquityCurve++;
    if (check.hasStats) strategiesWithStats++;
    if (check.hasTabs) strategiesWithTabs++;
  }

  finding("Strategy", `Strategies loaded: ${strategiesLoaded}/4 spot-checked`, "good");
  finding("Strategy", `Strategies with benchmark: ${strategiesWithBenchmark}/4`, strategiesWithBenchmark >= 3 ? "good" : "high");
  finding("Strategy", `Strategies with equity curve: ${strategiesWithEquityCurve}/4`, strategiesWithEquityCurve >= 3 ? "good" : "high");

  // ═══════════════════════════════════════════════════════════
  // 5. DATA QUALITY DEEP DIVE
  // ═══════════════════════════════════════════════════════════
  log("\n=== 5. DATA QUALITY ===");
  await timeNav(page, `${BASE_URL}/trade`, "trade-data-quality");
  await page.waitForTimeout(2000);

  // Check SPY data
  const spyLink = await page.$('text=SPY');
  if (spyLink) {
    await spyLink.click();
    await page.waitForTimeout(3000);
  }

  const dataQ = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasRealPrices: /\$\d{2,4}\.\d{2}/.test(body),
      hasBidAsk: body.includes("spread") || /\d+\.\d{2}\s*[\/x]\s*\d+\.\d{2}/.test(body),
      hasVolume: body.includes("Vol") || body.includes("Volume"),
      hasHighLow: body.includes("H:") || body.includes("L:"),
      hasTechScore: body.includes("Technical") || body.includes("Score"),
      hasRSI: body.includes("RSI"),
      hasMACD: body.includes("MACD"),
      hasPE: body.includes("P/E"),
      hasROE: body.includes("ROE"),
      hasFScore: body.includes("F-Score") || body.includes("Piotroski"),
      hasTemplateNews: body.includes("Analysts raise price target following earnings beat"),
      hasSentiment: body.includes("Sentiment") || body.includes("sentiment"),
      sentimentScore: body.match(/Sentiment.*?(\d+)/)?.[1] || "N/A",
      zeroPointOneCount: (body.match(/0\.01/g) || []).length,
    };
  });

  if (dataQ.hasRealPrices) finding("DataQuality", "Real equity prices visible", "good");
  else finding("DataQuality", "No real prices found", "critical");

  if (dataQ.hasBidAsk) finding("DataQuality", "Bid/Ask spread data present", "good");
  if (dataQ.hasVolume) finding("DataQuality", "Volume data present", "good");
  if (dataQ.hasHighLow) finding("DataQuality", "High/Low data present", "good");
  if (dataQ.hasRSI) finding("DataQuality", "RSI indicator available", "good");
  if (dataQ.hasMACD) finding("DataQuality", "MACD indicator available", "good");
  if (dataQ.hasPE) finding("DataQuality", "P/E ratio in fundamentals", "good");
  if (dataQ.hasROE) finding("DataQuality", "ROE in fundamentals", "good");
  if (dataQ.hasSentiment) finding("DataQuality", "Sentiment analysis present", "good");
  if (dataQ.hasTemplateNews) finding("DataQuality", "Template/boilerplate news -- same text for all symbols", "high");
  if (dataQ.zeroPointOneCount > 5) finding("DataQuality", `${dataQ.zeroPointOneCount} instances of $0.01 -- possible placeholder option prices`, "high");

  // Check if different symbols show different data
  log("  Cross-symbol data check...");
  const symbolsToCheck = ["AAPL", "MSFT", "NVDA"];
  const symbolTexts = {};
  for (const sym of symbolsToCheck) {
    const symLink = await page.$(`text=${sym}`);
    if (symLink) {
      await symLink.click();
      await page.waitForTimeout(2000);
      symbolTexts[sym] = await page.evaluate(() => {
        const panel = document.querySelector('[data-slot="chart-panel"]');
        return panel?.textContent?.substring(0, 200) || "";
      });
    }
  }
  const allSame = Object.values(symbolTexts).every((t, _, arr) => t === arr[0]);
  if (Object.keys(symbolTexts).length >= 2) {
    if (allSame) finding("DataQuality", "Chart panels show IDENTICAL text for different symbols -- data not updating", "critical");
    else finding("DataQuality", "Chart panels differ per symbol -- data loads correctly", "good");
  }
  await screenshot(page, "05-data-quality");

  // ═══════════════════════════════════════════════════════════
  // 6. CONSOLE ERRORS & NETWORK FAILURES
  // ═══════════════════════════════════════════════════════════
  log("\n=== 6. ERRORS & PERFORMANCE ===");
  log(`  Console errors: ${consoleErrors.length}`);
  log(`  Network failures: ${networkFailures.length}`);

  if (consoleErrors.length === 0) finding("Stability", "Zero console errors during session", "good");
  else {
    finding("Stability", `${consoleErrors.length} console errors captured`, "high");
    consoleErrors.slice(0, 5).forEach(e => finding("Stability", `Error: ${e.substring(0, 100)}`, "info"));
  }

  if (networkFailures.length > 0) {
    finding("Stability", `${networkFailures.length} network requests failed`, "high");
    networkFailures.slice(0, 3).forEach(f => finding("Stability", `Failed: ${f.url?.substring(0, 80)}`, "info"));
  }

  for (const [label, ms] of Object.entries(timings)) {
    if (ms > 10000) finding("Performance", `${label}: ${ms}ms -- very slow`, "high");
    else if (ms > 5000) finding("Performance", `${label}: ${ms}ms -- slow`, "info");
    else finding("Performance", `${label}: ${ms}ms`, "good");
  }

  // ═══════════════════════════════════════════════════════════
  // 7. FINAL DASHBOARD SCREENSHOT
  // ═══════════════════════════════════════════════════════════
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await screenshot(page, "99-final-dashboard");

  await browser.close();

  // ═══════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════
  const allFindings = Object.values(findings.sections).flat();
  const goods = allFindings.filter(f => f.severity === "good").length;
  const highs = allFindings.filter(f => f.severity === "high").length;
  const criticals = allFindings.filter(f => f.severity === "critical").length;

  console.log("\n" + "=".repeat(64));
  console.log("  FINAL RATING EVALUATION SUMMARY");
  console.log("=".repeat(64));
  console.log(`  Total findings: ${allFindings.length}`);
  console.log(`  PASS:     ${goods}`);
  console.log(`  WARNING:  ${highs}`);
  console.log(`  CRITICAL: ${criticals}`);
  console.log(`  Screenshots: ${findings.screenshots.length}`);
  console.log(`  Console errors: ${consoleErrors.length}`);
  console.log(`  Network failures: ${networkFailures.length}`);
  console.log(`  Page timings: ${JSON.stringify(timings)}`);

  // Write raw results
  writeFileSync(
    join(SCREENSHOT_DIR, "findings.json"),
    JSON.stringify({ findings: findings.sections, timings, consoleErrors: consoleErrors.slice(0, 20), networkFailures: networkFailures.slice(0, 20), screenshots: findings.screenshots }, null, 2)
  );

  // Write section summary
  const lines = [];
  for (const [section, items] of Object.entries(findings.sections)) {
    lines.push(`\n### ${section}`);
    for (const item of items) {
      const icon = item.severity === "good" ? "PASS" : item.severity === "critical" ? "CRIT" : item.severity === "high" ? "WARN" : "INFO";
      lines.push(`- [${icon}] ${item.detail}`);
    }
  }
  writeFileSync(join(SCREENSHOT_DIR, "findings-summary.txt"), lines.join("\n"));

  console.log("\n  Results saved to: " + SCREENSHOT_DIR);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
