import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE = "https://tradingalpha.net";
const SCREENSHOT_DIR = "./qa-screenshots";
const PASSWORD = getQaPassword();

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });

  // 1. Screenshot the login page
  const loginPage = await context.newPage();
  await loginPage.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await loginPage.waitForTimeout(1000);
  await loginPage.screenshot({ path: `${SCREENSHOT_DIR}/01-login.png`, fullPage: true });
  console.log("Captured: login page");

  // 2. Log in via the UI
  await loginPage.fill('input[placeholder="admin"]', QA_USERNAME);
  await loginPage.fill('input[type="password"]', PASSWORD);
  await loginPage.waitForTimeout(500);
  await loginPage.screenshot({ path: `${SCREENSHOT_DIR}/01b-login-filled.png`, fullPage: true });
  console.log("Captured: login filled");

  await loginPage.click('button[type="submit"]');
  await loginPage.waitForTimeout(3000);
  await loginPage.screenshot({ path: `${SCREENSHOT_DIR}/01c-after-login.png`, fullPage: true });
  console.log("Captured: after login attempt (url:", loginPage.url(), ")");

  // 3. Screenshot dashboard
  const dashPage = await context.newPage();
  const dashErrors = [];
  dashPage.on("console", (msg) => {
    if (msg.type() === "error") dashErrors.push(msg.text());
  });
  const dashNetworkFails = [];
  dashPage.on("requestfailed", (req) => {
    dashNetworkFails.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });
  try {
    await dashPage.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
    await dashPage.waitForTimeout(3000);
    await dashPage.screenshot({ path: `${SCREENSHOT_DIR}/02-dashboard.png`, fullPage: true });
    console.log("Captured: dashboard");
  } catch (e) {
    console.log("Dashboard error:", e.message);
    await dashPage.screenshot({ path: `${SCREENSHOT_DIR}/02-dashboard-error.png` });
  }
  if (dashErrors.length) {
    writeFileSync(`${SCREENSHOT_DIR}/02-dashboard-errors.txt`, dashErrors.join("\n"));
    console.log(`  Dashboard errors: ${dashErrors.length}`);
  }
  if (dashNetworkFails.length) {
    writeFileSync(`${SCREENSHOT_DIR}/02-dashboard-network-errors.txt`, dashNetworkFails.join("\n"));
    console.log(`  Dashboard network failures: ${dashNetworkFails.length}`);
  }

  // 4. Screenshot trade page
  const tradePage = await context.newPage();
  const tradeErrors = [];
  tradePage.on("console", (msg) => {
    if (msg.type() === "error") tradeErrors.push(msg.text());
  });
  try {
    await tradePage.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
    await tradePage.waitForTimeout(3000);
    await tradePage.screenshot({ path: `${SCREENSHOT_DIR}/03-trade.png`, fullPage: true });
    console.log("Captured: trade page");
  } catch (e) {
    console.log("Trade page error:", e.message);
    await tradePage.screenshot({ path: `${SCREENSHOT_DIR}/03-trade-error.png` });
  }
  if (tradeErrors.length) {
    writeFileSync(`${SCREENSHOT_DIR}/03-trade-errors.txt`, tradeErrors.join("\n"));
    console.log(`  Trade errors: ${tradeErrors.length}`);
  }

  // 5. Screenshot pipeline page
  const pipelinePage = await context.newPage();
  const pipelineErrors = [];
  pipelinePage.on("console", (msg) => {
    if (msg.type() === "error") pipelineErrors.push(msg.text());
  });
  try {
    await pipelinePage.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
    await pipelinePage.waitForTimeout(3000);
    await pipelinePage.screenshot({ path: `${SCREENSHOT_DIR}/04-pipeline.png`, fullPage: true });
    console.log("Captured: pipeline page");
  } catch (e) {
    console.log("Pipeline page error:", e.message);
    await pipelinePage.screenshot({ path: `${SCREENSHOT_DIR}/04-pipeline-error.png` });
  }
  if (pipelineErrors.length) {
    writeFileSync(`${SCREENSHOT_DIR}/04-pipeline-errors.txt`, pipelineErrors.join("\n"));
    console.log(`  Pipeline errors: ${pipelineErrors.length}`);
  }

  // 6. Test API endpoints
  console.log("\n--- Testing API Endpoints ---");
  // Get token from cookies
  const cookies = await context.cookies();
  const tokenCookie = cookies.find((c) => c.name === "access_token");
  const headers = tokenCookie
    ? { Authorization: `Bearer ${tokenCookie.value}` }
    : {};

  const endpoints = [
    "/api/v1/portfolio/summary",
    "/api/v1/market/quotes/AAPL",
    "/api/v1/market/bars/AAPL?timeframe=1d&limit=10",
    "/api/v1/pipeline/status",
    "/api/v1/trades/positions",
    "/api/v1/trades/orders",
    "/api/v1/portfolio/greeks",
    "/api/v1/portfolio/calendar",
    "/api/v1/news/market",
    "/api/v1/screener/presets",
  ];

  const apiResults = [];
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${BASE}${ep}`, { headers });
      const body = await res.text();
      const truncBody = body.length > 300 ? body.slice(0, 300) + "..." : body;
      const line = `${res.status} ${ep} -> ${truncBody}`;
      console.log(`  ${line}`);
      apiResults.push(line);
    } catch (e) {
      const line = `FAIL ${ep} -> ${e.message}`;
      console.log(`  ${line}`);
      apiResults.push(line);
    }
  }
  writeFileSync(`${SCREENSHOT_DIR}/api-test-results.txt`, apiResults.join("\n\n"));

  await browser.close();
  console.log("\nDone! Screenshots saved to", SCREENSHOT_DIR);
}

main().catch(console.error);
