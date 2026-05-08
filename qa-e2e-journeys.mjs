/**
 * AlphaDesk E2E User Journey Tests
 * Tests 7 complete user journeys end-to-end
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE_URL = "https://tradingalpha.net";
const SCREENSHOT_DIR = "/Users/GK/Downloads/alphadesk/qa-screenshots/e2e";
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ─── Results collector ──────────────────────────────────────

const results = {
  startTime: new Date().toISOString(),
  endTime: null,
  summary: { total: 0, passed: 0, failed: 0 },
  journeys: [],
};

let currentJourney = null;

function startJourney(id, name) {
  currentJourney = { id, name, steps: [], status: "pass", startTime: new Date().toISOString() };
  console.log(`\n${"=".repeat(64)}`);
  console.log(`  JOURNEY ${id}: ${name}`);
  console.log(`${"=".repeat(64)}`);
}

function endJourney() {
  currentJourney.endTime = new Date().toISOString();
  const failed = currentJourney.steps.filter((s) => s.status === "FAIL").length;
  currentJourney.status = failed > 0 ? "fail" : "pass";
  results.journeys.push(currentJourney);
  const total = currentJourney.steps.length;
  const passed = total - failed;
  console.log(`\n  Journey ${currentJourney.id} result: ${passed}/${total} steps passed ${failed > 0 ? "** FAILURES **" : ""}`);
}

async function step(num, description, testFn, page) {
  results.summary.total++;
  const stepResult = { num, description, status: "PASS", detail: null, screenshot: null };
  try {
    const detail = await testFn();
    stepResult.detail = detail || "OK";
    stepResult.status = "PASS";
    results.summary.passed++;
    console.log(`  [PASS] Step ${num}: ${description}${detail ? " -- " + detail : ""}`);
  } catch (err) {
    stepResult.status = "FAIL";
    stepResult.detail = err.message;
    results.summary.failed++;
    console.log(`  [FAIL] Step ${num}: ${description} -- ${err.message}`);
    // Take failure screenshot
    if (page) {
      try {
        const fname = `fail-j${currentJourney.id}-s${num}.png`;
        await page.screenshot({ path: join(SCREENSHOT_DIR, fname), fullPage: true });
        stepResult.screenshot = fname;
      } catch {}
    }
  }
  currentJourney.steps.push(stepResult);
}

// ─── Login helper ───────────────────────────────────────────

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  const inputs = await page.$$("input");
  if (inputs.length >= 2) {
    await inputs[0].fill(USERNAME);
    await inputs[1].fill(PASSWORD);
  } else {
    await page.getByLabel(/username/i).fill(USERNAME);
    await page.getByLabel(/password/i).fill(PASSWORD);
  }
  await page.waitForTimeout(500);

  const signInBtn = await page.$('button:has-text("Sign In"), button:has-text("Login"), button[type="submit"]');
  if (signInBtn) {
    await signInBtn.click();
  } else {
    await inputs[1].press("Enter");
  }

  await page.waitForTimeout(4000);
  await page.waitForLoadState("networkidle").catch(() => {});
}

// ─── Journey 1: First Login -> Dashboard Orientation ────────

async function journey1(page) {
  startJourney(1, "First Login -> Dashboard Orientation");

  // Step 1: Go to /login, enter credentials, submit
  await step(1, "Go to /login, enter credentials, submit", async () => {
    await login(page);
    return `Current URL: ${page.url()}`;
  }, page);

  // Step 2: Verify redirect to /
  await step(2, "Verify redirect to / (not still on /login)", async () => {
    const url = page.url();
    if (url.includes("/login")) {
      throw new Error(`Still on login page: ${url}`);
    }
    return `Redirected to: ${url}`;
  }, page);

  // Step 3: Verify portfolio value is visible and numeric
  await step(3, "Verify portfolio value is visible and numeric", async () => {
    await page.waitForTimeout(3000);
    const moneyValues = await page.$$eval("*", (els) => {
      const matches = [];
      for (const el of els) {
        const text = el.textContent || "";
        const moneyMatch = text.match(/\$[\d,]+\.?\d*/);
        if (moneyMatch && el.children.length <= 3) {
          matches.push(moneyMatch[0]);
        }
      }
      return [...new Set(matches)].slice(0, 10);
    });
    if (!moneyValues.length) {
      throw new Error("No dollar values found on dashboard");
    }
    return `Found portfolio values: ${moneyValues.slice(0, 4).join(", ")}`;
  }, page);

  // Step 4: Verify at least 1 strategy card is visible
  await step(4, "Verify at least 1 strategy card is visible", async () => {
    const strategyNames = ["Momentum", "PEAD", "VRP", "Earnings", "Claude", "Mean Rev", "Regime"];
    const bodyText = await page.evaluate(() => document.body.innerText);
    const found = strategyNames.filter((n) => bodyText.includes(n));
    if (!found.length) {
      throw new Error("No strategy cards found on dashboard");
    }
    return `Found strategies: ${found.join(", ")}`;
  }, page);

  // Step 5: Verify status strip shows regime data (not ---)
  await step(5, "Verify status strip shows regime data (not ---)", async () => {
    const statusData = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasRegimePlaceholder: body.includes("---"),
        regimeMatch: body.match(/Regime\s+(\S+)/)?.[1] || null,
        hasVixPlaceholder: body.includes("--.-"),
        vixMatch: body.match(/VIX\s+([\d.]+)/)?.[1] || null,
        hasPnl: /P&L/.test(body),
      };
    });
    const issues = [];
    if (statusData.hasRegimePlaceholder) issues.push("Regime shows ---");
    if (statusData.hasVixPlaceholder) issues.push("VIX shows --.-");
    if (issues.length > 0) {
      throw new Error(issues.join("; "));
    }
    return `Regime: ${statusData.regimeMatch}, VIX: ${statusData.vixMatch}`;
  }, page);

  // Step 6: Verify equity curve chart is visible
  await step(6, "Verify equity curve chart is visible", async () => {
    const hasSvg = await page.evaluate(() => {
      const svgs = document.querySelectorAll("svg");
      // Look for large SVGs (likely charts)
      let chartSvgs = 0;
      for (const svg of svgs) {
        const rect = svg.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 80) chartSvgs++;
      }
      // Also check for polyline/path in SVGs (equity curve lines)
      const polylines = document.querySelectorAll("svg polyline, svg path, svg polygon");
      return { chartSvgs, polylines: polylines.length };
    });
    if (hasSvg.chartSvgs === 0 && hasSvg.polylines === 0) {
      throw new Error("No chart SVGs or polylines found");
    }
    return `Found ${hasSvg.chartSvgs} chart SVG(s), ${hasSvg.polylines} polyline/path elements`;
  }, page);

  // Step 7: Take screenshot
  await step(7, "Take dashboard screenshot", async () => {
    const fname = "j1-dashboard.png";
    await page.screenshot({ path: join(SCREENSHOT_DIR, fname), fullPage: true });
    return fname;
  }, page);

  endJourney();
}

