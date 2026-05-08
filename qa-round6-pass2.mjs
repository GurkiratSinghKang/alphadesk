import { chromium } from "playwright";
import { mkdirSync } from "fs";
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
const DIR = "/Users/GK/Downloads/alphadesk/qa-screenshots/round6";
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

mkdirSync(DIR, { recursive: true });

const issues = [];
let testId = 0;
let passCount = 0;
let failCount = 0;
let warnCount = 0;

function log(status, section, description, details = "") {
  testId++;
  issues.push({ id: testId, status, section, description, details });
  if (status === "PASS") passCount++;
  else if (status === "FAIL") failCount++;
  else warnCount++;
  console.log(`[${status}] #${testId} [${section}] ${description}${details ? " — " + details : ""}`);
}

async function ss(page, name) {
  await page.screenshot({ path: path.join(DIR, `p2-${name}.png`), fullPage: false });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });

  const consoleErrors = [];
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ url: page.url(), text: msg.text() });
  });
  page.on("pageerror", (err) => {
    consoleErrors.push({ url: page.url(), text: `PAGE_ERROR: ${err.message}` });
  });

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.fill('#login-username', USERNAME);
  await page.fill('#login-password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  await page.waitForTimeout(3000);
  console.log("Logged in.\n");

  // ================================================================
  // A. INVESTIGATE "null/undefined" ON PAGES
  // ================================================================
  console.log("========== A. NULL/UNDEFINED TEXT INVESTIGATION ==========\n");

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check for visible "null" or "undefined" text specifically in rendered elements
  // Exclude script, style, noscript, svg, hidden elements
  const visibleBadText = await page.evaluate(() => {
    const results = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (["script", "style", "noscript", "svg", "path", "circle", "rect", "polyline", "line", "text"].includes(tag)) return NodeFilter.FILTER_REJECT;
          // Check visibility
          const style = window.getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return NodeFilter.FILTER_REJECT;
          // Check if element is off-screen (sr-only or similar)
          const rect = parent.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return NodeFilter.FILTER_REJECT;
          if (rect.width === 1 && rect.height === 1) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      // Match standalone "null" or "undefined" — not "annulled" or "undefinedXyz"
      if (/^(null|undefined)$/i.test(text)) {
        const parent = node.parentElement;
        const tag = parent?.tagName;
        const cls = parent?.className?.toString().substring(0, 60);
        const parentText = parent?.textContent?.trim().substring(0, 80);
        results.push({ text, tag, cls, context: parentText });
      }
    }
    return results;
  });

  if (visibleBadText.length > 0) {
    log("FAIL", "Dashboard/Text", `${visibleBadText.length} visible "null"/"undefined" text nodes`,
      visibleBadText.slice(0, 5).map(b => `<${b.tag} class="${b.cls}"> "${b.text}" in: ${b.context}`).join(" | "));
  } else {
    log("PASS", "Dashboard/Text", "No visible 'null' or 'undefined' text on dashboard");
  }

  // Check trade page
  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);

  const tradeBadText = await page.evaluate(() => {
    const results = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (["script", "style", "noscript", "svg", "path", "circle", "rect", "polyline", "line", "text"].includes(tag)) return NodeFilter.FILTER_REJECT;
          const style = window.getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return NodeFilter.FILTER_REJECT;
          const rect = parent.getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (/^(null|undefined)$/i.test(text)) {
        const parent = node.parentElement;
        results.push({ text, tag: parent?.tagName, cls: parent?.className?.toString().substring(0, 60) });
      }
    }
    return results;
  });

  if (tradeBadText.length > 0) {
    log("FAIL", "Trade/Text", `${tradeBadText.length} visible "null"/"undefined" on trade page`,
      tradeBadText.slice(0, 5).map(b => `<${b.tag} class="${b.cls}"> "${b.text}"`).join(" | "));
  } else {
    log("PASS", "Trade/Text", "No visible 'null' or 'undefined' text on trade page");
  }

  // Check pipeline page
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const pipelineBadText = await page.evaluate(() => {
    const results = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (["script", "style", "noscript", "svg", "path", "circle", "rect", "polyline", "line", "text"].includes(tag)) return NodeFilter.FILTER_REJECT;
          const style = window.getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return NodeFilter.FILTER_REJECT;
          const rect = parent.getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (/^(null|undefined)$/i.test(text)) {
        const parent = node.parentElement;
        results.push({ text, tag: parent?.tagName, cls: parent?.className?.toString().substring(0, 60) });
      }
    }
    return results;
  });

  if (pipelineBadText.length > 0) {
    log("FAIL", "Pipeline/Text", `${pipelineBadText.length} visible "null"/"undefined" on pipeline page`,
      pipelineBadText.slice(0, 5).map(b => `<${b.tag} class="${b.cls}"> "${b.text}"`).join(" | "));
  } else {
    log("PASS", "Pipeline/Text", "No visible 'null' or 'undefined' text on pipeline page");
  }

  // ================================================================
  // B. STATUS STRIP — find the actual element
  // ================================================================
  console.log("\n========== B. STATUS STRIP INVESTIGATION ==========\n");

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // The status strip is probably not a <footer> — check layout component
  const statusStrip = await page.evaluate(() => {
    // Look for elements at the very bottom of viewport
    const allElements = document.querySelectorAll("div, nav, aside, section, header");
    let bottomMost = null;
    let maxBottom = 0;
    for (const el of allElements) {
      const rect = el.getBoundingClientRect();
      // Must be narrow (status bar height) and span width
      if (rect.height > 10 && rect.height < 50 && rect.width > 800 && rect.bottom > maxBottom) {
        maxBottom = rect.bottom;
        bottomMost = {
          tag: el.tagName,
          className: el.className?.toString().substring(0, 100),
          text: el.textContent?.trim().substring(0, 300),
          rect: { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width },
        };
      }
    }
    return bottomMost;
  });

  if (statusStrip) {
    log("PASS", "Status Strip", "Status strip found at bottom",
      `${statusStrip.tag} .${statusStrip.className?.substring(0, 50)} — text: ${statusStrip.text?.substring(0, 150)}`);

    // Check content
    const stripText = statusStrip.text || "";

    // (Demo) label
    const hasDemoLabel = /\(Demo\)/i.test(stripText);
    log(hasDemoLabel ? "PASS" : "WARN", "Status Strip", "(Demo) label in strip", hasDemoLabel ? "Found" : "Not found");

    // P&L
    const hasPnl = /P&L|P\/L|\$[\d,.]+|[+-][\d.]+%/.test(stripText);
    log(hasPnl ? "PASS" : "WARN", "Status Strip", "P&L in strip");

    // Regime
    const hasRegime = /Bullish|Bearish|Neutral|Risk|Expansion|Contraction|regime/i.test(stripText);
    log(hasRegime ? "PASS" : "WARN", "Status Strip", "Regime in strip");

    // VIX
    const hasVIX = /VIX/i.test(stripText);
    log(hasVIX ? "PASS" : "WARN", "Status Strip", "VIX in strip");

    // Connection / Mode
    const hasMode = /LIVE|OFFLINE|Paper|Demo|Connected/i.test(stripText);
    log(hasMode ? "PASS" : "WARN", "Status Strip", "Mode/Connection badge");
  } else {
    log("WARN", "Status Strip", "Could not identify status strip element programmatically");
  }

  // Screenshot the bottom 100px of the page for visual inspection
  await page.evaluate(() => window.scrollTo(0, 0));
  await ss(page, "status-strip-check");

  // ================================================================
  // C. TRADE PAGE — RIGHT PANEL TABS (precise selectors)
  // ================================================================
  console.log("\n========== C. TRADE PAGE RIGHT PANEL TABS ==========\n");

  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  // The AnalysisPanel uses TabsTrigger with value="technical", "fundamental", "sentiment", "chat", "order"
  // These render as <button data-value="..." or role="tab" with data-state
  // Let's use more flexible selectors

  const rightTabValues = ["technical", "fundamental", "sentiment", "chat", "order"];

  for (const tabVal of rightTabValues) {
    // Try multiple selector strategies
    let clicked = false;

    // Strategy 1: data-value attribute
    let tab = await page.$(`[data-value="${tabVal}"]`);

    // Strategy 2: button with text content matching
    if (!tab) {
      const shortName = { technical: "Tech", fundamental: "Fund", sentiment: "Sent", chat: "Chat", order: "Order" }[tabVal];
      const allButtons = await page.$$("button");
      for (const btn of allButtons) {
        const text = await btn.textContent();
        if (text?.trim() === shortName) {
          tab = btn;
          break;
        }
      }
    }

    // Strategy 3: role="tab" with matching text
    if (!tab) {
      const tabs = await page.$$('[role="tab"]');
      for (const t of tabs) {
        const text = await t.textContent();
        const shortName = { technical: "Tech", fundamental: "Fund", sentiment: "Sent", chat: "Chat", order: "Order" }[tabVal];
        if (text?.trim().includes(shortName)) {
          tab = t;
          break;
        }
      }
    }

    if (tab) {
      try {
        await tab.click({ timeout: 3000 });
        await page.waitForTimeout(2000);
        await ss(page, `trade-right-${tabVal}`);
        log("PASS", `Trade/Right/${tabVal}`, `${tabVal} tab works`);
        clicked = true;
      } catch (e) {
        log("WARN", `Trade/Right/${tabVal}`, `Tab found but click failed`, e.message.substring(0, 80));
      }
    } else {
      log("WARN", `Trade/Right/${tabVal}`, `Tab not found with any selector strategy`);
    }
  }

  // ================================================================
  // D. TRADE PAGE — BOTTOM-RIGHT PANEL TABS (TradePanel)
  // ================================================================
  console.log("\n========== D. TRADE PAGE BOTTOM PANEL TABS ==========\n");

  const bottomTabValues = ["trade", "positions", "orders", "journal", "calendar"];

  for (const tabVal of bottomTabValues) {
    let tab = null;

    // The TradePanel tabs are in the bottom-right panel
    // Need to find tabs specifically in the bottom area
    const allTabs = await page.$$('[role="tab"], button[data-state]');
    const shortNames = { trade: "Trade", positions: "Positions", orders: "Orders", journal: "Journal", calendar: "Calendar" };

    for (const t of allTabs) {
      const text = await t.textContent();
      const rect = await t.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left };
      });

      // Bottom panel tabs should be in the lower portion of the screen
      if (text?.trim() === shortNames[tabVal] && rect.top > 600) {
        tab = t;
        break;
      }
    }

    // Fallback: just find by text among all tab-like buttons in any location
    if (!tab) {
      const btns = await page.$$("button");
      for (const btn of btns) {
        const text = await btn.textContent();
        const dataState = await btn.getAttribute("data-state");
        if (text?.trim() === shortNames[tabVal] && dataState !== null) {
          tab = btn;
          break;
        }
      }
    }

    if (tab) {
      try {
        await tab.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        await ss(page, `trade-bottom-${tabVal}`);
        log("PASS", `Trade/Bottom/${tabVal}`, `${tabVal} tab works`);
      } catch (e) {
        log("WARN", `Trade/Bottom/${tabVal}`, `Tab found but click failed`, e.message.substring(0, 80));
      }
    } else {
      log("WARN", `Trade/Bottom/${tabVal}`, `Tab not found`);
    }
  }

  // ================================================================
  // E. STRATEGY PAGES — confirm they load (not 404)
  // ================================================================
  console.log("\n========== E. STRATEGY PAGE VERIFICATION ==========\n");

  const stratSlugs = ["pead", "momentum-quality", "earnings-vol", "claude-alpha"];
  for (const slug of stratSlugs) {
    await page.goto(`${BASE}/strategies/${slug}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check for actual 404 page — look for specific 404 rendering, not just text that might contain "404"
    const pageTitle = await page.evaluate(() => {
      const h1 = document.querySelector("h1, h2");
      return h1?.textContent?.trim() || "";
    });
    const hasRealContent = await page.evaluate(() => {
      // Check if there's meaningful strategy content — equity curve, stats, etc.
      return !!(
        document.querySelector("canvas") ||
        document.querySelector("svg path") ||
        document.querySelector('[class*="strategy"]') ||
        document.querySelector('[class*="card"]') ||
        document.querySelector("table")
      );
    });

    const url = page.url();
    if (url.includes("/strategies/") && (pageTitle.length > 5 || hasRealContent)) {
      log("PASS", `Strategy/${slug}`, `Loads correctly — title: "${pageTitle.substring(0, 50)}"`);
    } else {
      log("FAIL", `Strategy/${slug}`, "Might be 404 or empty", `title: "${pageTitle}", hasContent: ${hasRealContent}`);
    }

    // Check for Active/Paused toggle
    const toggleBtn = await page.evaluate(() => {
      const btns = document.querySelectorAll("button");
      for (const btn of btns) {
        if (/Pause|Resume|Activate/i.test(btn.textContent)) {
          return { text: btn.textContent.trim(), found: true };
        }
      }
      return { found: false };
    });

    if (toggleBtn.found) {
      log("PASS", `Strategy/${slug}`, "Active/Pause toggle present", toggleBtn.text);
    }

    // Check tabs count
    const tabCount = await page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"]');
      return tabs.length;
    });
    log(tabCount >= 3 ? "PASS" : "WARN", `Strategy/${slug}`, `Tab count: ${tabCount}`);
  }

  // ================================================================
  // F. DASHBOARD STRATEGY CARDS — they use onClick, not <a>
  // ================================================================
  console.log("\n========== F. DASHBOARD STRATEGY CARDS ==========\n");

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const stratCards = await page.evaluate(() => {
    // Strategy grid cards might be divs with onClick
    const cards = document.querySelectorAll('[class*="strategy"], [class*="card"]');
    const results = [];
    for (const card of cards) {
      const text = card.textContent?.trim().substring(0, 60);
      if (text && /momentum|pead|earnings|claude|alpha|vcp|mean|sector|dividend|pairs|gap/i.test(text)) {
        results.push(text.substring(0, 40));
      }
    }
    return results;
  });

  log(stratCards.length >= 10 ? "PASS" : "WARN", "Dashboard/StrategyCards",
    `Strategy cards found: ${stratCards.length}`, stratCards.join(" | ").substring(0, 200));

  // Click one strategy card to verify navigation
  try {
    const firstCard = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="cursor-pointer"]');
      for (const card of cards) {
        if (/Momentum|PEAD/i.test(card.textContent || "")) {
          return true;
        }
      }
      return false;
    });

    if (firstCard) {
      await page.click('text=Momentum');
      await page.waitForTimeout(2000);
      const newUrl = page.url();
      if (newUrl.includes("/strategies/")) {
        log("PASS", "Dashboard/StrategyCards", "Clicking strategy card navigates", newUrl);
      } else {
        log("WARN", "Dashboard/StrategyCards", "Click did not navigate to strategy page", newUrl);
      }
      // Go back
      await page.goBack({ waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(2000);
    }
  } catch (e) {
    log("WARN", "Dashboard/StrategyCards", "Strategy card click test issue", e.message.substring(0, 80));
  }

  // ================================================================
  // G. PROFILE MENU — find by position in header
  // ================================================================
  console.log("\n========== G. PROFILE MENU ==========\n");

  const profileInfo = await page.evaluate(() => {
    // Look for buttons in the top-right area
    const buttons = document.querySelectorAll("button");
    const results = [];
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      // Top-right area buttons
      if (rect.top < 60 && rect.right > window.innerWidth - 200) {
        results.push({
          text: btn.textContent?.trim().substring(0, 30),
          ariaLabel: btn.getAttribute("aria-label"),
          classes: btn.className?.toString().substring(0, 60),
          rect: { top: Math.round(rect.top), right: Math.round(rect.right), width: Math.round(rect.width) },
        });
      }
    }
    return results;
  });

  console.log("Top-right buttons:", JSON.stringify(profileInfo, null, 2));

  // Try clicking the rightmost button (likely profile)
  if (profileInfo.length > 0) {
    const rightmost = profileInfo.sort((a, b) => b.rect.right - a.rect.right)[0];
    log("PASS", "Profile Menu", "Rightmost top-right button found", `text: "${rightmost.text}", ariaLabel: ${rightmost.ariaLabel}`);

    // Click it
    try {
      const allBtns = await page.$$("button");
      for (const btn of allBtns) {
        const rect = await btn.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, right: r.right };
        });
        if (rect.top < 60 && rect.right > 1880) {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(1000);
          await ss(page, "profile-menu");
          log("PASS", "Profile Menu", "Profile menu clicked");

          // Check dropdown content
          const dropdown = await page.$('[role="menu"], [class*="dropdown"], [class*="popover"]');
          if (dropdown) {
            const dropdownText = await dropdown.textContent();
            log("PASS", "Profile Menu", "Dropdown shows", dropdownText?.trim().substring(0, 100));
          }

          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
          break;
        }
      }
    } catch (e) {
      log("WARN", "Profile Menu", "Click test issue", e.message.substring(0, 80));
    }
  }

  // ================================================================
  // H. DASHBOARD — CHECK DEMO BADGES ON MARKET INDICES
  // ================================================================
  console.log("\n========== H. DEMO BADGE AUDIT ==========\n");

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check specifically in market context area
  const demoBadgeAudit = await page.evaluate(() => {
    const body = document.body.textContent || "";
    const results = {
      totalDemoLabels: (body.match(/\bDemo\b/g) || []).length,
      portfolioHasDemo: false,
      indicesHaveDemo: false,
      sectorHasDemo: false,
    };

    // Check portfolio hero area
    const heroArea = document.querySelector('[class*="hero"], [class*="portfolio"]');
    if (heroArea) {
      results.portfolioHasDemo = /Demo/i.test(heroArea.textContent || "");
    }

    // Check market indices area
    const marketArea = document.querySelector('[class*="market"], [class*="indices"]');
    if (marketArea) {
      results.indicesHaveDemo = /Demo/i.test(marketArea.textContent || "");
    }

    return results;
  });

  log("PASS", "Demo Badges", `Total "Demo" labels on dashboard: ${demoBadgeAudit.totalDemoLabels}`,
    `Portfolio: ${demoBadgeAudit.portfolioHasDemo}, Indices: ${demoBadgeAudit.indicesHaveDemo}`);

  // ================================================================
  // I. NEWS LINKS — are they properly handled for demo?
  // ================================================================
  console.log("\n========== I. NEWS LINKS CHECK ==========\n");

  const newsLinksCheck = await page.evaluate(() => {
    const links = document.querySelectorAll("a");
    const externalLinks = [];
    for (const link of links) {
      const href = link.getAttribute("href");
      if (href && href.startsWith("http") && !href.includes("tradingalpha.net")) {
        externalLinks.push({
          href: href.substring(0, 80),
          text: link.textContent?.trim().substring(0, 50),
          hasPointerEvents: window.getComputedStyle(link).pointerEvents !== "none",
          hasAriaDisabled: link.getAttribute("aria-disabled") === "true",
          isVisible: link.getBoundingClientRect().width > 0,
        });
      }
    }
    return externalLinks;
  });

  const clickableExternal = newsLinksCheck.filter((l) => l.hasPointerEvents && !l.hasAriaDisabled && l.isVisible);
  if (clickableExternal.length > 0) {
    log("WARN", "News/Links", `${clickableExternal.length} clickable external links`,
      clickableExternal.slice(0, 3).map(l => l.text).join(", "));
  } else {
    log("PASS", "News/Links", "External links properly handled for demo");
  }

  // ================================================================
  // J. CHECK ALL STRATEGY PAGES FOR EACH TAB
  // ================================================================
  console.log("\n========== J. STRATEGY TAB DEEP-CHECK ==========\n");

  await page.goto(`${BASE}/strategies/pead`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // List all tabs
  const strategyTabs = await page.evaluate(() => {
    const tabs = document.querySelectorAll('[role="tab"]');
    return Array.from(tabs).map((t) => ({
      text: t.textContent?.trim(),
      dataState: t.getAttribute("data-state"),
    }));
  });

  console.log("Strategy page tabs:", JSON.stringify(strategyTabs));
  log("PASS", "Strategy/PEAD/Tabs", `Tabs: ${strategyTabs.map(t => t.text).join(", ")}`);

  // Click through each tab
  for (let i = 0; i < strategyTabs.length; i++) {
    try {
      const tabs = await page.$$('[role="tab"]');
      if (tabs[i]) {
        await tabs[i].click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        await ss(page, `strategy-pead-tab-${i}`);

        // Check for errors in tab content
        const tabContent = await page.textContent("body");
        const hasError = /error|failed|something went wrong/i.test(tabContent);
        if (hasError && !/tracking error/i.test(tabContent)) {
          log("WARN", `Strategy/PEAD/Tab-${strategyTabs[i].text}`, "Tab content may show error");
        } else {
          log("PASS", `Strategy/PEAD/Tab-${strategyTabs[i].text}`, "Tab loads cleanly");
        }
      }
    } catch {
      log("WARN", `Strategy/PEAD/Tab-${i}`, "Tab click issue");
    }
  }

  // ================================================================
  // K. HYDRATION ERROR INVESTIGATION (React #418)
  // ================================================================
  console.log("\n========== K. HYDRATION ERROR ==========\n");

  // React error #418 is a hydration mismatch
  const hydrationErrors = consoleErrors.filter((e) => e.text.includes("418"));
  if (hydrationErrors.length > 0) {
    log("WARN", "Hydration", `React hydration mismatch error #418 detected (${hydrationErrors.length} times)`,
      "This is a SSR/client rendering mismatch — common with date/time rendering or random values");
    console.log("  Hydration error pages:", [...new Set(hydrationErrors.map(e => e.url))].join(", "));
  } else {
    log("PASS", "Hydration", "No React hydration errors");
  }

  // ================================================================
  // L. PIPELINE DATE BUG — requesting tomorrow's date
  // ================================================================
  console.log("\n========== L. PIPELINE DATE BUG ==========\n");

  // The 404 was for /api/v1/pipeline/history/2026-04-13 — that's tomorrow's date
  // Check if the pipeline page is requesting a future date
  log("WARN", "Pipeline/Date", "Pipeline page requested /api/v1/pipeline/history/2026-04-13 (tomorrow's date, April 13)",
    "May be a timezone issue — server date vs client date offset causing off-by-one");

  // ================================================================
  // FINAL SUMMARY
  // ================================================================
  console.log("\n\n================================================");
  console.log("       ROUND 6 PASS 2 — DETAILED FINDINGS");
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
  }

  if (warnCount > 0) {
    console.log("\n---------- WARNINGS ----------");
    for (const i of issues.filter((x) => x.status === "WARN")) {
      console.log(`  #${i.id} [${i.section}] ${i.description}${i.details ? " — " + i.details : ""}`);
    }
  }

  console.log(`\nScreenshots: ${DIR}`);
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
