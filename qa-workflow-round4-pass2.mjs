import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE = "https://tradingalpha.net";
const DIR = "./qa-screenshots/round4/workflows";
const RESULTS_FILE = "./qa-screenshots/round4/workflows/results-pass2.json";
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

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
  const filePath = path.join(DIR, `p2-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
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
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // LOGIN
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  const usernameInput = await page.$('input[placeholder="admin"], input[name="username"], input[type="text"]');
  const passwordInput = await page.$('input[type="password"]');
  await usernameInput.fill(USERNAME);
  await passwordInput.fill(PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  await page.waitForTimeout(3000);
  log("PASS", "Login", "Logged in successfully");

  // ================================================================
  // FIX #1: STRATEGY DETAIL PAGES — The "not found" text was a false positive
  // The pages DO load, the text "Not enough data for equity curve" contains "not found" substring issue
  // ================================================================
  console.log("\n========== STRATEGY DETAIL PAGES (Deep Test) ==========\n");

  const strategiesToTest = ["momentum-quality", "pead", "vrp-harvesting", "claude-alpha"];

  for (const stratId of strategiesToTest) {
    try {
      await page.goto(`${BASE}/strategies/${stratId}`, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(3000);

      // Check if we got redirected to login (auth failure) or error page
      const url = page.url();
      if (url.includes("/login")) {
        log("FAIL", "Strategy Detail", `Strategy ${stratId} → redirected to login (auth issue)`);
        continue;
      }

      // Check for actual 404 page vs strategy content
      const title = await page.title();
      const h1Text = await page.$eval('h1', el => el.textContent).catch(() => null);

      // Look for strategy-specific elements
      const hasBackButton = !!(await page.$('button:has-text("Back"), button svg'));
      const hasStrategyName = !!(await page.$('h2, h1'));
      const hasTabs = !!(await page.$('button:has-text("About"), button:has-text("Positions")'));
      const hasMetrics = !!(await page.$('.tabular-nums'));
      const hasStatusBadge = !!(await page.$('button:has-text("Pause"), button:has-text("Resume"), button:has-text("Activate")'));

      // Check actual page structure
      const pageContentSample = await page.evaluate(() => {
        const body = document.body?.textContent || '';
        return body.substring(0, 500);
      });

      if (hasStrategyName && (hasTabs || hasMetrics)) {
        log("PASS", "Strategy Detail", `Strategy ${stratId} page loads correctly`, `Has name: ${hasStrategyName}, tabs: ${hasTabs}, metrics: ${hasMetrics}`);
      } else {
        log("FAIL", "Strategy Detail", `Strategy ${stratId} page incomplete`, `Name: ${hasStrategyName}, tabs: ${hasTabs}, metrics: ${hasMetrics}`);
      }

      await screenshot(page, `strategy-${stratId}`);

      // Test each tab
      const tabNames = ["About", "Positions", "Sector Exposure", "Correlation", "Analytics"];
      let tabsClicked = 0;
      for (const tabName of tabNames) {
        const tabBtn = await page.$(`button:has-text("${tabName}")`);
        if (tabBtn) {
          const visible = await tabBtn.isVisible().catch(() => false);
          if (visible) {
            await tabBtn.click();
            tabsClicked++;
            await page.waitForTimeout(800);
            await screenshot(page, `strategy-${stratId}-${tabName.toLowerCase().replace(/ /g, "-")}`);
          }
        }
      }
      log(tabsClicked >= 3 ? "PASS" : "WARN", "Strategy Detail", `Strategy ${stratId} — ${tabsClicked}/5 tabs clickable`);

      // Test toggle button
      const pauseBtn = await page.$('button:has-text("Pause")');
      const resumeBtn = await page.$('button:has-text("Resume")');
      const activateBtn = await page.$('button:has-text("Activate")');
      const toggleBtn = pauseBtn || resumeBtn || activateBtn;

      if (toggleBtn) {
        const btnText = await toggleBtn.textContent();
        // Click it to test toggle
        await toggleBtn.click();
        await page.waitForTimeout(2000);

        // Check if status changed
        const newPauseBtn = await page.$('button:has-text("Pause")');
        const newResumeBtn = await page.$('button:has-text("Resume")');
        const newActivateBtn = await page.$('button:has-text("Activate")');
        const newBtn = newPauseBtn || newResumeBtn || newActivateBtn;
        const newText = newBtn ? await newBtn.textContent() : null;

        if (newText && newText !== btnText) {
          log("PASS", "Strategy Detail", `Strategy ${stratId} toggle works`, `${btnText} → ${newText}`);
          // Toggle back
          if (newBtn) {
            await newBtn.click();
            await page.waitForTimeout(2000);
          }
        } else {
          log("WARN", "Strategy Detail", `Strategy ${stratId} toggle clicked but state may not have changed`, `Was: ${btnText}, Now: ${newText}`);
        }
        await screenshot(page, `strategy-${stratId}-toggle`);
      } else {
        log("WARN", "Strategy Detail", `Strategy ${stratId} toggle button not found`);
      }

      // Check equity curve / chart
      const svgs = await page.$$('svg');
      const hasSvg = svgs.length > 0;
      const hasEquityCurve = await page.$('text=equity curve, text=Equity Curve') !== null ||
                             await page.evaluate(() => document.body.textContent.includes('equity curve'));
      log(hasSvg ? "PASS" : "WARN", "Strategy Detail", `Strategy ${stratId} — ${svgs.length} SVG elements (charts)`, hasEquityCurve ? "Equity curve text found" : "");

      // Back button functionality
      const backButton = await page.$('button:has(svg.lucide-arrow-left)');
      if (backButton) {
        await backButton.click();
        await page.waitForTimeout(2000);
        const afterBackUrl = page.url();
        if (afterBackUrl === `${BASE}/` || afterBackUrl === BASE) {
          log("PASS", "Strategy Detail", `Strategy ${stratId} back button → dashboard`);
        } else {
          log("WARN", "Strategy Detail", `Strategy ${stratId} back button → ${afterBackUrl}`);
        }
      }

    } catch (e) {
      log("FAIL", "Strategy Detail", `Strategy ${stratId}`, e.message);
    }
  }

  // ================================================================
  // FIX #2: TRADE PAGE TABS — The AnalysisPanel uses Tabs component internally
  // Tabs render as buttons with specific data attributes, not [role="tab"]
  // ================================================================
  console.log("\n========== TRADE PAGE TABS (Deep Test) ==========\n");

  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(4000);

  // Right panel tabs: Tech, Fund, Sent, Chat, Order
  try {
    // The AnalysisPanel uses Tabs from shadcn/ui with TabsTrigger elements
    // These use [data-state] attributes and specific text content
    const rightPanelTabs = ["Tech", "Fund", "Sent", "Chat", "Order"];
    let tabsFound = 0;
    let tabsClicked = 0;

    for (const tabName of rightPanelTabs) {
      // Try multiple selectors
      const tab = await page.$(`button:has-text("${tabName}")`) ||
                  await page.$(`[data-state]:has-text("${tabName}")`) ||
                  await page.$(`[role="tab"]:has-text("${tabName}")`);

      if (tab) {
        tabsFound++;
        const visible = await tab.isVisible().catch(() => false);
        if (visible) {
          await tab.click();
          tabsClicked++;
          await page.waitForTimeout(1000);
          await screenshot(page, `trade-tab-${tabName.toLowerCase()}`);
        }
      }
    }

    log(tabsFound >= 3 ? "PASS" : tabsFound > 0 ? "WARN" : "FAIL",
      "Trade Page", `Right panel tabs: found ${tabsFound}/5, clicked ${tabsClicked}`,
      rightPanelTabs.join(", "));

    // If we found tabs, test specific interactions
    if (tabsClicked > 0) {
      // Test Chat tab specifically
      const chatTab = await page.$('button:has-text("Chat")');
      if (chatTab) {
        await chatTab.click();
        await page.waitForTimeout(1000);

        // Find chat input — could be an Input component
        const chatInput = await page.$('input[placeholder*="Ask"], input[placeholder*="ask"], input[placeholder*="chat"]');
        if (chatInput) {
          await chatInput.fill("What's your view on AAPL?");
          // Press Enter or find send button
          await chatInput.press("Enter");
          await page.waitForTimeout(5000);

          // Check if response appeared
          const chatMessages = await page.$$('.rounded-lg.px-3.py-2, [class*="message"]');
          log(chatMessages.length >= 2 ? "PASS" : "WARN", "Trade Page", "Chat tab — message + response", `${chatMessages.length} messages visible`);
          await screenshot(page, "trade-chat-response");
        } else {
          log("WARN", "Trade Page", "Chat tab — input field not found with expected placeholder");
        }
      }
    }

  } catch (e) {
    log("FAIL", "Trade Page", "Right panel tabs test", e.message);
  }

  // Bottom panel / Trade Panel tabs
  try {
    // TradePanel uses Tabs for: Trade Builder, Positions, Orders, Journal, Calendar
    const bottomTabs = ["Trade", "Positions", "Orders", "Journal", "Calendar"];
    let bTabsFound = 0;

    // Get ALL buttons on the page that match these labels
    for (const tabName of bottomTabs) {
      const matchingBtns = await page.$$(`button:has-text("${tabName}")`);
      for (const btn of matchingBtns) {
        const visible = await btn.isVisible().catch(() => false);
        if (visible) {
          const rect = await btn.boundingBox();
          // Bottom panel buttons should be in the lower portion of the screen
          if (rect && rect.y > 500) {
            bTabsFound++;
            try {
              await btn.click();
              await page.waitForTimeout(500);
              await screenshot(page, `trade-bottom-${tabName.toLowerCase()}`);
            } catch {}
            break;
          }
        }
      }
    }

    log(bTabsFound >= 2 ? "PASS" : "WARN", "Trade Page", `Bottom panel tabs: found ${bTabsFound}/5`);

  } catch (e) {
    log("FAIL", "Trade Page", "Bottom panel tabs", e.message);
  }

  // Test chart type switching (using the dropdown)
  try {
    // The chart type is controlled by a dropdown menu triggered by a button with icon
    // Look for the chart type dropdown button in the chart panel header
    const chartPanel = await page.$('[data-slot="chart-panel"]');
    if (chartPanel) {
      // Look for dropdown triggers that contain chart-type icons
      const dropdownTriggers = await chartPanel.$$('button');
      let chartTypeDropdownFound = false;

      for (const trigger of dropdownTriggers) {
        const rect = await trigger.boundingBox();
        if (rect && rect.y < 100) { // Header area
          // Check for chart type indicator (candle/line/area icons)
          const hasChartIcon = await trigger.$('svg.lucide-candlestick-chart, svg.lucide-line-chart, svg.lucide-area-chart');
          if (hasChartIcon) {
            await trigger.click();
            await page.waitForTimeout(500);

            // Check for dropdown menu
            const menuItems = await page.$$('[role="menuitem"]');
            if (menuItems.length > 0) {
              chartTypeDropdownFound = true;
              // Click Line chart
              for (const item of menuItems) {
                const text = await item.textContent();
                if (text?.includes("Line")) {
                  await item.click();
                  await page.waitForTimeout(1000);
                  log("PASS", "Trade Page", "Chart type switch to Line via dropdown");
                  break;
                }
              }
            }
            break;
          }
        }
      }

      if (!chartTypeDropdownFound) {
        // It might be a direct button toggle instead
        log("WARN", "Trade Page", "Chart type dropdown not found — may use direct toggle buttons");
      }
    }
    await screenshot(page, "trade-chart-type-switch");
  } catch (e) {
    log("FAIL", "Trade Page", "Chart type switch", e.message);
  }

  // Test indicator toggles
  try {
    const chartPanel = await page.$('[data-slot="chart-panel"]');
    if (chartPanel) {
      const indicatorNames = ["EMA", "SMA", "Bollinger", "RSI", "MACD", "Volume"];
      let indsFound = 0;

      for (const ind of indicatorNames) {
        const btn = await chartPanel.$(`button:has-text("${ind}")`);
        if (btn) {
          indsFound++;
          const visible = await btn.isVisible().catch(() => false);
          if (visible) {
            await btn.click();
            await page.waitForTimeout(300);
          }
        }
      }
      log(indsFound >= 3 ? "PASS" : "WARN", "Trade Page", `Indicator toggle buttons: ${indsFound}/6 found`);
    }
  } catch (e) {
    log("FAIL", "Trade Page", "Indicator toggles", e.message);
  }

  // Test drawing tools
  try {
    const chartPanel = await page.$('[data-slot="chart-panel"]');
    if (chartPanel) {
      const drawBtn = await chartPanel.$('button:has-text("H-Line"), button:has-text("Draw"), button:has-text("Line")');
      if (drawBtn) {
        log("PASS", "Trade Page", "Drawing tools present");
      } else {
        log("WARN", "Trade Page", "Drawing tool buttons not found (may require interaction)");
      }
    }
  } catch (e) {
    log("FAIL", "Trade Page", "Drawing tools", e.message);
  }

  // ================================================================
  // FIX #3: KEYBOARD SHORTCUTS DIALOG
  // The ProfileMenu dispatches a keyboard event for "?" which should trigger a dialog
  // ================================================================
  console.log("\n========== KEYBOARD SHORTCUTS (Deep Test) ==========\n");

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(3000);

  try {
    // Try pressing "?" directly (the keyboard shortcut handler)
    await page.keyboard.press("Shift+/"); // = "?"
    await page.waitForTimeout(1500);

    const shortcutDialog = await page.$('[role="dialog"], [data-state="open"]');
    if (shortcutDialog) {
      const dialogText = await shortcutDialog.textContent();
      if (dialogText?.includes("Shortcut") || dialogText?.includes("shortcut") || dialogText?.includes("Keyboard")) {
        log("PASS", "Keyboard Shortcuts", "? key → shortcuts dialog opens");
      } else {
        log("WARN", "Keyboard Shortcuts", "? key opened a dialog but content unclear", dialogText?.substring(0, 100));
      }
      await screenshot(page, "keyboard-shortcuts-dialog");
      await page.keyboard.press("Escape");
    } else {
      log("WARN", "Keyboard Shortcuts", "? key did not open a visible dialog — handler may not be registered");
    }
  } catch (e) {
    log("FAIL", "Keyboard Shortcuts", "? shortcut test", e.message);
  }

  // ================================================================
  // STRATEGY BUILDER — input test
  // ================================================================
  console.log("\n========== STRATEGY BUILDER (Deep Test) ==========\n");

  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(3000);

  try {
    // Look for strategy builder inputs — they may be text areas or rich editors
    const allInputs = await page.$$('input, textarea');
    const inputDetails = [];
    for (const inp of allInputs) {
      const tag = await inp.evaluate(el => el.tagName);
      const type = await inp.getAttribute('type');
      const placeholder = await inp.getAttribute('placeholder');
      const name = await inp.getAttribute('name');
      const rect = await inp.boundingBox();
      inputDetails.push({ tag, type, placeholder, name, y: rect?.y });
    }

    log("PASS", "Pipeline", `Found ${allInputs.length} input/textarea elements`, JSON.stringify(inputDetails.slice(0, 10)));

    // Look for the strategy builder section
    const builderSection = await page.$('text=Strategy Builder');
    if (builderSection) {
      // Find inputs near the builder section
      const builderInputs = await page.$$('textarea, input[type="text"]');
      let ruleInputFound = false;
      for (const inp of builderInputs) {
        const rect = await inp.boundingBox();
        const placeholder = await inp.getAttribute('placeholder');
        // Strategy builder is in the middle of the page
        if (rect && rect.y > 300 && rect.y < 800) {
          await inp.fill("RSI > 70 AND price > SMA(50)");
          await page.waitForTimeout(500);
          ruleInputFound = true;
          log("PASS", "Pipeline", "Strategy Builder — rule input found and filled");
          await screenshot(page, "pipeline-strategy-builder-rule");
          break;
        }
      }
      if (!ruleInputFound) {
        // Check if it uses a custom editor or button-based interface
        const addRuleBtn = await page.$('button:has-text("ADD"), button:has-text("Add Rule"), button:has-text("add")');
        if (addRuleBtn) {
          log("PASS", "Pipeline", "Strategy Builder uses button-based rule interface");
        } else {
          log("WARN", "Pipeline", "Strategy Builder rule input not found (may use different UI pattern)");
        }
      }
    }
  } catch (e) {
    log("FAIL", "Pipeline", "Strategy Builder test", e.message);
  }

  // ================================================================
  // TRADE PAGE — Order placement flow
  // ================================================================
  console.log("\n========== ORDER PLACEMENT FLOW ==========\n");

  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(4000);

  try {
    // Look for Trade Builder in the right panel
    const tradeBtn = await page.$('button:has-text("Trade")');
    if (tradeBtn) {
      const rect = await tradeBtn.boundingBox();
      // Click the Trade tab that's in the bottom-right trade panel area
      if (rect && rect.x > 1500) {
        await tradeBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    // Find Order Builder / Trade Builder elements
    const addLegBtn = await page.$('button:has-text("Add Leg"), button:has-text("Add")');
    const submitBtn = await page.$('button:has-text("Submit"), button:has-text("Place Order"), button:has-text("Execute")');

    if (addLegBtn || submitBtn) {
      log("PASS", "Trade Page", "Trade/Order Builder elements found", `Add Leg: ${!!addLegBtn}, Submit: ${!!submitBtn}`);
    }

    // Check for paper mode indicator
    const paperIndicator = await page.$('text=Paper') || await page.$('text=PAPER');
    if (paperIndicator) {
      log("PASS", "Trade Page", "Paper trading mode indicator visible");
    }

    await screenshot(page, "trade-order-builder");
  } catch (e) {
    log("FAIL", "Trade Page", "Order placement flow", e.message);
  }

  // ================================================================
  // RESPONSIVE / EDGE CASES
  // ================================================================
  console.log("\n========== EDGE CASE TESTS ==========\n");

  // Test: Navigate to non-existent strategy
  try {
    await page.goto(`${BASE}/strategies/nonexistent-strategy-xyz`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(3000);
    const pageText = await page.textContent('body');
    const url = page.url();
    // Should show error or redirect
    if (url.includes("/login")) {
      log("WARN", "Edge Case", "Non-existent strategy redirects to login");
    } else if (pageText?.includes("404") || pageText?.includes("Error") || pageText?.includes("not found")) {
      log("PASS", "Edge Case", "Non-existent strategy shows error page");
    } else {
      log("WARN", "Edge Case", "Non-existent strategy — page loaded without clear error", url);
    }
    await screenshot(page, "edge-nonexistent-strategy");
  } catch (e) {
    log("FAIL", "Edge Case", "Non-existent strategy", e.message);
  }

  // Test: WebSocket status on trade page
  try {
    await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(3000);

    const bodyText = await page.textContent('body');
    const hasWsIndicator = bodyText?.includes("WS") || bodyText?.includes("Connected") ||
                            bodyText?.includes("Disconnected") || bodyText?.includes("Reconnecting");
    log(hasWsIndicator ? "PASS" : "WARN", "Edge Case", "WebSocket status indicator present");
  } catch (e) {
    log("FAIL", "Edge Case", "WebSocket status", e.message);
  }

  // Test: Check all console errors
  if (consoleErrors.length > 0) {
    const criticalErrors = consoleErrors.filter(e =>
      !e.includes("404") && !e.includes("favicon") && !e.includes("workbox") &&
      !e.includes("service-worker") && !e.includes("manifest")
    );
    if (criticalErrors.length > 0) {
      log("WARN", "Console", `${criticalErrors.length} console errors detected`, criticalErrors.slice(0, 5).join(" | "));
    } else {
      log("PASS", "Console", "No critical console errors");
    }
  } else {
    log("PASS", "Console", "No console errors detected");
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log("\n\n========== PASS 2 RESULTS SUMMARY ==========\n");

  const passCount = results.filter(r => r.status === "PASS").length;
  const failCount = results.filter(r => r.status === "FAIL").length;
  const warnCount = results.filter(r => r.status === "WARN").length;
  const total = results.length;

  console.log(`Total: ${total}`);
  console.log(`PASS:  ${passCount}`);
  console.log(`FAIL:  ${failCount}`);
  console.log(`WARN:  ${warnCount}`);

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

  writeFileSync(RESULTS_FILE, JSON.stringify({ results, summary: { total, pass: passCount, fail: failCount, warn: warnCount }, consoleErrors: consoleErrors.slice(0, 30) }, null, 2));
  console.log(`\nResults saved to ${RESULTS_FILE}`);

  await browser.close();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
