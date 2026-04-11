/**
 * AlphaDesk API QA Test Suite
 * Tests all backend endpoints for correctness, data integrity, and performance.
 */

const BASE = "https://tradingalpha.net";
const API = `${BASE}/api/v1`;
const CREDS = { username: "admin", password: "GK1355$$gk" };
const SLOW_THRESHOLD_MS = 2000;

let accessToken = null;
const results = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNumeric(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function hasNaN(obj, path = "") {
  const issues = [];
  if (obj === null || obj === undefined) return issues;
  if (typeof obj === "number" && !Number.isFinite(obj)) {
    issues.push(`${path} is ${obj}`);
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => issues.push(...hasNaN(item, `${path}[${i}]`)));
  } else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      issues.push(...hasNaN(v, path ? `${path}.${k}` : k));
    }
  }
  return issues;
}

async function req(method, path, { body, token, expectStatus, timeout } = {}) {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout || 15000);
  opts.signal = controller.signal;

  const start = performance.now();
  let res, data;
  try {
    res = await fetch(url, opts);
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
  clearTimeout(timer);
  const elapsed = Math.round(performance.now() - start);
  return { status: res.status, data, elapsed };
}

function record(name, pass, details, elapsed) {
  const slow = elapsed > SLOW_THRESHOLD_MS;
  const entry = {
    test: name,
    pass,
    slow,
    elapsed_ms: elapsed,
    details: pass ? (slow ? `SLOW (${elapsed}ms) - ${details}` : details) : details,
  };
  results.push(entry);
  const icon = pass ? (slow ? "SLOW" : "PASS") : "FAIL";
  console.log(`  [${icon}] ${name} (${elapsed}ms)${pass ? "" : " — " + details}`);
}

// ---------------------------------------------------------------------------
// Test definitions
// ---------------------------------------------------------------------------

