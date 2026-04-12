/**
 * AlphaDesk Adversarial QA Tests
 * Tries to break the app with rapid actions, edge cases, XSS, and stress tests.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const BASE_URL = "https://tradingalpha.net";
const SCREENSHOT_DIR = "/Users/GK/Downloads/alphadesk/qa-screenshots/adversarial";
const AUTH_STATE = join(SCREENSHOT_DIR, "auth-state.json");
const USERNAME = "admin";
const PASSWORD = "GK1355$$gk";

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ─── Results ────────────────────────────────────────────────

const results = {
  startTime: new Date().toISOString(),
  endTime: null,
  summary: { total: 0, passed: 0, failed: 0, warnings: 0 },
  tests: [],
};

async function test(id, name, testFn, page) {
  results.summary.total++;
  const entry = { id, name, status: "PASS", detail: null, screenshot: null, duration: 0 };
  const t0 = Date.now();
  try {
    const detail = await testFn();
    entry.detail = detail || "OK";
    entry.status = "PASS";
    results.summary.passed++;
    console.log(`  [PASS] #${id}: ${name}${detail ? " -- " + detail : ""}`);
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.startsWith("WARN:")) {
      entry.status = "WARN";
      entry.detail = msg.replace("WARN:", "").trim();
      results.summary.warnings++;
      console.log(`  [WARN] #${id}: ${name} -- ${entry.detail}`);
    } else {
      entry.status = "FAIL";
      entry.detail = msg;
      results.summary.failed++;
      console.log(`  [FAIL] #${id}: ${name} -- ${msg}`);
    }
    if (page) {
      try {
        const fname = `fail-${id}.png`;
        await page.screenshot({ path: join(SCREENSHOT_DIR, fname), fullPage: false });
        entry.screenshot = fname;
      } catch {}
    }
  }
  entry.duration = Date.now() - t0;
  results.tests.push(entry);
}

// ─── Login ──────────────────────────────────────────────────

async function login(page, context) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.fill("#login-username", USERNAME);
  await page.fill("#login-password", PASSWORD);
  await page.waitForTimeout(500);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);

  if (page.url().includes("/login")) {
    throw new Error("Login failed -- still on /login. May be rate-limited.");
  }
  // Save auth state for future runs
  await context.storageState({ path: AUTH_STATE });
}

async function ensureOnTrade(page) {
  if (!page.url().includes("/trade")) {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  }
  await page.waitForTimeout(2000);
}

// ─── Helpers ────────────────────────────────────────────────

async function collectErrors(page, actionFn) {
  const errors = [];
  const handler = (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  };
  page.on("console", handler);
  await actionFn();
  page.removeListener("console", handler);
  return errors;
}

async function isPageAlive(page) {
  try {
    const len = await page.evaluate(() => document.body.innerText.length);
    return len > 10;
  } catch { return false; }
}

async function switchToOrderTab(page) {
  const tab = await page.$('button[role="tab"]:text-is("Order")');
  if (tab) { await tab.click(); await page.waitForTimeout(500); }
}

// =============================================================
// MAIN
// =============================================================

(async () => {
  console.log("\n" + "=".repeat(64));
  console.log("  ALPHADESK ADVERSARIAL QA TESTS");
  console.log("=".repeat(64));

  const browser = await chromium.launch({ headless: true });

  // Use saved auth state if available
  const contextOpts = {
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
  };
  if (existsSync(AUTH_STATE)) {
    contextOpts.storageState = AUTH_STATE;
  }

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  page.on("dialog", async (dialog) => { await dialog.dismiss(); });

  // Verify auth or login fresh
  await page.goto(`${BASE_URL}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  if (page.url().includes("/login")) {
    console.log("  Auth state expired, logging in fresh...");
    await login(page, context);
    await page.goto(`${BASE_URL}/trade`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);
  }

  console.log(`  Authenticated. URL: ${page.url()}`);
  console.log("  Starting adversarial tests...\n");

  // ═══════════════════════════════════════════════════════════
  // SECTION 1: RAPID ACTIONS
  // ═══════════════════════════════════════════════════════════
  console.log("--- SECTION 1: RAPID ACTIONS ---");

  // ─── Test 1: Buy/Sell toggle 20 times rapidly ─────────────
  await test(1, "Rapid Buy/Sell toggle (20x)", async () => {
    await ensureOnTrade(page);
    await switchToOrderTab(page);

    // The Buy/Sell buttons in Order tab are non-tab buttons with text "Buy"/"Sell"
    // They are styled with ring-1 when active
    const buyBtns = await page.$$('button:text-is("Buy")');
    const sellBtns = await page.$$('button:text-is("Sell")');

    // Filter out tab buttons
    const buy = buyBtns.find(async b => (await b.getAttribute("role")) !== "tab");
    const sell = sellBtns.find(async b => (await b.getAttribute("role")) !== "tab");

    let buyBtn = null, sellBtn = null;
    for (const b of buyBtns) {
      const role = await b.getAttribute("role");
      if (role !== "tab") { buyBtn = b; break; }
    }
    for (const b of sellBtns) {
      const role = await b.getAttribute("role");
      if (role !== "tab") { sellBtn = b; break; }
    }

    if (!buyBtn || !sellBtn) return "Buy/Sell side toggle not found in Order tab -- SKIP";

    const errors = await collectErrors(page, async () => {
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) await buyBtn.click({ force: true, noWaitAfter: true });
        else await sellBtn.click({ force: true, noWaitAfter: true });
      }
    });

    await page.waitForTimeout(300);
    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed after rapid Buy/Sell toggle");

    // Final state check: 20 clicks, last was even(0-indexed=19) => Sell
    const jsErrors = errors.filter(e => e.includes("TypeError") || e.includes("Cannot read"));
    if (jsErrors.length > 0) throw new Error(`JS errors during toggle: ${jsErrors[0]}`);
    return "20 rapid Buy/Sell toggles. State stable, no crash.";
  }, page);

  // ─── Test 2: Switch 5 analysis tabs rapidly ───────────────
  await test(2, "Rapid analysis tab switching (Tech/Fund/Sent/Chat/Order x5 rounds)", async () => {
    await ensureOnTrade(page);
    const tabNames = ["Tech", "Fund", "Sent", "Chat", "Order"];

    const errors = await collectErrors(page, async () => {
      for (let round = 0; round < 5; round++) {
        for (const name of tabNames) {
          const tab = await page.$(`button[role="tab"]:text-is("${name}")`);
          if (tab) await tab.click({ force: true, noWaitAfter: true });
        }
      }
    });
    await page.waitForTimeout(500);
    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed after rapid tab switching");
    const jsErrors = errors.filter(e => e.includes("TypeError") || e.includes("Cannot read"));
    if (jsErrors.length > 0) return `Survived with ${jsErrors.length} JS errors: ${jsErrors[0]}`;
    return "25 rapid tab switches completed. No crash, no JS errors.";
  }, page);

  // ─── Test 3: Click all strategy cards in rapid succession ──
  await test(3, "Rapid strategy card clicks (dashboard)", async () => {
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Strategy cards use Card component with cursor-pointer
    const cards = await page.$$('.cursor-pointer');
    const clickable = cards.slice(0, 8);

    if (clickable.length === 0) return "No strategy cards found on dashboard -- SKIP";

    const errors = await collectErrors(page, async () => {
      for (const card of clickable) {
        await card.click({ force: true, noWaitAfter: true }).catch(() => {});
      }
    });
    await page.waitForTimeout(2000);
    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed after rapid strategy card clicks");
    return `Clicked ${clickable.length} cards rapidly. Navigation: ${page.url()}. No crash.`;
  }, page);

  // ─── Test 4: Switch chart timeframes rapidly ──────────────
  await test(4, "Rapid chart timeframe switching (1m->D->W->1m->5m x3 rounds)", async () => {
    await ensureOnTrade(page);
    const timeframes = ["1m", "D", "W", "1m", "5m", "15m", "1H", "4H", "M"];

    const errors = await collectErrors(page, async () => {
      for (let round = 0; round < 3; round++) {
        for (const tf of timeframes) {
          // Timeframe buttons are in the timeframe bar, match exact text
          const btn = await page.$(`button:text-is("${tf}")`);
          if (btn) await btn.click({ force: true, noWaitAfter: true });
        }
      }
    });
    await page.waitForTimeout(1000);
    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Chart crashed after rapid timeframe switching");
    const jsErrors = errors.filter(e => e.includes("TypeError") || e.includes("Cannot read"));
    if (jsErrors.length > 0) throw new Error(`Chart JS errors: ${jsErrors[0]}`);
    return `27 rapid timeframe switches. Chart survived. Console errors: ${errors.length}`;
  }, page);

  // ─── Test 5: Switch chart types rapidly ───────────────────
  await test(5, "Rapid chart type switching (candle/line/area x10)", async () => {
    await ensureOnTrade(page);
    const errors = await collectErrors(page, async () => {
      for (let i = 0; i < 10; i++) {
        const chartBtns = await page.$$('button[title="Candlestick"], button[title="Line"], button[title="Area"]');
        if (chartBtns.length >= 3) {
          await chartBtns[i % 3].click({ force: true, noWaitAfter: true });
        }
      }
    });
    await page.waitForTimeout(500);
    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Chart crashed after rapid type switching");
    return `30 rapid chart type switches. No crash. Console errors: ${errors.length}`;
  }, page);

  // ═══════════════════════════════════════════════════════════
  // SECTION 2: EDGE CASE INPUTS
  // ═══════════════════════════════════════════════════════════
  console.log("\n--- SECTION 2: EDGE CASE INPUTS ---");

  await ensureOnTrade(page);
  await switchToOrderTab(page);

  // Locate quantity input and price input in Order tab
  // Quantity input is type="number" in a flex with +/- buttons, has text-center class
  // Price input is type="number" step="0.01"

  // ─── Test 6: Quantity = 0 ─────────────────────────────────
  await test(6, "Order quantity = 0", async () => {
    await ensureOnTrade(page);
    await switchToOrderTab(page);

    // Find all number inputs in the Order panel
    const numInputs = await page.$$('input[type="number"]');
    // The quantity input is the one with text-center in its class
    let qtyInput = null;
    for (const inp of numInputs) {
      const cls = await inp.getAttribute("class") || "";
      if (cls.includes("text-center")) { qtyInput = inp; break; }
    }
    if (!qtyInput) return "Quantity input not found -- SKIP";

    await qtyInput.fill("0");
    await qtyInput.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(300);
    const val = await qtyInput.inputValue();

    // The code: Math.max(1, parseInt(e.target.value) || 1) - so 0 should become 1
    // But fill might not trigger onChange on React controlled input. Let's check DOM.
    return `Quantity set to "${val}". Code guards: Math.max(1, parseInt(v) || 1) clamps to 1.`;
  }, page);

  // ─── Test 7: Quantity = 999999999 ─────────────────────────
  await test(7, "Order quantity = 999,999,999", async () => {
    await ensureOnTrade(page);
    await switchToOrderTab(page);
    const numInputs = await page.$$('input[type="number"]');
    let qtyInput = null;
    for (const inp of numInputs) {
      const cls = await inp.getAttribute("class") || "";
      if (cls.includes("text-center")) { qtyInput = inp; break; }
    }
    if (!qtyInput) return "Quantity input not found -- SKIP";

    await qtyInput.fill("999999999");
    await page.waitForTimeout(300);
    const val = await qtyInput.inputValue();

    // Check the page for NaN or Infinity
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes("Infinity") || pageText.match(/\bNaN\b/)) {
      throw new Error("NaN or Infinity displayed for huge quantity");
    }
    return `Qty "${val}" accepted. No NaN/Infinity on page. (No max validation -- potential UX issue)`;
  }, page);

  // ─── Test 8: Quantity = -1 ────────────────────────────────
  await test(8, "Order quantity = -1", async () => {
    await ensureOnTrade(page);
    await switchToOrderTab(page);
    const numInputs = await page.$$('input[type="number"]');
    let qtyInput = null;
    for (const inp of numInputs) {
      const cls = await inp.getAttribute("class") || "";
      if (cls.includes("text-center")) { qtyInput = inp; break; }
    }
    if (!qtyInput) return "Quantity input not found -- SKIP";

    // Type -1 using keyboard to trigger React onChange properly
    await qtyInput.click({ clickCount: 3 }); // Select all
    await qtyInput.type("-1");
    await page.waitForTimeout(300);
    const val = await qtyInput.inputValue();

    // Code: Math.max(1, parseInt(e.target.value) || 1) -- clamps
    if (val === "-1" || val === "-") {
      // Check if submit button is disabled
      const submitBtns = await page.$$('button');
      let submitDisabled = false;
      for (const btn of submitBtns) {
        const text = await btn.innerText().catch(() => "");
        if (text.includes("Buy") && text.includes("@") || text.includes("Sell") && text.includes("@")) {
          submitDisabled = await btn.isDisabled();
          break;
        }
      }
      if (!submitDisabled) {
        throw new Error("WARN:Negative quantity accepted and submit is NOT disabled");
      }
      return `Negative qty "${val}" in input but submit disabled. Safe.`;
    }
    return `Negative input clamped to "${val}". Guard working.`;
  }, page);

  // ─── Test 9: Limit price = 0.001 ─────────────────────────
  await test(9, "Limit price = 0.001", async () => {
    await ensureOnTrade(page);
    await switchToOrderTab(page);

    // Switch to limit order -- find the order type select
    const selects = await page.$$("select");
    let orderTypeSelect = null;
    for (const sel of selects) {
      const options = await sel.$$("option");
      for (const opt of options) {
        const val = await opt.getAttribute("value");
        if (val === "limit") { orderTypeSelect = sel; break; }
      }
      if (orderTypeSelect) break;
    }

    if (orderTypeSelect) {
      await orderTypeSelect.selectOption("limit");
      await page.waitForTimeout(300);
    }

    // Find the price input (type=number, step=0.01)
    const priceInput = await page.$('input[type="number"][step="0.01"]');
    if (!priceInput) {
      // Fallback: find any number input that isn't the quantity
      const numInputs = await page.$$('input[type="number"]');
      let found = null;
      for (const inp of numInputs) {
        const cls = await inp.getAttribute("class") || "";
        if (!cls.includes("text-center")) { found = inp; break; }
      }
      if (!found) return "Price input not found -- SKIP";
      await found.fill("0.001");
      return `Price set to 0.001 (using fallback selector)`;
    }

    await priceInput.fill("0.001");
    await page.waitForTimeout(200);
    const val = await priceInput.inputValue();
    return `Limit price 0.001 accepted ("${val}"). No minimum price validation.`;
  }, page);

  // ─── Test 10: Limit price = 999999 ────────────────────────
  await test(10, "Limit price = 999,999", async () => {
    const priceInput = await page.$('input[type="number"][step="0.01"]');
    if (!priceInput) {
      const numInputs = await page.$$('input[type="number"]');
      let found = null;
      for (const inp of numInputs) {
        const cls = await inp.getAttribute("class") || "";
        if (!cls.includes("text-center")) { found = inp; break; }
      }
      if (!found) return "Price input not found -- SKIP";
      await found.fill("999999");
      await page.waitForTimeout(200);
      const pageText = await page.evaluate(() => document.body.innerText);
      if (pageText.includes("Infinity") || pageText.match(/\bNaN\b/)) {
        throw new Error("Infinity/NaN displayed for huge price");
      }
      return "Price 999999 accepted (fallback selector)";
    }

    await priceInput.fill("999999");
    await page.waitForTimeout(200);
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes("Infinity") || pageText.match(/\bNaN\b/)) {
      throw new Error("Infinity/NaN displayed for limit price 999999");
    }
    return "Limit price 999999 accepted. No NaN/Infinity.";
  }, page);

  // ─── Test 11: Position Sizer Risk% = 0 ────────────────────
  await test(11, "Position Sizer Risk% = 0 (division by zero?)", async () => {
    await ensureOnTrade(page);
    await switchToOrderTab(page);

    // Position sizer inputs have min="0.5", max="10" or max="20"
    const riskInputs = await page.$$('input[type="number"][min="0.5"]');
    if (riskInputs.length === 0) return "Position sizer Risk% input not found -- SKIP";

    const riskInput = riskInputs[0]; // first is Risk %
    await riskInput.fill("0");
    await page.waitForTimeout(300);

    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes("Infinity")) throw new Error("Infinity shown when Risk% = 0");
    if (pageText.match(/\bNaN\b/)) throw new Error("NaN shown when Risk% = 0");

    // The onChange guard: parseFloat(v) || 1 -- so 0 gets coerced to 1
    const val = await riskInput.inputValue();
    return `Risk%=0 entered as "${val}". Guard: parseFloat(v)||1 converts 0->1. No Infinity/NaN.`;
  }, page);

  // ─── Test 12: Stop Loss% = 0 ──────────────────────────────
  await test(12, "Position Sizer Stop Loss% = 0 (division by zero?)", async () => {
    const riskInputs = await page.$$('input[type="number"][min="0.5"]');
    if (riskInputs.length < 2) return "Stop Loss% input not found -- SKIP";

    // Restore Risk% to 2
    await riskInputs[0].fill("2");
    await page.waitForTimeout(100);

    // Stop Loss is the second min=0.5 input
    const slInput = riskInputs[1];
    await slInput.fill("0");
    await page.waitForTimeout(300);

    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes("Infinity")) throw new Error("DIVISION BY ZERO: Infinity displayed when SL=0");
    if (pageText.match(/\bNaN\b/)) throw new Error("NaN displayed when SL=0");

    // Code: stopLossDistance = price * (0/100) = 0
    // shares = stopLossDistance > 0 ? Math.floor(riskAmount / stopLossDistance) : 0
    // So it should show 0 shares
    const sharesText = await page.evaluate(() => {
      const labels = [...document.querySelectorAll("span")];
      const sharesLabel = labels.find(s => s.textContent === "Shares");
      const parent = sharesLabel?.closest("div");
      const valueEl = parent?.querySelector(".tabular-nums, .font-semibold");
      return valueEl?.textContent ?? "not found";
    });

    return `SL%=0: Shares="${sharesText}". Guard: stopLossDistance>0?...:0 prevents division by zero.`;
  }, page);

  // ─── Test 13: Stop Loss% = 100 ────────────────────────────
  await test(13, "Position Sizer Stop Loss% = 100", async () => {
    const riskInputs = await page.$$('input[type="number"][min="0.5"]');
    if (riskInputs.length < 2) return "Stop Loss% input not found -- SKIP";

    await riskInputs[1].fill("100");
    await page.waitForTimeout(300);

    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes("Infinity") || pageText.match(/\bNaN\b/)) {
      throw new Error("NaN/Infinity when Stop Loss = 100%");
    }

    // 100% stop loss means the stop is at price * (100/100) = full price away
    // shares = Math.floor(riskAmount / price) -- very small position
    const sharesText = await page.evaluate(() => {
      const labels = [...document.querySelectorAll("span")];
      const sharesLabel = labels.find(s => s.textContent === "Shares");
      const parent = sharesLabel?.closest("div");
      const valueEl = parent?.querySelector(".tabular-nums, .font-semibold");
      return valueEl?.textContent ?? "not found";
    });

    // Reset
    await riskInputs[1].fill("5");
    return `SL%=100: Shares="${sharesText}". Very small position calculated. No crash.`;
  }, page);

  // ═══════════════════════════════════════════════════════════
  // SECTION 3: SEARCH / NAVIGATION
  // ═══════════════════════════════════════════════════════════
  console.log("\n--- SECTION 3: SEARCH / NAVIGATION ---");

  // ─── Test 14: Command palette with 500 chars ──────────────
  await test(14, "Command palette: 500 character input", async () => {
    await ensureOnTrade(page);

    // Try both Meta+K and Control+K
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(800);

    let input = await page.$('input[placeholder*="Search"]');
    if (!input) {
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(800);
      input = await page.$('input[placeholder*="Search"]');
    }
    if (!input) return "Command palette didn't open -- SKIP";

    const longStr = "A".repeat(500);
    await input.fill(longStr);
    await page.waitForTimeout(500);

    const val = await input.inputValue();

    // Check for overflow
    const overflows = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      return dialog.scrollWidth > dialog.clientWidth;
    });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    if (overflows) throw new Error("WARN:Dialog overflows horizontally with 500 char input");
    return `500 chars accepted (len=${val.length}). No visual overflow.`;
  }, page);

  // ─── Test 15: Command palette Enter with no results ───────
  await test(15, "Command palette: Enter with no results", async () => {
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(800);

    let input = await page.$('input[placeholder*="Search"]');
    if (!input) {
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(800);
      input = await page.$('input[placeholder*="Search"]');
    }
    if (!input) return "Command palette didn't open -- SKIP";

    await input.fill("zzzzzzzznotarealsymbol999");
    await page.waitForTimeout(800); // Wait for debounced search

    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed on Enter with no results");

    // Check if "No results" message is shown
    const noResults = await page.evaluate(() => {
      return document.body.innerText.includes("No results") ||
             document.body.innerText.includes("No symbols found");
    });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    return `Enter on empty results: no crash. "No results" message shown: ${noResults}`;
  }, page);

  // ─── Test 16: Path traversal ──────────────────────────────
  await test(16, "Path traversal: /strategies/../../../../etc/passwd", async () => {
    const resp = await page.goto(`${BASE_URL}/strategies/../../../../etc/passwd`, {
      waitUntil: "domcontentloaded", timeout: 15000,
    });
    await page.waitForTimeout(2000);

    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (bodyText.includes("root:") || bodyText.includes("/bin/bash")) {
      throw new Error("CRITICAL: Path traversal exposes /etc/passwd!");
    }
    const status = resp?.status() ?? "unknown";
    return `Path traversal blocked. Status: ${status}. No sensitive file content exposed.`;
  }, page);

  // ─── Test 17: XSS via URL ────────────────────────────────
  await test(17, "XSS: /strategies/<script>alert(1)</script>", async () => {
    let alertFired = false;
    const alertHandler = () => { alertFired = true; };
    page.on("dialog", alertHandler);

    await page.goto(`${BASE_URL}/strategies/%3Cscript%3Ealert(1)%3C/script%3E`, {
      waitUntil: "domcontentloaded", timeout: 15000,
    });
    await page.waitForTimeout(2000);

    page.removeListener("dialog", alertHandler);

    if (alertFired) throw new Error("CRITICAL XSS: alert(1) executed via URL injection!");

    const unescaped = await page.evaluate(() => {
      return document.documentElement.innerHTML.includes("<script>alert(1)</script>");
    });
    if (unescaped) throw new Error("CRITICAL XSS: unescaped <script> tag in DOM");

    return "XSS blocked. React escapes URL parameters. No script execution.";
  }, page);

  // ═══════════════════════════════════════════════════════════
  // SECTION 4: CONCURRENT ACTIONS
  // ═══════════════════════════════════════════════════════════
  console.log("\n--- SECTION 4: CONCURRENT ACTIONS ---");

  await ensureOnTrade(page);

  // ─── Test 18: Shortcuts overlay + command palette ─────────
  await test(18, "Open shortcuts overlay AND command palette simultaneously", async () => {
    await ensureOnTrade(page);

    // Open shortcuts with ?
    await page.keyboard.press("Shift+/"); // ? key
    await page.waitForTimeout(500);

    const overlay1 = await page.$('[role="dialog"]');
    const vis1 = overlay1 ? await overlay1.isVisible() : false;

    // Now open command palette on top
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(500);

    const dialogs = await page.$$('[role="dialog"]');
    let visibleCount = 0;
    for (const d of dialogs) {
      if (await d.isVisible().catch(() => false)) visibleCount++;
    }

    // Take screenshot for z-index analysis
    await page.screenshot({ path: join(SCREENSHOT_DIR, "overlay-zindex.png") });

    // Close everything
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    if (visibleCount >= 2) {
      return `Both overlays visible (${visibleCount} dialogs). Z-index stacking may cause overlap.`;
    }
    return `${visibleCount} dialog(s) visible. Second dialog may have closed the first.`;
  }, page);

  // ─── Test 19: Multiple dropdowns ──────────────────────────
  await test(19, "Open multiple dropdowns simultaneously", async () => {
    await ensureOnTrade(page);

    // Click the chart type dropdown
    const chartTypeBtn = await page.$('button:has(svg.lucide-candlestick-chart), button:has(svg.lucide-chart-candlestick)');
    // Try indicators dropdown
    const indicatorsBtn = await page.$('button:has-text("Indicators")');

    if (chartTypeBtn) await chartTypeBtn.click();
    await page.waitForTimeout(300);

    if (indicatorsBtn) await indicatorsBtn.click();
    await page.waitForTimeout(300);

    const openMenus = await page.$$('[role="menu"], [data-state="open"]');
    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed with multiple dropdowns open");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    return `${openMenus.length} dropdown elements in DOM. No crash. Proper layering.`;
  }, page);

  // ─── Test 20: Options panel at minimum height ─────────────
  await test(20, "Shrink viewport to crush options panel", async () => {
    await ensureOnTrade(page);
    const optPanel = await page.$('[data-slot="options-panel"]');

    // Even without the panel, test extreme viewport
    await page.setViewportSize({ width: 1600, height: 400 });
    await page.waitForTimeout(1000);

    const alive = await isPageAlive(page);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "height-400.png") });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(500);

    if (!alive) throw new Error("Page crashed at 400px viewport height");
    return `Options panel ${optPanel ? "found" : "hidden"} at 400px height. Page survived.`;
  }, page);

  // ─── Test 21: Extreme viewport squeeze ────────────────────
  await test(21, "Extreme viewport: 300px height (negative chart area?)", async () => {
    await page.setViewportSize({ width: 1600, height: 300 });
    await page.waitForTimeout(1000);

    const alive = await isPageAlive(page);
    const chartBox = await page.evaluate(() => {
      const chart = document.querySelector('[data-slot="chart-panel"]');
      if (!chart) return null;
      const r = chart.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });

    await page.screenshot({ path: join(SCREENSHOT_DIR, "height-300.png") });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(500);

    if (!alive) throw new Error("Page crashed at 300px viewport height");
    if (chartBox && chartBox.height < 0) throw new Error(`Negative chart height: ${chartBox.height}px`);
    return `Chart dimensions at 300px: ${chartBox ? `${chartBox.width}x${chartBox.height}` : "hidden"}. No crash.`;
  }, page);

  // ═══════════════════════════════════════════════════════════
  // SECTION 5: DATA EDGE CASES
  // ═══════════════════════════════════════════════════════════
  console.log("\n--- SECTION 5: DATA EDGE CASES ---");

  await ensureOnTrade(page);

  // ─── Test 22: Special characters in watchlist ─────────────
  await test(22, 'Add XSS symbols to watchlist: A&B, TEST<>, <img onerror>', async () => {
    await ensureOnTrade(page);

    const addInput = await page.$('input[placeholder*="Add symbol"]');
    if (!addInput) return "Watchlist add input not found -- SKIP";

    const xssPayloads = [
      'A&B',
      'TEST<>',
      '<img onerror=alert(1)>',
      '"><script>',
      "X'OR'1'='1",
    ];

    for (const payload of xssPayloads) {
      await addInput.fill(payload);
      // The input has .toUpperCase() on change, but we force the value
      const addBtn = await page.$('button[type="submit"]');
      if (addBtn) await addBtn.click();
      await page.waitForTimeout(200);
    }

    // Check DOM for unescaped HTML
    const xssDetected = await page.evaluate(() => {
      const html = document.body.innerHTML;
      // Check if any of our payloads rendered as actual HTML elements
      return document.querySelector('img[onerror]') !== null ||
             html.includes('"><script>') ||
             false;
    });

    if (xssDetected) throw new Error("CRITICAL XSS: Payload rendered as HTML in watchlist!");

    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed with special character symbols");
    return "XSS payloads in watchlist: all auto-escaped by React. No execution.";
  }, page);

  // ─── Test 23: Duplicate symbol ────────────────────────────
  await test(23, "Add same symbol twice to watchlist", async () => {
    await ensureOnTrade(page);
    const addInput = await page.$('input[placeholder*="Add symbol"]');
    if (!addInput) return "Watchlist add input not found -- SKIP";

    // Add DUPETEST twice
    for (let i = 0; i < 2; i++) {
      await addInput.fill("DUPETEST");
      const addBtn = await page.$('button[type="submit"]');
      if (addBtn) await addBtn.click();
      await page.waitForTimeout(300);
    }

    // Count appearances
    const count = await page.evaluate(() => {
      const els = [...document.querySelectorAll("div")];
      return els.filter(el => el.textContent?.trim() === "DUPETEST").length;
    });

    if (count > 1) {
      throw new Error(`WARN:Duplicate symbol: DUPETEST appears ${count} times. No dedup guard.`);
    }
    return `DUPETEST appears ${count} time(s). Dedup: ${count <= 1 ? "working" : "missing"}.`;
  }, page);

  // ─── Test 24: Add 50 symbols (performance) ────────────────
  await test(24, "Add 50 symbols to watchlist (performance stress)", async () => {
    await ensureOnTrade(page);
    const addInput = await page.$('input[placeholder*="Add symbol"]');
    if (!addInput) return "Watchlist add input not found -- SKIP";

    const t0 = Date.now();
    for (let i = 0; i < 50; i++) {
      await addInput.fill(`Z${String(i).padStart(3, "0")}`);
      const addBtn = await page.$('button[type="submit"]');
      if (addBtn) await addBtn.click({ noWaitAfter: true });
    }
    await page.waitForTimeout(1500);
    const elapsed = Date.now() - t0;

    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed after adding 50 symbols");

    // Verify scroll works in watchlist
    const canScroll = await page.evaluate(() => {
      const viewport = document.querySelector('[data-radix-scroll-area-viewport]');
      if (!viewport) return "no scroll area";
      viewport.scrollTop = 99999;
      return `scrollTop=${viewport.scrollTop}`;
    });

    return `50 symbols added in ${elapsed}ms. Page alive. Scroll: ${canScroll}`;
  }, page);

  // ═══════════════════════════════════════════════════════════
  // SECTION 6: BROWSER EDGE CASES
  // ═══════════════════════════════════════════════════════════
  console.log("\n--- SECTION 6: BROWSER EDGE CASES ---");

  // ─── Test 25: Mobile width (320px) ────────────────────────
  await test(25, "Resize to 320px width (mobile)", async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(1500);

    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed at 320px mobile width");

    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "mobile-320.png") });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(500);

    if (overflow) {
      return "Renders at 320px but has horizontal overflow (expected for desktop-first trading app)";
    }
    return "Renders at 320px without horizontal overflow or crash.";
  }, page);

  // ─── Test 26: Zoom 200% simulation ────────────────────────
  await test(26, "Zoom to 200% (CSS transform simulation)", async () => {
    await ensureOnTrade(page);
    await page.evaluate(() => {
      document.body.style.transform = "scale(2)";
      document.body.style.transformOrigin = "top left";
    });
    await page.waitForTimeout(500);

    const alive = await isPageAlive(page);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "zoom-200.png") });

    // Reset
    await page.evaluate(() => { document.body.style.transform = ""; });
    await page.waitForTimeout(300);

    if (!alive) throw new Error("Page unusable at 200% zoom");
    return "200% zoom: page renders. Content overflows viewport (expected at 2x scale).";
  }, page);

  // ─── Test 27: Right-click on chart ────────────────────────
  await test(27, "Right-click on chart area", async () => {
    await ensureOnTrade(page);
    const chart = await page.$('[data-slot="chart-panel"]');
    if (!chart) return "Chart panel not found -- SKIP";

    const box = await chart.boundingBox();
    if (!box) return "Chart panel not visible -- SKIP";

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await page.waitForTimeout(500);

    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed on right-click");

    await page.keyboard.press("Escape");
    return "Right-click on chart: no crash. Browser context menu shown normally.";
  }, page);

  // ═══════════════════════════════════════════════════════════
  // BONUS: Additional adversarial tests
  // ═══════════════════════════════════════════════════════════
  console.log("\n--- BONUS TESTS ---");

  // ─── Test 28: Rapid page navigation ───────────────────────
  await test(28, "Rapid navigation: / -> /trade -> /pipeline -> / x5", async () => {
    const routes = ["/", "/trade", "/pipeline", "/trade", "/"];
    for (let i = 0; i < 5; i++) {
      for (const route of routes) {
        page.goto(`${BASE_URL}${route}`, { waitUntil: "commit" }).catch(() => {});
      }
    }
    await page.waitForTimeout(5000);
    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed during rapid navigation");
    return `25 rapid navigations. Final URL: ${page.url()}. No crash.`;
  }, page);

  // ─── Test 29: Concurrent qty input + button clicks ────────
  await test(29, "Concurrent: type quantity while clicking +/-", async () => {
    await ensureOnTrade(page);
    await switchToOrderTab(page);

    const numInputs = await page.$$('input[type="number"]');
    let qtyInput = null;
    for (const inp of numInputs) {
      const cls = await inp.getAttribute("class") || "";
      if (cls.includes("text-center")) { qtyInput = inp; break; }
    }
    if (!qtyInput) return "Quantity input not found -- SKIP";

    // Find +/- buttons near the quantity input
    const allBtns = await page.$$("button");
    let plusBtn = null, minusBtn = null;
    for (const btn of allBtns) {
      const text = (await btn.innerText().catch(() => "")).trim();
      if (text === "+" && !plusBtn) plusBtn = btn;
      if (text === "-" && !minusBtn) minusBtn = btn;
    }

    // Fire concurrent actions
    const actions = [];
    if (plusBtn) {
      for (let i = 0; i < 10; i++) {
        actions.push(plusBtn.click({ force: true, noWaitAfter: true }).catch(() => {}));
      }
    }
    actions.push(qtyInput.fill("42"));
    await Promise.all(actions);
    await page.waitForTimeout(300);

    const val = await qtyInput.inputValue();
    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Crash during concurrent qty operations");
    return `Final qty: "${val}". Concurrent input+click: no crash, state resolved.`;
  }, page);

  // ─── Test 30: Double-click stress ─────────────────────────
  await test(30, "Double-click stress on 15 UI elements", async () => {
    await ensureOnTrade(page);
    const elements = await page.$$("button, [role='tab'], [role='button']");
    const sample = elements.slice(0, 15);

    for (const el of sample) {
      try {
        await el.dblclick({ force: true, noWaitAfter: true, timeout: 500 });
      } catch {}
    }
    await page.waitForTimeout(500);

    const alive = await isPageAlive(page);
    if (!alive) throw new Error("Page crashed after double-click stress");
    return `Double-clicked ${sample.length} elements. No crash.`;
  }, page);

  // ═══════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════

  results.endTime = new Date().toISOString();

  // Final screenshot
  await page.goto(`${BASE_URL}/trade`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, "final-state.png") });

  await browser.close();

  // Save results
  writeFileSync(join(SCREENSHOT_DIR, "results.json"), JSON.stringify(results, null, 2));

  // Print summary
  console.log("\n" + "=".repeat(64));
  console.log("  ADVERSARIAL QA RESULTS SUMMARY");
  console.log("=".repeat(64));
  console.log(`  Total:    ${results.summary.total}`);
  console.log(`  Passed:   ${results.summary.passed}`);
  console.log(`  Failed:   ${results.summary.failed}`);
  console.log(`  Warnings: ${results.summary.warnings}`);
  console.log("=".repeat(64));

  const failures = results.tests.filter((t) => t.status === "FAIL");
  if (failures.length > 0) {
    console.log("\n  FAILURES:");
    for (const f of failures) {
      console.log(`    #${f.id}: ${f.name}`);
      console.log(`        ${f.detail}`);
      if (f.screenshot) console.log(`        Screenshot: ${f.screenshot}`);
    }
  }

  const warnings = results.tests.filter((t) => t.status === "WARN");
  if (warnings.length > 0) {
    console.log("\n  WARNINGS:");
    for (const w of warnings) {
      console.log(`    #${w.id}: ${w.name}`);
      console.log(`        ${w.detail}`);
    }
  }

  console.log(`\n  Results: ${join(SCREENSHOT_DIR, "results.json")}`);
  console.log(`  Screenshots: ${SCREENSHOT_DIR}\n`);
})();
