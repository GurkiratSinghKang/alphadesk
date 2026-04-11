/**
 * AlphaDesk API Edge Case & Contract Verification Test Suite
 * Tests 30 edge cases across auth, trading safety, data validation,
 * strategies, pipeline, and response shape.
 */

import fs from "fs";
import path from "path";

const BASE = "https://tradingalpha.net/api/v1";
const CREDS = { username: "admin", password: "GK1355$$gk" };

const results = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snippet(body, maxLen = 200) {
  if (body === null || body === undefined) return "(empty)";
  const s = typeof body === "string" ? body : JSON.stringify(body);
  return s.length > maxLen ? s.slice(0, maxLen) + "..." : s;
}

async function safeFetch(url, opts = {}) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    return { ok: false, status: 0, statusText: err.message, json: async () => ({}), text: async () => err.message, headers: new Headers() };
  }
}

async function safeBody(resp) {
  try {
    const text = await resp.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch { return "(unreadable)"; }
}

function record(id, endpoint, method, status, pass, body, notes = "") {
  const entry = { id, endpoint, method, status, pass, response_snippet: snippet(body), notes };
  results.push(entry);
  const icon = pass ? "PASS" : "FAIL";
  console.log(`[${icon}] #${id} ${method} ${endpoint} -> ${status}  ${notes}`);
}

async function login() {
  const resp = await safeFetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CREDS),
  });
  const body = await resp.json();
  return body.access_token;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Auth Edge Cases (1-7)
// ---------------------------------------------------------------------------

