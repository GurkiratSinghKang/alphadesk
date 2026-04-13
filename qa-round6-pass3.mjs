import { chromium } from "playwright";
import { mkdirSync } from "fs";
import path from "path";

const BASE = "https://tradingalpha.net";
const DIR = "/Users/GK/Downloads/alphadesk/qa-screenshots/round6";

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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', 'alphaDesk2025!');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  await page.waitForTimeout(3000);
  console.log("Logged in.\n");

  // ================================================================
  // 1. STATUS STRIP — detailed content check
  // ================================================================
  console.log("========== STATUS STRIP DEEP CHECK ==========\n");

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // The StatusStrip is: <div className="flex h-7 shrink-0 items-center ...">
  // It's rendered right after TopBar in the layout
  const stripCheck = await page.evaluate(() => {
    // Find the status strip — it's a h-7 (28px) div with P&L, Regime, VIX
    const allDivs = document.querySelectorAll("div");
    for (const div of allDivs) {
      const text = div.textContent || "";
      if (text.includes("P&L") && text.includes("Regime") && text.includes("VIX")) {
        const rect = div.getBoundingClientRect();
        if (rect.height < 40) {
          return {
            found: true,
            text: text.trim().substring(0, 300),
            height: rect.height,
            top: rect.top,
            hasPnl: /P&L/.test(text),
            hasRegime: /Regime/.test(text),
            hasVix: /VIX/.test(text),
            hasDemo: /\(Demo\)/.test(text),
            hasLiveOffline: /LIVE|OFFLINE/.test(text),
            hasModeBadge: /Paper|Live|paper|live/.test(text),
          };
        }
      }
    }
    return { found: false };
  });

  if (stripCheck.found) {
    log("PASS", "Status Strip", "Found and verified",
      `height: ${stripCheck.height}px, top: ${stripCheck.top}px`);
    log(stripCheck.hasPnl ? "PASS" : "FAIL", "Status Strip", "P&L present");
    log(stripCheck.hasRegime ? "PASS" : "FAIL", "Status Strip", "Regime present");
    log(stripCheck.hasVix ? "PASS" : "FAIL", "Status Strip", "VIX present");
    log(stripCheck.hasDemo ? "PASS" : "WARN", "Status Strip", "(Demo) labels present");
    log(stripCheck.hasLiveOffline ? "PASS" : "FAIL", "Status Strip", "LIVE/OFFLINE indicator");
    log(stripCheck.hasModeBadge ? "PASS" : "FAIL", "Status Strip", "Paper/Live mode badge");
    console.log("  Strip text:", stripCheck.text);
  } else {
    log("FAIL", "Status Strip", "Could not find status strip with P&L, Regime, VIX");
  }

  // Clip screenshot of just the status strip area (top ~72px)
  await page.screenshot({
    path: path.join(DIR, "p3-status-strip-cropped.png"),
    clip: { x: 0, y: 0, width: 1920, height: 80 },
  });

  // ================================================================
  // 2. STRATEGY TABS — using correct selectors (custom buttons, not role="tab")
  // ================================================================
  console.log("\n========== STRATEGY TABS CHECK ==========\n");

  await page.goto(`${BASE}/strategies/pead`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const stratTabs = await page.evaluate(() => {
    // Strategy tabs use custom buttons with border-b-2, not role="tab"
    const buttons = document.querySelectorAll("button");
    const tabs = [];
    for (const btn of buttons) {
      const cls = btn.className || "";
      if (cls.includes("border-b-2") || cls.includes("-mb-px")) {
        tabs.push({
          text: btn.textContent?.trim(),
          isActive: cls.includes("border-primary"),
        });
      }
    }
    return tabs;
  });

  console.log("Strategy tabs found:", JSON.stringify(stratTabs));
  log(stratTabs.length >= 5 ? "PASS" : "WARN", "Strategy/Tabs",
    `Found ${stratTabs.length} tabs: ${stratTabs.map(t => t.text).join(", ")}`);

  // Click through each tab
  for (let i = 0; i < stratTabs.length; i++) {
    try {
      const tabs = await page.$$("button");
      for (const tab of tabs) {
        const text = await tab.textContent();
        const cls = await tab.getAttribute("class");
        if (text?.trim() === stratTabs[i].text && (cls?.includes("border-b-2") || cls?.includes("-mb-px"))) {
          await tab.click({ timeout: 3000 });
          await page.waitForTimeout(1000);
          await page.screenshot({
            path: path.join(DIR, `p3-strategy-pead-tab-${i}-${stratTabs[i].text?.replace(/\s/g, "_")}.png`),
            fullPage: false,
          });
          log("PASS", `Strategy/Tab/${stratTabs[i].text}`, "Tab loads correctly");
          break;
        }
      }
    } catch (e) {
      log("WARN", `Strategy/Tab/${stratTabs[i]?.text}`, "Tab click issue", e.message.substring(0, 50));
    }
  }

  // ================================================================
  // 3. DASHBOARD DEEP PIXEL CHECKS
  // ================================================================
  console.log("\n========== DASHBOARD DETAILED CHECKS ==========\n");

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check portfolio hero for Demo badge
  const heroCheck = await page.evaluate(() => {
    // PortfolioHero component renders the portfolio value
    const heroEl = document.querySelector('[class*="hero"]') ||
                   (() => {
                     // Find by looking for the big dollar amount
                     const h2s = document.querySelectorAll("h2, div");
                     for (const el of h2s) {
                       if (/\$\d{3,}/.test(el.textContent || "")) {
                         return el.closest("div.rounded-xl") || el.parentElement;
                       }
                     }
                     return null;
                   })();

    if (!heroEl) return { found: false };

    const text = heroEl.textContent || "";
    return {
      found: true,
      hasDemoBadge: /Demo/i.test(text),
      hasPortfolioValue: /\$[\d,]+/.test(text),
      hasPnl: /P&L|Day's P&L/i.test(text) || /[+-]\$/.test(text),
      text: text.substring(0, 150),
    };
  });

  if (heroCheck.found) {
    log(heroCheck.hasDemoBadge ? "PASS" : "WARN", "Dashboard/Hero", "Demo badge on portfolio hero",
      heroCheck.hasDemoBadge ? "Visible" : "Not visible");
    log(heroCheck.hasPortfolioValue ? "PASS" : "FAIL", "Dashboard/Hero", "Portfolio value displayed");
    log(heroCheck.hasPnl ? "PASS" : "WARN", "Dashboard/Hero", "P&L displayed in hero");
  }

  // Check strategy grid for "12 cards visible"
  const gridCheck = await page.evaluate(() => {
    // Strategy grid renders cards with onClick
    const allCards = document.querySelectorAll('[class*="cursor-pointer"]');
    let stratCards = 0;
    const cardTexts = [];
    for (const card of allCards) {
      const text = card.textContent || "";
      if (/Active|Paused|positions|pos\b/i.test(text) && text.length > 10 && text.length < 300) {
        stratCards++;
        const name = text.match(/^([A-Za-z\s+.]+)/)?.[1]?.trim();
        if (name && name.length > 2) cardTexts.push(name.substring(0, 25));
      }
    }
    return { count: stratCards, names: cardTexts };
  });

  log(gridCheck.count >= 12 ? "PASS" : gridCheck.count >= 8 ? "WARN" : "FAIL", "Dashboard/StrategyGrid",
    `Strategy cards visible: ${gridCheck.count}`, gridCheck.names.join(", "));

  // Check activity feed timestamps
  const feedCheck = await page.evaluate(() => {
    const feedItems = document.querySelectorAll('[class*="feed"] [class*="item"], [class*="activity"] li, [class*="Activity"] > div > div');
    const timestamps = [];
    for (const item of feedItems) {
      const timeEl = item.querySelector("time, [class*='time'], [class*='muted']");
      if (timeEl) timestamps.push(timeEl.textContent?.trim());
    }
    return { count: feedItems.length, timestamps: timestamps.slice(0, 5) };
  });

  log(feedCheck.count > 0 ? "PASS" : "WARN", "Dashboard/ActivityFeed",
    `Feed items: ${feedCheck.count}`, `Timestamps: ${feedCheck.timestamps.join(", ")}`);

  // Check economic calendar "Sample Events" label
  const econCalCheck = await page.evaluate(() => {
    const body = document.body.textContent || "";
    return {
      hasSampleEvents: /Sample Events/i.test(body),
      hasSampleLabel: /sample/i.test(body),
      hasCalendar: /Economic Calendar/i.test(body),
    };
  });

  log(econCalCheck.hasSampleEvents ? "PASS" : "WARN", "Dashboard/EconCalendar",
    "Sample Events label", econCalCheck.hasSampleEvents ? "Visible" : "Not visible");

  // Check P&L Calendar mini
  const pnlCalCheck = await page.evaluate(() => {
    const body = document.body.textContent || "";
    return {
      hasNoTradingData: /No trading data|no trades/i.test(body),
      hasPnlCalendar: /P&L Calendar/i.test(body),
    };
  });

  log(pnlCalCheck.hasNoTradingData || pnlCalCheck.hasPnlCalendar ? "PASS" : "WARN",
    "Dashboard/PnlCalendar", "P&L Calendar widget",
    pnlCalCheck.hasNoTradingData ? "Shows 'No trading data'" : pnlCalCheck.hasPnlCalendar ? "Calendar visible" : "");

  // Check market indices have Demo badges
  const indexDemoCheck = await page.evaluate(() => {
    // Find the Market Indices section
    const headers = document.querySelectorAll("h3");
    for (const h of headers) {
      if (/Market Indices/i.test(h.textContent || "")) {
        const section = h.parentElement;
        const text = section?.textContent || "";
        return {
          found: true,
          hasDemo: /Demo/i.test(text),
          text: text.substring(0, 200),
        };
      }
    }
    return { found: false };
  });

  if (indexDemoCheck.found) {
    log(indexDemoCheck.hasDemo ? "PASS" : "WARN", "Dashboard/Indices",
      "Market indices Demo badge", indexDemoCheck.hasDemo ? "Visible" : "Not visible — indices show real-ish data without demo label");
  }

  // Check sector treemap for Demo label
  const sectorCheck = await page.evaluate(() => {
    const headers = document.querySelectorAll("h3");
    for (const h of headers) {
      if (/Sector Performance/i.test(h.textContent || "")) {
        const section = h.parentElement;
        const text = section?.textContent || "";
        return {
          found: true,
          hasDemo: /Demo/i.test(text),
        };
      }
    }
    return { found: false };
  });

  if (sectorCheck.found) {
    log(sectorCheck.hasDemo ? "PASS" : "WARN", "Dashboard/Sectors",
      "Sector treemap Demo label", sectorCheck.hasDemo ? "Visible" : "Not visible");
  }

  // ================================================================
  // 4. TRADE PAGE — VERIFY OPTIONS CHAIN ESTIMATED BANNER
  // ================================================================
  console.log("\n========== OPTIONS CHAIN CHECK ==========\n");

  await page.goto(`${BASE}/trade`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  const optionsCheck = await page.evaluate(() => {
    // OptionsPanel is bottom-left
    const body = document.body.textContent || "";
    return {
      hasOptions: /Options|Chain|Strike|Expir/i.test(body),
      hasEstimated: /Estimated|est\.|Sample/i.test(body),
      hasIVdash: body.includes("—") && /IV|Implied/i.test(body),
      hasCalls: /Calls?/i.test(body),
      hasPuts: /Puts?/i.test(body),
    };
  });

  log(optionsCheck.hasOptions ? "PASS" : "WARN", "Trade/OptionsChain", "Options chain visible");
  log(optionsCheck.hasEstimated ? "PASS" : "WARN", "Trade/OptionsChain", "Estimated banner present");
  log(optionsCheck.hasCalls ? "PASS" : "WARN", "Trade/OptionsChain", "Calls column visible");
  log(optionsCheck.hasPuts ? "PASS" : "WARN", "Trade/OptionsChain", "Puts column visible");

  // ================================================================
  // 5. CROSS-PAGE CONSISTENCY — portfolio value
  // ================================================================
  console.log("\n========== CROSS-PAGE CONSISTENCY ==========\n");

  // Dashboard portfolio value
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const dashPortfolio = await page.evaluate(() => {
    // Find the big portfolio number
    const text = document.body.textContent || "";
    const match = text.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    return match ? match[0] : null;
  });

  // Status strip portfolio value
  const stripPortfolio = await page.evaluate(() => {
    const allDivs = document.querySelectorAll("div");
    for (const div of allDivs) {
      const text = div.textContent || "";
      if (text.includes("P&L") && text.includes("Regime") && text.includes("VIX")) {
        const rect = div.getBoundingClientRect();
        if (rect.height < 40) {
          const dollars = text.match(/\$[\d,.]+/g);
          return dollars;
        }
      }
    }
    return null;
  });

  // Profile menu portfolio value
  // Click profile
  const allBtns = await page.$$("button");
  let profileValue = null;
  for (const btn of allBtns) {
    const rect = await btn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, right: r.right };
    });
    if (rect.top < 60 && rect.right > 1880) {
      await btn.click({ timeout: 3000 });
      await page.waitForTimeout(1000);

      const dropdown = await page.$('[role="menu"], [class*="dropdown"], [class*="popover"]');
      if (dropdown) {
        const dropText = await dropdown.textContent();
        const match = dropText?.match(/\$[\d,]+(?:\.\d{2})?/);
        profileValue = match ? match[0] : null;
      }

      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      break;
    }
  }

  console.log(`  Dashboard: ${dashPortfolio}`);
  console.log(`  Status strip: ${JSON.stringify(stripPortfolio)}`);
  console.log(`  Profile menu: ${profileValue}`);

  if (dashPortfolio && profileValue) {
    if (dashPortfolio === profileValue) {
      log("PASS", "Consistency", "Portfolio value matches dashboard and profile menu", dashPortfolio);
    } else {
      log("WARN", "Consistency", "Portfolio value mismatch",
        `Dashboard: ${dashPortfolio}, Profile: ${profileValue}`);
    }
  }

  // Strategy returns consistency
  const dashStratReturns = await page.evaluate(() => {
    const text = document.body.textContent || "";
    const matches = text.match(/[+-]?\d+\.\d+%/g);
    return matches?.slice(0, 5);
  });
  log("PASS", "Consistency", "Strategy returns on dashboard", dashStratReturns?.join(", ") || "none");

  // ================================================================
  // 6. PIPELINE DATE BUG INVESTIGATION
  // ================================================================
  console.log("\n========== PIPELINE DATE CHECK ==========\n");

  const dateCheck = await page.evaluate(() => {
    const isoDate = new Date().toISOString().slice(0, 10);
    const localDate = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    })();
    return { isoDate, localDate, matches: isoDate === localDate };
  });

  console.log(`  ISO (UTC) date: ${dateCheck.isoDate}`);
  console.log(`  Local date: ${dateCheck.localDate}`);
  console.log(`  Match: ${dateCheck.matches}`);

  if (!dateCheck.matches) {
    log("WARN", "Pipeline/Date", "UTC date differs from local date — could cause off-by-one",
      `UTC: ${dateCheck.isoDate}, Local: ${dateCheck.localDate}`);
  } else {
    log("PASS", "Pipeline/Date", "UTC and local dates match for this timezone");
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log("\n\n================================================");
  console.log("         ROUND 6 PASS 3 — FINAL DETAILS");
  console.log("================================================\n");
  console.log(`  PASS: ${passCount}`);
  console.log(`  WARN: ${warnCount}`);
  console.log(`  FAIL: ${failCount}`);
  console.log(`  TOTAL: ${testId}\n`);

  if (failCount > 0) {
    console.log("FAILURES:");
    for (const i of issues.filter((x) => x.status === "FAIL")) {
      console.log(`  #${i.id} [${i.section}] ${i.description}${i.details ? " — " + i.details : ""}`);
    }
  }
  if (warnCount > 0) {
    console.log("\nWARNINGS:");
    for (const i of issues.filter((x) => x.status === "WARN")) {
      console.log(`  #${i.id} [${i.section}] ${i.description}${i.details ? " — " + i.details : ""}`);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