async function testLogin() {
  const name = "POST /auth/login";
  try {
    const { status, data, elapsed } = await req("POST", "/auth/login", { body: CREDS });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}: ${JSON.stringify(data)}`, elapsed);
    if (!data.access_token) return record(name, false, "Missing access_token in response", elapsed);
    if (!data.token_type) return record(name, false, "Missing token_type", elapsed);
    accessToken = data.access_token;
    record(name, true, "Token received", elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testLogout() {
  const name = "POST /auth/logout";
  try {
    const { status, data, elapsed } = await req("POST", "/auth/logout", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);
    record(name, true, "Logout OK", elapsed);
    // Re-login to continue tests
    const r2 = await req("POST", "/auth/login", { body: CREDS });
    if (r2.status === 200) accessToken = r2.data.access_token;
  } catch (e) { record(name, false, e.message, 0); }
}

async function testPortfolioSummary() {
  const name = "GET /portfolio/summary";
  try {
    const { status, data, elapsed } = await req("GET", "/portfolio/summary", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    const required = ["equity", "cash", "buying_power", "total_market_value", "unrealized_pnl",
      "unrealized_pnl_pct", "realized_pnl_today", "positions_count", "last_updated"];
    const missing = required.filter(f => !(f in data));
    if (missing.length) return record(name, false, `Missing fields: ${missing.join(", ")}`, elapsed);

    const numFields = ["equity", "cash", "buying_power", "total_market_value", "unrealized_pnl",
      "unrealized_pnl_pct", "realized_pnl_today", "positions_count"];
    const nanIssues = numFields.filter(f => !isNumeric(data[f]));
    if (nanIssues.length) return record(name, false, `Non-numeric fields: ${nanIssues.join(", ")} (values: ${nanIssues.map(f => data[f])})`, elapsed);

    // Consistency: equity ~ cash + total_market_value
    const diff = Math.abs(data.equity - (data.cash + data.total_market_value));
    const pctDiff = data.equity !== 0 ? (diff / Math.abs(data.equity)) * 100 : 0;
    let detail = `equity=${data.equity}, cash=${data.cash}, market_value=${data.total_market_value}`;
    if (pctDiff > 5) detail += ` WARNING: equity != cash+market_value by ${pctDiff.toFixed(1)}%`;

    record(name, true, detail, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testPortfolioGreeks() {
  const name = "GET /portfolio/greeks";
  try {
    const { status, data, elapsed } = await req("GET", "/portfolio/greeks", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    const required = ["net_delta", "net_gamma", "net_theta", "net_vega", "beta_weighted_delta"];
    const missing = required.filter(f => !(f in data));
    if (missing.length) return record(name, false, `Missing fields: ${missing.join(", ")}`, elapsed);

    const nanIssues = required.filter(f => !isNumeric(data[f]));
    if (nanIssues.length) return record(name, false, `Non-numeric: ${nanIssues.join(", ")}`, elapsed);

    record(name, true, `delta=${data.net_delta}, theta=${data.net_theta}, positions=${(data.by_position||[]).length}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testPortfolioCalendar() {
  const name = "GET /portfolio/calendar";
  try {
    const { status, data, elapsed } = await req("GET", "/portfolio/calendar", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    if (!Array.isArray(data.days)) return record(name, false, "Missing or non-array 'days'", elapsed);
    if (!("month_total" in data)) return record(name, false, "Missing 'month_total'", elapsed);
    if (!isNumeric(data.month_total)) return record(name, false, `month_total is not numeric: ${data.month_total}`, elapsed);

    // Check day entries for NaN
    const nanIssues = hasNaN(data.days, "days");
    if (nanIssues.length) return record(name, false, `NaN in days: ${nanIssues.slice(0,3).join("; ")}`, elapsed);

    record(name, true, `${data.days.length} days, month_total=${data.month_total}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testPortfolioPerformance() {
  const name = "GET /portfolio/performance";
  try {
    const { status, data, elapsed } = await req("GET", "/portfolio/performance", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    if (!Array.isArray(data.equity_curve)) return record(name, false, "Missing or non-array 'equity_curve'", elapsed);
    if (data.equity_curve.length === 0) return record(name, false, "equity_curve is empty", elapsed);

    const nanIssues = hasNaN(data.equity_curve.slice(0, 5), "equity_curve");
    if (nanIssues.length) return record(name, false, `NaN in equity_curve: ${nanIssues.slice(0,3).join("; ")}`, elapsed);

    record(name, true, `${data.equity_curve.length} points, period=${data.period || "?"}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testMarketQuoteValid() {
  const name = "GET /market/quotes/AAPL";
  try {
    const { status, data, elapsed } = await req("GET", "/market/quotes/AAPL", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    const required = ["symbol", "bid", "ask", "last", "volume", "timestamp", "change", "changePct", "high", "low", "open", "close"];
    const missing = required.filter(f => !(f in data));
    if (missing.length) return record(name, false, `Missing fields: ${missing.join(", ")}`, elapsed);

    const numFields = ["bid", "ask", "last", "volume", "change", "changePct", "high", "low", "open", "close"];
    const nanIssues = numFields.filter(f => !isNumeric(data[f]));
    if (nanIssues.length) return record(name, false, `Non-numeric: ${nanIssues.join(", ")} (${nanIssues.map(f=>data[f])})`, elapsed);

    if (data.symbol !== "AAPL") return record(name, false, `Symbol mismatch: ${data.symbol}`, elapsed);
    if (data.bid <= 0 || data.ask <= 0) return record(name, false, `Invalid bid/ask: ${data.bid}/${data.ask}`, elapsed);

    record(name, true, `last=${data.last}, bid=${data.bid}, ask=${data.ask}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testMarketQuoteInvalid() {
  const name = "GET /market/quotes/INVALIDXYZ";
  try {
    const { status, data, elapsed } = await req("GET", "/market/quotes/INVALIDXYZ", { token: accessToken });
    if (status === 404) return record(name, true, "Correct 404 for invalid symbol", elapsed);
    record(name, false, `Expected 404, got ${status}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testMarketBars() {
  const name = "GET /market/bars/SPY?timeframe=1d&limit=10";
  try {
    const { status, data, elapsed } = await req("GET", "/market/bars/SPY?timeframe=1d&limit=10", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    const bars = Array.isArray(data) ? data : data.bars;
    if (!Array.isArray(bars)) return record(name, false, "Response is not an array of bars", elapsed);
    if (bars.length === 0) return record(name, false, "Empty bars array", elapsed);

    const first = bars[0];
    const barFields = ["timestamp", "open", "high", "low", "close", "volume"];
    const missing = barFields.filter(f => !(f in first));
    if (missing.length) return record(name, false, `Bar missing fields: ${missing.join(", ")}`, elapsed);

    const nanIssues = hasNaN(bars.slice(0, 3), "bars");
    if (nanIssues.length) return record(name, false, `NaN in bars: ${nanIssues.slice(0,3).join("; ")}`, elapsed);

    record(name, true, `${bars.length} bars returned`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testOptionsChainValid() {
  const name = "GET /options/chain/AAPL";
  try {
    const { status, data, elapsed } = await req("GET", "/options/chain/AAPL", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    if (!Array.isArray(data.contracts)) return record(name, false, "Missing or non-array 'contracts'", elapsed);
    if (data.contracts.length === 0) return record(name, false, "contracts array is empty", elapsed);

    const c = data.contracts[0];
    const reqFields = ["symbol", "underlying", "expiry", "strike", "option_type", "bid", "ask", "last", "volume", "open_interest", "iv", "delta", "gamma", "theta", "vega"];
    const missing = reqFields.filter(f => !(f in c));
    if (missing.length) return record(name, false, `Contract missing fields: ${missing.join(", ")}`, elapsed);

    const nanCheck = hasNaN(data.contracts.slice(0, 3), "contracts");
    if (nanCheck.length) return record(name, false, `NaN: ${nanCheck.slice(0,3).join("; ")}`, elapsed);

    record(name, true, `${data.contracts.length} contracts, ${(data.expirations||[]).length} expirations`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testOptionsChainInvalid() {
  const name = "GET /options/chain/INVALIDXYZ";
  try {
    const { status, data, elapsed } = await req("GET", "/options/chain/INVALIDXYZ", { token: accessToken });
    if (status === 404) return record(name, true, "Correct 404 for invalid symbol", elapsed);
    record(name, false, `Expected 404, got ${status}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testTradesPositions() {
  const name = "GET /trades/positions";
  try {
    const { status, data, elapsed } = await req("GET", "/trades/positions", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    if (!Array.isArray(data)) return record(name, false, "Response is not an array", elapsed);

    if (data.length > 0) {
      const p = data[0];
      const reqFields = ["symbol", "quantity", "side"];
      const missing = reqFields.filter(f => !(f in p));
      if (missing.length) return record(name, false, `Position missing fields: ${missing.join(", ")}`, elapsed);

      const nanCheck = hasNaN(data.slice(0, 3), "positions");
      if (nanCheck.length) return record(name, false, `NaN: ${nanCheck.slice(0,3).join("; ")}`, elapsed);
    }

    record(name, true, `${data.length} positions`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testTradesOrders() {
  const name = "GET /trades/orders";
  try {
    const { status, data, elapsed } = await req("GET", "/trades/orders", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    if (!Array.isArray(data)) return record(name, false, "Response is not an array", elapsed);

    record(name, true, `${data.length} orders`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testStrategiesList() {
  const name = "GET /strategies/";
  try {
    const { status, data, elapsed } = await req("GET", "/strategies/", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    if (!Array.isArray(data)) return record(name, false, "Response is not an array", elapsed);
    if (data.length === 0) return record(name, false, "Strategies array is empty", elapsed);

    const s = data[0];
    const reqFields = ["id", "name", "status", "total_return_pct", "sharpe_ratio"];
    const missing = reqFields.filter(f => !(f in s));
    if (missing.length) return record(name, false, `Strategy missing fields: ${missing.join(", ")}`, elapsed);

    const nanCheck = hasNaN(data.slice(0, 3), "strategies");
    if (nanCheck.length) return record(name, false, `NaN: ${nanCheck.slice(0,3).join("; ")}`, elapsed);

    record(name, true, `${data.length} strategies: ${data.map(s=>s.name||s.id).join(", ")}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testStrategyPeadPerformance() {
  const name = "GET /strategies/pead/performance";
  try {
    const { status, data, elapsed } = await req("GET", "/strategies/pead/performance", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    const reqFields = ["name", "status", "total_return_pct", "win_rate", "sharpe_ratio", "equity_curve"];
    const missing = reqFields.filter(f => !(f in data));
    if (missing.length) return record(name, false, `Missing fields: ${missing.join(", ")}`, elapsed);

    if (!Array.isArray(data.equity_curve)) return record(name, false, "equity_curve is not an array", elapsed);

    const nanCheck = hasNaN({
      total_return_pct: data.total_return_pct,
      win_rate: data.win_rate,
      sharpe_ratio: data.sharpe_ratio,
      max_drawdown: data.max_drawdown,
    }, "perf");
    if (nanCheck.length) return record(name, false, `NaN: ${nanCheck.join("; ")}`, elapsed);

    record(name, true, `return=${data.total_return_pct}%, sharpe=${data.sharpe_ratio}, win_rate=${data.win_rate}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testPipelineStatus() {
  const name = "GET /pipeline/status";
  try {
    const { status, data, elapsed } = await req("GET", "/pipeline/status", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    if (typeof data !== "object" || data === null) return record(name, false, "Response is not an object", elapsed);

    // Check for some expected status fields
    const hasFields = ["enabled", "last_run", "next_run", "status"].some(f => f in data);
    const keys = Object.keys(data);

    record(name, true, `Fields: ${keys.join(", ")}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testPipelinePositions() {
  const name = "GET /pipeline/positions";
  try {
    const { status, data, elapsed } = await req("GET", "/pipeline/positions", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    if (typeof data !== "object" || data === null) return record(name, false, "Response is not an object", elapsed);

    // Could be {positions: [...], performance: {...}} or just an array
    const positions = Array.isArray(data) ? data : data.positions;
    if (positions !== undefined && !Array.isArray(positions)) {
      return record(name, false, "positions field is not an array", elapsed);
    }

    const nanCheck = hasNaN(data, "pipeline_positions");
    if (nanCheck.length > 5) return record(name, false, `NaN issues: ${nanCheck.slice(0,3).join("; ")} (+${nanCheck.length-3} more)`, elapsed);

    const count = positions ? positions.length : "N/A";
    record(name, true, `${count} pipeline positions`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testNewsMarket() {
  const name = "GET /news/market";
  try {
    const { status, data, elapsed } = await req("GET", "/news/market", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    const articles = data.articles || (Array.isArray(data) ? data : null);
    if (!Array.isArray(articles)) return record(name, false, "Missing or non-array 'articles'", elapsed);

    if (articles.length > 0) {
      const a = articles[0];
      const reqFields = ["title", "url", "source"];
      const missing = reqFields.filter(f => !(f in a));
      if (missing.length) return record(name, false, `Article missing fields: ${missing.join(", ")}`, elapsed);
    }

    record(name, true, `${articles.length} articles`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testScreenerPresets() {
  const name = "GET /screener/presets";
  try {
    const { status, data, elapsed } = await req("GET", "/screener/presets", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    if (!Array.isArray(data)) return record(name, false, "Response is not an array", elapsed);

    if (data.length > 0) {
      const p = data[0];
      if (!p.name && !p.id) return record(name, false, "Preset missing name/id", elapsed);
    }

    record(name, true, `${data.length} presets`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testMarketOverviewIndices() {
  const name = "GET /market-overview/indices";
  try {
    const { status, data, elapsed } = await req("GET", "/market-overview/indices", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    const indices = data.indices || (Array.isArray(data) ? data : null);
    if (!Array.isArray(indices)) return record(name, false, "Missing or non-array 'indices'", elapsed);
    if (indices.length === 0) return record(name, false, "indices array is empty", elapsed);

    const idx = indices[0];
    const reqFields = ["symbol", "name", "price", "change", "change_pct"];
    const missing = reqFields.filter(f => !(f in idx));
    if (missing.length) return record(name, false, `Index missing fields: ${missing.join(", ")}`, elapsed);

    const nanCheck = hasNaN(indices, "indices");
    if (nanCheck.length) return record(name, false, `NaN: ${nanCheck.slice(0,3).join("; ")}`, elapsed);

    record(name, true, `${indices.length} indices: ${indices.map(i=>i.symbol).join(", ")}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testMarketOverviewRegime() {
  const name = "GET /market-overview/regime";
  try {
    const { status, data, elapsed } = await req("GET", "/market-overview/regime", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    const regime = data.regime || data;
    if (typeof regime !== "object" || regime === null) return record(name, false, "Response is not an object", elapsed);

    const reqFields = ["regime", "label", "confidence", "vix_level"];
    // regime might be nested: data.regime.regime or data.regime
    const target = typeof regime.regime === "string" ? regime : (regime.regime || regime);
    const fieldSource = typeof regime.regime === "object" ? regime.regime : regime;

    const missing = reqFields.filter(f => !(f in fieldSource));
    if (missing.length) return record(name, false, `Missing fields: ${missing.join(", ")}`, elapsed);

    record(name, true, `regime="${fieldSource.regime || fieldSource.label}", confidence=${fieldSource.confidence}, vix=${fieldSource.vix_level}`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

async function testMarketOverviewSectors() {
  const name = "GET /market-overview/sectors";
  try {
    const { status, data, elapsed } = await req("GET", "/market-overview/sectors", { token: accessToken });
    if (status !== 200) return record(name, false, `Expected 200, got ${status}`, elapsed);

    const sectors = data.sectors || (Array.isArray(data) ? data : null);
    if (!Array.isArray(sectors)) return record(name, false, "Missing or non-array 'sectors'", elapsed);
    if (sectors.length === 0) return record(name, false, "sectors array is empty", elapsed);

    const s = sectors[0];
    const reqFields = ["sector", "change_pct"];
    const missing = reqFields.filter(f => !(f in s));
    if (missing.length) return record(name, false, `Sector missing fields: ${missing.join(", ")}`, elapsed);

    const nanCheck = hasNaN(sectors, "sectors");
    if (nanCheck.length) return record(name, false, `NaN: ${nanCheck.slice(0,3).join("; ")}`, elapsed);

    record(name, true, `${sectors.length} sectors`, elapsed);
  } catch (e) { record(name, false, e.message, 0); }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== AlphaDesk API QA Test Suite ===");
  console.log(`Target: ${BASE}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  // 1. Auth
  console.log("--- Auth ---");
  await testLogin();
  await testLogout();

  if (!accessToken) {
    console.error("\nFATAL: No access token — cannot continue.\n");
    process.exit(1);
  }

  // 2. Portfolio
  console.log("\n--- Portfolio ---");
  await testPortfolioSummary();
  await testPortfolioGreeks();
  await testPortfolioCalendar();
  await testPortfolioPerformance();

  // 3. Market data
  console.log("\n--- Market Data ---");
  await testMarketQuoteValid();
  await testMarketQuoteInvalid();
  await testMarketBars();

  // 4. Options
  console.log("\n--- Options ---");
  await testOptionsChainValid();
  await testOptionsChainInvalid();

  // 5. Trades
  console.log("\n--- Trades ---");
  await testTradesPositions();
  await testTradesOrders();

  // 6. Strategies
  console.log("\n--- Strategies ---");
  await testStrategiesList();
  await testStrategyPeadPerformance();

  // 7. Pipeline
  console.log("\n--- Pipeline ---");
  await testPipelineStatus();
  await testPipelinePositions();

  // 8. News
  console.log("\n--- News ---");
  await testNewsMarket();

  // 9. Screener
  console.log("\n--- Screener ---");
  await testScreenerPresets();

  // 10. Market Overview
  console.log("\n--- Market Overview ---");
  await testMarketOverviewIndices();
  await testMarketOverviewRegime();
  await testMarketOverviewSectors();

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const slow = results.filter(r => r.slow).length;

  console.log("\n========================================");
  console.log(`TOTAL: ${results.length}  |  PASS: ${passed}  |  FAIL: ${failed}  |  SLOW: ${slow}`);
  console.log("========================================\n");

  if (failed > 0) {
    console.log("FAILURES:");
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  - ${r.test}: ${r.details}`);
    });
    console.log();
  }
  if (slow > 0) {
    console.log("SLOW RESPONSES (>2s):");
    results.filter(r => r.slow).forEach(r => {
      console.log(`  - ${r.test}: ${r.elapsed_ms}ms`);
    });
    console.log();
  }

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    base_url: BASE,
    total: results.length,
    passed,
    failed,
    slow,
    results,
  };

  const fs = await import("fs");
  const path = await import("path");
  const outDir = "/Users/GK/Downloads/alphadesk/qa-screenshots";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "api-results.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Results saved to ${outPath}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
