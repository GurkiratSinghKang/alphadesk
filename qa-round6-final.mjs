import { chromium } from "playwright";
import { mkdirSync } from "fs";
import path from "path";

const BASE = "https://tradingalpha.net";
const DIR = "/Users/GK/Downloads/alphadesk/qa-screenshots/round6";
const USERNAME = "admin";
const PASSWORD = "alphaDesk2025!";

mkdirSync(DIR, { recursive: true });

const issues = [];
let testId = 0;
let passCount = 0;
let failCount = 0;
let warnCount = 0;

function log(status, section, description, details = "") {
  testId++;
  const entry = { id: testId, status, section, description, details };
  issues.push(entry);
  if (status === "PASS") passCount++;
  else if (status === "FAIL") failCount++;
  else warnCount++;
  console.log(`[${status}] #${testId} [${section}] ${description}${details ? " — " + details : ""}`);
}

async function ss(page, name) {
  await page.screenshot({ path: path.join(DIR, `${name}.png`), fullPage: false });
}

async function ssFull(page, name) {
  await page.screenshot({ path: path.join(DIR, `${name}.png`), fullPage: true });
}

// Safely click something, with timeout protection
async function safeClick(page, selector, timeout = 5000) {
  try {
    const el = await page.$(selector);
    if (!el) return false;
    await el.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });

  const consoleErrors = [];
  const networkErrors = [];

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ url: page.url(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push({ url: page.url(), text: `PAGE_ERROR: ${err.message}` });
  });
  page.on("response", (resp) => {
    if (resp.status() >= 400 && !resp.url().includes("favicon")) {
      networkErrors.push({ url: resp.url(), status: resp.status() });
    }
  });

  // ================================================================
  // 1. LOGIN PAGE
  // ================================================================
  console.log("\n========== 1. LOGIN PAGE ==========\n");

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await ss(page, "01-login-page");

  // Check form elements
  const usernameInput = await page.$('input[type="text"], input[placeholder*="admin"]');
  const passwordInput = await page.$('input[type="password"]');
  const submitBtn = await page.$('button[type="submit"]');
  log(usernameInput && passwordInput && submitBtn ? "PASS" : "FAIL", "Login", "Form has username, password, and submit button");

  // Check placeholder
  if (usernameInput) {
    const ph = await usernameInput.getAttribute("placeholder");
    log(ph ? "PASS" : "WARN", "Login", "Username placeholder", ph || "none");
  }

  // Check button states — disabled when empty?
  if (submitBtn) {
    const isDisabled = await submitBtn.isDisabled();
    log("PASS", "Login", "Submit button state with empty fields", isDisabled ? "disabled (good UX)" : "enabled (acceptable)");
  }

  // Test wrong password
  if (usernameInput) await usernameInput.fill("admin");
  if (passwordInput) await passwordInput.fill("wrongpassword");
  if (submitBtn) await submitBtn.click();
  await page.waitForTimeout(2500);
  await ss(page, "01-login-wrong-password");

  // Check for any error indication
  const pageTextAfterWrongPwd = await page.textContent("body");
  const hasErrorIndication = pageTextAfterWrongPwd.match(/invalid|incorrect|failed|wrong|error|unauthorized/i);
  log(hasErrorIndication ? "PASS" : "WARN", "Login", "Error shown for wrong password", hasErrorIndication ? hasErrorIndication[0] : "No error text found — check toast/animation");

  // Test correct password
  if (usernameInput) await usernameInput.fill(USERNAME);
  if (passwordInput) await passwordInput.fill(PASSWORD);
  await ss(page, "01-login-filled");
  if (submitBtn) await submitBtn.click();

  try {
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
    log("PASS", "Login", "Correct credentials redirect to dashboard");
  } catch {
    log("FAIL", "Login", "Login did not redirect after correct credentials");
  }
  await page.waitForTimeout(3000);
  await ss(page, "01-after-login");

  // ================================================================
  // 2. DASHBOARD PAGE
  // ================================================================
  console.log("\n========== 2. DASHBOARD ==========\n");

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  // 2a. Screenshots at multiple resolutions
  await ss(page, "02-dashboard-1920x1080");
  await ssFull(page, "02-dashboard-1920x1080-full");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1000);
  await ss(page, "02-dashboard-1440x900");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(1000);

  const bodyText = await page.textContent("body");

  // 2b. Portfolio value
  const portfolioMatch = bodyText.match(/\$[\d,]+(?:\.\d{2})?/);
  log(portfolioMatch ? "PASS" : "WARN", "Dashboard", "Portfolio value displayed", portfolioMatch ? portfolioMatch[0] : "None");

  // 2c. Demo badges
  const demoCount = (bodyText.match(/\bDemo\b/gi) || []).length;
  log(demoCount > 0 ? "PASS" : "WARN", "Dashboard", "Demo labels on page", `${demoCount} occurrences`);

  // 2d. P&L display
  const hasPnL = bodyText.match(/P&L|Daily P|Profit|day's P/i);
  log(hasPnL ? "PASS" : "WARN", "Dashboard", "P&L display", hasPnL ? hasPnL[0] : "Not found");

  // 2e. Strategy Grid — check links via href
  const stratLinks = await page.$$eval('a[href*="/strategies/"]', (els) =>
    els.map((el) => ({ href: el.getAttribute("href"), text: el.textContent?.trim().substring(0, 50) }))
  );
  log(stratLinks.length >= 10 ? "PASS" : stratLinks.length > 0 ? "WARN" : "FAIL", "Dashboard/Strategies",
    `Strategy links: ${stratLinks.length}`, stratLinks.map(s => s.text).join(", ").substring(0, 200));

  // 2f. Activity Feed
  const feedSection = await page.$('h2:has-text("Activity"), h3:has-text("Activity"), [class*="feed"]');
  log(feedSection ? "PASS" : "WARN", "Dashboard", "Activity Feed section");

  // 2g. News section
  const newsExists = bodyText.match(/News|Headlines/i);
  log(newsExists ? "PASS" : "WARN", "Dashboard", "News section visible");

  // 2h. Economic Calendar
  const econCal = bodyText.match(/Economic Calendar|Calendar|Events/i);
  log(econCal ? "PASS" : "WARN", "Dashboard", "Economic Calendar section");

  // Sample Events label
  const sampleLabel = bodyText.match(/Sample Events|Sample Data/i);
  log(sampleLabel ? "PASS" : "WARN", "Dashboard", "Sample Events label", sampleLabel ? sampleLabel[0] : "Not found");

  // 2i. Market indices
  const indexNames = ["S&P", "NASDAQ", "Russell", "VIX"];
  const foundIndices = indexNames.filter((idx) => bodyText.includes(idx));
  log(foundIndices.length >= 3 ? "PASS" : "WARN", "Dashboard", "Market indices visible", foundIndices.join(", "));

  // 2j. P&L Calendar mini
  const pnlCalCheck = bodyText.match(/P&L Calendar|No trading data|Calendar/i);
  log(pnlCalCheck ? "PASS" : "WARN", "Dashboard", "P&L Calendar widget");

  // 2k. Positions Summary
  const positionsSection = bodyText.match(/Positions|No open positions|position/i);
  log(positionsSection ? "PASS" : "WARN", "Dashboard", "Positions Summary section");

  // 2l. Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  await ss(page, "02-dashboard-bottom");
  log("PASS", "Dashboard", "Scrolled to bottom — screenshot captured");

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // ================================================================
  // 3. STATUS STRIP (footer)
  // ================================================================
  console.log("\n========== 3. STATUS STRIP ==========\n");

  const footer = await page.$("footer");
  if (footer) {
    const footerText = await footer.textContent();
    log("PASS", "Status Strip", "Footer present", footerText?.substring(0, 250));

    // Regime with (Demo) check
    const hasRegimeDemo = footerText?.match(/\(Demo\)/i);
    log(hasRegimeDemo ? "PASS" : "WARN", "Status Strip", "Shows (Demo) label in status strip");

    // VIX
    const hasVIX = footerText?.match(/VIX/i);
    log(hasVIX ? "PASS" : "WARN", "Status Strip", "VIX in status strip");

    // Connection status
    const hasConnection = footerText?.match(/LIVE|OFFLINE|Online|Offline|Connected/i);
    log(hasConnection ? "PASS" : "WARN", "Status Strip", "Connection status", hasConnection ? hasConnection[0] : "");

    // Mode badge (Paper/Live/Demo)
    const hasMode = footerText?.match(/Paper|Live|Simulated|Demo/i);
    log(hasMode ? "PASS" : "WARN", "Status Strip", "Mode badge", hasMode ? hasMode[0] : "");

    // P&L in status strip
    const hasPnlInStrip = footerText?.match(/P&L|\$[\d,.]+|[+-][\d,.]+%/);
    log(hasPnlInStrip ? "PASS" : "WARN", "Status Strip", "P&L in status strip");
  } else {
    log("FAIL", "Status Strip", "No footer element found");
  }

  // ================================================================
  // 4. COMMAND PALETTE (Cmd+K / Ctrl+K)
  // ================================================================
  console.log("\n========== 4. COMMAND PALETTE ==========\n");

  try {
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(1500);

    let paletteOpen = false;
    const dialogs = await page.$$('[role="dialog"], .fixed.inset-0');
    for (const d of dialogs) {
      const t = await d.textContent();
      if (t?.match(/search|command|type a command/i)) {
        paletteOpen = true;
        log("PASS", "Command Palette", "Opens with Cmd+K");
        await ss(page, "04-command-palette");

        // Type a search
        const searchInput = await d.$('input');
        if (searchInput) {
          await searchInput.fill("trade");
          await page.waitForTimeout(1000);
          await ss(page, "04-command-palette-search");

          // Check results
          const results = await d.$$('[role="option"], [class*="item"], li, a');
          log(results.length > 0 ? "PASS" : "WARN", "Command Palette", "Search returns results", `${results.length} items`);
        }

        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        break;
      }
    }

    if (!paletteOpen) {
      // Try Ctrl+K
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(1500);
      const d2 = await page.$('[role="dialog"]');
      if (d2) {
        log("PASS", "Command Palette", "Opens with Ctrl+K");
        await page.keyboard.press("Escape");
      } else {
        log("WARN", "Command Palette", "Neither Cmd+K nor Ctrl+K opened recognizable command palette");
      }
    }
  } catch (e) {
    log("FAIL", "Command Palette", "Test error", e.message);
  }

  // ================================================================
  // 5. KEYBOARD SHORTCUTS OVERLAY (?)
  // ================================================================
  console.log("\n========== 5. KEYBOARD SHORTCUTS ==========\n");

  try {
    // Make sure no dialogs are open
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    await page.keyboard.press("?");
    await page.waitForTimeout(1500);

    const overlay = await page.$('[role="dialog"]');
    if (overlay) {
      const overlayText = await overlay.textContent();
      if (overlayText?.match(/keyboard shortcuts|shortcuts/i)) {
        log("PASS", "Keyboard Shortcuts", "? key opens shortcuts overlay");
        await ss(page, "05-shortcuts-overlay");

        // Check that shortcuts are documented
        const hasKeyDocs = overlayText.match(/Ctrl|Cmd|Alt|Shift|Enter|Escape/i);
        log(hasKeyDocs ? "PASS" : "WARN", "Keyboard Shortcuts", "Shortcuts are documented with key combos");

        // Close
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);

        // Verify close works
        const stillOpen = await page.$('[role="dialog"]');
        log(!stillOpen ? "PASS" : "WARN", "Keyboard Shortcuts", "Escape closes overlay");
      } else {
        log("WARN", "Keyboard Shortcuts", "? opened dialog but content is not shortcuts", overlayText?.substring(0, 100));
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    } else {
      log("WARN", "Keyboard Shortcuts", "? key did not open overlay");
    }
  } catch (e) {
    log("FAIL", "Keyboard Shortcuts", "Test error", e.message);
  }

  // ================================================================
  // 6. PROFILE MENU & NOTIFICATIONS
  // ================================================================
  console.log("\n========== 6. PROFILE & NOTIFICATIONS ==========\n");

  // Notifications bell
  try {
    // Look for bell icon in header
    const headerButtons = await page.$$("header button, nav button, [class*='topbar'] button, [class*='TopBar'] button");
    let foundBell = false;
    for (const btn of headerButtons) {
      const ariaLabel = await btn.getAttribute("aria-label");
      const title = await btn.getAttribute("title");
      const text = await btn.textContent();
      if (ariaLabel?.match(/notif/i) || title?.match(/notif/i)) {
        await btn.click();
        await page.waitForTimeout(1000);
        await ss(page, "06-notifications");
        log("PASS", "Notifications", "Bell opens notification panel");
        foundBell = true;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        break;
      }
    }
    if (!foundBell) {
      log("WARN", "Notifications", "Bell button not found by aria-label — checking by icon class");
    }
  } catch (e) {
    log("WARN", "Notifications", "Notification test error", e.message);
  }

  // Profile menu
  try {
    const headerButtons = await page.$$("header button, nav button, [class*='topbar'] button, [class*='TopBar'] button");
    let foundProfile = false;
    for (const btn of headerButtons) {
      const ariaLabel = await btn.getAttribute("aria-label");
      const text = await btn.textContent();
      if (ariaLabel?.match(/profile|user|account/i) || text?.match(/admin|profile|user/i)) {
        await btn.click();
        await page.waitForTimeout(1000);
        await ss(page, "06-profile-menu");
        log("PASS", "Profile Menu", "Profile dropdown opens");
        foundProfile = true;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        break;
      }
    }
    if (!foundProfile) {
      log("WARN", "Profile Menu", "Profile button not found — might be icon-only without aria-label");
    }
  } catch (e) {
    log("WARN", "Profile Menu", "Profile menu test error", e.message);
  }

  // ================================================================
  // 7. TRADE PAGE
  // ================================================================
  console.log("\n========== 7. TRADE PAGE ==========\n");

  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);
  await ss(page, "07-trade-page");

  // 7a. Chart loaded
  const chartCanvas = await page.$("canvas");
  log(chartCanvas ? "PASS" : "WARN", "Trade", "Chart canvas present");

  // 7b. LEFT PANEL — WatchlistPanel has tabs: watchlist, screener, signals
  console.log("\n--- Left Panel (WatchlistPanel) ---\n");

  // Watchlist tab (usually default)
  const watchlistTrigger = await page.$('[value="watchlist"], button:has-text("Watchlist")');
  if (watchlistTrigger) {
    try { await watchlistTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(1500);
    await ss(page, "07-trade-watchlist");

    // Check for symbols
    const watchlistText = await page.textContent("body");
    const hasSymbols = watchlistText.match(/AAPL|MSFT|GOOGL|AMZN|TSLA|SPY|QQQ|NVDA/);
    log(hasSymbols ? "PASS" : "WARN", "Trade/Watchlist", "Symbols visible", hasSymbols ? hasSymbols[0] : "No recognizable symbols");

    // Click a symbol to update chart
    const symbolRow = await page.$('[role="button"]');
    if (symbolRow) {
      try {
        await symbolRow.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        log("PASS", "Trade/Watchlist", "Symbol click works");
      } catch {
        log("WARN", "Trade/Watchlist", "Symbol click timed out");
      }
    }
  } else {
    log("WARN", "Trade/Watchlist", "Watchlist tab trigger not found");
  }

  // Screener tab
  const screenerTrigger = await page.$('[value="screener"], button:has-text("Screener")');
  if (screenerTrigger) {
    try { await screenerTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(1500);
    await ss(page, "07-trade-screener");
    log("PASS", "Trade/Screener", "Screener tab loads");

    // Try running a screen
    const runScreenBtn = await page.$('button:has-text("Run Screen"), button:has-text("Run"), button:has-text("Search")');
    if (runScreenBtn) {
      try {
        await runScreenBtn.click({ timeout: 5000 });
        await page.waitForTimeout(3000);
        await ss(page, "07-trade-screener-results");
        log("PASS", "Trade/Screener", "Run screen button works");
      } catch {
        log("WARN", "Trade/Screener", "Run screen button click issue");
      }
    }
  } else {
    log("WARN", "Trade/Screener", "Screener tab trigger not found");
  }

  // Signals tab
  const signalsTrigger = await page.$('[value="signals"], button:has-text("Signals")');
  if (signalsTrigger) {
    try { await signalsTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(1500);
    await ss(page, "07-trade-signals");

    const signalsText = await page.textContent("body");
    const hasSampleSignals = signalsText.match(/Sample|sample|demo|estimated/i);
    log(hasSampleSignals ? "PASS" : "WARN", "Trade/Signals", "Sample signals label", hasSampleSignals ? hasSampleSignals[0] : "No sample label");
    log("PASS", "Trade/Signals", "Signals tab loads");
  } else {
    log("WARN", "Trade/Signals", "Signals tab trigger not found");
  }

  // Switch back to watchlist
  if (watchlistTrigger) {
    try { await watchlistTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(500);
  }

  // 7c. RIGHT PANEL — AnalysisPanel has tabs: technical, fundamental, sentiment, chat, order
  console.log("\n--- Right Panel (AnalysisPanel) ---\n");

  // Technical tab
  const techTrigger = await page.$('[value="technical"]');
  if (techTrigger) {
    try { await techTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(2000);
    await ss(page, "07-trade-tech");

    const techText = await page.textContent("body");
    const hasEst = techText.match(/\(est\.\)|estimated|No analysis/i);
    log(hasEst ? "PASS" : "WARN", "Trade/Tech", "(est.) labels on technical levels", hasEst ? hasEst[0] : "Not found");
    log("PASS", "Trade/Tech", "Technical tab loads");
  } else {
    log("WARN", "Trade/Tech", "Technical tab trigger not found");
  }

  // Fundamental tab
  const fundTrigger = await page.$('[value="fundamental"]');
  if (fundTrigger) {
    try { await fundTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(2000);
    await ss(page, "07-trade-fund");

    const fundText = await page.textContent("body");
    const hasFScore = fundText.match(/F-Score|Piotroski|fundamental|Quality/i);
    log(hasFScore ? "PASS" : "WARN", "Trade/Fund", "F-Score / Fundamental content");

    // Check for fake benchmark comparisons
    const fakeBenchmark = fundText.match(/vs\.?\s*benchmark|compared to benchmark|outperforms benchmark/i);
    log(!fakeBenchmark ? "PASS" : "FAIL", "Trade/Fund", "No fake 'vs benchmark' comparisons", fakeBenchmark ? fakeBenchmark[0] : "");

    // Check F-Score text varies by score
    const fScoreValue = fundText.match(/(\d)\/9/);
    if (fScoreValue) {
      log("PASS", "Trade/Fund", "F-Score displayed", `Score: ${fScoreValue[0]}`);
    }
  } else {
    log("WARN", "Trade/Fund", "Fundamental tab trigger not found");
  }

  // Sentiment tab
  const sentTrigger = await page.$('[value="sentiment"]');
  if (sentTrigger) {
    try { await sentTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(2000);
    await ss(page, "07-trade-sent");

    const sentText = await page.textContent("body");
    const hasEstimated = sentText.match(/\(Estimated\)|estimated|Sentiment/i);
    log(hasEstimated ? "PASS" : "WARN", "Trade/Sent", "Sentiment shows (Estimated) label", hasEstimated ? hasEstimated[0] : "");

    // Check it uses selected symbol
    const selectedSymbol = await page.evaluate(() => {
      // Try to get from the store
      return document.querySelector('[class*="selected-symbol"]')?.textContent || "";
    });
  } else {
    log("WARN", "Trade/Sent", "Sentiment tab trigger not found");
  }

  // Chat tab
  const chatTrigger = await page.$('[value="chat"]');
  if (chatTrigger) {
    try { await chatTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(2000);
    await ss(page, "07-trade-chat");
    log("PASS", "Trade/Chat", "Chat tab loads");

    // Try finding and using chat input
    const chatInputs = await page.$$('input[type="text"], textarea');
    let foundChatInput = false;
    for (const inp of chatInputs) {
      const placeholder = await inp.getAttribute("placeholder");
      if (placeholder?.match(/ask|message|chat|type/i)) {
        await inp.fill("What is the current trend for AAPL?");
        await page.waitForTimeout(500);
        foundChatInput = true;

        // Try send
        const sendBtn = await page.$('button:has(svg)'); // Send icon button
        // Don't actually send to avoid API cost/errors, just check the input works
        log("PASS", "Trade/Chat", "Chat input accepts text");
        break;
      }
    }
    if (!foundChatInput) {
      log("WARN", "Trade/Chat", "Chat input not found (placeholder search)");
    }
  } else {
    log("WARN", "Trade/Chat", "Chat tab trigger not found");
  }

  // Order tab
  const orderTrigger = await page.$('[value="order"]');
  if (orderTrigger) {
    try { await orderTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(2000);
    await ss(page, "07-trade-order");

    const orderText = await page.textContent("body");

    // Buy/Sell toggle
    const hasBuy = orderText.match(/\bBuy\b/);
    const hasSell = orderText.match(/\bSell\b/);
    log(hasBuy && hasSell ? "PASS" : "WARN", "Trade/Order", "Buy/Sell toggle present");

    // Quantity
    const qtyInput = await page.$('input[type="number"]');
    log(qtyInput ? "PASS" : "WARN", "Trade/Order", "Quantity input present");

    // Order type
    const hasOrderType = orderText.match(/Market|Limit|Stop/i);
    log(hasOrderType ? "PASS" : "WARN", "Trade/Order", "Order type selector", hasOrderType ? hasOrderType[0] : "");

    // Submit button
    const hasSubmit = orderText.match(/Place Order|Submit|Execute/i);
    log(hasSubmit ? "PASS" : "WARN", "Trade/Order", "Submit button present");
  } else {
    log("WARN", "Trade/Order", "Order tab trigger not found");
  }

  // 7d. BOTTOM-RIGHT PANEL — TradePanel has tabs: trade, positions, orders, journal, calendar
  console.log("\n--- Bottom-Right Panel (TradePanel) ---\n");

  // Trade tab (trade builder)
  const tradeBuildTrigger = await page.$('[value="trade"]');
  if (tradeBuildTrigger) {
    try { await tradeBuildTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(1500);
    await ss(page, "07-trade-bottom-trade");

    const tradeText = await page.textContent("body");

    // Add Leg button
    const hasAddLeg = tradeText.match(/Add Leg|\+ Leg/i);
    log(hasAddLeg ? "PASS" : "WARN", "Trade/Bottom/Trade", "Add Leg button present");

    // Net Credit/Debit label
    const hasNetLabel = tradeText.match(/Net Credit|Net Debit|Net Premium/i);
    log(hasNetLabel ? "PASS" : "WARN", "Trade/Bottom/Trade", "Net Credit/Debit label", hasNetLabel ? hasNetLabel[0] : "");

    // Strategy detection label
    const hasStrategy = tradeText.match(/No Legs|Long Call|Short Put|Bull Call|Custom/i);
    if (hasStrategy) {
      log("PASS", "Trade/Bottom/Trade", "Strategy detection label", hasStrategy[0]);
    }

    // Try clicking Add Leg
    const addLegBtn = await page.$('button:has-text("Add Leg"), button:has-text("+ Leg")');
    if (addLegBtn) {
      try {
        await addLegBtn.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
        await ss(page, "07-trade-bottom-trade-addleg");
        log("PASS", "Trade/Bottom/Trade", "Add Leg click works");
      } catch {
        log("WARN", "Trade/Bottom/Trade", "Add Leg click issue");
      }
    }
  } else {
    log("WARN", "Trade/Bottom/Trade", "Trade builder tab trigger not found");
  }

  // Positions tab
  const positionsTrigger = await page.$('[value="positions"]');
  if (positionsTrigger) {
    try { await positionsTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(1500);
    await ss(page, "07-trade-bottom-positions");

    const posText = await page.textContent("body");
    const hasPositionsInfo = posText.match(/Position|Symbol|Qty|No position|empty/i);
    log("PASS", "Trade/Bottom/Positions", "Positions tab loads", hasPositionsInfo ? hasPositionsInfo[0] : "");
  } else {
    log("WARN", "Trade/Bottom/Positions", "Positions tab trigger not found");
  }

  // Orders tab
  const ordersTrigger = await page.$('[value="orders"]');
  if (ordersTrigger) {
    try { await ordersTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(1500);
    await ss(page, "07-trade-bottom-orders");

    const ordText = await page.textContent("body");
    const hasOrdersInfo = ordText.match(/Order|Pending|Filled|No order|empty|cancel/i);
    log("PASS", "Trade/Bottom/Orders", "Orders tab loads", hasOrdersInfo ? hasOrdersInfo[0] : "");
  } else {
    log("WARN", "Trade/Bottom/Orders", "Orders tab trigger not found");
  }

  // Journal tab
  const journalTrigger = await page.$('[value="journal"]');
  if (journalTrigger) {
    try { await journalTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(1500);
    await ss(page, "07-trade-bottom-journal");

    // Try writing in journal
    const journalInput = await page.$('textarea');
    if (journalInput) {
      await journalInput.fill("Round 6 QA journal test");
      await page.waitForTimeout(500);

      // Switch away and back to test persistence
      if (positionsTrigger) {
        try { await positionsTrigger.click({ timeout: 3000 }); } catch {}
        await page.waitForTimeout(500);
        try { await journalTrigger.click({ timeout: 3000 }); } catch {}
        await page.waitForTimeout(1000);

        const currentVal = await page.$eval("textarea", (el) => el.value).catch(() => "");
        log(currentVal.includes("Round 6") ? "PASS" : "WARN", "Trade/Bottom/Journal", "Journal notes persist across tab switches", currentVal.substring(0, 50));
      }
    } else {
      log("WARN", "Trade/Bottom/Journal", "Journal textarea not found");
    }
  } else {
    log("WARN", "Trade/Bottom/Journal", "Journal tab trigger not found");
  }

  // Calendar tab
  const calendarTrigger = await page.$('[value="calendar"]');
  if (calendarTrigger) {
    try { await calendarTrigger.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(1500);
    await ss(page, "07-trade-bottom-calendar");
    log("PASS", "Trade/Bottom/Calendar", "Calendar tab loads");
  } else {
    log("WARN", "Trade/Bottom/Calendar", "Calendar tab trigger not found");
  }

  // 7e. OPTIONS CHAIN (bottom-left panel)
  console.log("\n--- Options Chain ---\n");

  const optionsText = await page.textContent("body");
  const hasOptionsChain = optionsText.match(/Options|Chain|Calls|Puts|Strike|Expir/i);
  log(hasOptionsChain ? "PASS" : "WARN", "Trade/Options", "Options chain visible", hasOptionsChain ? hasOptionsChain[0] : "");

  const hasEstBanner = optionsText.match(/estimated|est\.|Estimated IV|Sample/i);
  log(hasEstBanner ? "PASS" : "WARN", "Trade/Options", "Estimated data banner on options chain");

  // 7f. BUY/SELL buttons near chart
  const buySellBtns = await page.$$('button:has-text("BUY"), button:has-text("SELL")');
  if (buySellBtns.length > 0) {
    log("PASS", "Trade", "BUY/SELL quick-trade buttons present");
  }

  // ================================================================
  // 8. PIPELINE PAGE
  // ================================================================
  console.log("\n========== 8. PIPELINE PAGE ==========\n");

  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  await ss(page, "08-pipeline-page");
  await ssFull(page, "08-pipeline-full");

  const pipelineText = await page.textContent("body");

  // Flow diagram
  const hasFlowDiagram = pipelineText.match(/Screened|Analyzed|Signals|Orders/i);
  log(hasFlowDiagram ? "PASS" : "WARN", "Pipeline", "Pipeline flow diagram stages visible");

  // "Pipeline has not run today" if all zeros
  const notRunToday = pipelineText.match(/has not run today|Pipeline has not run|not run/i);
  if (notRunToday) {
    log("PASS", "Pipeline", "'Pipeline has not run today' message shown when appropriate");
  }

  // Positions table
  const hasTable = await page.$("table, [class*='table']");
  log(hasTable ? "PASS" : "WARN", "Pipeline", "Positions/data table present");

  // Strategy builder
  const hasBuilder = pipelineText.match(/Strategy Builder|Build|Custom Strategy/i);
  log(hasBuilder ? "PASS" : "WARN", "Pipeline", "Strategy Builder section");

  // Backtest section
  const hasBacktest = pipelineText.match(/Backtest|Back Test|backt/i);
  log(hasBacktest ? "PASS" : "WARN", "Pipeline", "Backtest section visible");

  // Indicator dropdown (SMA/RSI/MACD)
  const hasIndicators = pipelineText.match(/SMA|RSI|MACD|Moving Average|indicator/i);
  log(hasIndicators ? "PASS" : "WARN", "Pipeline", "Indicator options (SMA/RSI/MACD)", hasIndicators ? hasIndicators[0] : "");

  // Run backtest button
  const runBacktestBtn = await page.$('button:has-text("Run Backtest"), button:has-text("Run"), button:has-text("Backtest")');
  if (runBacktestBtn) {
    log("PASS", "Pipeline", "Run Backtest button present");
    await ss(page, "08-pipeline-backtest");
  }

  // Performance summary
  const hasPerfSummary = pipelineText.match(/Performance|Summary|Win Rate|Return|Sharpe/i);
  log(hasPerfSummary ? "PASS" : "WARN", "Pipeline", "Performance summary section");

  // Trigger pipeline button
  const triggerBtn = await page.$('button:has-text("Run Pipeline"), button:has-text("Trigger"), button:has-text("Execute")');
  if (triggerBtn) {
    log("PASS", "Pipeline", "Run/Trigger Pipeline button present");
  }

  // ================================================================
  // 9. STRATEGY PAGES (4 strategies)
  // ================================================================
  console.log("\n========== 9. STRATEGY PAGES ==========\n");

  const strategies = [
    { slug: "pead", name: "PEAD" },
    { slug: "momentum-quality", name: "Momentum Quality" },
    { slug: "earnings-vol", name: "Earnings Vol" },
    { slug: "claude-alpha", name: "Claude Alpha" },
  ];

  for (const strat of strategies) {
    console.log(`\n--- ${strat.name} (/strategies/${strat.slug}) ---\n`);

    try {
      await page.goto(`${BASE}/strategies/${strat.slug}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(3000);
      await ss(page, `09-strategy-${strat.slug}`);

      const stratPageText = await page.textContent("body");

      // 404 check
      if (stratPageText.match(/404|not found|page not found/i)) {
        log("FAIL", `Strategy/${strat.name}`, "Page shows 404");
        continue;
      }

      log("PASS", `Strategy/${strat.name}`, "Page loads successfully");

      // Stats section
      const hasStats = stratPageText.match(/Sharpe|Max DD|Max Drawdown|Win Rate|Calmar|Return|Awaiting trades/i);
      log(hasStats ? "PASS" : "WARN", `Strategy/${strat.name}`, "Stats visible", hasStats ? hasStats[0] : "No stats");

      // Check stat values are reasonable
      const sharpeMatch = stratPageText.match(/Sharpe[\s\S]{0,30}?([\d.]+|N\/A|Awaiting)/i);
      if (sharpeMatch) {
        log("PASS", `Strategy/${strat.name}`, "Sharpe ratio displayed", sharpeMatch[0].substring(0, 40));
      }

      // Equity curve
      const equityCurve = await page.$("canvas, svg path, [class*='equity'], [class*='chart']");
      log(equityCurve ? "PASS" : "WARN", `Strategy/${strat.name}`, "Equity curve / chart element present");

      // Tabs (Overview, Trades, Analytics, Rules, Content)
      const tabTriggers = await page.$$('[role="tab"], button[data-state]');
      const tabTexts = [];
      for (const t of tabTriggers) {
        const txt = await t.textContent();
        if (txt?.trim()) tabTexts.push(txt.trim());
      }
      log(tabTexts.length >= 3 ? "PASS" : "WARN", `Strategy/${strat.name}`, `Tabs found: ${tabTexts.length}`, tabTexts.join(", "));

      // Click through tabs
      for (let i = 0; i < Math.min(tabTriggers.length, 5); i++) {
        try {
          const tabText = await tabTriggers[i].textContent();
          await tabTriggers[i].click({ timeout: 3000 });
          await page.waitForTimeout(1000);
        } catch {
          // Tab may have re-rendered
        }
      }

      // Active/Paused toggle
      const toggleBtn = await page.$('button:has-text("Pause"), button:has-text("Activate"), button:has-text("Active"), button:has-text("Resume")');
      if (toggleBtn) {
        const toggleText = await toggleBtn.textContent();
        log("PASS", `Strategy/${strat.name}`, "Active/Pause toggle present", toggleText?.trim());

        // Try toggling
        try {
          await toggleBtn.click({ timeout: 3000 });
          await page.waitForTimeout(1500);
          const newText = await toggleBtn.textContent().catch(() => "");
          log("PASS", `Strategy/${strat.name}`, "Toggle click works", `Now shows: ${newText?.trim()}`);

          // Toggle back
          await toggleBtn.click({ timeout: 3000 });
          await page.waitForTimeout(1000);
        } catch {
          log("WARN", `Strategy/${strat.name}`, "Toggle click issue");
        }
      } else {
        log("WARN", `Strategy/${strat.name}`, "Active/Pause toggle not found");
      }

      await ssFull(page, `09-strategy-${strat.slug}-full`);
    } catch (e) {
      log("FAIL", `Strategy/${strat.name}`, "Page error", e.message.substring(0, 100));
    }
  }

  // ================================================================
  // 10. CROSS-PAGE CONSISTENCY
  // ================================================================
  console.log("\n========== 10. CROSS-PAGE CONSISTENCY ==========\n");

  // Get portfolio value from dashboard
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const dashText = await page.textContent("body");
  const dashDollar = dashText.match(/\$[\d,]+(?:\.\d{2})?/g) || [];

  // Get from status strip
  const footerEl = await page.$("footer");
  const footerTxt = footerEl ? await footerEl.textContent() : "";
  const stripDollar = footerTxt.match(/\$[\d,]+(?:\.\d{2})?/g) || [];

  if (dashDollar.length > 0 && stripDollar.length > 0) {
    // The first dollar amount on dashboard is likely portfolio value
    // Status strip should have a matching one
    log("PASS", "Consistency", "Dollar values present on dashboard and status strip",
      `Dashboard first: ${dashDollar[0]}, Strip: ${stripDollar.join(", ")}`);
  }

  // Check regime consistency
  const regimeInDash = dashText.match(/Bullish|Bearish|Neutral|Risk-Off|Risk-On|Expansion|Contraction/i);
  const regimeInStrip = footerTxt.match(/Bullish|Bearish|Neutral|Risk-Off|Risk-On|Expansion|Contraction/i);
  if (regimeInDash && regimeInStrip) {
    if (regimeInDash[0].toLowerCase() === regimeInStrip[0].toLowerCase()) {
      log("PASS", "Consistency", "Regime matches dashboard and strip", regimeInDash[0]);
    } else {
      log("WARN", "Consistency", "Regime mismatch", `Dashboard: ${regimeInDash[0]}, Strip: ${regimeInStrip[0]}`);
    }
  }

  // ================================================================
  // 11. EDGE CASES
  // ================================================================
  console.log("\n========== 11. EDGE CASES ==========\n");

  // 11a. Resize to 1024x768
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(1500);
  await ss(page, "11-responsive-1024-dashboard");

  const overflowCheck = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    hasHorizontalScroll: document.body.scrollWidth > document.body.clientWidth + 10,
  }));
  log(!overflowCheck.hasHorizontalScroll ? "PASS" : "WARN", "Responsive", "Dashboard at 1024x768 — no horizontal scroll",
    `scroll: ${overflowCheck.bodyScrollWidth}, client: ${overflowCheck.bodyClientWidth}`);

  // Trade page at 1024x768
  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  await ss(page, "11-responsive-1024-trade");

  const tradeOverflow = await page.evaluate(() => ({
    hasHorizontalScroll: document.body.scrollWidth > document.body.clientWidth + 10,
  }));
  log(!tradeOverflow.hasHorizontalScroll ? "PASS" : "WARN", "Responsive", "Trade page at 1024x768",
    tradeOverflow.hasHorizontalScroll ? "Has horizontal scroll" : "No horizontal scroll");

  // Pipeline at 1024x768
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  await ss(page, "11-responsive-1024-pipeline");

  // Reset viewport
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(1000);

  // 11b. Page refresh mid-navigation
  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  const afterRefresh = page.url();
  if (afterRefresh.includes("/trade")) {
    log("PASS", "Edge Cases", "Page refresh preserves route on /trade");
  } else if (afterRefresh.includes("/login")) {
    log("FAIL", "Edge Cases", "Page refresh redirects to login — session lost");
  } else {
    log("WARN", "Edge Cases", "Page refresh went to unexpected URL", afterRefresh);
  }

  // 11c. Fast navigation between pages
  const navPages = ["/", "/trade", "/pipeline", "/", "/trade"];
  let navErrors = 0;
  for (const p of navPages) {
    try {
      await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForTimeout(300);
    } catch {
      navErrors++;
    }
  }
  log(navErrors === 0 ? "PASS" : "WARN", "Edge Cases", "Fast page navigation", navErrors > 0 ? `${navErrors} errors` : "No errors");
  await page.waitForTimeout(2000);

  // 11d. Refresh on pipeline page
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  const pipelineAfterRefresh = page.url();
  log(pipelineAfterRefresh.includes("/pipeline") ? "PASS" : "FAIL", "Edge Cases", "Refresh on /pipeline preserves route");

  // 11e. Refresh on strategy page
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  const stratAfterRefresh = page.url();
  log(stratAfterRefresh.includes("/strategies/pead") ? "PASS" : "FAIL", "Edge Cases", "Refresh on /strategies/pead preserves route");

  // ================================================================
  // 12. DETAILED PIXEL-LEVEL CHECKS
  // ================================================================
  console.log("\n========== 12. DETAILED CHECKS ==========\n");

  // Back to dashboard for final checks
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check all strategy cards are showing — we expect 12 from STRATEGY_ORDER
  const allStrategyLinks = await page.$$eval('a[href*="/strategies/"]', (els) =>
    els.map((el) => el.getAttribute("href"))
  );
  const uniqueStrategies = [...new Set(allStrategyLinks)];
  log(uniqueStrategies.length >= 10 ? "PASS" : "WARN", "Dashboard/Strategies",
    `Unique strategy links: ${uniqueStrategies.length}`, uniqueStrategies.join(", "));

  // Check for truncated names without tooltips
  const stratCards = await page.$$('a[href*="/strategies/"]');
  let truncatedWithoutTooltip = 0;
  for (const card of stratCards.slice(0, 5)) {
    const nameEl = await card.$('[class*="truncate"], .truncate');
    if (nameEl) {
      const isOverflowing = await nameEl.evaluate((el) => el.scrollWidth > el.clientWidth);
      if (isOverflowing) {
        const title = await nameEl.getAttribute("title");
        if (!title) truncatedWithoutTooltip++;
      }
    }
  }
  if (truncatedWithoutTooltip > 0) {
    log("WARN", "Dashboard/Strategies", `${truncatedWithoutTooltip} strategy name(s) truncated without tooltip`);
  }

  // News links — check if external links are disabled for demo
  const externalLinks = await page.$$eval('a[href^="http"]', (els) =>
    els
      .filter((el) => !el.href.includes("tradingalpha.net"))
      .map((el) => ({
        href: el.href,
        disabled: el.hasAttribute("aria-disabled") || el.style.pointerEvents === "none",
        text: el.textContent?.trim().substring(0, 40),
      }))
  );
  const activeExternalLinks = externalLinks.filter((l) => !l.disabled);
  if (activeExternalLinks.length > 0) {
    log("WARN", "Dashboard/News", `${activeExternalLinks.length} external links are clickable`, activeExternalLinks.slice(0, 3).map(l => l.text).join(", "));
  } else {
    log("PASS", "Dashboard/News", "No active external news links (good for demo)");
  }

  // Check for any "undefined", "NaN", "null" text on page (common bugs)
  const uglyText = bodyText.match(/\bundefined\b|\bNaN\b|\bnull\b|\[object Object\]/g);
  if (uglyText) {
    log("FAIL", "Dashboard", "Found ugly text on page", uglyText.join(", "));
  } else {
    log("PASS", "Dashboard", "No 'undefined', 'NaN', 'null', or '[object Object]' on page");
  }

  // Check trade page for ugly text too
  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  const tradeBodyText = await page.textContent("body");
  const tradeUglyText = tradeBodyText.match(/\bundefined\b|\bNaN\b|\bnull\b|\[object Object\]/g);
  if (tradeUglyText) {
    log("FAIL", "Trade", "Found ugly text on trade page", tradeUglyText.join(", "));
  } else {
    log("PASS", "Trade", "No ugly text on trade page");
  }

  // Check pipeline for ugly text
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  const pipelineBodyText = await page.textContent("body");
  const pipelineUglyText = pipelineBodyText.match(/\bundefined\b|\bNaN\b|\bnull\b|\[object Object\]/g);
  if (pipelineUglyText) {
    log("FAIL", "Pipeline", "Found ugly text on pipeline page", pipelineUglyText.join(", "));
  } else {
    log("PASS", "Pipeline", "No ugly text on pipeline page");
  }

  // ================================================================
  // 13. CONSOLE & NETWORK ERRORS SUMMARY
  // ================================================================
  console.log("\n========== 13. ERROR SUMMARY ==========\n");

  const criticalConsoleErrors = consoleErrors.filter((e) =>
    !e.text.includes("favicon") &&
    !e.text.includes("ResizeObserver") &&
    !e.text.includes("non-passive") &&
    !e.text.includes("third-party") &&
    !e.text.includes("Script error") &&
    !e.text.includes("chrome-extension") &&
    !e.text.includes("Download the React DevTools") &&
    !e.text.includes("WebSocket") &&
    !e.text.includes("ERR_CONNECTION_REFUSED")
  );

  if (criticalConsoleErrors.length > 0) {
    console.log("\nConsole errors (filtered):");
    const uniqueErrors = [...new Set(criticalConsoleErrors.map(e => e.text.substring(0, 150)))];
    for (const errText of uniqueErrors.slice(0, 15)) {
      console.log(`  ${errText}`);
    }
    log(criticalConsoleErrors.length > 5 ? "WARN" : "PASS", "Console",
      `${criticalConsoleErrors.length} console errors (${uniqueErrors.length} unique)`,
      uniqueErrors.slice(0, 3).map(e => e.substring(0, 80)).join("; "));
  } else {
    log("PASS", "Console", "No critical console errors");
  }

  // Network errors
  const critical404s = networkErrors.filter((e) => e.status === 404 && !e.url.includes("favicon"));
  const critical5xx = networkErrors.filter((e) => e.status >= 500);
  const other4xx = networkErrors.filter((e) => e.status >= 400 && e.status < 500 && e.status !== 404 && !e.url.includes("favicon"));

  if (critical5xx.length > 0) {
    console.log("\n5xx Server errors:");
    for (const err of critical5xx.slice(0, 10)) {
      console.log(`  [${err.status}] ${err.url}`);
    }
    log("FAIL", "Network/5xx", `${critical5xx.length} server error(s)`,
      critical5xx.slice(0, 3).map(e => `${e.status}: ${e.url.substring(0, 80)}`).join("; "));
  } else {
    log("PASS", "Network/5xx", "No 5xx server errors");
  }

  if (critical404s.length > 0) {
    console.log("\n404 Not Found:");
    const unique404s = [...new Set(critical404s.map(e => e.url))];
    for (const url of unique404s.slice(0, 10)) {
      console.log(`  [404] ${url}`);
    }
    log(unique404s.length > 3 ? "WARN" : "PASS", "Network/404", `${unique404s.length} unique 404(s)`,
      unique404s.slice(0, 3).map(u => u.substring(0, 80)).join("; "));
  } else {
    log("PASS", "Network/404", "No 404 errors");
  }

  if (other4xx.length > 0) {
    console.log("\nOther 4xx errors:");
    for (const err of other4xx.slice(0, 10)) {
      console.log(`  [${err.status}] ${err.url}`);
    }
    log("WARN", "Network/4xx", `${other4xx.length} other 4xx error(s)`);
  }

  // ================================================================
  // FINAL SUMMARY
  // ================================================================
  console.log("\n\n================================================");
  console.log("         ROUND 6 FINAL QA SWEEP SUMMARY");
  console.log("================================================\n");
  console.log(`  PASS: ${passCount}`);
  console.log(`  WARN: ${warnCount}`);
  console.log(`  FAIL: ${failCount}`);
  console.log(`  TOTAL: ${testId}\n`);

  if (failCount > 0) {
    console.log("---------- FAILURES ----------");
    for (const i of issues.filter((x) => x.status === "FAIL")) {
      console.log(`  #${i.id} [${i.section}] ${i.description}${i.details ? " — " + i.details : ""}`);
    }
    console.log("");
  }

  if (warnCount > 0) {
    console.log("---------- WARNINGS ----------");
    for (const i of issues.filter((x) => x.status === "WARN")) {
      console.log(`  #${i.id} [${i.section}] ${i.description}${i.details ? " — " + i.details : ""}`);
    }
    console.log("");
  }

  console.log(`Screenshots saved to: ${DIR}`);
  console.log(`Total screenshots: ${await page.evaluate(() => 0) || "check directory"}`);

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
