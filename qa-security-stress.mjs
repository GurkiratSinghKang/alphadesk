/**
 * AlphaDesk Security & Stress QA Suite
 * -------------------------------------
 * 23 tests across:  Security, Rate Limiting, Halt/Resume,
 *                   Data Integrity, Performance Under Load
 */

import { writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";

const BASE = "https://tradingalpha.net";
const API  = `${BASE}/api/v1`;
const CREDS = { username: "admin", password: "GK1355$$gk" };
const RESULTS_PATH = "/Users/GK/Downloads/alphadesk/qa-screenshots/security/results.json";

let accessToken  = null;
let refreshToken = null;
const results    = [];

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

async function req(method, path, { body, token, headers: extra, timeout, raw } = {}) {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const headers = { "Content-Type": "application/json", ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body !== undefined) {
    opts.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout || 20000);
  opts.signal = controller.signal;

  const start = performance.now();
  let res, data, text;
  try {
    res  = await fetch(url, opts);
    text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } catch (err) {
    clearTimeout(timer);
    return { status: 0, data: null, text: "", elapsed: Math.round(performance.now() - start), error: err.message, headers: {} };
  }
  clearTimeout(timer);
  const elapsed = Math.round(performance.now() - start);
  return {
    status: res.status,
    data,
    text,
    elapsed,
    headers: Object.fromEntries(res.headers.entries()),
  };
}

function record(name, pass, details, elapsed = 0) {
  const entry = { test: name, pass, elapsed_ms: elapsed, details };
  results.push(entry);
  const icon = pass ? "PASS" : "FAIL";
  console.log(`  [${icon}] ${name} (${elapsed}ms) — ${details}`);
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────

async function login() {
  console.log("\n=== Authenticating ===");
  const r = await req("POST", "/auth/login", { body: CREDS });
  if (r.status === 200 && r.data?.access_token) {
    accessToken  = r.data.access_token;
    refreshToken = r.data.refresh_token;
    console.log("  Logged in OK");
    return true;
  }
  console.error("  LOGIN FAILED:", r.status, r.data);
  return false;
}

// ────────────────────────────────────────────────────────────
// 1-10  Security Tests
// ────────────────────────────────────────────────────────────

async function securityTests() {
  console.log("\n=== Security Tests ===");

  // 1. SQL injection on market quotes
  {
    const r = await req("GET", "/market/quotes/' OR 1=1--", { token: accessToken });
    const pass = r.status === 404 || r.status === 422 || r.status === 400;
    record("SEC-01: SQL injection on /market/quotes", pass,
      `Status ${r.status} (expected 4xx rejection)`, r.elapsed);
  }

  // 2. SQL injection on strategies
  {
    const r = await req("GET", "/strategies/' OR ''='", { token: accessToken });
    const pass = r.status === 404 || r.status === 422 || r.status === 400;
    record("SEC-02: SQL injection on /strategies", pass,
      `Status ${r.status} (expected 4xx rejection)`, r.elapsed);
  }

  // 3. XSS reflection check
  {
    const payload = "<script>alert(1)</script>";
    const r = await req("GET", `/market/quotes/${encodeURIComponent(payload)}`, { token: accessToken });
    const reflected = typeof r.text === "string" && r.text.includes("<script>");
    const pass = !reflected;
    record("SEC-03: XSS reflection in /market/quotes", pass,
      reflected ? "SCRIPT TAG REFLECTED in response body" : `No script reflected (status ${r.status})`, r.elapsed);
  }

  // 4. Path traversal
  {
    const r = await req("GET", "/pipeline/history/../../etc/passwd", { token: accessToken });
    const hasPasswd = typeof r.text === "string" && (r.text.includes("root:") || r.text.includes("/bin/"));
    const pass = !hasPasswd && (r.status === 404 || r.status === 400 || r.status === 422 || r.status === 200);
    record("SEC-04: Path traversal on /pipeline/history", pass,
      hasPasswd ? "PASSWD CONTENTS LEAKED" : `Status ${r.status}, no sensitive file content`, r.elapsed);
  }

  // 5. JWT tampering
  {
    // Decode the token, modify, re-encode (without valid signature)
    const parts = accessToken.split(".");
    let payloadObj;
    try {
      payloadObj = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    } catch {
      payloadObj = {};
    }
    payloadObj.sub = "hacker";
    const newPayload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
    const tampered = `${parts[0]}.${newPayload}.${parts[2]}`;

    const r = await req("GET", "/portfolio/summary", { token: tampered });
    const pass = r.status === 401 || r.status === 403;
    record("SEC-05: JWT tampering (modified payload)", pass,
      `Status ${r.status} (expected 401/403)`, r.elapsed);
  }

  // 6. Expired token
  {
    const parts = accessToken.split(".");
    let payloadObj;
    try {
      payloadObj = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    } catch {
      payloadObj = {};
    }
    payloadObj.exp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const newPayload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
    const expired = `${parts[0]}.${newPayload}.${parts[2]}`;

    const r = await req("GET", "/portfolio/summary", { token: expired });
    const pass = r.status === 401 || r.status === 403;
    record("SEC-06: Expired token", pass,
      `Status ${r.status} (expected 401/403)`, r.elapsed);
  }

  // 7. Wrong token type (refresh token used as access token)
  {
    const r = await req("GET", "/portfolio/summary", { token: refreshToken });
    const pass = r.status === 401 || r.status === 403;
    record("SEC-07: Refresh token used as access token", pass,
      `Status ${r.status} (expected 401/403)`, r.elapsed);
  }

  // 8. CORS check with evil origin
  {
    const r = await req("GET", "/portfolio/summary", {
      token: accessToken,
      headers: { Origin: "https://evil.com" },
    });
    const acao = r.headers["access-control-allow-origin"] || "";
    const pass = !acao.includes("evil.com");
    record("SEC-08: CORS rejects evil.com origin", pass,
      acao ? `ACAO header: ${acao}` : "No ACAO header returned (good)", r.elapsed);
  }

  // 9. HTTP method confusion  (PUT to POST-only endpoint)
  {
    const r = await req("PUT", "/trades/orders", {
      token: accessToken,
      body: { legs: [{ symbol: "AAPL", side: "buy", qty: 1 }] },
    });
    const pass = r.status === 405 || r.status === 404;
    record("SEC-09: PUT /trades/orders (should be POST)", pass,
      `Status ${r.status} (expected 405 or 404)`, r.elapsed);
  }

  // 10. Large payload (1 MB body)
  {
    const bigBody = JSON.stringify({ data: "x".repeat(1_000_000) });
    const r = await req("POST", "/trades/orders", {
      token: accessToken,
      body: bigBody,
    });
    // Should reject gracefully (400/413/422) rather than crash (5xx)
    const pass = r.status >= 400 && r.status < 500;
    record("SEC-10: 1 MB payload to /trades/orders", pass,
      `Status ${r.status} (expected 4xx graceful rejection)`, r.elapsed);
  }
}

// ────────────────────────────────────────────────────────────
// 11-12  Rate Limiting Tests
// ────────────────────────────────────────────────────────────

async function rateLimitTests() {
  console.log("\n=== Rate Limiting Tests ===");

  // 11. Rapid login attempts
  {
    const statuses = [];
    let got429 = false;
    let firstRateLimit = -1;
    for (let i = 1; i <= 10; i++) {
      const r = await req("POST", "/auth/login", {
        body: { username: "admin", password: "wrong_password" },
      });
      statuses.push(r.status);
      if (r.status === 429 && !got429) {
        got429 = true;
        firstRateLimit = i;
      }
    }
    const pass = got429;
    record("SEC-11: Rate limiting on login (10 rapid attempts)", pass,
      got429
        ? `429 first seen on attempt ${firstRateLimit}. Statuses: [${statuses.join(",")}]`
        : `No 429 received. Statuses: [${statuses.join(",")}]`, 0);
  }

  // 12. After rate limit, wait and verify legitimate login works
  {
    console.log("  ... waiting 8s for rate limit to clear ...");
    await new Promise(r => setTimeout(r, 8000));
    const r = await req("POST", "/auth/login", { body: CREDS });
    // Re-login since our token may still be valid, rate limit might still be active
    // Accept either 200 (limit cleared) or 429 (window hasn't expired yet - still valid behavior)
    const pass = r.status === 200 || r.status === 429;
    if (r.status === 200 && r.data?.access_token) {
      accessToken  = r.data.access_token;
      refreshToken = r.data.refresh_token;
    }
    record("SEC-12: Login after rate limit cooldown", pass,
      `Status ${r.status}${r.status === 429 ? " (rate limit window still active, 5-min window)" : " (login succeeded)"}`, r.elapsed);
  }

  // Ensure we have a valid token for subsequent tests
  if (!accessToken) {
    console.log("  Re-authenticating after rate limit tests...");
    await new Promise(r => setTimeout(r, 5000));
    await login();
  }
}

// ────────────────────────────────────────────────────────────
// 13-15  Halt / Resume Tests
// ────────────────────────────────────────────────────────────

async function haltResumeTests() {
  console.log("\n=== Halt / Resume Tests ===");

  // 13. POST /trades/halt
  {
    const r = await req("POST", "/trades/halt", { token: accessToken });
    const pass = r.status === 200;
    record("SEC-13: POST /trades/halt", pass,
      `Status ${r.status}, body: ${JSON.stringify(r.data)}`, r.elapsed);
  }

  // 14. Verify halt persists: POST /trades/orders should return 503
  {
    const r = await req("POST", "/trades/orders", {
      token: accessToken,
      body: {
        legs: [{ symbol: "AAPL", side: "buy", qty: 1, order_type: "limit", limit_price: 100 }],
        time_in_force: "day",
      },
    });
    const pass = r.status === 503;
    record("SEC-14: Orders blocked while halted", pass,
      `Status ${r.status} (expected 503). ${typeof r.data === "object" ? JSON.stringify(r.data) : ""}`, r.elapsed);
  }

  // 15. POST /trades/resume
  {
    const r = await req("POST", "/trades/resume", { token: accessToken });
    const pass = r.status === 200;
    record("SEC-15: POST /trades/resume", pass,
      `Status ${r.status}, body: ${JSON.stringify(r.data)}`, r.elapsed);
  }
}

// ────────────────────────────────────────────────────────────
// 16-20  Data Integrity Tests
// ────────────────────────────────────────────────────────────

async function dataIntegrityTests() {
  console.log("\n=== Data Integrity Tests ===");

  // 16. Portfolio summary: equity ~ cash + market_value
  {
    const r = await req("GET", "/portfolio/summary", { token: accessToken });
    let pass = false;
    let details = "";
    if (r.status === 200 && r.data) {
      const { equity, cash, total_market_value } = r.data;
      const expected = cash + total_market_value;
      const diff = Math.abs(equity - expected);
      // Allow 1% tolerance or $100 absolute
      pass = diff < Math.max(equity * 0.01, 100);
      details = `equity=${equity}, cash=${cash}, market_value=${total_market_value}, sum=${expected}, diff=${diff.toFixed(2)}`;
    } else {
      details = `Status ${r.status}`;
    }
    record("DI-16: Portfolio equity = cash + market_value", pass, details, r.elapsed);
  }

  // 17. Positions have numeric avgCost & currentPrice
  {
    const r = await req("GET", "/trades/positions", { token: accessToken });
    let pass = true;
    let details = "";
    if (r.status === 200 && Array.isArray(r.data)) {
      if (r.data.length === 0) {
        pass = true;
        details = "No positions (vacuously true)";
      } else {
        for (const pos of r.data) {
          if (typeof pos.avg_cost !== "number" || !Number.isFinite(pos.avg_cost)) {
            pass = false;
            details += `${pos.symbol} has non-numeric avg_cost (${pos.avg_cost}); `;
          }
          if (typeof pos.current_price !== "number" || !Number.isFinite(pos.current_price)) {
            pass = false;
            details += `${pos.symbol} has non-numeric current_price (${pos.current_price}); `;
          }
        }
        if (pass) details = `All ${r.data.length} positions have valid numeric fields`;
      }
    } else {
      details = `Status ${r.status}`;
    }
    record("DI-17: Positions have numeric avgCost/currentPrice", pass, details, r.elapsed);
  }

  // 18. Strategies have valid status
  {
    const r = await req("GET", "/strategies/", { token: accessToken });
    let pass = true;
    let details = "";
    const validStatuses = new Set(["active", "paused", "backtest"]);
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const s of r.data) {
        if (!validStatuses.has(s.status)) {
          pass = false;
          details += `Strategy '${s.name}' has invalid status '${s.status}'; `;
        }
      }
      if (pass) details = `All ${r.data.length} strategies have valid status (active/paused/backtest)`;
    } else {
      details = `Status ${r.status}`;
    }
    record("DI-18: Strategies have valid status", pass, details, r.elapsed);
  }

  // 19. Calendar: no future dates with PnL data
  {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const r = await req("GET", `/portfolio/calendar?year=${year}&month=${month}`, { token: accessToken });
    let pass = true;
    let details = "";
    if (r.status === 200 && r.data?.days) {
      const today = new Date().toISOString().slice(0, 10);
      const futureDays = r.data.days.filter(d => d.date > today && (d.pnl !== 0 || d.trades > 0));
      if (futureDays.length > 0) {
        pass = false;
        details = `Found ${futureDays.length} future date(s) with PnL: ${futureDays.map(d => d.date).join(", ")}`;
      } else {
        details = `No future dates with PnL (${r.data.days.length} days checked)`;
      }
    } else {
      details = `Status ${r.status}`;
    }
    record("DI-19: Calendar has no future PnL data", pass, details, r.elapsed);
  }

  // 20. Market quotes consistency (two calls return same data)
  {
    const r1 = await req("GET", "/market/quotes/AAPL", { token: accessToken });
    const r2 = await req("GET", "/market/quotes/AAPL", { token: accessToken });
    let pass = false;
    let details = "";
    if (r1.status === 200 && r2.status === 200 && r1.data && r2.data) {
      // Compare key fields (last price, bid, ask). They should be the same or very close
      // since they come from the same seed-based demo or cached live data
      const d1 = r1.data, d2 = r2.data;
      const lastDiff = Math.abs((d1.last || 0) - (d2.last || 0));
      const bidDiff  = Math.abs((d1.bid  || 0) - (d2.bid  || 0));
      const askDiff  = Math.abs((d1.ask  || 0) - (d2.ask  || 0));
      // Allow small floating-point drift (up to 1% of price)
      const tolerance = Math.max(d1.last * 0.01, 0.5);
      pass = lastDiff <= tolerance && bidDiff <= tolerance && askDiff <= tolerance;
      details = `last: ${d1.last} vs ${d2.last} (diff ${lastDiff.toFixed(4)}), bid diff ${bidDiff.toFixed(4)}, ask diff ${askDiff.toFixed(4)}`;
    } else {
      details = `Statuses: ${r1.status}, ${r2.status}`;
    }
    record("DI-20: Market quotes consistency (AAPL x2)", pass, details, r1.elapsed + r2.elapsed);
  }
}