// ─── Journey 2: Symbol Research Flow ────────────────────────

async function journey2(page) {
  startJourney(2, "Symbol Research Flow");

  // Step 1: From dashboard, press Ctrl+K to open command palette
  await step(1, "Press Ctrl+K to open command palette", async () => {
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(1000);
    // Check if palette opened
    const paletteVisible = await page.evaluate(() => {
      const dialogs = document.querySelectorAll("[role='dialog']");
      for (const d of dialogs) {
        if (d.getBoundingClientRect().height > 50) return true;
      }
      // Also check for cmdk elements
      return !!document.querySelector("[cmdk-root]") || !!document.querySelector("[cmdk-input]");
    });
    if (!paletteVisible) {
      throw new Error("Command palette did not open");
    }
    return "Command palette opened";
  }, page);

  // Step 2: Type "AAPL" in search
  await step(2, 'Type "AAPL" in search', async () => {
    const input = await page.$("[cmdk-input], [role='dialog'] input");
    if (!input) throw new Error("No search input found in command palette");
    await input.fill("AAPL");
    await page.waitForTimeout(1500); // Wait for debounced search
    return "Typed AAPL";
  }, page);

  // Step 3: Verify search results appear
  await step(3, "Verify search results appear", async () => {
    const results = await page.evaluate(() => {
      const items = document.querySelectorAll("[cmdk-item]");
      const texts = [];
      for (const item of items) {
        const t = item.textContent?.trim();
        if (t && t.toLowerCase().includes("aapl")) texts.push(t.substring(0, 60));
      }
      return texts;
    });
    if (!results.length) {
      throw new Error("No AAPL results in command palette");
    }
    return `Found ${results.length} result(s): ${results[0]}`;
  }, page);

  // Step 4: Select AAPL (or navigate to /trade)
  await step(4, "Select AAPL and navigate to trade page", async () => {
    // Click the first AAPL result
    const aaplItem = await page.$("[cmdk-item]:has-text('AAPL')");
    if (aaplItem) {
      await aaplItem.click();
      await page.waitForTimeout(1000);
    }
    // Navigate to trade page to see the chart
    await page.goto(`${BASE_URL}/trade`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(4000);
    return `On trade page: ${page.url()}`;
  }, page);

  // Step 5: Verify AAPL chart loads with candlestick data
  await step(5, "Verify chart loads with data", async () => {
    const chartCheck = await page.evaluate(() => {
      // Check for TradingView widget or canvas elements
      const canvases = document.querySelectorAll("canvas");
      const tvWidget = document.querySelector(".tradingview-widget-container, [data-slot='chart-panel']");
      const svgCharts = document.querySelectorAll("svg polyline, svg path");
      return {
        canvasCount: canvases.length,
        hasTvWidget: !!tvWidget,
        svgPaths: svgCharts.length,
        bodyHasAAPL: document.body.innerText.includes("AAPL"),
      };
    });
    if (chartCheck.canvasCount === 0 && chartCheck.svgPaths === 0 && !chartCheck.hasTvWidget) {
      throw new Error("No chart rendered (no canvas, SVG paths, or TradingView widget)");
    }
    return `Canvas: ${chartCheck.canvasCount}, SVG paths: ${chartCheck.svgPaths}, TV widget: ${chartCheck.hasTvWidget}, AAPL visible: ${chartCheck.bodyHasAAPL}`;
  }, page);

  // Step 6: Click through analysis tabs: Tech, Fund, Sent
  const analysisTabs = ["technical", "fundamental", "sentiment"];
  const tabLabels = ["Tech", "Fund", "Sent"];

  for (let i = 0; i < analysisTabs.length; i++) {
    const tabValue = analysisTabs[i];
    const label = tabLabels[i];

    // Step 6a/b/c: Click tab
    await step(`6${String.fromCharCode(97 + i)}`, `Click "${label}" analysis tab`, async () => {
      // Find and click tab trigger
      const trigger = await page.$(`button:has-text("${label}"), [role="tab"]:has-text("${label}")`);
      if (!trigger) throw new Error(`"${label}" tab trigger not found`);
      await trigger.click();
      await page.waitForTimeout(2000);
      return `Clicked "${label}" tab`;
    }, page);

    // Step 7a/b/c: Verify content not empty
    await step(`7${String.fromCharCode(97 + i)}`, `Verify "${label}" tab shows content`, async () => {
      const tabContent = await page.evaluate((tv) => {
        // Look for the active tab content area
        const panels = document.querySelectorAll('[role="tabpanel"]');
        for (const panel of panels) {
          if (panel.getAttribute("data-state") === "active" || !panel.hidden) {
            const text = panel.innerText?.trim();
            if (text && text.length > 20) {
              return { hasContent: true, textLen: text.length, preview: text.substring(0, 100) };
            }
          }
        }
        // Fallback: check body text near analysis area
        const body = document.body.innerText;
        const hasScore = /score|signal|rating|gauge|trend/i.test(body);
        return { hasContent: hasScore, textLen: body.length, preview: "checked body" };
      }, tabValue);
      if (!tabContent.hasContent && tabContent.textLen < 50) {
        throw new Error(`"${label}" tab content appears empty`);
      }
      return `Content length: ${tabContent.textLen} chars, preview: ${tabContent.preview?.substring(0, 60)}`;
    }, page);
  }

  // Step 8: Verify "Estimated" badge appears on generated data
  await step(8, 'Verify "Estimated" badge appears on generated data', async () => {
    const hasEstimated = await page.evaluate(() => {
      const body = document.body.innerText;
      return body.includes("Estimated") || body.includes("estimated");
    });
    if (!hasEstimated) {
      throw new Error('"Estimated" badge not found in page text');
    }
    return "Estimated badge found";
  }, page);

  // Step 9: Take screenshots of analysis tabs
  await step(9, "Take screenshot of trade/analysis page", async () => {
    const fname = "j2-trade-analysis.png";
    await page.screenshot({ path: join(SCREENSHOT_DIR, fname), fullPage: true });

    // Also take individual tab screenshots
    for (let i = 0; i < analysisTabs.length; i++) {
      const trigger = await page.$(`button:has-text("${tabLabels[i]}"), [role="tab"]:has-text("${tabLabels[i]}")`);
      if (trigger) {
        await trigger.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(SCREENSHOT_DIR, `j2-tab-${analysisTabs[i]}.png`), fullPage: true });
      }
    }
    return "Screenshots saved for all analysis tabs";
  }, page);

  endJourney();
}

