import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";

const BASE = "https://tradingalpha.net";
const DIR = "./qa-screenshots/deep";
const PASSWORD = "GK1355$$gk";

async function main() {
  mkdirSync(DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });

  const allErrors = [];
  const allNetworkFails = [];
  const allWarnings = [];

  // --- Login ---
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") allErrors.push(`[LOGIN] ${msg.text()}`);
    if (msg.type() === "warning") allWarnings.push(`[LOGIN] ${msg.text()}`);
  });
  page.on("requestfailed", (req) => {
    allNetworkFails.push(`[LOGIN] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });
  page.on("pageerror", (err) => allErrors.push(`[LOGIN PAGE_ERROR] ${err.message}`));

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill('input[placeholder="admin"]', "admin");
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  console.log("Logged in, URL:", page.url());

  // --- Dashboard (full inspection) ---
  const dash = await context.newPage();
  dash.on("console", (msg) => {
    if (msg.type() === "error") allErrors.push(`[DASHBOARD] ${msg.text()}`);
    if (msg.type() === "warning") allWarnings.push(`[DASHBOARD] ${msg.text()}`);
  });
  dash.on("requestfailed", (req) => {
    allNetworkFails.push(`[DASHBOARD] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });
  dash.on("pageerror", (err) => allErrors.push(`[DASHBOARD PAGE_ERROR] ${err.message}`));

  await dash.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await dash.waitForTimeout(4000);
  await dash.screenshot({ path: `${DIR}/01-dashboard-full.png`, fullPage: true });

  // Check for empty/error states on dashboard
  const dashInfo = await dash.evaluate(() => {
    const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
    const getAll = (sel) => Array.from(document.querySelectorAll(sel)).map(e => e.textContent?.trim());
    const getVisibility = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return "not found";
      const cs = getComputedStyle(el);
      return cs.display === "none" ? "hidden" : "visible";
    };
    return {
      title: document.title,
      bodyText: document.body.innerText.slice(0, 3000),
      // Check for common error indicators
      errorTexts: getAll('[class*="error"], [class*="Error"], [role="alert"]'),
      emptyStates: getAll('[class*="empty"], [class*="Empty"]'),
      loadingStates: getAll('[class*="loading"], [class*="Loading"], [class*="skeleton"], [class*="Skeleton"]'),
      // Count key elements
      buttons: document.querySelectorAll("button").length,
      links: document.querySelectorAll("a").length,
      images: document.querySelectorAll("img").length,
      svgs: document.querySelectorAll("svg").length,
      // Check strategy cards
      strategyCards: getAll('[class*="strategy"], [class*="Strategy"]'),
      // Check for "NaN", "undefined", "null" displayed
      nanInPage: document.body.innerText.includes("NaN"),
      undefinedInPage: document.body.innerText.includes("undefined"),
      nullInPage: document.body.innerText.match(/\bnull\b/) !== null,
      // Broken images
      brokenImages: Array.from(document.querySelectorAll("img")).filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src),
    };
  });
  writeFileSync(`${DIR}/01-dashboard-info.json`, JSON.stringify(dashInfo, null, 2));
  console.log("Dashboard - NaN:", dashInfo.nanInPage, "undefined:", dashInfo.undefinedInPage, "null:", dashInfo.nullInPage);

  // --- Dashboard sections: scroll and capture ---
  await dash.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await dash.waitForTimeout(1000);
  await dash.screenshot({ path: `${DIR}/01b-dashboard-bottom.png`, fullPage: false });

  // --- Trade page (full inspection) ---
  const trade = await context.newPage();
  trade.on("console", (msg) => {
    if (msg.type() === "error") allErrors.push(`[TRADE] ${msg.text()}`);
    if (msg.type() === "warning") allWarnings.push(`[TRADE] ${msg.text()}`);
  });
  trade.on("requestfailed", (req) => {
    allNetworkFails.push(`[TRADE] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });
  trade.on("pageerror", (err) => allErrors.push(`[TRADE PAGE_ERROR] ${err.message}`));

  await trade.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await trade.waitForTimeout(4000);
  await trade.screenshot({ path: `${DIR}/02-trade-full.png`, fullPage: true });

  const tradeInfo = await trade.evaluate(() => {
    return {
      bodyText: document.body.innerText.slice(0, 3000),
      nanInPage: document.body.innerText.includes("NaN"),
      undefinedInPage: document.body.innerText.includes("undefined"),
      nullInPage: document.body.innerText.match(/\bnull\b/) !== null,
      errorTexts: Array.from(document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"]')).map(e => e.textContent?.trim()),
      // Check chart loaded
      canvasCount: document.querySelectorAll("canvas").length,
      // Check options chain
      tableRows: document.querySelectorAll("table tr, [role='row']").length,
    };
  });
  writeFileSync(`${DIR}/02-trade-info.json`, JSON.stringify(tradeInfo, null, 2));
  console.log("Trade - NaN:", tradeInfo.nanInPage, "undefined:", tradeInfo.undefinedInPage, "canvas:", tradeInfo.canvasCount);

  // --- Trade page: try switching symbols via watchlist ---
  const watchlistItems = await trade.$$('button, [role="button"], a');
  // Try clicking AAPL in the watchlist
  const aaplBtn = await trade.$('text=AAPL');
  if (aaplBtn) {
    await aaplBtn.click();
    await trade.waitForTimeout(3000);
    await trade.screenshot({ path: `${DIR}/02b-trade-aapl.png`, fullPage: true });
    console.log("Clicked AAPL in watchlist");
  }

  // --- Pipeline page (full inspection) ---
  const pipeline = await context.newPage();
  pipeline.on("console", (msg) => {
    if (msg.type() === "error") allErrors.push(`[PIPELINE] ${msg.text()}`);
    if (msg.type() === "warning") allWarnings.push(`[PIPELINE] ${msg.text()}`);
  });
  pipeline.on("requestfailed", (req) => {
    allNetworkFails.push(`[PIPELINE] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });
  pipeline.on("pageerror", (err) => allErrors.push(`[PIPELINE PAGE_ERROR] ${err.message}`));

  await pipeline.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await pipeline.waitForTimeout(4000);
  await pipeline.screenshot({ path: `${DIR}/03-pipeline-full.png`, fullPage: true });

  const pipelineInfo = await pipeline.evaluate(() => {
    return {
      bodyText: document.body.innerText.slice(0, 3000),
      nanInPage: document.body.innerText.includes("NaN"),
      undefinedInPage: document.body.innerText.includes("undefined"),
      nullInPage: document.body.innerText.match(/\bnull\b/) !== null,
      errorTexts: Array.from(document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"]')).map(e => e.textContent?.trim()),
    };
  });
  writeFileSync(`${DIR}/03-pipeline-info.json`, JSON.stringify(pipelineInfo, null, 2));
  console.log("Pipeline - NaN:", pipelineInfo.nanInPage, "undefined:", pipelineInfo.undefinedInPage);

  // --- Strategy detail pages ---
  // Get strategy IDs from the API
  const cookies = await context.cookies();
  const tokenCookie = cookies.find((c) => c.name === "access_token");
  const authHeaders = tokenCookie ? { Authorization: `Bearer ${tokenCookie.value}` } : {};

  let strategies = [];
  try {
    const res = await fetch(`${BASE}/api/v1/strategies/`, { headers: authHeaders });
    strategies = await res.json();
    writeFileSync(`${DIR}/strategies-list.json`, JSON.stringify(strategies, null, 2));
    console.log(`Found ${strategies.length} strategies`);
  } catch (e) {
    console.log("Failed to fetch strategies:", e.message);
  }

  // Visit first 3 strategy detail pages
  for (let i = 0; i < Math.min(strategies.length, 3); i++) {
    const s = strategies[i];
    const sp = await context.newPage();
    sp.on("console", (msg) => {
      if (msg.type() === "error") allErrors.push(`[STRATEGY:${s.name}] ${msg.text()}`);
    });
    sp.on("requestfailed", (req) => {
      allNetworkFails.push(`[STRATEGY:${s.name}] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
    });
    sp.on("pageerror", (err) => allErrors.push(`[STRATEGY:${s.name} PAGE_ERROR] ${err.message}`));

    try {
      await sp.goto(`${BASE}/strategies/${s.id}`, { waitUntil: "networkidle", timeout: 30000 });
      await sp.waitForTimeout(4000);
      await sp.screenshot({ path: `${DIR}/04-strategy-${i + 1}-${s.name.replace(/\s+/g, "_")}.png`, fullPage: true });

      const sInfo = await sp.evaluate(() => {
        return {
          bodyText: document.body.innerText.slice(0, 3000),
          nanInPage: document.body.innerText.includes("NaN"),
          undefinedInPage: document.body.innerText.includes("undefined"),
          nullInPage: document.body.innerText.match(/\bnull\b/) !== null,
          errorTexts: Array.from(document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"]')).map(e => e.textContent?.trim()),
        };
      });
      writeFileSync(`${DIR}/04-strategy-${i + 1}-info.json`, JSON.stringify(sInfo, null, 2));
      console.log(`Strategy "${s.name}" - NaN: ${sInfo.nanInPage}, undefined: ${sInfo.undefinedInPage}`);
    } catch (e) {
      console.log(`Strategy "${s.name}" error:`, e.message);
    }
    await sp.close();
  }

  // --- Test WebSocket ---
  const wsPage = await context.newPage();
  let wsConnected = false;
  let wsMessages = [];
  let wsErrors = [];
  wsPage.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("WebSocket") || text.includes("ws://") || text.includes("wss://")) {
      wsMessages.push(text);
    }
    if (msg.type() === "error") wsErrors.push(text);
  });

  await wsPage.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await wsPage.waitForTimeout(5000);
  writeFileSync(`${DIR}/05-websocket-info.json`, JSON.stringify({ wsMessages, wsErrors }, null, 2));
  console.log("WebSocket messages:", wsMessages.length, "errors:", wsErrors.length);

  // --- Test navigation bar links ---
  const navPage = await context.newPage();
  navPage.on("console", (msg) => {
    if (msg.type() === "error") allErrors.push(`[NAV] ${msg.text()}`);
  });
  await navPage.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await navPage.waitForTimeout(2000);

  const navLinks = await navPage.evaluate(() => {
    return Array.from(document.querySelectorAll("nav a, header a, [role='navigation'] a")).map(a => ({
      text: a.textContent?.trim(),
      href: a.getAttribute("href"),
    }));
  });
  writeFileSync(`${DIR}/06-nav-links.json`, JSON.stringify(navLinks, null, 2));
  console.log("Nav links:", navLinks.map(l => `${l.text}→${l.href}`).join(", "));

  // --- Test API error handling (invalid symbol) ---
  const apiTests = [];
  const badEndpoints = [
    { url: "/api/v1/market/quotes/INVALIDSYMBOL123", desc: "invalid symbol quote" },
    { url: "/api/v1/strategies/nonexistent-id/performance", desc: "invalid strategy" },
    { url: "/api/v1/options/chain/INVALIDSYMBOL123", desc: "invalid options chain" },
  ];
  for (const ep of badEndpoints) {
    try {
      const res = await fetch(`${BASE}${ep.url}`, { headers: authHeaders });
      const body = await res.text();
      apiTests.push({ ...ep, status: res.status, body: body.slice(0, 300) });
    } catch (e) {
      apiTests.push({ ...ep, status: "FAIL", body: e.message });
    }
  }
  writeFileSync(`${DIR}/07-api-error-handling.json`, JSON.stringify(apiTests, null, 2));
  console.log("API error handling:", apiTests.map(t => `${t.desc}:${t.status}`).join(", "));

  // --- Compile final report ---
  const report = {
    timestamp: new Date().toISOString(),
    consoleErrors: allErrors,
    networkFailures: allNetworkFails,
    warnings: allWarnings.slice(0, 20),
    apiErrorTests: apiTests,
    dashboardIssues: {
      nanDisplayed: dashInfo.nanInPage,
      undefinedDisplayed: dashInfo.undefinedInPage,
      nullDisplayed: dashInfo.nullInPage,
      brokenImages: dashInfo.brokenImages,
    },
    tradeIssues: {
      nanDisplayed: tradeInfo.nanInPage,
      undefinedDisplayed: tradeInfo.undefinedInPage,
      nullDisplayed: tradeInfo.nullInPage,
      chartLoaded: tradeInfo.canvasCount > 0,
    },
    pipelineIssues: {
      nanDisplayed: pipelineInfo.nanInPage,
      undefinedDisplayed: pipelineInfo.undefinedInPage,
      nullDisplayed: pipelineInfo.nullInPage,
    },
  };
  writeFileSync(`${DIR}/00-qa-report.json`, JSON.stringify(report, null, 2));

  console.log("\n=== QA REPORT ===");
  console.log(`Console errors: ${allErrors.length}`);
  console.log(`Network failures: ${allNetworkFails.length}`);
  console.log(`Warnings: ${allWarnings.length}`);
  if (allErrors.length) {
    console.log("\nErrors:");
    allErrors.forEach(e => console.log("  ", e));
  }
  if (allNetworkFails.length) {
    console.log("\nNetwork failures:");
    allNetworkFails.forEach(e => console.log("  ", e));
  }

  await browser.close();
  console.log("\nDone! Results saved to", DIR);
}

main().catch(console.error);
