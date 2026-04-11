/**
 * AlphaDesk Deep Visual QA Audit - v2
 * Comprehensive pixel-level audit of every page at 1920x1080
 * Captures screenshots, console errors, network failures, text anomalies,
 * and detailed element crops using positional/structural selectors.
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = "https://tradingalpha.net";
const OUTPUT_DIR = "/Users/GK/Downloads/alphadesk/qa-screenshots/deep-audit";
const CREDS = { username: "admin", password: "GK1355$$gk" };
const VIEWPORT = { width: 1920, height: 1080 };

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Global findings accumulator ─────────────────────────────
const findings = {
  generatedAt: new Date().toISOString(),
  viewport: VIEWPORT,
  pages: {},
};

function addFinding(pageId, category, detail) {
  if (!findings.pages[pageId]) {
    findings.pages[pageId] = {
      consoleErrors: [],
      networkFailures: [],
      pageErrors: [],
      textAnomalies: [],
      layoutIssues: [],
      visualIssues: [],
    };
  }
  findings.pages[pageId][category].push(detail);
}

// ─── Text anomaly scanner ────────────────────────────────────
function scanTextForAnomalies(bodyText, pageKey) {
  const lines = bodyText.split("\n");
  const patterns = [
    { regex: /\bNaN\b/g, label: "NaN displayed in text" },
    { regex: /\bundefined\b/gi, label: "undefined displayed in text" },
    { regex: /\bnull\b/gi, label: "null displayed in text" },
    { regex: /\[object Object\]/g, label: "[object Object] displayed" },
    { regex: /Error:/gi, label: "Error message visible" },
    { regex: /loading\.{3,}/gi, label: "Stuck loading indicator" },
    { regex: /\$-?\d+\.\d{3,}/, label: "Currency with excess decimals" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    for (const pat of patterns) {
      const matches = line.match(pat.regex);
      if (matches) {
        addFinding(pageKey, "textAnomalies", {
          line: i + 1,
          text: line.substring(0, 200),
          issue: pat.label,
          matchCount: matches.length,
        });
      }
    }
  }
}

// ─── Advanced layout checker ─────────────────────────────────
async function checkLayoutAdvanced(page, pageKey) {
  const issues = await page.evaluate(() => {
    const results = [];

    // 1. Check for text overflow
    const allEls = document.querySelectorAll("div, span, p, td, th, h1, h2, h3, h4, h5, h6, label, a, button");
    for (const el of allEls) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (style.display === "none" || style.visibility === "hidden") continue;

      // Text overflow (excluding scroll containers)
      if (
        el.scrollWidth > el.clientWidth + 3 &&
        !["auto", "scroll"].includes(style.overflow) &&
        !["auto", "scroll"].includes(style.overflowX) &&
        style.textOverflow !== "ellipsis" &&
        !["BODY", "HTML"].includes(el.tagName)
      ) {
        const text = el.textContent?.trim().substring(0, 120);
        if (text && text.length > 3 && el.children.length < 3) {
          results.push({
            type: "text-overflow",
            tag: el.tagName,
            className: el.className?.toString?.()?.substring(0, 120) || "",
            text,
            overflow: el.scrollWidth - el.clientWidth,
          });
        }
      }
    }

    // 2. Overlapping interactive elements
    const interactiveEls = document.querySelectorAll("button, a[href], input, select, [role='button'], [tabindex]");
    const rects = [];
    for (const el of interactiveEls) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).display === "none") continue;
      rects.push({ rect: r, text: el.textContent?.trim()?.substring(0, 50) || el.tagName });
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].rect, b = rects[j].rect;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          const overlap = (Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          const minArea = Math.min(a.width * a.height, b.width * b.height);
          if (overlap > minArea * 0.4) {
            results.push({
              type: "overlapping-interactive",
              el1: rects[i].text,
              el2: rects[j].text,
              overlapPct: Math.round((overlap / minArea) * 100),
            });
          }
        }
      }
    }

    // 3. Broken images
    const imgs = document.querySelectorAll("img");
    for (const img of imgs) {
      if (!img.complete || img.naturalWidth === 0) {
        results.push({ type: "broken-image", src: img.src?.substring(0, 200), alt: img.alt });
      }
    }

    // 4. Horizontal scroll
    if (document.body.scrollWidth > window.innerWidth + 10) {
      results.push({
        type: "horizontal-scroll",
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
      });
    }

    // 5. Empty visible containers
    const containers = document.querySelectorAll("div, section, article");
    for (const c of containers) {
      const r = c.getBoundingClientRect();
      if (r.height > 80 && r.width > 200) {
        const text = c.textContent?.trim();
        const hasVisibleChildren = c.querySelector("img, svg, canvas, video, iframe");
        if ((!text || text.length < 3) && !hasVisibleChildren) {
          results.push({
            type: "empty-container",
            className: c.className?.toString?.()?.substring(0, 120) || "",
            size: `${Math.round(r.width)}x${Math.round(r.height)}`,
          });
        }
      }
    }

    // 6. Very small text
    const textEls = document.querySelectorAll("p, span, td, th, label, div");
    for (const el of textEls) {
      const text = el.textContent?.trim();
      if (!text || text.length < 5) continue;
      const fontSize = parseFloat(getComputedStyle(el).fontSize);
      if (fontSize > 0 && fontSize < 9) {
        results.push({
          type: "very-small-text",
          fontSize,
          text: text.substring(0, 80),
        });
      }
    }

    return results.slice(0, 60);
  });

  for (const issue of issues) {
    addFinding(pageKey, "layoutIssues", issue);
  }
}

// ─── Coordinate-based crop helper ────────────────────────────
async function cropByCoords(page, coords, filename, description) {
  try {
    await page.screenshot({
      path: path.join(OUTPUT_DIR, filename),
      clip: coords,
    });
    console.log(`    [CROP] ${description} -> ${filename}`);
    return true;
  } catch (err) {
    console.log(`    [CROP FAIL] ${description}: ${err.message.substring(0, 100)}`);
    return false;
  }
}

// ─── Selector-based crop helper (tries multiple) ─────────────
async function cropBySelector(page, selectors, filename, description, pageKey) {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  for (const sel of selectorList) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.screenshot({ path: path.join(OUTPUT_DIR, filename) });
        console.log(`    [CROP] ${description} -> ${filename} (via: ${sel.substring(0, 60)})`);
        return true;
      }
    } catch { /* try next */ }
  }
  console.log(`    [CROP MISS] ${description} - none of ${selectorList.length} selectors matched`);
  addFinding(pageKey, "visualIssues", {
    issue: `Could not crop: ${description}`,
    selectors: selectorList.map(s => s.substring(0, 80)),
  });
  return false;
}