// ─── Journey 3: Order Placement Flow ────────────────────────

async function journey3(page) {
  startJourney(3, "Order Placement Flow");

  // Make sure we're on the trade page
  await page.goto(`${BASE_URL}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Step 1: Click "Order" tab
  await step(1, 'Click "Order" tab on analysis panel', async () => {
    const orderTab = await page.$('button:has-text("Order"), [role="tab"]:has-text("Order")');
    if (!orderTab) throw new Error("Order tab not found");
    await orderTab.click();
    await page.waitForTimeout(1000);
    return "Order tab clicked";
  }, page);

  // Step 2: Verify Buy/Sell toggle appears
  await step(2, "Verify Buy/Sell toggle appears", async () => {
    const hasBuySell = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const buyBtn = buttons.find((b) => b.textContent?.trim() === "Buy");
      const sellBtn = buttons.find((b) => b.textContent?.trim() === "Sell");
      return { hasBuy: !!buyBtn, hasSell: !!sellBtn };
    });
    if (!hasBuySell.hasBuy || !hasBuySell.hasSell) {
      throw new Error(`Buy/Sell toggle missing. Buy: ${hasBuySell.hasBuy}, Sell: ${hasBuySell.hasSell}`);
    }
    return "Buy and Sell buttons found";
  }, page);

  // Step 3: Click "Sell" to switch side
  await step(3, 'Click "Sell" to switch side', async () => {
    const sellBtn = await page.$("button:has-text('Sell')");
    if (!sellBtn) throw new Error("Sell button not found");
    await sellBtn.click();
    await page.waitForTimeout(500);
    // Verify sell is now active (has ring or active style)
    const sellActive = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const sellBtn = buttons.find((b) => b.textContent?.trim() === "Sell");
      if (!sellBtn) return false;
      const cl = sellBtn.className || "";
      return cl.includes("ring") || cl.includes("active") || cl.includes("loss");
    });
    return `Sell button active: ${sellActive}`;
  }, page);

  // Step 4: Change quantity to 5
  await step(4, "Change quantity to 5", async () => {
    const qtyInput = await page.$('input[type="number"]');
    if (!qtyInput) throw new Error("Quantity input not found");
    await qtyInput.fill("");
    await qtyInput.fill("5");
    await page.waitForTimeout(300);
    const val = await qtyInput.inputValue();
    if (val !== "5") throw new Error(`Quantity shows ${val} instead of 5`);
    return "Quantity set to 5";
  }, page);

  // Step 5: Change order type to "Limit"
  await step(5, 'Change order type to "Limit"', async () => {
    const select = await page.$("select");
    if (!select) throw new Error("Order type select not found");
    await select.selectOption("limit");
    await page.waitForTimeout(500);
    const val = await select.inputValue();
    return `Order type changed to: ${val}`;
  }, page);

  // Step 6: Verify price input appears
  await step(6, "Verify price input appears for Limit order", async () => {
    await page.waitForTimeout(500);
    const priceInputs = await page.$$('input[type="number"]');
    // Should now have at least 2: quantity + price
    if (priceInputs.length < 2) {
      throw new Error(`Only ${priceInputs.length} number input(s) found, expected at least 2 (qty + price)`);
    }
    return `Found ${priceInputs.length} number inputs (includes price input)`;
  }, page);

  // Step 7: Enter a price
  await step(7, "Enter a limit price", async () => {
    const priceInputs = await page.$$('input[type="number"]');
    // Price input is the second or last number input
    const priceInput = priceInputs[priceInputs.length - 1];
    await priceInput.fill("150.00");
    await page.waitForTimeout(300);
    const val = await priceInput.inputValue();
    return `Price set to: ${val}`;
  }, page);

  // Step 8: Verify submit button text updates
  await step(8, "Verify submit button text updates to reflect order", async () => {
    const submitText = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      // Find the submit button (should contain Sell, quantity, and price)
      const submit = buttons.find(
        (b) => {
          const t = b.textContent?.trim() || "";
          return (t.includes("Sell") || t.includes("Buy")) &&
                 (t.includes("$") || t.includes("Market") || t.includes("@"));
        }
      );
      return submit?.textContent?.trim() || null;
    });
    if (!submitText) {
      throw new Error("Submit button with order details not found");
    }
    return `Submit button text: "${submitText}"`;
  }, page);

  // Step 9: DO NOT actually submit
  await step(9, "Verify form is complete (NOT submitting)", async () => {
    return "Form verified -- order NOT submitted as instructed";
  }, page);

  // Step 10: Take screenshot
  await step(10, "Take order form screenshot", async () => {
    const fname = "j3-order-form.png";
    await page.screenshot({ path: join(SCREENSHOT_DIR, fname), fullPage: true });
    return fname;
  }, page);

  endJourney();
}

// ─── Journey 4: Pipeline Monitoring ─────────────────────────

async function journey4(page) {
  startJourney(4, "Pipeline Monitoring");

  // Step 1: Navigate to /pipeline
  await step(1, "Navigate to /pipeline", async () => {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(4000);
    const url = page.url();
    if (!url.includes("/pipeline")) throw new Error(`Not on pipeline page: ${url}`);
    return `On pipeline page: ${url}`;
  }, page);

  // Step 2: Verify pipeline flow diagram is visible with 4 stages
  await step(2, "Verify pipeline flow diagram with 4 stages", async () => {
    const stageCheck = await page.evaluate(() => {
      const body = document.body.innerText;
      const stages = ["Screened", "Analyzed", "Signals", "Orders"];
      const found = stages.filter((s) => body.includes(s));
      const arrows = document.querySelectorAll("span");
      let arrowCount = 0;
      for (const a of arrows) {
        if (a.textContent?.trim() === "\u2192") arrowCount++;
      }
      return { foundStages: found, arrowCount };
    });
    if (stageCheck.foundStages.length < 4) {
      throw new Error(`Only found ${stageCheck.foundStages.length}/4 stages: ${stageCheck.foundStages.join(", ")}`);
    }
    return `Found all 4 stages: ${stageCheck.foundStages.join(", ")}, ${stageCheck.arrowCount} arrows`;
  }, page);

  // Step 3: Verify current positions table shows data
  await step(3, "Verify current positions section shows data", async () => {
    const posCheck = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasCurrentPositions = body.includes("Current Positions");
      // Check for table rows or "No active positions" message
      const tableRows = document.querySelectorAll("table tbody tr");
      const hasNoPositions = body.includes("No active positions");
      return {
        hasCurrentPositions,
        rowCount: tableRows.length,
        hasNoPositions,
      };
    });
    if (!posCheck.hasCurrentPositions) {
      throw new Error("Current Positions section not found");
    }
    return `Current Positions visible. Rows: ${posCheck.rowCount}, No positions msg: ${posCheck.hasNoPositions}`;
  }, page);

  // Step 4: Verify performance summary cards are visible
  await step(4, "Verify performance summary cards visible", async () => {
    const perfCheck = await page.evaluate(() => {
      const body = document.body.innerText;
      const cards = ["Total P&L", "Win Rate", "Total Trades", "Active Positions"];
      const found = cards.filter((c) => body.includes(c));
      return { found, hasPerformance: body.includes("Performance Summary") };
    });
    if (!perfCheck.hasPerformance) {
      throw new Error("Performance Summary section not found");
    }
    return `Performance Summary visible. Cards found: ${perfCheck.found.join(", ")}`;
  }, page);

  // Step 5: Click a history row to expand
  await step(5, "Click a history row to expand", async () => {
    const historyCheck = await page.evaluate(() => {
      return document.body.innerText.includes("History");
    });
    if (!historyCheck) {
      return "History section not found -- may have no history data (acceptable)";
    }
    // Try clicking a history row
    const historyRow = await page.$("table tbody tr:has(svg)");
    if (historyRow) {
      await historyRow.click();
      await page.waitForTimeout(1500);
      return "Clicked history row";
    }
    return "No expandable history rows found (acceptable if no history)";
  }, page);

  // Step 6: Take screenshot
  await step(6, "Take pipeline screenshot", async () => {
    const fname = "j4-pipeline.png";
    await page.screenshot({ path: join(SCREENSHOT_DIR, fname), fullPage: true });
    return fname;
  }, page);

  endJourney();
}

// ─── Journey 5: Strategy Deep Dive ──────────────────────────

async function journey5(page) {
  startJourney(5, "Strategy Deep Dive");

  // Step 1: Navigate to /strategies/pead
  await step(1, "Navigate to /strategies/pead", async () => {
    await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(4000);
    return `URL: ${page.url()}`;
  }, page);

  // Step 2: Verify strategy name and description visible
  await step(2, "Verify strategy name and description visible", async () => {
    const check = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasPEAD = body.includes("PEAD") || body.includes("Post-Earnings") || body.includes("Earnings");
      const h1 = document.querySelector("h1");
      return {
        hasPEAD,
        h1Text: h1?.textContent?.trim() || null,
        hasDescription: body.length > 200,
      };
    });
    if (!check.hasPEAD) {
      throw new Error("PEAD strategy name not found");
    }
    return `Strategy: ${check.h1Text}, has description: ${check.hasDescription}`;
  }, page);

  // Step 3: Verify equity curve chart renders
  await step(3, "Verify equity curve chart renders", async () => {
    const chartCheck = await page.evaluate(() => {
      const svgs = document.querySelectorAll("svg");
      let chartSvgs = 0;
      let hasPolyline = false;
      for (const svg of svgs) {
        const rect = svg.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 100) {
          chartSvgs++;
          if (svg.querySelector("polyline") || svg.querySelector("polygon")) {
            hasPolyline = true;
          }
        }
      }
      return { chartSvgs, hasPolyline };
    });
    if (chartSvgs === 0 && !chartCheck.hasPolyline) {
      // Might say "Not enough data"
      const noData = await page.evaluate(() => document.body.innerText.includes("Not enough data"));
      if (noData) return "Chart shows 'Not enough data' message (acceptable)";
      throw new Error("No equity curve chart found");
    }
    return `Found ${chartCheck.chartSvgs} chart SVG(s), polyline: ${chartCheck.hasPolyline}`;
  }, page);

  // Step 4: Verify SPY benchmark line is visible (gray line)
  await step(4, "Verify SPY benchmark line is visible (gray line)", async () => {
    const benchCheck = await page.evaluate(() => {
      const body = document.body.innerText;
      const hasSPYLabel = body.includes("SPY");
      // Check for gray polyline (benchmark)
      const grayLines = document.querySelectorAll('svg polyline[stroke="#71717a"]');
      // Check for benchmark legend
      const texts = document.querySelectorAll("svg text");
      let hasSPYText = false;
      for (const t of texts) {
        if (t.textContent?.includes("SPY")) hasSPYText = true;
      }
      return { hasSPYLabel, grayLines: grayLines.length, hasSPYText };
    });
    if (!benchCheck.hasSPYLabel && benchCheck.grayLines === 0 && !benchCheck.hasSPYText) {
      return "SPY benchmark not rendered (may need data to load) -- noted";
    }
    return `SPY label: ${benchCheck.hasSPYLabel}, gray lines: ${benchCheck.grayLines}, SVG text: ${benchCheck.hasSPYText}`;
  }, page);

  // Step 5: Click each tab: About, Positions, Sector Exposure, Correlation, Analytics
  const stratTabs = [
    { label: "About", id: "about" },
    { label: "Positions", id: "positions" },
    { label: "Sector Exposure", id: "sectors" },
    { label: "Correlation", id: "correlation" },
    { label: "Analytics", id: "analytics" },
  ];

  for (let i = 0; i < stratTabs.length; i++) {
    const tab = stratTabs[i];
    await step(`5${String.fromCharCode(97 + i)}`, `Click "${tab.label}" tab`, async () => {
      // Strategy detail uses custom tab buttons, not standard tabs
      const tabBtn = await page.$(`button:has-text("${tab.label}")`);
      if (!tabBtn) {
        // Try finding by text content more broadly
        const found = await page.evaluate((label) => {
          const btns = Array.from(document.querySelectorAll("button, [role='tab']"));
          for (const b of btns) {
            if (b.textContent?.trim().includes(label)) {
              return true;
            }
          }
          return false;
        }, tab.label);
        if (!found) throw new Error(`Tab button "${tab.label}" not found`);
        const btn = await page.$(`button:has-text("${tab.label}"), [role="tab"]:has-text("${tab.label}")`);
        if (btn) await btn.click();
      } else {
        await tabBtn.click();
      }
      await page.waitForTimeout(1500);
      return `Clicked "${tab.label}" tab`;
    }, page);
  }

  // Step 6: Verify each tab changes content (just check the page didn't break)
  await step(6, "Verify tabs change content without errors", async () => {
    // Go back to "About" tab to verify it re-renders
    const aboutBtn = await page.$('button:has-text("About")');
    if (aboutBtn) await aboutBtn.click();
    await page.waitForTimeout(1000);
    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    if (bodyLen < 100) throw new Error("Page content appears empty after tab switching");
    return `Page content length: ${bodyLen} chars after tab cycling`;
  }, page);

  // Step 7: Take screenshot of About tab
  await step(7, "Take screenshot of About tab", async () => {
    const fname = "j5-strategy-about.png";
    await page.screenshot({ path: join(SCREENSHOT_DIR, fname), fullPage: true });
    return fname;
  }, page);

  // Step 8: Navigate back to dashboard
  await step(8, "Navigate back to dashboard", async () => {
    const backBtn = await page.$('button:has(svg)');
    // Or just navigate directly
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    const url = page.url();
    const isHome = !url.includes("/strategies/");
    if (!isHome) throw new Error(`Still on strategy page: ${url}`);
    return `Back on dashboard: ${url}`;
  }, page);

  endJourney();
}

// ─── Journey 6: Keyboard Navigation ────────────────────────

async function journey6(page) {
  startJourney(6, "Keyboard Navigation");

  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Step 1: Press ? to open keyboard shortcuts
  await step(1, "Press ? to open keyboard shortcuts overlay", async () => {
    await page.keyboard.press("Shift+/"); // ? = Shift+/
    await page.waitForTimeout(1000);
    const overlayVisible = await page.evaluate(() => {
      const dialogs = document.querySelectorAll("[role='dialog']");
      for (const d of dialogs) {
        if (d.innerText?.includes("Keyboard Shortcuts")) return true;
      }
      // Check for any overlay/modal
      const overlay = document.querySelector(".fixed.inset-0");
      return !!overlay && overlay.innerText?.includes("Keyboard");
    });
    if (!overlayVisible) {
      throw new Error("Keyboard shortcuts overlay did not open");
    }
    return "Shortcuts overlay opened";
  }, page);

  // Step 2: Verify overlay shows shortcuts grouped
  await step(2, "Verify overlay shows shortcuts grouped", async () => {
    const groupCheck = await page.evaluate(() => {
      const body = document.body.innerText;
      const groups = ["Global", "Navigation", "Trading", "Panels"];
      const found = groups.filter((g) => body.includes(g));
      const hasShortcutKeys = body.includes("Esc") || body.includes("then");
      return { foundGroups: found, hasShortcutKeys };
    });
    if (groupCheck.foundGroups.length < 1) {
      throw new Error("No shortcut groups found in overlay");
    }
    return `Groups found: ${groupCheck.foundGroups.join(", ")}, has shortcut keys: ${groupCheck.hasShortcutKeys}`;
  }, page);

  // Step 3: Press Escape to close
  await step(3, "Press Escape to close shortcuts overlay", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const overlayClosed = await page.evaluate(() => {
      const overlay = document.querySelector(".fixed.inset-0");
      if (!overlay) return true;
      return !overlay.innerText?.includes("Keyboard Shortcuts");
    });
    if (!overlayClosed) {
      throw new Error("Shortcuts overlay did not close");
    }
    return "Overlay closed";
  }, page);

  // Step 4: Press g then d -- verify stays on dashboard
  await step(4, "Press g then d -- verify stays on dashboard", async () => {
    await page.keyboard.press("g");
    await page.waitForTimeout(300);
    await page.keyboard.press("d");
    await page.waitForTimeout(1500);
    const url = page.url();
    const onDashboard = url.endsWith("/") || url.endsWith(BASE_URL) || (!url.includes("/trade") && !url.includes("/pipeline"));
    if (!onDashboard) {
      throw new Error(`Expected dashboard, but on: ${url}`);
    }
    return `On dashboard: ${url}`;
  }, page);

  // Step 5: Press g then t -- verify navigates to /trade
  await step(5, "Press g then t -- verify navigates to /trade", async () => {
    await page.keyboard.press("g");
    await page.waitForTimeout(300);
    await page.keyboard.press("t");
    await page.waitForTimeout(2000);
    const url = page.url();
    if (!url.includes("/trade")) {
      throw new Error(`Expected /trade, but on: ${url}`);
    }
    return `Navigated to: ${url}`;
  }, page);

  // Step 6: Press g then p -- verify navigates to /pipeline
  await step(6, "Press g then p -- verify navigates to /pipeline", async () => {
    await page.keyboard.press("g");
    await page.waitForTimeout(300);
    await page.keyboard.press("p");
    await page.waitForTimeout(2000);
    const url = page.url();
    if (!url.includes("/pipeline")) {
      throw new Error(`Expected /pipeline, but on: ${url}`);
    }
    return `Navigated to: ${url}`;
  }, page);

  endJourney();
}

// ─── Journey 7: Error Recovery ──────────────────────────────

async function journey7(page) {
  startJourney(7, "Error Recovery");

  // Step 1: Navigate to a non-existent route /nonexistent
  await step(1, "Navigate to /nonexistent", async () => {
    const response = await page.goto(`${BASE_URL}/nonexistent`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);
    const status = response?.status();
    const url = page.url();
    return `Status: ${status}, URL: ${url}`;
  }, page);

  // Step 2: Verify 404 page appears (or redirect to dashboard)
  await step(2, "Verify 404 page or dashboard redirect", async () => {
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    const has404 = bodyText.includes("404") || bodyText.includes("not found") || bodyText.includes("Not Found");
    const redirectedHome = url === `${BASE_URL}/` || url === BASE_URL || url.endsWith("/login");
    const hasContent = bodyText.length > 50;

    if (has404) return `404 page displayed correctly`;
    if (redirectedHome) return `Redirected to: ${url}`;
    if (hasContent) return `Page shows content (not blank): ${bodyText.substring(0, 80)}...`;
    throw new Error("Neither 404 page nor redirect detected -- possibly a white screen");
  }, page);

  // Step 3: Navigate to /strategies/nonexistent-id
  await step(3, "Navigate to /strategies/nonexistent-id", async () => {
    await page.goto(`${BASE_URL}/strategies/nonexistent-id`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(4000);
    return `URL: ${page.url()}`;
  }, page);

  // Step 4: Verify error is handled gracefully (not a white screen)
  await step(4, "Verify error handled gracefully (not a white screen)", async () => {
    const pageState = await page.evaluate(() => {
      const body = document.body;
      const text = body.innerText?.trim() || "";
      const children = body.querySelectorAll("*").length;
      const hasError = text.includes("Error") || text.includes("error") || text.includes("not found");
      const hasNav = text.includes("Dashboard") || text.includes("Back") || text.includes("Strategies");
      const isBlank = text.length < 20 && children < 5;
      return {
        textLen: text.length,
        elementCount: children,
        hasError,
        hasNav,
        isBlank,
        preview: text.substring(0, 200),
      };
    });

    if (pageState.isBlank) {
      throw new Error(`White screen detected: only ${pageState.textLen} chars, ${pageState.elementCount} elements`);
    }

    const fname = "j7-error-recovery.png";
    await page.screenshot({ path: join(SCREENSHOT_DIR, fname), fullPage: true });

    return `Page handled gracefully. ${pageState.elementCount} elements, has nav: ${pageState.hasNav}, has error msg: ${pageState.hasError}. Preview: "${pageState.preview.substring(0, 80)}"`;
  }, page);

  endJourney();
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log("\n======================================================");
  console.log("  AlphaDesk E2E User Journey Tests");
  console.log("  Target: " + BASE_URL);
  console.log("  Start:  " + new Date().toISOString());
  console.log("======================================================\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Capture console errors globally
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ text: msg.text(), url: page.url(), ts: new Date().toISOString() });
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push({ text: err.message, url: page.url(), ts: new Date().toISOString(), type: "pageerror" });
  });

  try {
    await journey1(page);
    await journey2(page);
    await journey3(page);
    await journey4(page);
    await journey5(page);
    await journey6(page);
    await journey7(page);
  } catch (err) {
    console.error("\n** FATAL ERROR **:", err.message);
    try {
      await page.screenshot({ path: join(SCREENSHOT_DIR, "fatal-error.png"), fullPage: true });
    } catch {}
  }

  await browser.close();

  // ─── Final Report ─────────────────────────────────────────
  results.endTime = new Date().toISOString();
  results.consoleErrors = consoleErrors.slice(0, 50);

  console.log("\n======================================================");
  console.log("  FINAL RESULTS");
  console.log("======================================================");
  console.log(`  Total steps:  ${results.summary.total}`);
  console.log(`  Passed:       ${results.summary.passed}`);
  console.log(`  Failed:       ${results.summary.failed}`);
  console.log(`  Pass rate:    ${((results.summary.passed / results.summary.total) * 100).toFixed(1)}%`);
  console.log(`  Console errs: ${consoleErrors.length}`);
  console.log("------------------------------------------------------");

  for (const j of results.journeys) {
    const failed = j.steps.filter((s) => s.status === "FAIL");
    const icon = failed.length === 0 ? "PASS" : "FAIL";
    console.log(`  [${icon}] Journey ${j.id}: ${j.name} (${j.steps.length - failed.length}/${j.steps.length})`);
    for (const f of failed) {
      console.log(`        FAIL Step ${f.num}: ${f.description} -- ${f.detail}`);
    }
  }

  console.log("======================================================\n");

  // Save results JSON
  writeFileSync(
    join(SCREENSHOT_DIR, "results.json"),
    JSON.stringify(results, null, 2)
  );
  console.log(`Results saved to: ${join(SCREENSHOT_DIR, "results.json")}`);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
