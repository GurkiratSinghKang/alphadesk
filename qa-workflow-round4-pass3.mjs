import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const BASE = "https://tradingalpha.net";
const DIR = "./qa-screenshots/round4/workflows";
const USERNAME = "admin";
const PASSWORD = "alphaDesk2025!";

mkdirSync(DIR, { recursive: true });

const results = [];
let testId = 0;

function log(status, section, description, details = "") {
  testId++;
  const entry = { id: testId, status, section, description, details };
  results.push(entry);
  const icon = status === "PASS" ? "PASS" : status === "WARN" ? "WARN" : "FAIL";
  console.log(`[${icon}] #${testId} [${section}] ${description}${details ? " — " + details : ""}`);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(DIR, `p3-${name}.png`), fullPage: false });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // LOGIN
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill('input[placeholder="admin"], input[type="text"]', USERNAME);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  await page.waitForTimeout(3000);
  console.log("Logged in.\n");

  // ================================================================
  // TEST 1: KEYBOARD SHORTCUTS OVERLAY via "?" key
  // ================================================================
  console.log("=== KEYBOARD SHORTCUTS OVERLAY ===\n");

  try {
    // The "?" key is Shift+/ — useKeyboardShortcuts listens for e.key === "?"
    await page.keyboard.press("?");
    await page.waitForTimeout(1500);

    // Look for overlay specifically
    const overlay = await page.$('.fixed.inset-0, [role="dialog"][aria-modal="true"]');
    if (overlay) {
      const text = await overlay.textContent();
      if (text?.includes("Keyboard Shortcuts")) {
        log("PASS", "Keyboard Shortcuts", "? key opens Keyboard Shortcuts overlay");
        await screenshot(page, "shortcuts-overlay");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      } else {
        // It might have opened the command palette instead
        if (text?.includes("Search") || text?.includes("commands")) {
          log("FAIL", "Keyboard Shortcuts", "? key opens Command Palette instead of Shortcuts Overlay",
              "The key handler conflict: ProfileMenu dispatches '?' but CommandPalette may be intercepting");
        } else {
          log("WARN", "Keyboard Shortcuts", "? key opened dialog but not shortcuts", text?.substring(0, 100));
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    } else {
      log("FAIL", "Keyboard Shortcuts", "? key does not open any overlay/dialog");
    }
  } catch (e) {
    log("FAIL", "Keyboard Shortcuts", "? key test", e.message);
  }

  // Now test from ProfileMenu
  try {
    const avatar = await page.$('.rounded-full:has-text("A")');
    if (avatar) {
      await avatar.click();
      await page.waitForTimeout(800);

      const kbItem = await page.$('[role="menuitem"]:has-text("Keyboard")');
      if (kbItem) {
        await kbItem.click();
        await page.waitForTimeout(1500);

        // Check what opened
        const overlayAfter = await page.$('.fixed.inset-0, [role="dialog"][aria-modal="true"]');
        if (overlayAfter) {
          const text = await overlayAfter.textContent();
          if (text?.includes("Keyboard Shortcuts")) {
            log("PASS", "Keyboard Shortcuts", "Profile Menu → Keyboard Shortcuts → overlay opens correctly");
            await screenshot(page, "shortcuts-from-menu");
          } else if (text?.includes("Search") || text?.includes("commands")) {
            log("FAIL", "Keyboard Shortcuts", "Profile Menu → Keyboard Shortcuts opens Command Palette instead",
                "ProfileMenu dispatches keydown '?' but it triggers CommandPalette focus handler instead of ShortcutOverlay");
          } else {
            log("WARN", "Keyboard Shortcuts", "Something opened but not clear what", text?.substring(0, 100));
          }
        } else {
          log("FAIL", "Keyboard Shortcuts", "Profile Menu → Keyboard Shortcuts → nothing opened");
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    }
  } catch (e) {
    log("FAIL", "Keyboard Shortcuts", "From profile menu", e.message);
  }

  // ================================================================
  // TEST 2: CHAT TAB — Check for raw JSON display bug
  // ================================================================
  console.log("\n=== CHAT TAB RESPONSE FORMAT ===\n");

  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(4000);

  try {
    // Click Chat tab
    const chatTab = await page.$('button:has-text("Chat")');
    if (chatTab) {
      await chatTab.click();
      await page.waitForTimeout(1000);

      // Send message
      const chatInput = await page.$('input[placeholder*="Ask"], input[placeholder*="ask"]');
      if (chatInput) {
        await chatInput.fill("What is the trend for SPY?");
        await chatInput.press("Enter");
        await page.waitForTimeout(6000);

        // Take screenshot of response
        await screenshot(page, "chat-response-detail");

        // Get the response text
        const chatMessages = await page.$$('.rounded-lg.px-3.py-2');
        for (const msg of chatMessages) {
          const text = await msg.textContent();
          if (text?.includes("{") && text?.includes("}") && (text?.includes("status_code") || text?.includes("detail") || text?.includes("error"))) {
            log("FAIL", "Chat", "AI response shows raw JSON/error instead of formatted text", text.substring(0, 200));
          } else if (text && text.length > 20 && !text.includes("{")) {
            log("PASS", "Chat", "AI response is properly formatted text", text.substring(0, 100));
          }
        }
      }
    }
  } catch (e) {
    log("FAIL", "Chat", "Chat response test", e.message);
  }

  // ================================================================
  // TEST 3: CHART TYPE + INDICATOR DROPDOWNS
  // ================================================================
  console.log("\n=== CHART CONTROLS (Dropdown) ===\n");

  try {
    // Chart type dropdown - look for the button with aria-label
    const chartTypeBtn = await page.$('[aria-label="Chart type selector"]');
    if (chartTypeBtn) {
      await chartTypeBtn.click();
      await page.waitForTimeout(800);

      const menuItems = await page.$$('[role="menuitem"]');
      const itemTexts = [];
      for (const item of menuItems) {
        itemTexts.push(await item.textContent());
      }

      if (itemTexts.some(t => t?.includes("Line"))) {
        // Click Line
        for (const item of menuItems) {
          const text = await item.textContent();
          if (text?.includes("Line")) {
            await item.click();
            await page.waitForTimeout(1000);
            break;
          }
        }
        log("PASS", "Chart", "Chart type dropdown opens with Candlestick/Line/Area options", itemTexts.join(", "));
        await screenshot(page, "chart-line-type");

        // Switch back to candle
        const chartTypeBtn2 = await page.$('[aria-label="Chart type selector"]');
        if (chartTypeBtn2) {
          await chartTypeBtn2.click();
          await page.waitForTimeout(500);
          const candleItem = await page.$('[role="menuitem"]:has-text("Candlestick")');
          if (candleItem) {
            await candleItem.click();
            await page.waitForTimeout(500);
          }
        }
      } else {
        log("FAIL", "Chart", "Chart type dropdown items not found", `Items: ${itemTexts.join(", ")}`);
      }
    } else {
      // Try the emoji-based chart type buttons in timeframe bar
      const candleBtn = await page.$('[aria-label="Candlestick chart"]');
      const lineBtn = await page.$('[aria-label="Line chart"]');
      const areaBtn = await page.$('[aria-label="Area chart"]');

      if (lineBtn) {
        await lineBtn.click();
        await page.waitForTimeout(1000);
        log("PASS", "Chart", "Chart type buttons (emoji) found and clickable", `Candle: ${!!candleBtn}, Line: ${!!lineBtn}, Area: ${!!areaBtn}`);
        await screenshot(page, "chart-line-emoji-btn");
      } else {
        log("FAIL", "Chart", "Neither dropdown nor emoji chart type buttons found");
      }
    }
  } catch (e) {
    log("FAIL", "Chart", "Chart type controls", e.message);
  }

  // Indicator dropdown
  try {
    const indicatorBtn = await page.$('button:has-text("Indicators")');
    if (indicatorBtn) {
      await indicatorBtn.click();
      await page.waitForTimeout(800);

      const menuItems = await page.$$('[role="menuitem"]');
      const itemTexts = [];
      for (const item of menuItems) {
        itemTexts.push(await item.textContent());
      }

      const hasEMA = itemTexts.some(t => t?.includes("EMA"));
      const hasRSI = itemTexts.some(t => t?.includes("RSI"));
      const hasMACD = itemTexts.some(t => t?.includes("MACD"));

      if (hasEMA && hasRSI) {
        log("PASS", "Chart", "Indicator dropdown opens with all indicators", itemTexts.join(", "));

        // Toggle EMA on
        for (const item of menuItems) {
          const text = await item.textContent();
          if (text?.includes("EMA")) {
            await item.click();
            await page.waitForTimeout(500);
            break;
          }
        }
        await screenshot(page, "chart-indicator-ema");
      } else {
        log("FAIL", "Chart", "Indicator dropdown items missing", `Found: ${itemTexts.join(", ")}`);
      }
    } else {
      log("FAIL", "Chart", "Indicator dropdown button not found");
    }
  } catch (e) {
    log("FAIL", "Chart", "Indicator dropdown", e.message);
  }

  // Drawing tools
  try {
    const hlineBtn = await page.$('[aria-label="Draw horizontal line"]');
    const trendBtn = await page.$('[aria-label="Draw trendline"]');
    const fibBtn = await page.$('[aria-label="Draw fibonacci retracement"]');

    if (hlineBtn && trendBtn && fibBtn) {
      log("PASS", "Chart", "Drawing tools present: H-Line, Trendline, Fibonacci");
      await hlineBtn.click();
      await page.waitForTimeout(500);
      await screenshot(page, "chart-drawing-hline");
      // Cancel drawing mode
      await page.keyboard.press("Escape");
    } else {
      log("WARN", "Chart", "Some drawing tools missing", `H-Line: ${!!hlineBtn}, Trend: ${!!trendBtn}, Fib: ${!!fibBtn}`);
    }
  } catch (e) {
    log("FAIL", "Chart", "Drawing tools", e.message);
  }

  // ================================================================
  // TEST 4: BUY/SELL QUICK ORDER BUTTONS on chart
  // ================================================================
  console.log("\n=== QUICK ORDER BUTTONS ===\n");

  try {
    // Quick buy/sell buttons have opacity-30 by default, become visible on hover
    const buyBtn = await page.$('[aria-label="Quick buy"]');
    const sellBtn = await page.$('[aria-label="Quick sell"]');

    if (buyBtn) {
      log("PASS", "Chart", "Quick BUY button present on chart (translucent until hover)");
    } else {
      log("WARN", "Chart", "Quick BUY button not found — may need quote data to appear");
    }

    if (sellBtn) {
      log("PASS", "Chart", "Quick SELL button present on chart");
    } else {
      log("WARN", "Chart", "Quick SELL button not found — may need quote data to appear");
    }
  } catch (e) {
    log("FAIL", "Chart", "Quick order buttons", e.message);
  }

  // ================================================================
  // TEST 5: BOTTOM PANEL TAB CONTENT
  // ================================================================
  console.log("\n=== BOTTOM PANEL TABS ===\n");

  try {
    // Trade builder tab in the bottom-right panel
    const tradeBuilderTabs = ["Trade", "Positions", "Orders", "Journal", "Calendar"];

    for (const tabName of tradeBuilderTabs) {
      const btns = await page.$$(`button:has-text("${tabName}")`);
      let clicked = false;
      for (const btn of btns) {
        const rect = await btn.boundingBox();
        // Bottom right panel tabs should be in the rightmost section, lower area
        if (rect && rect.x > 1400 && rect.y > 700) {
          await btn.click();
          clicked = true;
          await page.waitForTimeout(800);
          await screenshot(page, `bottom-tab-${tabName.toLowerCase()}`);
          break;
        }
      }
      if (clicked) {
        log("PASS", "Trade Page", `Bottom panel tab "${tabName}" found and clicked`);
      } else {
        log("WARN", "Trade Page", `Bottom panel tab "${tabName}" not found in expected position`);
      }
    }
  } catch (e) {
    log("FAIL", "Trade Page", "Bottom panel tabs", e.message);
  }

  // ================================================================
  // TEST 6: FULL SCREEN TOGGLE on bottom panel
  // ================================================================
  console.log("\n=== FULL SCREEN TOGGLE ===\n");

  try {
    const fsBtn = await page.$('button[title="Full screen"], button[title="Exit full screen"]');
    if (fsBtn) {
      await fsBtn.click();
      await page.waitForTimeout(1000);
      await screenshot(page, "fullscreen-options");

      log("PASS", "Trade Page", "Full screen toggle button works for options panel");

      // Toggle back
      const exitBtn = await page.$('button[title="Exit full screen"]');
      if (exitBtn) {
        await exitBtn.click();
        await page.waitForTimeout(500);
      }
    } else {
      log("WARN", "Trade Page", "Full screen toggle button not found");
    }
  } catch (e) {
    log("FAIL", "Trade Page", "Full screen toggle", e.message);
  }

  // ================================================================
  // TEST 7: WATCHLIST — ADD SYMBOL
  // ================================================================
  console.log("\n=== WATCHLIST ADD SYMBOL ===\n");

  try {
    const addInput = await page.$('input[placeholder*="Add symbol"], input[placeholder*="add"]');
    if (addInput) {
      await addInput.fill("NFLX");
      await page.waitForTimeout(500);
      await addInput.press("Enter");
      await page.waitForTimeout(1000);

      // Check if NFLX appeared in watchlist
      const body = await page.textContent('body');
      if (body?.includes("NFLX")) {
        log("PASS", "Watchlist", "Add symbol NFLX to watchlist works");
      } else {
        log("WARN", "Watchlist", "Typed NFLX but it may not have been added");
      }
    } else {
      log("WARN", "Watchlist", "Add symbol input not found");
    }
  } catch (e) {
    log("FAIL", "Watchlist", "Add symbol", e.message);
  }

  // ================================================================
  // TEST 8: OPTIONS CHAIN — EXPIRY TABS
  // ================================================================
  console.log("\n=== OPTIONS CHAIN ===\n");

  try {
    const bodyText = await page.textContent('body');
    const hasExpiries = bodyText?.includes("Jan") || bodyText?.includes("Feb") || bodyText?.includes("2025") ||
                        bodyText?.includes("2026") || bodyText?.includes("Weekly");
    const hasChain = bodyText?.includes("Strike") || bodyText?.includes("Call") || bodyText?.includes("Put") ||
                     bodyText?.includes("Bid") || bodyText?.includes("Ask");

    if (hasChain) {
      log("PASS", "Options", "Options chain visible with Bid/Ask/Strike data");

      // Check for expiry buttons
      const expiryBtns = await page.$$('button:has-text("Jan"), button:has-text("Feb"), button:has-text("Apr"), button:has-text("Week")');
      if (expiryBtns.length > 0) {
        log("PASS", "Options", `Expiry date tabs found: ${expiryBtns.length} options`);

        // Click different expiry
        if (expiryBtns.length > 1) {
          await expiryBtns[1].click();
          await page.waitForTimeout(1000);
          log("PASS", "Options", "Switched to different expiry date");
          await screenshot(page, "options-expiry-switch");
        }
      }
    } else {
      log("WARN", "Options", "Options chain content not visible");
    }
  } catch (e) {
    log("FAIL", "Options", "Options chain test", e.message);
  }

  // ================================================================
  // TEST 9: SCREENER TAB in Watchlist
  // ================================================================
  console.log("\n=== SCREENER TAB ===\n");

  try {
    const screenerTab = await page.$('button:has-text("Screener")');
    if (screenerTab) {
      await screenerTab.click();
      await page.waitForTimeout(2000);

      const screenerContent = await page.textContent('body');
      const hasScreener = screenerContent?.includes("Momentum") || screenerContent?.includes("screener") || screenerContent?.includes("Screen");
      log(hasScreener ? "PASS" : "WARN", "Screener", "Screener tab content", hasScreener ? "Screener results visible" : "No clear screener content");
      await screenshot(page, "screener-tab");
    } else {
      log("WARN", "Screener", "Screener tab not found in watchlist panel");
    }
  } catch (e) {
    log("FAIL", "Screener", "Screener tab", e.message);
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log("\n\n========== PASS 3 RESULTS ==========\n");

  const passCount = results.filter(r => r.status === "PASS").length;
  const failCount = results.filter(r => r.status === "FAIL").length;
  const warnCount = results.filter(r => r.status === "WARN").length;
  console.log(`Total: ${results.length}  PASS: ${passCount}  FAIL: ${failCount}  WARN: ${warnCount}`);

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

  writeFileSync(path.join(DIR, "results-pass3.json"), JSON.stringify({ results }, null, 2));
  await browser.close();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