// ─── Data quality checks (specific to trading data) ──────────
function checkTradingDataQuality(bodyText, pageKey) {
  const issues = [];

  // Check for placeholder data markers
  const placeholders = ["--.-", "---", "N/A", "No data", "No trades yet"];
  for (const ph of placeholders) {
    if (bodyText.includes(ph)) {
      issues.push({
        type: "placeholder-data",
        marker: ph,
        context: bodyText.substring(
          Math.max(0, bodyText.indexOf(ph) - 30),
          bodyText.indexOf(ph) + ph.length + 30
        ),
      });
    }
  }

  // Check for $0.00 values that might indicate missing data
  const zeroMatches = bodyText.match(/\$0\.00(?!\d)/g);
  if (zeroMatches && zeroMatches.length > 2) {
    issues.push({
      type: "many-zero-values",
      count: zeroMatches.length,
      note: "Multiple $0.00 values may indicate missing data",
    });
  }

  // Check for +0.00% values
  const zeroPctMatches = bodyText.match(/\+?0\.00%/g);
  if (zeroPctMatches && zeroPctMatches.length > 3) {
    issues.push({
      type: "many-zero-percent",
      count: zeroPctMatches.length,
      note: "Multiple 0.00% returns may indicate strategies not generating data",
    });
  }

  // Check for negative best trade (logical error)
  if (bodyText.includes("BEST TRADE") && bodyText.includes("WORST TRADE")) {
    const bestMatch = bodyText.match(/BEST TRADE\s*\n?\s*(-?\$[\d,.]+)/);
    if (bestMatch && bestMatch[1].startsWith("-")) {
      issues.push({
        type: "data-logic-error",
        detail: `Best trade is negative: ${bestMatch[1]}`,
        note: "Best trade should not have a loss value",
      });
    }
  }

  // Check if best trade = worst trade
  const bestTradeMatch = bodyText.match(/BEST TRADE\s*\n?\s*(-?\$[\d,.]+)\s*\n?\s*(\w+)/);
  const worstTradeMatch = bodyText.match(/WORST TRADE\s*\n?\s*(-?\$[\d,.]+)\s*\n?\s*(\w+)/);
  if (bestTradeMatch && worstTradeMatch && bestTradeMatch[1] === worstTradeMatch[1]) {
    issues.push({
      type: "data-logic-error",
      detail: `Best trade (${bestTradeMatch[1]} ${bestTradeMatch[2]}) equals worst trade (${worstTradeMatch[1]} ${worstTradeMatch[2]})`,
      note: "Likely only one trade exists but labels are misleading",
    });
  }

  for (const issue of issues) {
    addFinding(pageKey, "visualIssues", issue);
  }
}

