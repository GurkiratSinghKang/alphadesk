import { chromium } from "playwright";
import { mkdirSync } from "fs";

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE = "https://tradingalpha.net";
const DIR = "./qa-screenshots/eval-round3/uiux";
const CREDS = { user: QA_USERNAME, pass: getQaPassword() };

async function main() {
  mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // Full HD viewport
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });

  // --- LOGIN PAGE ---
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/01-login-page.png`, fullPage: true });
  console.log("01 login page");

  // Login
  await page.fill('input[placeholder="admin"]', CREDS.user);
  await page.fill('input[type="password"]', CREDS.pass);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/02-login-filled.png`, fullPage: true });
  console.log("02 login filled");

  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${DIR}/03-dashboard-full.png`, fullPage: true });
  console.log("03 dashboard (url:", page.url(), ")");

  // --- DASHBOARD SECTIONS ---
  // Top area - portfolio hero
  await page.screenshot({ path: `${DIR}/04-dashboard-viewport.png`, fullPage: false });
  console.log("04 dashboard viewport");

  // Scroll to strategy grid area
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/05-dashboard-mid.png`, fullPage: false });
  console.log("05 dashboard mid-section");

  // Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/06-dashboard-bottom.png`, fullPage: true });
  console.log("06 dashboard bottom");

  // Back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  // --- HOVER / INTERACTION STATES ---
  // Hover over strategy cards if they exist
  const stratCards = await page.$$('[class*="strategy"], [class*="Strategy"], [data-testid*="strategy"]');
  if (stratCards.length > 0) {
    await stratCards[0].hover();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/07-strategy-card-hover.png`, fullPage: false });
    console.log("07 strategy card hover");
  }

  // --- TRADE PAGE ---
  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/10-trade-page-full.png`, fullPage: true });
  console.log("10 trade page");
  await page.screenshot({ path: `${DIR}/11-trade-viewport.png`, fullPage: false });
  console.log("11 trade viewport");

  // Scroll trade page
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/12-trade-mid.png`, fullPage: false });
  console.log("12 trade mid");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/13-trade-bottom.png`, fullPage: false });
  console.log("13 trade bottom");

  // Check for trade panel tabs
  const tradeTabs = await page.$$('button[role="tab"], [class*="tab"]');
  console.log(`Found ${tradeTabs.length} tabs on trade page`);
  for (let i = 0; i < Math.min(tradeTabs.length, 6); i++) {
    const text = await tradeTabs[i].textContent();
    console.log(`  Tab ${i}: "${text?.trim()}"`);
    try {
      await tradeTabs[i].click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${DIR}/14-trade-tab-${i}-${text?.trim().replace(/\s+/g, '-').toLowerCase() || i}.png`, fullPage: false });
      console.log(`  Captured tab ${i}`);
    } catch (e) {
      console.log(`  Tab ${i} click failed: ${e.message}`);
    }
  }

  // --- PIPELINE PAGE ---
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/20-pipeline-full.png`, fullPage: true });
  console.log("20 pipeline page");
  await page.screenshot({ path: `${DIR}/21-pipeline-viewport.png`, fullPage: false });
  console.log("21 pipeline viewport");

  // Scroll pipeline
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/22-pipeline-bottom.png`, fullPage: false });
  console.log("22 pipeline bottom");

  // --- STRATEGY DETAIL PAGE ---
  // First find a strategy link on dashboard
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Look for strategy links
  const stratLinks = await page.$$('a[href*="/strategies/"]');
  console.log(`Found ${stratLinks.length} strategy links`);
  if (stratLinks.length > 0) {
    const href = await stratLinks[0].getAttribute("href");
    console.log(`Navigating to strategy: ${href}`);
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${DIR}/30-strategy-detail-full.png`, fullPage: true });
    console.log("30 strategy detail");
    await page.screenshot({ path: `${DIR}/31-strategy-detail-viewport.png`, fullPage: false });
    console.log("31 strategy detail viewport");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/32-strategy-detail-bottom.png`, fullPage: false });
    console.log("32 strategy detail bottom");
  }

  // --- COMMAND PALETTE ---
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  // Try Cmd+K
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${DIR}/40-command-palette.png`, fullPage: false });
  console.log("40 command palette");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // --- PROFILE MENU ---
  const profileBtn = await page.$('[class*="profile"], [class*="Profile"], [class*="avatar"], [class*="Avatar"], button:has(svg[class*="user"]), button:has(span[class*="initials"])');
  if (profileBtn) {
    await profileBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}/41-profile-menu.png`, fullPage: false });
    console.log("41 profile menu");
  }

  // --- TOOLTIPS / HELP ---
  const helpIcons = await page.$$('[class*="help"], [class*="Help"], [data-tooltip], [title]');
  if (helpIcons.length > 0) {
    await helpIcons[0].hover();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}/42-tooltip.png`, fullPage: false });
    console.log("42 tooltip");
  }

  // --- KEYBOARD SHORTCUTS OVERLAY ---
  await page.keyboard.press("?");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${DIR}/43-keyboard-shortcuts.png`, fullPage: false });
  console.log("43 keyboard shortcuts");
  await page.keyboard.press("Escape");

  // --- RESPONSIVE: Tablet ---
  const tabletCtx = await browser.newContext({
    viewport: { width: 768, height: 1024 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });
  const tabletPage = await tabletCtx.newPage();

  // Login on tablet
  await tabletPage.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await tabletPage.waitForTimeout(1000);
  await tabletPage.fill('input[placeholder="admin"]', CREDS.user);
  await tabletPage.fill('input[type="password"]', CREDS.pass);
  await tabletPage.click('button[type="submit"]');
  await tabletPage.waitForTimeout(4000);

  await tabletPage.screenshot({ path: `${DIR}/50-tablet-dashboard.png`, fullPage: true });
  console.log("50 tablet dashboard");

  await tabletPage.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await tabletPage.waitForTimeout(3000);
  await tabletPage.screenshot({ path: `${DIR}/51-tablet-trade.png`, fullPage: true });
  console.log("51 tablet trade");

  await tabletPage.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await tabletPage.waitForTimeout(2000);
  await tabletPage.screenshot({ path: `${DIR}/52-tablet-pipeline.png`, fullPage: true });
  console.log("52 tablet pipeline");

  // --- RESPONSIVE: Mobile ---
  const mobileCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });
  const mobilePage = await mobileCtx.newPage();

  await mobilePage.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await mobilePage.waitForTimeout(1000);
  await mobilePage.screenshot({ path: `${DIR}/55-mobile-login.png`, fullPage: true });
  console.log("55 mobile login");

  await mobilePage.fill('input[placeholder="admin"]', CREDS.user);
  await mobilePage.fill('input[type="password"]', CREDS.pass);
  await mobilePage.click('button[type="submit"]');
  await mobilePage.waitForTimeout(4000);

  await mobilePage.screenshot({ path: `${DIR}/56-mobile-dashboard.png`, fullPage: true });
  console.log("56 mobile dashboard");

  await mobilePage.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await mobilePage.waitForTimeout(3000);
  await mobilePage.screenshot({ path: `${DIR}/57-mobile-trade.png`, fullPage: true });
  console.log("57 mobile trade");

  await mobilePage.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await mobilePage.waitForTimeout(2000);
  await mobilePage.screenshot({ path: `${DIR}/58-mobile-pipeline.png`, fullPage: true });
  console.log("58 mobile pipeline");

  // --- LOADING STATE (capture by intercepting network) ---
  const loadPage = await ctx.newPage();
  // Slow down API responses to capture loading states
  await loadPage.route('**/api/**', async (route) => {
    await new Promise(r => setTimeout(r, 3000));
    await route.continue();
  });
  await loadPage.goto(BASE, { waitUntil: "commit", timeout: 30000 });
  await loadPage.waitForTimeout(800);
  await loadPage.screenshot({ path: `${DIR}/60-loading-state.png`, fullPage: false });
  console.log("60 loading state");

  // --- EMPTY STATE: Try a strategy that doesn't exist ---
  await page.goto(`${BASE}/strategies/nonexistent-id-12345`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${DIR}/61-404-strategy.png`, fullPage: false });
  console.log("61 404/empty strategy");

  // --- STATUS STRIP ---
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  // Crop just the bottom status strip
  const statusStrip = await page.$('[class*="status-strip"], [class*="StatusStrip"], footer, [class*="footer"]');
  if (statusStrip) {
    await statusStrip.screenshot({ path: `${DIR}/62-status-strip.png` });
    console.log("62 status strip");
  }

  // --- TOAST NOTIFICATION ---
  // Try to trigger a toast by some action
  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // --- DARK THEME CONSISTENCY CHECK ---
  // Already in dark mode, take a few more zoomed screenshots
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Capture the sidebar/nav area
  const sidebar = await page.$('nav, [class*="sidebar"], [class*="Sidebar"]');
  if (sidebar) {
    await sidebar.screenshot({ path: `${DIR}/63-sidebar.png` });
    console.log("63 sidebar");
  }

  // Capture topbar
  const topbar = await page.$('header, [class*="topbar"], [class*="TopBar"], [class*="top-bar"]');
  if (topbar) {
    await topbar.screenshot({ path: `${DIR}/64-topbar.png` });
    console.log("64 topbar");
  }

  // Wider viewport for ultra-wide test
  const wideCtx = await browser.newContext({
    viewport: { width: 2560, height: 1440 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });
  const widePage = await wideCtx.newPage();
  await widePage.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await widePage.waitForTimeout(1000);
  await widePage.fill('input[placeholder="admin"]', CREDS.user);
  await widePage.fill('input[type="password"]', CREDS.pass);
  await widePage.click('button[type="submit"]');
  await widePage.waitForTimeout(4000);
  await widePage.screenshot({ path: `${DIR}/70-ultrawide-dashboard.png`, fullPage: false });
  console.log("70 ultrawide dashboard");
  await widePage.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await widePage.waitForTimeout(3000);
  await widePage.screenshot({ path: `${DIR}/71-ultrawide-trade.png`, fullPage: false });
  console.log("71 ultrawide trade");

  await browser.close();
  console.log("\nDone! All screenshots saved to", DIR);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