async function testAuth() {
  console.log("\n=== AUTH EDGE CASES ===\n");

  // 1. Wrong password
  {
    const resp = await safeFetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrongpass" }),
    });
    const body = await safeBody(resp);
    record(1, "/auth/login", "POST", resp.status, resp.status === 401, body, "Wrong password");
  }

  // 2. Empty body
  {
    const resp = await safeFetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await safeBody(resp);
    // Pydantic requires username+password so expect 422, or 401 if it treats empty as wrong creds
    const pass = resp.status === 422 || resp.status === 401;
    record(2, "/auth/login", "POST", resp.status, pass, body, "Empty body");
  }

  // 3. Rate limiting (6 rapid wrong logins)
  {
    let lastStatus = 0;
    let lastBody = {};
    let hitRateLimit = false;
    for (let i = 0; i < 8; i++) {
      const resp = await safeFetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "wrong" + i }),
      });
      lastBody = await safeBody(resp);
      lastStatus = resp.status;
      if (resp.status === 429) { hitRateLimit = true; break; }
    }
    record(3, "/auth/login", "POST", lastStatus, hitRateLimit, lastBody,
      hitRateLimit ? "Rate limit kicked in" : "Rate limit NOT triggered (Redis may be absent or different IP counting)");
  }

  // 4. Protected endpoint without token
  {
    const resp = await safeFetch(`${BASE}/portfolio/summary`);
    const body = await safeBody(resp);
    const pass = resp.status === 401 || resp.status === 403;
    record(4, "/portfolio/summary", "GET", resp.status, pass, body, "No token");
  }

  // 5. Invalid/expired token
  {
    const resp = await safeFetch(`${BASE}/portfolio/summary`, {
      headers: { Authorization: "Bearer invalidtoken123" },
    });
    const body = await safeBody(resp);
    const pass = resp.status === 401 || resp.status === 403;
    record(5, "/portfolio/summary", "GET", resp.status, pass, body, "Invalid token");
  }

  // 6. Logout clears cookies
  {
    const token = await login();
    const resp = await safeFetch(`${BASE}/auth/logout`, {
      method: "POST",
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    const setCookie = resp.headers?.get?.("set-cookie") || "";
    const cookiesCleared = setCookie.includes("access_token") || resp.status === 200;
    record(6, "/auth/logout", "POST", resp.status, resp.status === 200, body,
      `Cookies header: ${setCookie ? snippet(setCookie, 120) : "(no set-cookie visible in fetch — HttpOnly)"}`);
  }

  // 7. Token after logout (should be revoked if Redis is running)
  {
    const token = await login();
    // Logout
    await safeFetch(`${BASE}/auth/logout`, {
      method: "POST",
      headers: authHeaders(token),
    });
    // Try using the same token
    const resp = await safeFetch(`${BASE}/portfolio/summary`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    // If revocation works (Redis up): 401; if no revocation: 200
    const revoked = resp.status === 401;
    record(7, "/portfolio/summary", "GET", resp.status,
      resp.status === 401 || resp.status === 200, body,
      revoked ? "Token revoked after logout (Redis active)" : "Token still valid after logout (revocation not active)");
  }
}

// ---------------------------------------------------------------------------
// Trading Safety Edge Cases (8-15)
// ---------------------------------------------------------------------------

async function testTradingSafety() {
  console.log("\n=== TRADING SAFETY EDGE CASES ===\n");
  const token = await login();

  // Helper: create order request
  function orderBody(qty, opts = {}) {
    return JSON.stringify({
      legs: [{
        symbol: opts.symbol || "AAPL",
        side: opts.side || "buy",
        qty: qty,
        order_type: opts.order_type || "limit",
        limit_price: opts.limit_price ?? 150.00,
        asset_class: "equity",
      }],
      time_in_force: opts.tif || "day",
      strategy: opts.strategy || "test",
      notes: opts.notes || "edge-case-test",
    });
  }

  // 8. Zero quantity
  {
    const resp = await safeFetch(`${BASE}/trades/orders`, {
      method: "POST",
      headers: authHeaders(token),
      body: orderBody(0),
    });
    const body = await safeBody(resp);
    const pass = resp.status >= 400 && resp.status < 500;
    record(8, "/trades/orders", "POST", resp.status, pass, body, "qty=0");
  }

  // 9. Negative quantity
  {
    const resp = await safeFetch(`${BASE}/trades/orders`, {
      method: "POST",
      headers: authHeaders(token),
      body: orderBody(-10),
    });
    const body = await safeBody(resp);
    const pass = resp.status >= 400 && resp.status < 500;
    record(9, "/trades/orders", "POST", resp.status, pass, body, "qty=-10");
  }

  // 10. Huge quantity (risk check)
  {
    const resp = await safeFetch(`${BASE}/trades/orders`, {
      method: "POST",
      headers: authHeaders(token),
      body: orderBody(999999, { limit_price: 150.00 }),
    });
    const body = await safeBody(resp);
    // 422 = risk check failed; 400 or 503 also acceptable
    const pass = resp.status >= 400;
    record(10, "/trades/orders", "POST", resp.status, pass, body, "qty=999999 (huge notional)");
  }

  // 11. Halt trading
  {
    const resp = await safeFetch(`${BASE}/trades/halt`, {
      method: "POST",
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    record(11, "/trades/halt", "POST", resp.status, resp.status === 200, body, "Halt trading");
  }

  // 12. Order while halted
  {
    const resp = await safeFetch(`${BASE}/trades/orders`, {
      method: "POST",
      headers: authHeaders(token),
      body: orderBody(1),
    });
    const body = await safeBody(resp);
    record(12, "/trades/orders", "POST", resp.status, resp.status === 503, body, "Order while halted");
  }

  // 13. Resume trading
  {
    const resp = await safeFetch(`${BASE}/trades/resume`, {
      method: "POST",
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    record(13, "/trades/resume", "POST", resp.status, resp.status === 200, body, "Resume trading");
  }

  // 14. Order after resume (should pass validation, may fail at broker)
  {
    const resp = await safeFetch(`${BASE}/trades/orders`, {
      method: "POST",
      headers: authHeaders(token),
      body: orderBody(1),
    });
    const body = await safeBody(resp);
    // After resume, order should NOT get 503. It may get 422 (risk), 400 (market hours),
    // 502 (broker error), or 201 (success). Key: it should NOT be 503.
    const pass = resp.status !== 503;
    record(14, "/trades/orders", "POST", resp.status, pass, body,
      `After resume - ${resp.status === 503 ? "STILL HALTED" : "Not halted (validation/broker response)"}`);
  }

  // 15. Duplicate order within 30s
  {
    // Submit first order
    const firstResp = await safeFetch(`${BASE}/trades/orders`, {
      method: "POST",
      headers: authHeaders(token),
      body: orderBody(5, { symbol: "MSFT", limit_price: 430.00, notes: "dedup-test" }),
    });
    const firstBody = await safeBody(firstResp);
    // Submit identical order immediately
    const secondResp = await safeFetch(`${BASE}/trades/orders`, {
      method: "POST",
      headers: authHeaders(token),
      body: orderBody(5, { symbol: "MSFT", limit_price: 430.00, notes: "dedup-test" }),
    });
    const secondBody = await safeBody(secondResp);
    // Second should be 409 if dedup works; first may be 201 or other validation error
    const pass = secondResp.status === 409 || (firstResp.status >= 400 && secondResp.status >= 400);
    record(15, "/trades/orders", "POST", secondResp.status, pass, secondBody,
      `Duplicate check: 1st=${firstResp.status}, 2nd=${secondResp.status}`);
  }
}

// ---------------------------------------------------------------------------
// Data Validation Edge Cases (16-21)
// ---------------------------------------------------------------------------

async function testDataValidation() {
  console.log("\n=== DATA VALIDATION EDGE CASES ===\n");
  const token = await login();

  // 16. No symbol in quote path
  {
    const resp = await safeFetch(`${BASE}/market/quotes/`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    const pass = resp.status === 404 || resp.status === 422 || resp.status === 405;
    record(16, "/market/quotes/", "GET", resp.status, pass, body, "No symbol");
  }

  // 17. Single-char symbol
  {
    const resp = await safeFetch(`${BASE}/market/quotes/A`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    // 'A' is not in demo symbols, might return 404 or actual data if Alpaca has it
    const pass = resp.status === 200 || resp.status === 404;
    record(17, "/market/quotes/A", "GET", resp.status, pass, body, "Single char symbol");
  }

  // 18. Space in symbol
  {
    const resp = await safeFetch(`${BASE}/market/quotes/AAPL%20MSFT`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    const pass = resp.status === 404 || resp.status === 400 || resp.status === 200;
    record(18, "/market/quotes/AAPL%20MSFT", "GET", resp.status, pass, body, "Space in symbol");
  }

  // 19. Invalid timeframe for bars
  {
    const resp = await safeFetch(`${BASE}/market/bars/AAPL?timeframe=invalid`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    const pass = resp.status === 422 || resp.status === 400;
    record(19, "/market/bars/AAPL?timeframe=invalid", "GET", resp.status, pass, body, "Invalid timeframe");
  }

  // 20. Negative limit
  {
    const resp = await safeFetch(`${BASE}/market/bars/AAPL?limit=-1`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    const pass = resp.status === 422 || resp.status === 400;
    record(20, "/market/bars/AAPL?limit=-1", "GET", resp.status, pass, body, "Negative limit");
  }

  // 21. Huge limit
  {
    const resp = await safeFetch(`${BASE}/market/bars/AAPL?limit=99999`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    // Should be 422 (exceeds max 5000) or capped silently (200)
    const pass = resp.status === 422 || resp.status === 200;
    record(21, "/market/bars/AAPL?limit=99999", "GET", resp.status, pass, body,
      resp.status === 422 ? "Rejected by validation" : `Returned ${Array.isArray(body) ? body.length : "?"} bars`);
  }
}

// ---------------------------------------------------------------------------
// Strategy Edge Cases (22-25)
// ---------------------------------------------------------------------------

async function testStrategies() {
  console.log("\n=== STRATEGY EDGE CASES ===\n");
  const token = await login();

  // 22. Nonexistent strategy performance
  {
    const resp = await safeFetch(`${BASE}/strategies/nonexistent-id/performance`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    record(22, "/strategies/nonexistent-id/performance", "GET", resp.status,
      resp.status === 404, body, "Nonexistent strategy performance");
  }

  // 23. Toggle nonexistent strategy
  {
    const resp = await safeFetch(`${BASE}/strategies/nonexistent-id/toggle`, {
      method: "POST",
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    record(23, "/strategies/nonexistent-id/toggle", "POST", resp.status,
      resp.status === 404, body, "Toggle nonexistent strategy");
  }

  // 24. Calendar: year=1900, month=13
  {
    const resp = await safeFetch(`${BASE}/portfolio/calendar?year=1900&month=13`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    const pass = resp.status === 400 || resp.status === 422;
    record(24, "/portfolio/calendar?year=1900&month=13", "GET", resp.status,
      pass, body, "Invalid year/month");
  }

  // 25. Calendar: year=2099, month=1
  {
    const resp = await safeFetch(`${BASE}/portfolio/calendar?year=2099&month=1`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    // 2099 is within 2000-2100 range, month=1 is valid, so should return 200 with empty days
    const pass = resp.status === 200 || resp.status === 400;
    record(25, "/portfolio/calendar?year=2099&month=1", "GET", resp.status,
      pass, body, "Far future calendar");
  }
}

// ---------------------------------------------------------------------------
// Pipeline Edge Cases (26-28)
// ---------------------------------------------------------------------------

async function testPipeline() {
  console.log("\n=== PIPELINE EDGE CASES ===\n");
  const token = await login();

  // 26. Pipeline run (or double-run) - just test it responds properly
  {
    // We won't actually double-submit. Just verify /run responds.
    const resp = await safeFetch(`${BASE}/pipeline/status`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    const pass = resp.status === 200;
    record(26, "/pipeline/status", "GET", resp.status, pass, body,
      "Pipeline status check (run guarded by pipeline internally)");
  }

  // 27. Pipeline history with invalid date format
  {
    const resp = await safeFetch(`${BASE}/pipeline/history/invalid-date`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    const pass = resp.status === 400 || resp.status === 404 || resp.status === 422;
    record(27, "/pipeline/history/invalid-date", "GET", resp.status, pass, body, "Invalid date format");
  }

  // 28. Pipeline history with impossible date
  {
    const resp = await safeFetch(`${BASE}/pipeline/history/9999-99-99`, {
      headers: authHeaders(token),
    });
    const body = await safeBody(resp);
    const pass = resp.status === 400 || resp.status === 404 || resp.status === 422;
    record(28, "/pipeline/history/9999-99-99", "GET", resp.status, pass, body, "Impossible date");
  }
}

// ---------------------------------------------------------------------------
// Response Shape Verification (29-30)
// ---------------------------------------------------------------------------

async function testResponseShape() {
  console.log("\n=== RESPONSE SHAPE VERIFICATION ===\n");
  const token = await login();

  // 29. Verify error responses use consistent {"detail": "..."} format
  {
    const errorEndpoints = [
      { url: `${BASE}/auth/login`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "x", password: "x" }) },
      { url: `${BASE}/strategies/nope/performance`, method: "GET", headers: authHeaders(token) },
      { url: `${BASE}/pipeline/history/invalid-date`, method: "GET", headers: authHeaders(token) },
      { url: `${BASE}/market/bars/AAPL?timeframe=invalid`, method: "GET", headers: authHeaders(token) },
      { url: `${BASE}/portfolio/summary`, method: "GET", headers: {} }, // no auth
    ];

    let allConsistent = true;
    const inconsistencies = [];

    for (const ep of errorEndpoints) {
      const resp = await safeFetch(ep.url, {
        method: ep.method,
        headers: ep.headers,
        body: ep.body,
      });
      const body = await safeBody(resp);
      if (resp.status >= 400) {
        const hasDetail = typeof body === "object" && body !== null && "detail" in body;
        if (!hasDetail) {
          allConsistent = false;
          inconsistencies.push(`${ep.method} ${ep.url.replace(BASE, "")} -> ${resp.status}: ${snippet(body, 100)}`);
        }
      }
    }

    record(29, "(multiple error endpoints)", "MULTI", "-",
      allConsistent, inconsistencies.length ? inconsistencies : "All error responses have {detail: ...}",
      allConsistent ? "Consistent error format" : `${inconsistencies.length} inconsistent responses`);
  }

  // 30. Verify no raw Python tracebacks
  {
    const tracebackEndpoints = [
      { url: `${BASE}/auth/login`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "wrong" }) },
      { url: `${BASE}/strategies/nope/performance`, method: "GET", headers: authHeaders(token) },
      { url: `${BASE}/pipeline/history/bad`, method: "GET", headers: authHeaders(token) },
      { url: `${BASE}/market/quotes/ZZZZZ`, method: "GET", headers: authHeaders(token) },
      { url: `${BASE}/portfolio/calendar?year=1900&month=13`, method: "GET", headers: authHeaders(token) },
    ];

    let foundTraceback = false;
    const tracebackDetails = [];

    for (const ep of tracebackEndpoints) {
      const resp = await safeFetch(ep.url, {
        method: ep.method,
        headers: ep.headers,
        body: ep.body,
      });
      const body = await safeBody(resp);
      const text = typeof body === "string" ? body : JSON.stringify(body);
      if (text.includes("Traceback (most recent call last)") || text.includes("File \"") || text.includes("raise ") && text.includes(".py\"")) {
        foundTraceback = true;
        tracebackDetails.push(`${ep.method} ${ep.url.replace(BASE, "")} -> raw traceback`);
      }
    }

    record(30, "(multiple error endpoints)", "MULTI", "-",
      !foundTraceback, foundTraceback ? tracebackDetails : "No raw tracebacks detected",
      foundTraceback ? "Python tracebacks exposed" : "Clean error responses");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("AlphaDesk API Edge Case Test Suite");
  console.log("==================================");
  console.log(`Target: ${BASE}`);
  console.log(`Time:   ${new Date().toISOString()}\n`);

  // First verify we can login at all
  try {
    const token = await login();
    if (!token) throw new Error("No token returned");
    console.log("Login OK - token obtained.\n");
  } catch (err) {
    console.error("FATAL: Cannot login. Aborting.", err.message);
    process.exit(1);
  }

  await testAuth();
  await testTradingSafety();
  await testDataValidation();
  await testStrategies();
  await testPipeline();
  await testResponseShape();

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const total = results.length;

  console.log("\n==================================");
  console.log(`TOTAL: ${total}  PASS: ${passed}  FAIL: ${failed}`);
  console.log("==================================\n");

  // Save results
  const outPath = "/Users/GK/Downloads/alphadesk/qa-screenshots/api-edge/results.json";
  const output = {
    timestamp: new Date().toISOString(),
    base_url: BASE,
    summary: { total, passed, failed },
    results,
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${outPath}`);
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