// ─── TopBar audit ────────────────────────────────────────────
async function auditTopBar(page, pageKey) {
  const topBarIssues = await page.evaluate(() => {
    const issues = [];
    // Check top bar metric displays
    const topBar = document.querySelector("header") || document.querySelector("nav") || document.querySelector("[class*='h-12']");
    if (!topBar) return issues;

    const text = topBar.textContent || "";

    // Check for "---" placeholder in VIX
    if (text.includes("---") || text.includes("--.-")) {
      issues.push({
        type: "topbar-placeholder",
        detail: "TopBar shows placeholder values (--- or --.-)  for metrics",
        text: text.substring(0, 200),
      });
    }

    return issues;
  });

  for (const issue of topBarIssues) {
    addFinding(pageKey, "visualIssues", issue);
  }
}

// ─── Main audit flow ─────────────────────────────────────────
async function runAudit() {
  console.log("========================================");
  console.log("  AlphaDesk Deep Visual QA Audit v2");
  console.log("========================================\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // ─── Global error collectors ─────────────────────────────
  let currentPageKey = "global";

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      addFinding(currentPageKey, "consoleErrors", {
        text: msg.text().substring(0, 500),
        location: msg.location(),
      });
    }
  });

  page.on("requestfailed", (req) => {
    addFinding(currentPageKey, "networkFailures", {
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText ?? "unknown",
    });
  });

  page.on("pageerror", (err) => {
    addFinding(currentPageKey, "pageErrors", {
      message: err.message.substring(0, 500),
      stack: err.stack?.substring(0, 300),
    });
  });

  // ─── Audit helper ─────────────────────────────────────────
  async function auditCurrentPage(pageKey, screenshotFile, waitMs = 3000) {
    currentPageKey = pageKey;
    console.log(`\n-- Auditing: ${pageKey} --`);

    await page.waitForTimeout(waitMs);

    // Full page screenshot
    await page.screenshot({
      path: path.join(OUTPUT_DIR, screenshotFile),
      fullPage: true,
    });
    console.log(`  [SCREENSHOT] ${screenshotFile}`);

    // Body text
    const bodyText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${pageKey}-body-text.txt`), bodyText, "utf-8");
    console.log(`  [TEXT] ${bodyText.length} chars`);

    // Scans
    scanTextForAnomalies(bodyText, pageKey);
    await checkLayoutAdvanced(page, pageKey);
    checkTradingDataQuality(bodyText, pageKey);
    await auditTopBar(page, pageKey);

    console.log(`  [DONE] ${pageKey}`);
    return bodyText;
  }

  // ════════════════════════════════════════════════════════════
  // 1. LOGIN PAGE
  // ════════════════════════════════════════════════════════════
  console.log("\n[1/9] Login page");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await auditCurrentPage("login-before", "01-login-before.png", 2000);

  // ════════════════════════════════════════════════════════════
  // 2. FILL + SUBMIT LOGIN
  // ════════════════════════════════════════════════════════════
  console.log("\n[2/9] Logging in...");
  currentPageKey = "login-action";

  try {
    await page.fill('input[name="username"], input[type="text"]', CREDS.username);
  } catch {
    const inputs = page.locator("input");
    if (await inputs.count() >= 2) await inputs.nth(0).fill(CREDS.username);
  }

  try {
    await page.fill('input[name="password"], input[type="password"]', CREDS.password);
  } catch {
    await page.locator('input[type="password"]').first().fill(CREDS.password);
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, "02-login-filled.png"), fullPage: true });

  try {
    await page.click('button[type="submit"], button:has-text("Sign")');
  } catch {
    await page.keyboard.press("Enter");
  }

  await page.waitForURL("**/", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "03-login-after.png"), fullPage: true });
  console.log("  [LOGIN] Completed");

  // ════════════════════════════════════════════════════════════
  // 3. DASHBOARD
  // ════════════════════════════════════════════════════════════
  console.log("\n[3/9] Dashboard");
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);
  const dashText = await auditCurrentPage("dashboard", "04-dashboard-full.png", 2000);

  // Dashboard crops using structural selectors from the DOM
  console.log("  Capturing dashboard crops...");

  // The dashboard layout is: ScrollArea > div.mx-auto > [PortfolioHero, grid(ActivityFeed+Positions+Calendar | StrategyGrid), MarketContext]
  // PortfolioHero is the first direct child
  await cropBySelector(page,
    ['.mx-auto.max-w-\\[1800px\\] > div:first-child',
     '.space-y-4 > div:first-child',
     'div:has(> .text-3xl)'],
    "04a-dashboard-hero.png", "Portfolio Hero", "dashboard"
  );

  // Strategy Grid area: right column (lg:col-span-2) inside the grid
  await cropBySelector(page,
    ['.lg\\:col-span-2',
     'div:has(> div:has-text("Strategies"))'],
    "04b-dashboard-strategies.png", "Strategy Cards Grid", "dashboard"
  );

  // Activity Feed: left column (lg:col-span-3)
  await cropBySelector(page,
    ['.lg\\:col-span-3',
     'div:has(> div:has-text("Activity Feed"))'],
    "04c-dashboard-activity-area.png", "Activity Feed + Positions + Calendar", "dashboard"
  );

  // Positions area - find "Open Positions" heading
  await cropBySelector(page,
    ['div:has(> div:has-text("Open Positions"))',
     'div:has-text("MRK") >> xpath=ancestor::div[contains(@class,"rounded")]'],
    "04d-dashboard-positions.png", "Open Positions", "dashboard"
  );

  // P&L Calendar
  await cropBySelector(page,
    ['div:has(> div:has-text("April P&L"))',
     'div:has-text("April P&L") >> xpath=..'],
    "04e-dashboard-pnl-calendar.png", "P&L Calendar", "dashboard"
  );

  // Market Context (bottom section) - crop by coordinates from known layout
  // The Market Context section starts at about y=998 per our layout data
  const dashHeight = await page.evaluate(() => document.body.scrollHeight);
  await cropByCoords(page,
    { x: 60, y: Math.max(950, dashHeight - 300), width: 1800, height: 280 },
    "04f-dashboard-market-context.png", "Market Context (bottom)"
  );

  // Scroll to bottom for viewport shot
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "04g-dashboard-bottom-viewport.png"), fullPage: false });
  console.log("  [SCREENSHOT] 04g-dashboard-bottom-viewport.png");
  await page.evaluate(() => window.scrollTo(0, 0));

  // ════════════════════════════════════════════════════════════
  // 4. TRADE PAGE (SPY)
  // ════════════════════════════════════════════════════════════
  console.log("\n[4/9] Trade page (SPY)");
  await page.goto(`${BASE_URL}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(6000);
  await auditCurrentPage("trade-spy", "05-trade-spy-full.png", 2000);

  // Trade page uses absolute positioning, so we crop by coordinates
  // Layout: Watchlist(left, 240px) | Chart(center) | Analysis(right, 300px)
  //         Options(bottom-left, full-380px) | TradePanel(bottom-right, 380px)
  // Top row height = vh-48-260, bottom = 260px
  const topRowH = 1080 - 48 - 260; // 772
  const bottomY = 48 + topRowH;    // 820

  console.log("  Capturing trade page crops...");

  // Watchlist (left, 0-240px, top row)
  await cropByCoords(page,
    { x: 0, y: 48, width: 240, height: topRowH },
    "05a-trade-watchlist.png", "Watchlist (left)"
  );

  // Analysis panel (right, 1620-1920px, top row)
  await cropByCoords(page,
    { x: 1620, y: 48, width: 300, height: topRowH },
    "05b-trade-analysis.png", "Analysis Panel (right)"
  );

  // Options chain (bottom-left)
  await cropByCoords(page,
    { x: 0, y: bottomY, width: 1540, height: 260 },
    "05c-trade-options.png", "Options Chain (bottom)"
  );

  // Trade/order panel (bottom-right)
  await cropByCoords(page,
    { x: 1540, y: bottomY, width: 380, height: 260 },
    "05d-trade-order-panel.png", "Trade Panel (bottom-right)"
  );

  // Chart area (center)
  await cropByCoords(page,
    { x: 240, y: 48, width: 1380, height: topRowH },
    "05e-trade-chart.png", "Chart (center)"
  );

  // ════════════════════════════════════════════════════════════
  // 5. TRADE PAGE - AAPL
  // ════════════════════════════════════════════════════════════
  console.log("\n[5/9] Trade page (AAPL)");
  currentPageKey = "trade-aapl";

  let aaplClicked = false;
  for (const sel of ['text=AAPL', 'div:has-text("AAPL")', 'span:has-text("AAPL")']) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        aaplClicked = true;
        console.log(`  Clicked AAPL via: ${sel}`);
        break;
      }
    } catch { /* next */ }
  }

  if (aaplClicked) await page.waitForTimeout(5000);
  await auditCurrentPage("trade-aapl", "06-trade-aapl-full.png", 2000);

  // AAPL-specific crops
  await cropByCoords(page,
    { x: 1620, y: 48, width: 300, height: topRowH },
    "06a-trade-aapl-analysis.png", "AAPL Analysis Panel"
  );
  await cropByCoords(page,
    { x: 0, y: bottomY, width: 1540, height: 260 },
    "06b-trade-aapl-options.png", "AAPL Options Chain"
  );

  // ════════════════════════════════════════════════════════════
  // 6. PIPELINE
  // ════════════════════════════════════════════════════════════
  console.log("\n[6/9] Pipeline");
  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);
  await auditCurrentPage("pipeline", "07-pipeline-full.png", 2000);

  // Try expanding collapse sections
  try {
    const expandBtns = page.locator('button:has(svg)');
    const count = await expandBtns.count();
    for (let i = 0; i < Math.min(count, 8); i++) {
      try {
        const btn = expandBtns.nth(i);
        const text = await btn.textContent();
        if (text?.includes("expand") || text?.includes("Click")) {
          await btn.click();
          await page.waitForTimeout(500);
        }
      } catch { /* skip */ }
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "07b-pipeline-expanded.png"), fullPage: true });
    console.log("  [SCREENSHOT] 07b-pipeline-expanded.png");
  } catch { /* no expand buttons */ }

  // Performance summary crop (bottom of pipeline)
  const pipeHeight = await page.evaluate(() => document.body.scrollHeight);
  await cropByCoords(page,
    { x: 0, y: Math.max(pipeHeight - 200, 400), width: 1920, height: Math.min(200, pipeHeight - 400) },
    "07c-pipeline-performance.png", "Pipeline Performance Summary"
  );

  // ════════════════════════════════════════════════════════════
  // 7. STRATEGY: PEAD
  // ════════════════════════════════════════════════════════════
  console.log("\n[7/9] Strategy: PEAD");
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);
  await auditCurrentPage("strategy-pead", "08-strategy-pead-full.png", 2000);

  // Strategy detail crops: header + chart area
  await cropByCoords(page,
    { x: 260, y: 72, width: 1400, height: 500 },
    "08a-pead-header-chart.png", "PEAD Header + Chart"
  );

  // KPI cards row (below chart)
  await cropByCoords(page,
    { x: 260, y: 530, width: 1400, height: 100 },
    "08b-pead-kpis.png", "PEAD KPI Cards"
  );

  // Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "08c-pead-bottom.png"), fullPage: false });
  console.log("  [SCREENSHOT] 08c-pead-bottom.png");
  await page.evaluate(() => window.scrollTo(0, 0));

  // ════════════════════════════════════════════════════════════
  // 8. STRATEGY: MOMENTUM-QUALITY
  // ════════════════════════════════════════════════════════════
  console.log("\n[8/9] Strategy: Momentum + Quality");
  await page.goto(`${BASE_URL}/strategies/momentum-quality`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);
  await auditCurrentPage("strategy-momq", "09-strategy-momq-full.png", 2000);

  // Header + chart
  await cropByCoords(page,
    { x: 260, y: 72, width: 1400, height: 500 },
    "09a-momq-header-chart.png", "MomQ Header + Chart"
  );

  // Scroll to bottom for full view
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "09b-momq-bottom.png"), fullPage: false });
  console.log("  [SCREENSHOT] 09b-momq-bottom.png");

  // ════════════════════════════════════════════════════════════
  // 9. CROSS-PAGE CONSISTENCY CHECKS
  // ════════════════════════════════════════════════════════════
  console.log("\n[9/9] Cross-page consistency checks");
  currentPageKey = "cross-page";

  // Check that topbar P&L is consistent across pages
  const topBarChecks = [];
  for (const route of ["/", "/trade", "/pipeline", "/strategies/pead"]) {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2000);
    const topBarText = await page.evaluate(() => {
      // Get the first 48px of page content (topbar)
      const els = document.elementsFromPoint(400, 24);
      return els.map(e => e.textContent?.trim()).filter(Boolean).join(" | ").substring(0, 300);
    });
    topBarChecks.push({ route, text: topBarText });
  }

  // Check consistency
  const pnlValues = topBarChecks.map(t => {
    const m = t.text.match(/-?\$[\d,.]+/);
    return m ? m[0] : "not found";
  });
  const uniquePnl = [...new Set(pnlValues)];
  if (uniquePnl.length > 1) {
    addFinding("cross-page", "visualIssues", {
      type: "inconsistent-topbar",
      detail: "P&L value differs across pages",
      values: topBarChecks.map(t => ({ route: t.route, pnl: pnlValues[topBarChecks.indexOf(t)] })),
    });
  }

  // ════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ════════════════════════════════════════════════════════════
  console.log("\n\n========================================");
  console.log("  AUDIT COMPLETE - Summary");
  console.log("========================================\n");

  let totalIssues = 0;
  for (const [pageKey, pageFindings] of Object.entries(findings.pages)) {
    const counts = {};
    let pageTotal = 0;
    for (const [cat, items] of Object.entries(pageFindings)) {
      if (items.length > 0) {
        counts[cat] = items.length;
        pageTotal += items.length;
      }
    }
    if (pageTotal > 0) {
      console.log(`  ${pageKey}: ${pageTotal} issues`);
      for (const [cat, count] of Object.entries(counts)) {
        console.log(`    - ${cat}: ${count}`);
      }
    } else {
      console.log(`  ${pageKey}: CLEAN`);
    }
    totalIssues += pageTotal;
  }

  console.log(`\n  TOTAL ISSUES: ${totalIssues}`);

  // Write findings
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "findings.json"),
    JSON.stringify(findings, null, 2),
    "utf-8"
  );
  console.log(`\n  Saved: ${OUTPUT_DIR}/findings.json`);

  // Write human-readable summary
  let report = `# AlphaDesk Visual Audit Report\n`;
  report += `Generated: ${findings.generatedAt}\n`;
  report += `Viewport: ${VIEWPORT.width}x${VIEWPORT.height}\n`;
  report += `Total issues: ${totalIssues}\n\n`;

  for (const [pageKey, data] of Object.entries(findings.pages)) {
    report += `## ${pageKey}\n`;
    for (const [cat, items] of Object.entries(data)) {
      if (items.length > 0) {
        report += `### ${cat} (${items.length})\n`;
        for (const item of items) {
          report += `- ${JSON.stringify(item)}\n`;
        }
        report += `\n`;
      }
    }
    report += `\n`;
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, "audit-report.txt"), report, "utf-8");
  console.log(`  Saved: ${OUTPUT_DIR}/audit-report.txt`);
  console.log(`  Screenshots: ${OUTPUT_DIR}/\n`);

  await browser.close();
}

runAudit().catch((err) => {
  console.error("FATAL:", err);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "findings.json"),
    JSON.stringify({ ...findings, fatalError: err.message }, null, 2),
    "utf-8"
  );
  process.exit(1);
});