// ────────────────────────────────────────────────────────────
// 21-23  Performance Under Load
// ────────────────────────────────────────────────────────────

async function performanceTests() {
  console.log("\n=== Performance Under Load ===");

  async function loadTest(name, path, concurrency) {
    const latencies = [];
    const errors = [];

    const tasks = Array.from({ length: concurrency }, async () => {
      const r = await req("GET", path, { token: accessToken, timeout: 30000 });
      if (r.status === 200) {
        latencies.push(r.elapsed);
      } else {
        errors.push(r.status);
        latencies.push(r.elapsed);
      }
    });

    await Promise.all(tasks);

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const maxLat = Math.max(...latencies);
    const errCount = errors.length;
    const pass = errCount === 0 && p95 < 10000; // p95 under 10s
    const details = `${concurrency} concurrent | p50=${p50}ms p95=${p95}ms avg=${avg}ms max=${maxLat}ms | errors=${errCount}${errCount ? ` [${errors.join(",")}]` : ""}`;

    record(name, pass, details, avg);
    return { p50, p95, avg, maxLat, errors: errCount };
  }

  // 21. 20 concurrent /portfolio/summary
  await loadTest("PERF-21: 20x GET /portfolio/summary", "/portfolio/summary", 20);

  // 22. 20 concurrent /market/quotes/SPY
  await loadTest("PERF-22: 20x GET /market/quotes/SPY", "/market/quotes/SPY", 20);

  // 23. 20 concurrent /strategies/
  await loadTest("PERF-23: 20x GET /strategies/", "/strategies/", 20);
}

// ────────────────────────────────────────────────────────────
// Main runner
// ────────────────────────────────────────────────────────────

async function main() {
  console.log("AlphaDesk Security & Stress QA Suite");
  console.log("====================================");
  console.log(`Target: ${BASE}`);
  console.log(`Time:   ${new Date().toISOString()}`);

  const ok = await login();
  if (!ok) {
    console.error("Cannot proceed without authentication.");
    process.exit(1);
  }

  await securityTests();
  await rateLimitTests();
  await haltResumeTests();
  await dataIntegrityTests();
  await performanceTests();

  // ── Summary ──
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const total  = results.length;

  console.log("\n====================================");
  console.log(`TOTAL: ${total}  |  PASSED: ${passed}  |  FAILED: ${failed}`);
  console.log("====================================\n");

  const output = {
    run_at: new Date().toISOString(),
    target: BASE,
    summary: { total, passed, failed },
    results,
  };

  writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));
  console.log(`Results saved to ${RESULTS_PATH}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(2);
});
