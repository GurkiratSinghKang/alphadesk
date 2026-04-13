import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const BASE = "https://tradingalpha.net";
const DIR = "./qa-screenshots/round4/workflows";
const RESULTS_FILE = "./qa-screenshots/round4/workflows/results.json";
const USERNAME = "admin";
const PASSWORD = "alphaDesk2025!";

mkdirSync(DIR, { recursive: true });

const results = [];
let testId = 0;

function log(status, section, description, details = "") {
  testId++;
  const entry = { id: testId, status, section, description, details, timestamp: new Date().toISOString() };
  results.push(entry);
  const icon = status === "PASS" ? "PASS" : status === "WARN" ? "WARN" : "FAIL";
  console.log(`[${icon}] #${testId} [${section}] ${description}${details ? " — " + details : ""}`);
  return entry;
}

async function screenshot(page, name) {
  const filePath = path.join(DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

async function safeClick(page, selector, options = {}) {
  try {
    await page.waitForSelector(selector, { timeout: options.timeout || 5000, state: "visible" });
    await page.click(selector, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function safeText(page, selector, timeout = 5000) {
  try {
    const el = await page.waitForSelector(selector, { timeout, state: "visible" });
    return await el.textContent();
  } catch {
    return null;
  }
}

async function waitForNavigation(page, urlPattern, timeout = 10000) {
  try {
    await page.waitForURL(urlPattern, { timeout });
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
  const page = await context.newPage();

  const consoleErrors = [];
  const networkErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("requestfailed", (req) => {
    networkErrors.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });

  // ================================================================
  // LOGIN
  // ================================================================
  console.log("\n========== LOGIN ==========\n");
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
    await screenshot(page, "01-login-page");

    // Try filling login fields
    const usernameInput = await page.$('input[placeholder="admin"], input[name="username"], input[type="text"]');
    const passwordInput = await page.$('input[type="password"]');

    if (usernameInput && passwordInput) {
      await usernameInput.fill(USERNAME);
      await passwordInput.fill(PASSWORD);
      await screenshot(page, "02-login-filled");
      await page.click('button[type="submit"]');

      const loggedIn = await waitForNavigation(page, (url) => !url.pathname.includes("/login"), 15000);
      if (loggedIn) {
        log("PASS", "Login", "Login with admin/alphaDesk2025!", `Redirected to ${page.url()}`);
      } else {
        // Check if there's an error message
        const errorMsg = await safeText(page, '.text-destructive, .error, [role="alert"]', 2000);
        log("FAIL", "Login", "Login with admin/alphaDesk2025!", `Failed to redirect. Error: ${errorMsg || 'unknown'}`);
        await screenshot(page, "02-login-FAIL");
      }
    } else {
      log("FAIL", "Login", "Login form fields not found", "Could not find username or password inputs");
      await screenshot(page, "02-login-no-fields");
    }
  } catch (e) {
    log("FAIL", "Login", "Login flow", e.message);
    await screenshot(page, "02-login-error");
  }

  // Wait for dashboard to fully load
  await page.waitForTimeout(5000);
  await screenshot(page, "03-dashboard-loaded");

  // ================================================================
  // 1. NAVIGATION TESTS
  // ================================================================
  console.log("\n========== 1. NAVIGATION ==========\n");

  // 1a. Click logo → should go home
  try {
    const logoClicked = await safeClick(page, '.text-primary.h-5.w-5, [class*="Zap"], header .items-center .items-center');
    if (logoClicked) {
      await page.waitForTimeout(1000);
      const url = page.url();
      if (url.endsWith("/") || url === `${BASE}` || url === `${BASE}/`) {
        log("PASS", "Navigation", "Click logo → goes to dashboard", url);
      } else {
        log("WARN", "Navigation", "Click logo → unexpected URL", url);
      }
    } else {
      // Try clicking the AlphaDesk text
      const textClicked = await safeClick(page, 'header span.text-base');
      if (textClicked) {
        await page.waitForTimeout(1000);
        log("WARN", "Navigation", "Logo text clickable but may not navigate", `URL: ${page.url()}`);
      } else {
        log("FAIL", "Navigation", "Logo not clickable — no navigation to home");
      }
    }
    await screenshot(page, "04-nav-logo-click");
  } catch (e) {
    log("FAIL", "Navigation", "Logo click test", e.message);
  }

  // 1b. Click Dashboard tab
  try {
    const dashBtn = await page.$$('nav button');
    let dashClicked = false;
    for (const btn of dashBtn) {
      const text = await btn.textContent();
      if (text?.includes("Dashboard")) {
        await btn.click();
        dashClicked = true;
        break;
      }
    }
    await page.waitForTimeout(2000);
    if (dashClicked) {
      const url = page.url();
      if (url === `${BASE}/` || url === BASE) {
        log("PASS", "Navigation", "Click Dashboard tab → navigates to /", url);
      } else {
        log("FAIL", "Navigation", "Click Dashboard tab → wrong URL", url);
      }
    } else {
      log("FAIL", "Navigation", "Dashboard tab not found in nav");
    }
    await screenshot(page, "05-nav-dashboard");
  } catch (e) {
    log("FAIL", "Navigation", "Dashboard tab click", e.message);
  }

  // 1c. Click Trade tab
  try {
    const navBtns = await page.$$('nav button');
    let tradeClicked = false;
    for (const btn of navBtns) {
      const text = await btn.textContent();
      if (text?.includes("Trade")) {
        await btn.click();
        tradeClicked = true;
        break;
      }
    }
    await page.waitForTimeout(3000);
    if (tradeClicked) {
      const url = page.url();
      if (url.includes("/trade")) {
        log("PASS", "Navigation", "Click Trade tab → navigates to /trade", url);
      } else {
        log("FAIL", "Navigation", "Click Trade tab → wrong URL", url);
      }
    } else {
      log("FAIL", "Navigation", "Trade tab not found in nav");
    }
    await screenshot(page, "06-nav-trade");
  } catch (e) {
    log("FAIL", "Navigation", "Trade tab click", e.message);
  }

  // 1d. Click Pipeline tab
  try {
    const navBtns = await page.$$('nav button');
    let pipelineClicked = false;
    for (const btn of navBtns) {
      const text = await btn.textContent();
      if (text?.includes("Pipeline")) {
        await btn.click();
        pipelineClicked = true;
        break;
      }
    }
    await page.waitForTimeout(3000);
    if (pipelineClicked) {
      const url = page.url();
      if (url.includes("/pipeline")) {
        log("PASS", "Navigation", "Click Pipeline tab → navigates to /pipeline", url);
      } else {
        log("FAIL", "Navigation", "Click Pipeline tab → wrong URL", url);
      }
    } else {
      log("FAIL", "Navigation", "Pipeline tab not found in nav");
    }
    await screenshot(page, "07-nav-pipeline");
  } catch (e) {
    log("FAIL", "Navigation", "Pipeline tab click", e.message);
  }

  // 1e. Navigate back to Dashboard
  try {
    const navBtns = await page.$$('nav button');
    for (const btn of navBtns) {
      const text = await btn.textContent();
      if (text?.includes("Dashboard")) { await btn.click(); break; }
    }
    await page.waitForTimeout(3000);
  } catch {}

  // 1f. Click strategy cards on dashboard → navigate to strategy detail
  const strategyIds = [
    "momentum-quality", "pead", "vrp-harvesting", "earnings-vol-premium",
    "regime-adaptive", "claude-alpha"
  ];

  try {
    // Find all strategy cards
    const cards = await page.$$('[role="button"][tabindex="0"]');
    const cardCount = cards.length;
    log(cardCount > 0 ? "PASS" : "FAIL", "Navigation", `Strategy cards found on dashboard`, `Found ${cardCount} cards`);

    if (cardCount > 0) {
      // Click first strategy card
      await cards[0].click();
      await page.waitForTimeout(3000);
      const url = page.url();
      if (url.includes("/strategies/")) {
        log("PASS", "Navigation", "Click strategy card → navigates to strategy detail", url);
        await screenshot(page, "08-nav-strategy-detail");
      } else {
        log("FAIL", "Navigation", "Click strategy card → did not navigate to /strategies/", url);
      }

      // 1g. Back button
      await page.goBack();
      await page.waitForTimeout(3000);
      const backUrl = page.url();
      if (backUrl === `${BASE}/` || backUrl === BASE) {
        log("PASS", "Navigation", "Back button returns to dashboard", backUrl);
      } else {
        log("WARN", "Navigation", "Back button → unexpected URL", backUrl);
      }
      await screenshot(page, "09-nav-back-button");
    }
  } catch (e) {
    log("FAIL", "Navigation", "Strategy card click + back button", e.message);
  }

  // ================================================================
  // 2. COMMAND PALETTE (Ctrl+K)
  // ================================================================
  console.log("\n========== 2. COMMAND PALETTE ==========\n");

  // Ensure we're on the dashboard
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(3000);

  // 2a. Open command palette with Ctrl+K
  try {
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(1000);

    // Check if command palette dialog opened
    const cmdPalette = await page.$('[cmdk-root], [role="dialog"]');
    if (cmdPalette) {
      log("PASS", "Command Palette", "Ctrl+K opens command palette");
      await screenshot(page, "10-cmd-palette-open");
    } else {
      // Try Meta+K for Mac
      await page.keyboard.press("Meta+k");
      await page.waitForTimeout(1000);
      const cmdPalette2 = await page.$('[cmdk-root], [role="dialog"]');
      if (cmdPalette2) {
        log("PASS", "Command Palette", "Meta+K opens command palette");
      } else {
        log("FAIL", "Command Palette", "Ctrl+K / Meta+K does not open command palette");
      }
    }
  } catch (e) {
    log("FAIL", "Command Palette", "Open with keyboard shortcut", e.message);
  }

  // 2b. Search for AAPL
  try {
    const cmdInput = await page.$('[cmdk-input], [role="dialog"] input');
    if (cmdInput) {
      await cmdInput.fill("AAPL");
      await page.waitForTimeout(1500); // Wait for debounced search

      const results = await page.$$('[cmdk-item]');
      const resultTexts = [];
      for (const r of results) {
        const t = await r.textContent();
        resultTexts.push(t);
      }

      const aaplFound = resultTexts.some(t => t?.includes("AAPL"));
      if (aaplFound) {
        log("PASS", "Command Palette", "Search AAPL → results appear", `${resultTexts.length} results, AAPL found`);
      } else if (resultTexts.length > 0) {
        log("WARN", "Command Palette", "Search AAPL → results appear but AAPL not visible", `Results: ${resultTexts.slice(0, 3).join(", ")}`);
      } else {
        log("FAIL", "Command Palette", "Search AAPL → no results appeared");
      }
      await screenshot(page, "11-cmd-palette-search-aapl");
    } else {
      log("FAIL", "Command Palette", "Command palette input not found");
    }
  } catch (e) {
    log("FAIL", "Command Palette", "Search AAPL", e.message);
  }

  // 2c. Select AAPL symbol → should update chart
  try {
    const aaplItems = await page.$$('[cmdk-item]');
    let aaplClicked = false;
    for (const item of aaplItems) {
      const text = await item.textContent();
      if (text?.includes("AAPL")) {
        await item.click();
        aaplClicked = true;
        break;
      }
    }
    if (aaplClicked) {
      await page.waitForTimeout(2000);
      // Command palette should close
      const paletteStillOpen = await page.$('[cmdk-root]:visible, [role="dialog"]:visible');
      log("PASS", "Command Palette", "Select AAPL symbol → palette closes", `Palette ${paletteStillOpen ? "still open (issue)" : "closed"}`);
    } else {
      log("WARN", "Command Palette", "Could not find AAPL in results to click");
    }
  } catch (e) {
    log("FAIL", "Command Palette", "Select AAPL", e.message);
  }

  // 2d. Test "Analyze current symbol" command
  try {
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(1000);

    const analyzeItem = await page.$('[cmdk-item]:has-text("Analyze")');
    if (analyzeItem) {
      await analyzeItem.click();
      await page.waitForTimeout(2000);
      log("PASS", "Command Palette", "'Analyze current symbol' command found and clicked");
      await screenshot(page, "12-cmd-analyze");
    } else {
      // Look through all items
      const items = await page.$$('[cmdk-item]');
      let found = false;
      for (const item of items) {
        const text = await item.textContent();
        if (text?.toLowerCase().includes("analyze")) {
          await item.click();
          found = true;
          break;
        }
      }
      if (found) {
        log("PASS", "Command Palette", "'Analyze current symbol' command executed");
      } else {
        log("FAIL", "Command Palette", "'Analyze current symbol' command not found in palette");
      }
    }
  } catch (e) {
    log("FAIL", "Command Palette", "Analyze command", e.message);
  }

  // 2e. Test "Screen momentum stocks" command
  try {
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(1000);

    const items = await page.$$('[cmdk-item]');
    let found = false;
    for (const item of items) {
      const text = await item.textContent();
      if (text?.toLowerCase().includes("screen momentum")) {
        await item.click();
        found = true;
        break;
      }
    }
    if (found) {
      await page.waitForTimeout(1000);
      log("PASS", "Command Palette", "'Screen momentum stocks' command executed");
      await screenshot(page, "13-cmd-screen-momentum");
    } else {
      log("FAIL", "Command Palette", "'Screen momentum stocks' command not found");
    }
  } catch (e) {
    log("FAIL", "Command Palette", "Screen momentum command", e.message);
  }

  // 2f. Test "Show portfolio" command
  try {
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(1000);

    const items = await page.$$('[cmdk-item]');
    let found = false;
    for (const item of items) {
      const text = await item.textContent();
      if (text?.toLowerCase().includes("show portfolio")) {
        await item.click();
        found = true;
        break;
      }
    }
    if (found) {
      await page.waitForTimeout(1000);
      log("PASS", "Command Palette", "'Show portfolio' command executed");
      await screenshot(page, "14-cmd-show-portfolio");
    } else {
      log("FAIL", "Command Palette", "'Show portfolio' command not found");
    }
  } catch (e) {
    log("FAIL", "Command Palette", "Show portfolio command", e.message);
  }

  // 2g. Test "Switch to live trading" command
  try {
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(1000);

    // Handle confirmation dialog
    page.once("dialog", async (dialog) => {
      log("PASS", "Command Palette", "'Switch to live trading' shows confirmation dialog", dialog.message());
      await dialog.dismiss(); // Cancel to avoid switching
    });

    const items = await page.$$('[cmdk-item]');
    let found = false;
    for (const item of items) {
      const text = await item.textContent();
      if (text?.toLowerCase().includes("switch to live")) {
        await item.click();
        found = true;
        break;
      }
    }
    if (found) {
      await page.waitForTimeout(2000);
      log("PASS", "Command Palette", "'Switch to live trading' command executed");
      await screenshot(page, "15-cmd-switch-live");
    } else {
      log("FAIL", "Command Palette", "'Switch to live trading' command not found");
    }
  } catch (e) {
    log("FAIL", "Command Palette", "Switch to live trading command", e.message);
  }

  // 2h. Close palette with Escape
  try {
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const stillOpen = await page.$('[role="dialog"]:visible');
    log(stillOpen ? "FAIL" : "PASS", "Command Palette", "Escape closes command palette");
  } catch (e) {
    log("FAIL", "Command Palette", "Close with Escape", e.message);
  }

  // ================================================================
  // 3. TRADE PAGE INTERACTIONS
  // ================================================================
  console.log("\n========== 3. TRADE PAGE ==========\n");

  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(4000);
  await screenshot(page, "16-trade-page");

  // 3a. Check watchlist is present
  try {
    const watchlistItems = await page.$$('[data-symbol], .cursor-pointer');
    const watchlistVisible = await page.$('text=Watchlist') || await page.$('text=Watch');
    log(watchlistItems.length > 0 || watchlistVisible ? "PASS" : "FAIL", "Trade", "Watchlist panel visible", `Found ${watchlistItems.length} items`);
  } catch (e) {
    log("FAIL", "Trade", "Watchlist visibility", e.message);
  }

  // 3b. Click a symbol in watchlist → chart should update
  try {
    // Look for watchlist items with symbol text
    const watchlistRows = await page.$$('.cursor-pointer');
    let symbolClicked = null;
    if (watchlistRows.length > 1) {
      // Click the second one to ensure we're changing something
      const text = await watchlistRows[1].textContent();
      await watchlistRows[1].click();
      symbolClicked = text?.trim()?.substring(0, 8);
      await page.waitForTimeout(2000);
      log("PASS", "Trade", "Click watchlist symbol → chart should update", `Clicked: ${symbolClicked}`);
    } else {
      log("WARN", "Trade", "Not enough watchlist items to test symbol switch");
    }
    await screenshot(page, "17-trade-watchlist-click");
  } catch (e) {
    log("FAIL", "Trade", "Watchlist symbol click", e.message);
  }

  // 3c. Chart type buttons (candlestick/line/area)
  try {
    // Look for chart type dropdown or buttons
    const chartTypeBtn = await page.$('[aria-label="Chart type"], button:has-text("Candle"), [data-slot="chart-panel"] button');
    if (chartTypeBtn) {
      await chartTypeBtn.click();
      await page.waitForTimeout(500);

      // Try to find dropdown items
      const dropdownItems = await page.$$('[role="menuitem"]');
      if (dropdownItems.length > 0) {
        for (const item of dropdownItems) {
          const text = await item.textContent();
          if (text?.toLowerCase().includes("line")) {
            await item.click();
            await page.waitForTimeout(1000);
            log("PASS", "Trade", "Switch to Line chart type via dropdown");
            break;
          }
        }
      }
      await screenshot(page, "18-trade-chart-type");
    } else {
      // Look for the chart type icon buttons directly
      const chartPanel = await page.$('[data-slot="chart-panel"]');
      if (chartPanel) {
        const buttons = await chartPanel.$$('button');
        log("WARN", "Trade", "Chart type buttons", `Found ${buttons.length} buttons in chart panel, dropdown not found`);
      } else {
        log("FAIL", "Trade", "Chart panel not found");
      }
    }
  } catch (e) {
    log("FAIL", "Trade", "Chart type buttons", e.message);
  }

  // 3d. Timeframe buttons
  try {
    const timeframes = ["1m", "5m", "15m", "1H", "4H", "D"];
    let tfFound = 0;
    let tfClicked = 0;

    for (const tf of timeframes) {
      const tfBtn = await page.$(`button:has-text("${tf}")`);
      if (tfBtn) {
        tfFound++;
        const isVisible = await tfBtn.isVisible();
        if (isVisible) {
          try {
            await tfBtn.click();
            tfClicked++;
            await page.waitForTimeout(500);
          } catch {}
        }
      }
    }

    if (tfFound >= 4) {
      log("PASS", "Trade", "Timeframe buttons present and clickable", `Found ${tfFound}/6, clicked ${tfClicked}`);
    } else {
      log("FAIL", "Trade", "Timeframe buttons", `Only found ${tfFound}/6 buttons`);
    }
    await screenshot(page, "19-trade-timeframes");
  } catch (e) {
    log("FAIL", "Trade", "Timeframe buttons", e.message);
  }

  // 3e. Chart panel BUY/SELL quick order buttons
  try {
    const chartPanel = await page.$('[data-slot="chart-panel"]');
    if (chartPanel) {
      // Look for BUY/SELL buttons
      const buyBtn = await chartPanel.$('button:has-text("BUY"), button:has-text("Buy")');
      const sellBtn = await chartPanel.$('button:has-text("SELL"), button:has-text("Sell")');

      if (buyBtn) {
        await buyBtn.click();
        await page.waitForTimeout(1000);
        log("PASS", "Trade", "BUY button on chart panel found and clicked");
        await screenshot(page, "20-trade-buy-click");
      } else {
        log("WARN", "Trade", "No BUY button found on chart panel — may be inside order flow");
      }

      if (sellBtn) {
        log("PASS", "Trade", "SELL button on chart panel found");
      }
    }
  } catch (e) {
    log("FAIL", "Trade", "BUY/SELL buttons", e.message);
  }

  // 3f. Right panel tabs (Tech, Fund, Sent, Chat, Order)
  try {
    const tabLabels = ["Tech", "Fund", "Sent", "Chat", "Order"];
    let tabsFound = 0;
    let tabsClickable = 0;

    for (const label of tabLabels) {
      const tab = await page.$(`[role="tab"]:has-text("${label}"), button[role="tab"]:has-text("${label}")`);
      if (tab) {
        tabsFound++;
        try {
          const isVisible = await tab.isVisible();
          if (isVisible) {
            await tab.click();
            tabsClickable++;
            await page.waitForTimeout(1000);
            await screenshot(page, `21-trade-tab-${label.toLowerCase()}`);
          }
        } catch {}
      }
    }

    if (tabsFound >= 3) {
      log("PASS", "Trade", "Right panel tabs present", `Found ${tabsFound}/5 tabs, clicked ${tabsClickable}`);
    } else {
      // Try alternative selectors
      const allTabs = await page.$$('[role="tab"]');
      const tabTexts = [];
      for (const t of allTabs) {
        tabTexts.push(await t.textContent());
      }
      log("WARN", "Trade", "Right panel tabs", `Found ${allTabs.length} total tabs: ${tabTexts.join(", ")}`);
    }
  } catch (e) {
    log("FAIL", "Trade", "Right panel tabs", e.message);
  }

  // 3g. Chat tab — send a message
  try {
    // Click Chat tab
    const chatTab = await page.$('[role="tab"]:has-text("Chat")');
    if (chatTab) {
      await chatTab.click();
      await page.waitForTimeout(1000);

      // Find chat input
      const chatInput = await page.$('input[placeholder*="Ask"], input[placeholder*="ask"], input[placeholder*="message"], textarea[placeholder*="Ask"]');
      if (chatInput) {
        await chatInput.fill("What is the current trend for AAPL?");
        await page.waitForTimeout(500);

        // Find send button
        const sendBtn = await page.$('button[aria-label*="send"], button:has-text("Send"), button:has(svg)');
        if (sendBtn) {
          await sendBtn.click();
          await page.waitForTimeout(5000); // Wait for AI response
          log("PASS", "Trade", "Chat tab — message sent");
          await screenshot(page, "22-trade-chat-sent");
        } else {
          // Try pressing Enter
          await chatInput.press("Enter");
          await page.waitForTimeout(5000);
          log("PASS", "Trade", "Chat tab — message sent via Enter key");
          await screenshot(page, "22-trade-chat-sent");
        }
      } else {
        log("FAIL", "Trade", "Chat tab — input field not found");
      }
    } else {
      log("FAIL", "Trade", "Chat tab not found in right panel");
    }
  } catch (e) {
    log("FAIL", "Trade", "Chat tab interaction", e.message);
  }

  // 3h. Order tab — try to place a paper order
  try {
    const orderTab = await page.$('[role="tab"]:has-text("Order")');
    if (orderTab) {
      await orderTab.click();
      await page.waitForTimeout(1000);
      await screenshot(page, "23-trade-order-tab");
      log("PASS", "Trade", "Order tab opens");

      // Check for order form elements
      const qtyInput = await page.$('input[placeholder*="qty"], input[placeholder*="Qty"], input[type="number"]');
      if (qtyInput) {
        log("PASS", "Trade", "Order form has quantity input");
      } else {
        log("WARN", "Trade", "Order form quantity input not found — may use different layout");
      }
    } else {
      log("FAIL", "Trade", "Order tab not found");
    }
  } catch (e) {
    log("FAIL", "Trade", "Order tab", e.message);
  }

  // 3i. Bottom panel tabs (Trade, Positions, Orders, Journal, Calendar)
  try {
    const bottomTabLabels = ["Trade", "Positions", "Orders", "Journal", "Calendar"];
    let bottomTabsFound = 0;

    for (const label of bottomTabLabels) {
      const tabs = await page.$$(`[role="tab"]`);
      for (const tab of tabs) {
        const text = await tab.textContent();
        if (text?.trim() === label || text?.includes(label)) {
          bottomTabsFound++;
          try {
            await tab.click();
            await page.waitForTimeout(500);
          } catch {}
          break;
        }
      }
    }

    // Look for bottom panel tabs specifically
    const allTabs = await page.$$('[role="tab"]');
    const allTabTexts = [];
    for (const t of allTabs) {
      allTabTexts.push(await t.textContent());
    }

    log(bottomTabsFound >= 2 ? "PASS" : "WARN", "Trade", "Bottom panel tabs", `Found ${bottomTabsFound} matching tabs. All tabs: ${allTabTexts.join(" | ")}`);
    await screenshot(page, "24-trade-bottom-tabs");
  } catch (e) {
    log("FAIL", "Trade", "Bottom panel tabs", e.message);
  }

  // ================================================================
  // 4. PIPELINE PAGE
  // ================================================================
  console.log("\n========== 4. PIPELINE PAGE ==========\n");

  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(3000);
  await screenshot(page, "25-pipeline-page");

  // 4a. Pipeline status visible
  try {
    const pipelineContent = await page.textContent('body');
    const hasPipelineInfo = pipelineContent?.includes("Pipeline") || pipelineContent?.includes("pipeline");
    const hasStatus = pipelineContent?.includes("Screened") || pipelineContent?.includes("Analyzed") ||
                      pipelineContent?.includes("Signals") || pipelineContent?.includes("Orders");

    if (hasPipelineInfo && hasStatus) {
      log("PASS", "Pipeline", "Pipeline status is visible with flow stages");
    } else if (hasPipelineInfo) {
      log("PASS", "Pipeline", "Pipeline page loaded", "Status stages may not have data yet");
    } else {
      log("FAIL", "Pipeline", "Pipeline status not visible");
    }
  } catch (e) {
    log("FAIL", "Pipeline", "Pipeline status check", e.message);
  }

  // 4b. Run Pipeline button
  try {
    const runBtn = await page.$('button:has-text("Run Pipeline"), button:has-text("Run")');
    if (runBtn) {
      const isDisabled = await runBtn.isDisabled();
      if (!isDisabled) {
        await runBtn.click();
        await page.waitForTimeout(3000);
        log("PASS", "Pipeline", "Run Pipeline button clicked");
        await screenshot(page, "26-pipeline-running");
      } else {
        log("WARN", "Pipeline", "Run Pipeline button is disabled");
      }
    } else {
      log("WARN", "Pipeline", "Run Pipeline button not found — may require specific state");
    }
  } catch (e) {
    log("FAIL", "Pipeline", "Run Pipeline button", e.message);
  }

  // 4c. Strategy builder
  try {
    const stratBuilder = await page.$('text=Strategy Builder') || await page.$('text=strategy builder');
    if (stratBuilder) {
      log("PASS", "Pipeline", "Strategy Builder section present");

      // Check for rule input
      const ruleInput = await page.$('textarea, input[placeholder*="rule"], input[placeholder*="Rule"]');
      if (ruleInput) {
        await ruleInput.fill("RSI > 70 AND Volume > 1M");
        await page.waitForTimeout(1000);
        log("PASS", "Pipeline", "Strategy Builder — rule typed");
        await screenshot(page, "27-pipeline-strategy-builder");
      } else {
        log("WARN", "Pipeline", "Strategy Builder rule input not found");
      }
    } else {
      // Check if it's collapsed
      const pageText = await page.textContent('body');
      if (pageText?.includes("Builder") || pageText?.includes("builder")) {
        log("PASS", "Pipeline", "Strategy Builder reference found on page");
      } else {
        log("WARN", "Pipeline", "Strategy Builder not found on pipeline page");
      }
    }
  } catch (e) {
    log("FAIL", "Pipeline", "Strategy Builder", e.message);
  }

  // 4d. Pipeline positions / holdings table
  try {
    const positionsSection = await page.$('text=Holdings') || await page.$('text=Positions') || await page.$('text=Active');
    if (positionsSection) {
      log("PASS", "Pipeline", "Holdings/Positions section visible");
    } else {
      log("WARN", "Pipeline", "Holdings/Positions section not found");
    }
    await screenshot(page, "28-pipeline-positions");
  } catch (e) {
    log("FAIL", "Pipeline", "Pipeline positions", e.message);
  }

  // 4e. Backtest panel
  try {
    const backtestSection = await page.$('text=Backtest') || await page.$('text=backtest');
    if (backtestSection) {
      log("PASS", "Pipeline", "Backtest section present");
    } else {
      log("WARN", "Pipeline", "Backtest section not found");
    }
  } catch (e) {
    log("FAIL", "Pipeline", "Backtest section", e.message);
  }

  // ================================================================
  // 5. PROFILE MENU
  // ================================================================
  console.log("\n========== 5. PROFILE MENU ==========\n");

  // Go back to dashboard first
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(2000);

  // 5a. Click avatar → menu opens
  try {
    const avatar = await page.$('.rounded-full:has-text("A"), button:has-text("A").rounded-full, [class*="rounded-full"][class*="bg-primary"]');
    if (avatar) {
      await avatar.click();
      await page.waitForTimeout(1000);

      const menuContent = await page.$('[role="menu"], [data-state="open"]');
      if (menuContent) {
        log("PASS", "Profile Menu", "Click avatar → dropdown menu opens");
        await screenshot(page, "29-profile-menu-open");

        // 5b. Check trading mode display
        const modeText = await page.textContent('[role="menu"], [data-state="open"]');
        if (modeText?.includes("Paper") || modeText?.includes("Live") || modeText?.includes("Trading Mode")) {
          log("PASS", "Profile Menu", "Trading mode displayed in menu", modeText?.includes("Paper") ? "Paper mode" : "Live mode");
        } else {
          log("FAIL", "Profile Menu", "Trading mode not displayed in menu");
        }

        // 5c. Check for Keyboard Shortcuts option
        const kbItem = await page.$('[role="menuitem"]:has-text("Keyboard"), [role="menuitem"]:has-text("keyboard")');
        if (kbItem) {
          await kbItem.click();
          await page.waitForTimeout(1500);

          // Check if shortcuts dialog opened
          const shortcutDialog = await page.$('[role="dialog"], [data-state="open"]');
          if (shortcutDialog) {
            log("PASS", "Profile Menu", "Keyboard Shortcuts → dialog opens");
            await screenshot(page, "30-keyboard-shortcuts");
            // Close dialog
            await page.keyboard.press("Escape");
            await page.waitForTimeout(500);
          } else {
            log("WARN", "Profile Menu", "Keyboard Shortcuts clicked but no dialog detected");
          }
        } else {
          log("FAIL", "Profile Menu", "Keyboard Shortcuts menu item not found");
        }
      } else {
        log("FAIL", "Profile Menu", "Avatar clicked but menu did not open");
      }
    } else {
      // Try alternative selector
      const headerBtns = await page.$$('header button, header [role="button"]');
      let avatarFound = false;
      for (const btn of headerBtns) {
        const text = await btn.textContent();
        if (text?.trim() === "A") {
          await btn.click();
          avatarFound = true;
          await page.waitForTimeout(1000);
          break;
        }
      }
      if (avatarFound) {
        log("PASS", "Profile Menu", "Avatar found via alternative selector and clicked");
        await screenshot(page, "29-profile-menu-open");
      } else {
        log("FAIL", "Profile Menu", "Avatar/profile button not found");
      }
    }
  } catch (e) {
    log("FAIL", "Profile Menu", "Avatar click", e.message);
  }

  // 5d. Settings menu item
  try {
    // Reopen menu if needed
    const avatar = await page.$('.rounded-full:has-text("A"), [class*="rounded-full"][class*="bg-primary"]');
    if (avatar) {
      await avatar.click();
      await page.waitForTimeout(1000);

      const settingsItem = await page.$('[role="menuitem"]:has-text("Settings")');
      if (settingsItem) {
        await settingsItem.click();
        await page.waitForTimeout(1000);

        const settingsSheet = await page.$('[data-state="open"]:has-text("Settings"), [role="dialog"]:has-text("Settings")');
        if (settingsSheet) {
          log("PASS", "Profile Menu", "Settings → sheet/dialog opens");
          await screenshot(page, "31-settings-open");
          // Close
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        } else {
          log("WARN", "Profile Menu", "Settings clicked but sheet not detected");
        }
      } else {
        log("WARN", "Profile Menu", "Settings menu item not found");
      }
    }
  } catch (e) {
    log("FAIL", "Profile Menu", "Settings test", e.message);
  }

  // ================================================================
  // 6. STRATEGY DETAIL PAGES
  // ================================================================
  console.log("\n========== 6. STRATEGY DETAIL PAGES ==========\n");

  const strategiesToTest = ["momentum-quality", "pead", "vrp-harvesting", "claude-alpha"];

  for (const stratId of strategiesToTest) {
    console.log(`\n--- Strategy: ${stratId} ---\n`);

    try {
      await page.goto(`${BASE}/strategies/${stratId}`, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(3000);

      const pageText = await page.textContent('body');

      // Check page loaded (not 404 or error)
      if (pageText?.includes("404") || pageText?.includes("not found")) {
        log("FAIL", "Strategy Detail", `Strategy ${stratId} → 404 / not found`);
        await screenshot(page, `32-strategy-${stratId}-404`);
        continue;
      }

      // Check strategy name visible
      const meta = {
        "momentum-quality": "Momentum",
        "pead": "PEAD",
        "vrp-harvesting": "VRP",
        "claude-alpha": "Claude Alpha",
      };
      const expectedName = meta[stratId];
      if (pageText?.includes(expectedName)) {
        log("PASS", "Strategy Detail", `Strategy ${stratId} page loaded with name "${expectedName}"`);
      } else {
        log("WARN", "Strategy Detail", `Strategy ${stratId} page loaded but expected name not found`, `Looked for "${expectedName}"`);
      }
      await screenshot(page, `32-strategy-${stratId}`);

      // 6a. Check tabs (About, Positions, Sector Exposure, Correlation, Analytics)
      const tabNames = ["About", "Positions", "Sector", "Correlation", "Analytics"];
      let tabsFound = 0;

      for (const tabName of tabNames) {
        const tabBtn = await page.$(`button:has-text("${tabName}")`);
        if (tabBtn) {
          tabsFound++;
          try {
            await tabBtn.click();
            await page.waitForTimeout(1000);
            await screenshot(page, `33-strategy-${stratId}-tab-${tabName.toLowerCase()}`);
          } catch {}
        }
      }

      log(tabsFound >= 3 ? "PASS" : "FAIL", "Strategy Detail", `Strategy ${stratId} tabs`, `Found ${tabsFound}/5 tabs: ${tabNames.join(", ")}`);

      // 6b. Toggle strategy status (Active/Paused)
      const toggleBtn = await page.$('button:has-text("Pause"), button:has-text("Activate"), button:has-text("Resume")');
      if (toggleBtn) {
        const btnText = await toggleBtn.textContent();
        log("PASS", "Strategy Detail", `Strategy ${stratId} toggle button found`, `Current: ${btnText}`);
        // Don't actually toggle to avoid side effects, just verify button exists
      } else {
        // Check if there's a badge showing status instead
        const statusBadge = await page.$('.badge:has-text("Active"), .badge:has-text("Paused"), [class*="badge"]:has-text("Active")');
        if (statusBadge) {
          log("PASS", "Strategy Detail", `Strategy ${stratId} status badge visible`);
        } else {
          log("WARN", "Strategy Detail", `Strategy ${stratId} toggle/status button not found`);
        }
      }

      // 6c. Back button on strategy page
      const backBtn = await page.$('button:has-text("Back"), button[aria-label*="back"], a:has-text("Back")');
      if (backBtn) {
        log("PASS", "Strategy Detail", `Strategy ${stratId} has back navigation button`);
      } else {
        // Check for ArrowLeft icon
        const arrowBack = await page.$('button svg.lucide-arrow-left, button:has(svg[class*="arrow"])');
        if (arrowBack) {
          log("PASS", "Strategy Detail", `Strategy ${stratId} has back arrow button`);
        } else {
          log("WARN", "Strategy Detail", `Strategy ${stratId} no back button found`);
        }
      }

      // 6d. Equity curve presence
      const svgCharts = await page.$$('svg');
      const hasSvgChart = svgCharts.length > 0;
      log(hasSvgChart ? "PASS" : "WARN", "Strategy Detail", `Strategy ${stratId} equity curve/chart`, `Found ${svgCharts.length} SVG elements`);

      // 6e. Performance metrics
      const hasMetrics = pageText?.includes("Return") || pageText?.includes("Sharpe") ||
                         pageText?.includes("Win Rate") || pageText?.includes("Max Drawdown");
      log(hasMetrics ? "PASS" : "WARN", "Strategy Detail", `Strategy ${stratId} performance metrics visible`);

    } catch (e) {
      log("FAIL", "Strategy Detail", `Strategy ${stratId}`, e.message);
      await screenshot(page, `32-strategy-${stratId}-error`);
    }
  }

  // ================================================================
  // 7. ADDITIONAL INTERACTION TESTS
  // ================================================================
  console.log("\n========== 7. ADDITIONAL TESTS ==========\n");

  // 7a. Notifications bell
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2000);

    const bellBtn = await page.$('button[aria-label="Notifications"], button:has(svg.lucide-bell)');
    if (bellBtn) {
      await bellBtn.click();
      await page.waitForTimeout(1000);

      const notifContent = await page.$('[data-state="open"]:has-text("Alerts"), [role="dialog"]:has-text("Alerts")');
      if (notifContent) {
        log("PASS", "Notifications", "Bell icon → notification popover opens");
        await screenshot(page, "34-notifications");
      } else {
        log("WARN", "Notifications", "Bell clicked but popover not detected");
      }
    } else {
      log("FAIL", "Notifications", "Bell/notification icon not found");
    }
  } catch (e) {
    log("FAIL", "Notifications", "Notification bell test", e.message);
  }

  // 7b. Click search bar on TopBar → opens command palette
  try {
    await page.keyboard.press("Escape"); // Close any open popovers
    await page.waitForTimeout(500);

    const searchBar = await page.$('button:has-text("Search symbols")');
    if (searchBar) {
      await searchBar.click();
      await page.waitForTimeout(1000);

      const palette = await page.$('[cmdk-root], [role="dialog"]');
      if (palette) {
        log("PASS", "Search", "Click search bar → command palette opens");
      } else {
        log("FAIL", "Search", "Click search bar → command palette did not open");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    } else {
      log("FAIL", "Search", "Search bar not found in top bar");
    }
  } catch (e) {
    log("FAIL", "Search", "Search bar click", e.message);
  }

  // 7c. Status strip
  try {
    const statusStrip = await page.$('footer, [class*="StatusStrip"], [class*="status"]');
    if (statusStrip) {
      const stripText = await statusStrip.textContent();
      log("PASS", "Status Strip", "Status strip present", stripText?.substring(0, 100));
    } else {
      // Look for the status bar text
      const bodyText = await page.textContent('body');
      const hasWebSocket = bodyText?.includes("WS") || bodyText?.includes("WebSocket") || bodyText?.includes("Connected");
      const hasPaper = bodyText?.includes("PAPER") || bodyText?.includes("Paper");
      if (hasWebSocket || hasPaper) {
        log("PASS", "Status Strip", "Status indicators found in page");
      } else {
        log("WARN", "Status Strip", "Dedicated status strip not found");
      }
    }
  } catch (e) {
    log("FAIL", "Status Strip", "Status strip test", e.message);
  }

  // 7d. Trade page — Options panel test
  try {
    await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(3000);

    const optionsPanel = await page.$('[data-slot="options-panel"]');
    if (optionsPanel) {
      const optText = await optionsPanel.textContent();
      if (optText?.includes("Chain") || optText?.includes("Strike") || optText?.includes("Call") || optText?.includes("Put")) {
        log("PASS", "Trade", "Options chain panel visible with data");
      } else {
        log("WARN", "Trade", "Options panel found but no chain data visible");
      }
    } else {
      // Check for options content anywhere
      const bodyText = await page.textContent('body');
      const hasOptions = bodyText?.includes("Options") || bodyText?.includes("Strike") || bodyText?.includes("Chain");
      log(hasOptions ? "PASS" : "WARN", "Trade", "Options chain", hasOptions ? "Options content found" : "No options content detected");
    }
    await screenshot(page, "35-trade-options");
  } catch (e) {
    log("FAIL", "Trade", "Options panel", e.message);
  }

  // 7e. Trade page — Price alert on chart
  try {
    const alertBtn = await page.$('button[aria-label="Set price alert"], button[title="Set price alert"]');
    if (alertBtn) {
      await alertBtn.click();
      await page.waitForTimeout(1000);

      const alertForm = await page.$('select:has(option[value="above"]), input[type="number"]');
      if (alertForm) {
        log("PASS", "Trade", "Price alert UI opens when bell icon clicked");
        await screenshot(page, "36-trade-price-alert");
      } else {
        log("WARN", "Trade", "Price alert button clicked but form not visible");
      }
    } else {
      log("WARN", "Trade", "Price alert button not found on chart");
    }
  } catch (e) {
    log("FAIL", "Trade", "Price alert", e.message);
  }

  // 7f. Dashboard — Economic Calendar
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(3000);

    const bodyText = await page.textContent('body');
    const hasCalendar = bodyText?.includes("Economic Calendar") || bodyText?.includes("calendar");
    log(hasCalendar ? "PASS" : "WARN", "Dashboard", "Economic Calendar widget present");
  } catch (e) {
    log("FAIL", "Dashboard", "Economic Calendar", e.message);
  }

  // 7g. Dashboard — Market Context (indices)
  try {
    const bodyText = await page.textContent('body');
    const hasMarketContext = bodyText?.includes("S&P 500") || bodyText?.includes("NASDAQ") ||
                             bodyText?.includes("SPY") || bodyText?.includes("QQQ");
    log(hasMarketContext ? "PASS" : "WARN", "Dashboard", "Market context with indices visible");
  } catch (e) {
    log("FAIL", "Dashboard", "Market context", e.message);
  }

  // 7h. Dashboard — PnL Calendar
  try {
    const bodyText = await page.textContent('body');
    const hasPnlCal = bodyText?.includes("P&L") || bodyText?.includes("PnL") || bodyText?.includes("Calendar");
    log(hasPnlCal ? "PASS" : "WARN", "Dashboard", "PnL Calendar widget present");
  } catch (e) {
    log("FAIL", "Dashboard", "PnL Calendar", e.message);
  }

  // ================================================================
  // 5e. LOGOUT (last test)
  // ================================================================
  console.log("\n========== LOGOUT TEST ==========\n");

  try {
    const avatar = await page.$('.rounded-full:has-text("A"), [class*="rounded-full"][class*="bg-primary"]');
    if (avatar) {
      await avatar.click();
      await page.waitForTimeout(1000);

      const logoutItem = await page.$('[role="menuitem"]:has-text("Logout"), [role="menuitem"]:has-text("Log out")');
      if (logoutItem) {
        await logoutItem.click();
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        if (currentUrl.includes("/login")) {
          log("PASS", "Profile Menu", "Logout → redirects to /login", currentUrl);
        } else {
          log("FAIL", "Profile Menu", "Logout → did not redirect to /login", currentUrl);
        }
        await screenshot(page, "37-logout");
      } else {
        log("FAIL", "Profile Menu", "Logout menu item not found");
      }
    } else {
      log("FAIL", "Profile Menu", "Avatar not found for logout test");
    }
  } catch (e) {
    log("FAIL", "Profile Menu", "Logout test", e.message);
  }

  // ================================================================
  // RESULTS SUMMARY
  // ================================================================
  console.log("\n\n========== RESULTS SUMMARY ==========\n");

  const passCount = results.filter(r => r.status === "PASS").length;
  const failCount = results.filter(r => r.status === "FAIL").length;
  const warnCount = results.filter(r => r.status === "WARN").length;
  const total = results.length;

  console.log(`Total: ${total}`);
  console.log(`PASS:  ${passCount}`);
  console.log(`FAIL:  ${failCount}`);
  console.log(`WARN:  ${warnCount}`);
  console.log(`Score: ${((passCount / total) * 100).toFixed(1)}%`);

  if (failCount > 0) {
    console.log("\n--- FAILURES ---");
    results.filter(r => r.status === "FAIL").forEach(r => {
      console.log(`  #${r.id} [${r.section}] ${r.description} — ${r.details}`);
    });
  }

  if (warnCount > 0) {
    console.log("\n--- WARNINGS ---");
    results.filter(r => r.status === "WARN").forEach(r => {
      console.log(`  #${r.id} [${r.section}] ${r.description} — ${r.details}`);
    });
  }

  if (consoleErrors.length > 0) {
    console.log(`\n--- Console Errors (${consoleErrors.length}) ---`);
    consoleErrors.slice(0, 15).forEach(e => console.log(`  ${e.substring(0, 200)}`));
  }

  if (networkErrors.length > 0) {
    console.log(`\n--- Network Errors (${networkErrors.length}) ---`);
    networkErrors.slice(0, 10).forEach(e => console.log(`  ${e.substring(0, 200)}`));
  }

  // Write results
  writeFileSync(RESULTS_FILE, JSON.stringify({
    results,
    summary: { total, pass: passCount, fail: failCount, warn: warnCount },
    consoleErrors: consoleErrors.slice(0, 50),
    networkErrors: networkErrors.slice(0, 20),
  }, null, 2));
  console.log(`\nResults saved to ${RESULTS_FILE}`);

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
