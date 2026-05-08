/**
 * AlphaDesk FINAL Performance & Accessibility Audit
 *
 * Comprehensive audit covering:
 *   - Performance: load time, DOM count, JS/CSS resources, network, FCP
 *   - Accessibility: contrast, labels, ARIA, headings, keyboard nav
 *   - New feature audits: Economic Calendar, Strategy Builder, Backtester,
 *     Position Sizer, Drawing Toolbar, BUY/SELL buttons
 *
 * Usage: node qa-final-perf.mjs
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE_URL = "https://tradingalpha.net";
const LOGIN_URL = `${BASE_URL}/login`;
const CREDS = { username: QA_USERNAME, password: getQaPassword() };

const PAGES = [
  { name: "Dashboard (/)", path: "/" },
  { name: "Trade (/trade)", path: "/trade" },
  { name: "Pipeline (/pipeline)", path: "/pipeline" },
  { name: "Strategy Detail (/strategies/pead)", path: "/strategies/pead" },
];

const OUT_DIR = path.resolve("qa-screenshots/final-eval");
fs.mkdirSync(OUT_DIR, { recursive: true });

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // ── Login ──────────────────────────────────────────────────
  log("Logging in...");
  try {
    await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[placeholder="admin"]', CREDS.username);
    await page.fill('input[type="password"]', CREDS.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/", { timeout: 15000 });
    log("Login successful.");
  } catch (err) {
    console.error("Login failed:", err.message);
    await browser.close();
    process.exit(1);
  }

  const allResults = [];

  // ═══════════════════════════════════════════════════════════
  // PERFORMANCE + A11Y AUDIT PER PAGE
  // ═══════════════════════════════════════════════════════════

  for (const pg of PAGES) {
    log(`\n========== Auditing: ${pg.name} ==========`);
    const url = `${BASE_URL}${pg.path}`;
    const result = {
      name: pg.name,
      url,
      performance: {},
      accessibility: {},
      featureAudits: {},
    };

    // Track network
    const requestLog = [];
    const resourceList = [];

    page.on("response", async (response) => {
      const reqUrl = response.url();
      const status = response.status();
      let size = 0;
      try {
        const headers = response.headers();
        size = parseInt(headers["content-length"] || "0", 10);
        if (!size) {
          const body = await response.body().catch(() => Buffer.alloc(0));
          size = body.length;
        }
      } catch {}
      requestLog.push({ url: reqUrl, status, size });

      const ct = (response.headers()["content-type"] || "").toLowerCase();
      if (
        reqUrl.endsWith(".js") || reqUrl.endsWith(".css") ||
        ct.includes("javascript") || ct.includes("css")
      ) {
        const type = ct.includes("css") || reqUrl.endsWith(".css") ? "CSS" : "JS";
        const shortUrl = reqUrl.replace(BASE_URL, "").split("?")[0];
        resourceList.push({ type, url: shortUrl, size });
      }
    });

    // Navigate
    const navStart = Date.now();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } catch (err) {
      log(`  Navigation timeout: ${err.message}`);
    }
    const navEnd = Date.now();

    await page.waitForTimeout(3000);

    // ── Performance Metrics ──────────────────────────────
    const loadTimeMs = navEnd - navStart;
    const domElements = await page.evaluate(() => document.querySelectorAll("*").length);

    const fcp = await page.evaluate(() => {
      const entries = performance.getEntriesByName("first-contentful-paint");
      return entries.length > 0 ? Math.round(entries[0].startTime) : null;
    }).catch(() => null);

    const jsResources = resourceList.filter(r => r.type === "JS");
    const cssResources = resourceList.filter(r => r.type === "CSS");
    const totalJsSize = jsResources.reduce((s, r) => s + r.size, 0);
    const totalCssSize = cssResources.reduce((s, r) => s + r.size, 0);
    const totalTransferred = requestLog.reduce((s, r) => s + r.size, 0);

    result.performance = {
      loadTimeMs,
      domElements,
      fcp,
      jsResourceCount: jsResources.length,
      cssResourceCount: cssResources.length,
      totalJsSize,
      totalJsSizeHuman: fmtBytes(totalJsSize),
      totalCssSize,
      totalCssSizeHuman: fmtBytes(totalCssSize),
      totalNetworkRequests: requestLog.length,
      totalTransferredBytes: totalTransferred,
      totalTransferredHuman: fmtBytes(totalTransferred),
      topResources: resourceList.sort((a, b) => b.size - a.size).slice(0, 10).map(r => ({
        ...r,
        sizeHuman: fmtBytes(r.size),
      })),
    };

    log(`  Load: ${loadTimeMs}ms | FCP: ${fcp ?? "N/A"}ms | DOM: ${domElements} | Requests: ${requestLog.length} | Transfer: ${fmtBytes(totalTransferred)}`);
    log(`  JS: ${jsResources.length} files (${fmtBytes(totalJsSize)}) | CSS: ${cssResources.length} files (${fmtBytes(totalCssSize)})`);

    // ── Accessibility Audit ──────────────────────────────
    const a11yResults = await page.evaluate(() => {
      const findings = {
        contrastIssues: [],
        unlabeledButtons: [],
        unlabeledInputs: [],
        emptyLinks: [],
        headings: [],
        headingIssues: [],
        ariaLandmarks: {},
        focusableCount: 0,
        ariaRoleCount: 0,
        missingAltImages: 0,
        totalTextElements: 0,
      };

      // ── 1. Color Contrast Check ──────────────────────
      function relativeLuminance(r, g, b) {
        const srgb = [r / 255, g / 255, b / 255].map(c =>
          c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
        );
        return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
      }

      function contrastRatio(l1, l2) {
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }

      function parseColor(colorStr) {
        if (!colorStr || colorStr === "transparent" || colorStr === "rgba(0, 0, 0, 0)") return null;
        const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
        return null;
      }

      function isLargeText(el) {
        const style = getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        const fontWeight = parseInt(style.fontWeight) || (style.fontWeight === "bold" ? 700 : 400);
        return fontSize >= 18.66 || (fontSize >= 14 && fontWeight >= 700);
      }

      // Sample text elements for contrast
      const textEls = document.querySelectorAll("p, span, a, button, label, h1, h2, h3, h4, h5, h6, td, th, li, div");
      const contrastChecked = new Set();
      let totalChecked = 0;
      let contrastFailCount = 0;

      textEls.forEach(el => {
        const text = el.textContent?.trim();
        if (!text || text.length === 0) return;
        // Only check leaf text nodes or elements with direct text
        if (el.children.length > 3 && el.tagName !== "BUTTON" && el.tagName !== "A") return;

        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return;

        const fg = parseColor(style.color);
        const bg = parseColor(style.backgroundColor);
        if (!fg) return;

        totalChecked++;
        findings.totalTextElements++;

        // Walk up to find effective background
        let effectiveBg = bg;
        if (!effectiveBg) {
          let parent = el.parentElement;
          while (parent) {
            const pBg = parseColor(getComputedStyle(parent).backgroundColor);
            if (pBg) { effectiveBg = pBg; break; }
            parent = parent.parentElement;
          }
        }
        if (!effectiveBg) effectiveBg = { r: 10, g: 10, b: 15 }; // Default dark bg #0a0a0f

        const fgLum = relativeLuminance(fg.r, fg.g, fg.b);
        const bgLum = relativeLuminance(effectiveBg.r, effectiveBg.g, effectiveBg.b);
        const ratio = contrastRatio(fgLum, bgLum);
        const large = isLargeText(el);
        const threshold = large ? 3.0 : 4.5;

        if (ratio < threshold) {
          const key = `${style.color}|${style.backgroundColor}`;
          if (!contrastChecked.has(key)) {
            contrastChecked.add(key);
            contrastFailCount++;
            const snippet = text.slice(0, 40);
            findings.contrastIssues.push({
              element: el.tagName.toLowerCase(),
              text: snippet,
              fgColor: style.color,
              bgColor: style.backgroundColor || "(inherited)",
              ratio: ratio.toFixed(2),
              threshold,
              large,
              pass: false,
            });
          }
        }
      });

      // Specifically check #8a8a95 on dark backgrounds
      const specificCheck8a = (() => {
        const fg = { r: 0x8a, g: 0x8a, b: 0x95 };
        const backgrounds = [
          { name: "#0a0a0f (surface)", rgb: { r: 0x0a, g: 0x0a, b: 0x0f } },
          { name: "#0e0e16 (panel)", rgb: { r: 0x0e, g: 0x0e, b: 0x16 } },
          { name: "#141420 (card)", rgb: { r: 0x14, g: 0x14, b: 0x20 } },
        ];
        const fgLum = relativeLuminance(fg.r, fg.g, fg.b);
        return backgrounds.map(bg => {
          const bgLum = relativeLuminance(bg.rgb.r, bg.rgb.g, bg.rgb.b);
          const ratio = contrastRatio(fgLum, bgLum);
          return {
            fg: "#8a8a95",
            bg: bg.name,
            ratio: ratio.toFixed(2),
            passAA_normal: ratio >= 4.5,
            passAA_large: ratio >= 3.0,
          };
        });
      })();

      findings.mutedColorCheck = specificCheck8a;
      findings.contrastSummary = {
        totalChecked,
        uniqueFailingCombinations: contrastFailCount,
        totalIssuesFound: findings.contrastIssues.length,
      };

      // ── 2. Interactive Elements ──────────────────────
      document.querySelectorAll("button, [role='button']").forEach(btn => {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const title = btn.getAttribute("title") || "";
        if (!text && !ariaLabel && !title) {
          findings.unlabeledButtons.push({
            tag: btn.tagName.toLowerCase(),
            classes: btn.className?.slice?.(0, 80) || "",
            html: btn.innerHTML?.slice(0, 60) || "",
          });
        }
      });

      // ── 3. Form Inputs ──────────────────────────────
      document.querySelectorAll("input, select, textarea").forEach(inp => {
        const id = inp.id;
        const ariaLabel = inp.getAttribute("aria-label") || "";
        const ariaLabelledBy = inp.getAttribute("aria-labelledby") || "";
        const placeholder = inp.getAttribute("placeholder") || "";
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        // Also check if a parent label wraps this input
        const wrappedInLabel = inp.closest("label") !== null;
        // Check if sibling label exists
        const siblingLabel = inp.previousElementSibling?.tagName === "LABEL" ||
                             inp.parentElement?.querySelector("label") !== null;

        if (!hasLabel && !ariaLabel && !ariaLabelledBy && !placeholder && !wrappedInLabel && !siblingLabel) {
          findings.unlabeledInputs.push({
            tag: inp.tagName.toLowerCase(),
            type: inp.type || "",
            name: inp.name || "",
            classes: inp.className?.slice?.(0, 80) || "",
          });
        }
      });

      // ── 4. Links ────────────────────────────────────
      document.querySelectorAll("a").forEach(a => {
        const text = a.textContent?.trim() || "";
        const ariaLabel = a.getAttribute("aria-label") || "";
        if (!text && !ariaLabel) {
          findings.emptyLinks.push({
            href: a.href?.slice(0, 60) || "",
            html: a.innerHTML?.slice(0, 60) || "",
          });
        }
      });

      // ── 5. Headings ────────────────────────────────
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(h => {
        findings.headings.push({
          level: parseInt(h.tagName[1]),
          text: h.textContent?.trim().slice(0, 60),
        });
      });
      const h1Count = findings.headings.filter(h => h.level === 1).length;
      if (h1Count === 0) findings.headingIssues.push("No <h1> found");
      if (h1Count > 1) findings.headingIssues.push(`${h1Count} <h1> elements (should be 1)`);
      for (let i = 1; i < findings.headings.length; i++) {
        if (findings.headings[i].level > findings.headings[i - 1].level + 1) {
          findings.headingIssues.push(`Heading skip: h${findings.headings[i - 1].level} -> h${findings.headings[i].level}`);
          break;
        }
      }

      // ── 6. ARIA Landmarks ──────────────────────────
      findings.ariaLandmarks = {
        main: !!document.querySelector("main, [role='main']"),
        nav: !!document.querySelector("nav, [role='navigation']"),
        banner: !!document.querySelector("header, [role='banner']"),
        complementary: !!document.querySelector("aside, [role='complementary']"),
        contentinfo: !!document.querySelector("footer, [role='contentinfo']"),
        search: !!document.querySelector("[role='search']"),
      };

      // ── 7. Focusable / ARIA ────────────────────────
      findings.focusableCount = document.querySelectorAll(
        "button, a, input, select, textarea, [tabindex]"
      ).length;
      findings.ariaRoleCount = document.querySelectorAll("[role]").length;

      // ── 8. Images ──────────────────────────────────
      document.querySelectorAll("img").forEach(img => {
        if (!img.alt && !img.getAttribute("aria-hidden")) findings.missingAltImages++;
      });

      return findings;
    });

    result.accessibility = a11yResults;

    // ── Keyboard Navigation Test ──────────────────────
    const keyboardTest = await page.evaluate(async () => {
      const results = { tabbableElements: 0, focusableWithOutline: 0, elementsReached: [] };
      const focusable = document.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      results.tabbableElements = focusable.length;

      // Check first 15 elements for focus styles
      for (let i = 0; i < Math.min(focusable.length, 15); i++) {
        const el = focusable[i];
        el.focus();
        const style = getComputedStyle(el);
        const hasOutline = style.outlineWidth !== "0px" && style.outlineStyle !== "none";
        const hasBoxShadow = style.boxShadow !== "none";
        const hasRing = el.classList.contains("focus-visible") || el.matches(":focus-visible");
        if (hasOutline || hasBoxShadow || hasRing) {
          results.focusableWithOutline++;
        }
        results.elementsReached.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent?.trim() || el.getAttribute("aria-label") || "").slice(0, 30),
          hasFocusIndicator: hasOutline || hasBoxShadow || hasRing,
        });
      }

      return results;
    });

    result.accessibility.keyboardNav = keyboardTest;

    // ── Feature-Specific Audits (page-dependent) ────
    if (pg.path === "/") {
      // Dashboard: Economic Calendar
      const calendarAudit = await page.evaluate(() => {
        const calendar = document.querySelector('[class*="EconomicCalendar"], [data-slot="economic-calendar"]');
        // Also look for calendar by heading text
        const calHeading = Array.from(document.querySelectorAll("h2, h3")).find(
          h => h.textContent?.includes("Economic Calendar")
        );
        const calContainer = calHeading?.closest("[class*='rounded']") || calendar;
        if (!calContainer) return { found: false, note: "Economic Calendar not found on dashboard" };

        const items = calContainer.querySelectorAll("[class*='divide'] > div, [class*='divide'] > *");
        const eventTexts = [];
        items.forEach(item => {
          const text = item.textContent?.trim();
          if (text) eventTexts.push(text.slice(0, 80));
        });

        // Check for impact indicators (color dots or badges)
        const dots = calContainer.querySelectorAll("[class*='rounded-full']");
        const badges = calContainer.querySelectorAll("[class*='uppercase']");

        return {
          found: true,
          eventCount: items.length,
          hasDots: dots.length > 0,
          hasBadges: badges.length > 0,
          sampleEvents: eventTexts.slice(0, 3),
          hasSemanticStructure: !!calContainer.querySelector("h2, h3, [role='heading']"),
          accessible: items.length > 0 && (!!calHeading),
        };
      });
      result.featureAudits.economicCalendar = calendarAudit;
    }

    if (pg.path === "/trade") {
      // Trade page: Strategy Builder, Backtester, Position Sizer, Drawing Toolbar, BUY/SELL

      // Strategy Builder
      const strategyBuilderAudit = await page.evaluate(() => {
        // Look for Strategy Builder tab or content
        const tabs = Array.from(document.querySelectorAll('[role="tab"], button'));
        const builderTab = tabs.find(t => t.textContent?.includes("Builder") || t.textContent?.includes("Strategy"));
        return {
          tabFound: !!builderTab,
          tabText: builderTab?.textContent?.trim() || null,
        };
      });

      // Click on Strategy Builder tab if found
      const builderTab = await page.$('button:has-text("Builder"), [role="tab"]:has-text("Builder"), button:has-text("Strategy")');
      if (builderTab) {
        await builderTab.click();
        await page.waitForTimeout(1000);
      }

      const strategyBuilderDetail = await page.evaluate(() => {
        const results = { found: false, inputs: [], labelsOk: 0, labelsTotal: 0, issues: [] };
        // Look for strategy builder inputs
        const labels = document.querySelectorAll('label');
        const strategyLabels = Array.from(labels).filter(l =>
          l.textContent?.includes("Strategy Name") ||
          l.textContent?.includes("Rule") ||
          l.textContent?.includes("Natural Language")
        );

        if (strategyLabels.length > 0) results.found = true;

        // Check all inputs near strategy builder
        const allInputs = document.querySelectorAll("input");
        allInputs.forEach(inp => {
          const parentLabel = inp.closest("label") ||
                              inp.parentElement?.querySelector("label") ||
                              (inp.previousElementSibling?.tagName === "LABEL" ? inp.previousElementSibling : null);
          const ariaLabel = inp.getAttribute("aria-label");
          const placeholder = inp.getAttribute("placeholder");

          const hasLabel = !!parentLabel || !!ariaLabel || !!placeholder;
          results.labelsTotal++;
          if (hasLabel) results.labelsOk++;
          results.inputs.push({
            type: inp.type || "text",
            hasLabel,
            labelText: parentLabel?.textContent?.trim()?.slice(0, 40) || ariaLabel || placeholder || "(none)",
          });
        });

        if (results.labelsTotal > 0 && results.labelsOk < results.labelsTotal) {
          results.issues.push(`${results.labelsTotal - results.labelsOk} input(s) missing labels`);
        }

        return results;
      });

      result.featureAudits.strategyBuilder = {
        ...strategyBuilderAudit,
        ...strategyBuilderDetail,
      };

      // Backtester
      const backtesterTab = await page.$('button:has-text("Backtest"), [role="tab"]:has-text("Backtest")');
      if (backtesterTab) {
        await backtesterTab.click();
        await page.waitForTimeout(1000);
      }

      const backtesterAudit = await page.evaluate(() => {
        const results = { found: false, parameterInputs: [], allLabeled: true, issues: [] };
        const labels = document.querySelectorAll("label");
        const btLabels = Array.from(labels).filter(l =>
          l.textContent?.includes("Symbol") ||
          l.textContent?.includes("Fast") ||
          l.textContent?.includes("Slow") ||
          l.textContent?.includes("Capital")
        );

        results.found = btLabels.length >= 2;

        btLabels.forEach(label => {
          const input = label.parentElement?.querySelector("input");
          results.parameterInputs.push({
            label: label.textContent?.trim(),
            hasInput: !!input,
            inputType: input?.type || "unknown",
          });
        });

        // Check for Run button
        const runBtn = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent?.includes("Run Backtest") || b.textContent?.includes("Run")
        );
        results.hasRunButton = !!runBtn;
        results.runButtonAccessible = runBtn ? !!(runBtn.textContent?.trim() || runBtn.getAttribute("aria-label")) : false;

        return results;
      });
      result.featureAudits.backtester = backtesterAudit;

      // Position Sizer
      const positionSizerAudit = await page.evaluate(() => {
        const results = { found: false, riskLabelOk: false, stopLabelOk: false, issues: [] };

        // Find position sizer section
        const headers = Array.from(document.querySelectorAll("p, span, h3, h4")).filter(
          el => el.textContent?.includes("Position Sizer")
        );
        results.found = headers.length > 0;

        if (results.found) {
          const labels = document.querySelectorAll("label");
          const riskLabel = Array.from(labels).find(l => l.textContent?.includes("Risk %") || l.textContent?.includes("Risk"));
          const stopLabel = Array.from(labels).find(l => l.textContent?.includes("Stop") || l.textContent?.includes("Stop Loss"));
          results.riskLabelOk = !!riskLabel;
          results.stopLabelOk = !!stopLabel;

          if (!results.riskLabelOk) results.issues.push("Risk % input missing proper label");
          if (!results.stopLabelOk) results.issues.push("Stop Loss % input missing proper label");
        }

        return results;
      });
      result.featureAudits.positionSizer = positionSizerAudit;

      // Drawing Toolbar
      const drawingToolbarAudit = await page.evaluate(() => {
        const results = { found: false, buttons: [], allHaveTitles: true, issues: [] };

        // Look for drawing buttons by title attributes
        const drawingButtons = document.querySelectorAll('[title="Horizontal Line"], [title="Trendline"], [title="Fibonacci"], [title="Clear all drawings"]');
        results.found = drawingButtons.length > 0;

        drawingButtons.forEach(btn => {
          const title = btn.getAttribute("title") || "";
          const ariaLabel = btn.getAttribute("aria-label") || "";
          const text = btn.textContent?.trim() || "";
          const hasAccessibleName = !!(title || ariaLabel || text);
          results.buttons.push({ title, ariaLabel, text: text.slice(0, 20), accessible: hasAccessibleName });
          if (!hasAccessibleName) results.allHaveTitles = false;
        });

        return results;
      });
      result.featureAudits.drawingToolbar = drawingToolbarAudit;

      // BUY/SELL Chart Buttons
      const buySellAudit = await page.evaluate(() => {
        const results = { found: false, buttons: [], issues: [] };

        const allBtns = document.querySelectorAll("button");
        allBtns.forEach(btn => {
          const text = btn.textContent?.trim();
          if (text === "BUY" || text === "SELL") {
            results.found = true;
            const ariaLabel = btn.getAttribute("aria-label") || "";
            const title = btn.getAttribute("title") || "";
            results.buttons.push({
              text,
              hasAriaLabel: !!ariaLabel,
              hasTitle: !!title,
              accessible: !!(text || ariaLabel || title),
            });

            // Check color contrast for these buttons
            const style = getComputedStyle(btn);
            results.buttons[results.buttons.length - 1].color = style.color;
            results.buttons[results.buttons.length - 1].bgColor = style.backgroundColor;
          }
        });

        if (!results.found) {
          results.issues.push("BUY/SELL buttons not found (may require quote data)");
        }

        return results;
      });
      result.featureAudits.buySellButtons = buySellAudit;
    }

    // Take screenshot
    const screenshotName = pg.path.replace(/\//g, "_").replace(/^_/, "") || "dashboard";
    await page.screenshot({
      path: path.join(OUT_DIR, `final-${screenshotName}.png`),
      fullPage: true,
    });

    allResults.push(result);
    page.removeAllListeners("response");
  }

  // ═══════════════════════════════════════════════════════════
  // Save raw results
  // ═══════════════════════════════════════════════════════════
  const rawPath = path.join(OUT_DIR, "final-audit-raw.json");
  fs.writeFileSync(rawPath, JSON.stringify(allResults, null, 2));
  log(`\nRaw results saved to ${rawPath}`);

  // ═══════════════════════════════════════════════════════════
  // Print Summary
  // ═══════════════════════════════════════════════════════════

  console.log("\n" + "=".repeat(70));
  console.log("  ALPHADESK FINAL PERFORMANCE & ACCESSIBILITY AUDIT");
  console.log("=".repeat(70));

  for (const r of allResults) {
    const p = r.performance;
    const a = r.accessibility;

    console.log(`\n${"─".repeat(50)}`);
    console.log(`  ${r.name}`);
    console.log(`${"─".repeat(50)}`);

    console.log(`\n  PERFORMANCE:`);
    console.log(`    Page Load Time:       ${p.loadTimeMs}ms`);
    console.log(`    First Contentful Paint: ${p.fcp ?? "N/A"}ms`);
    console.log(`    DOM Elements:         ${p.domElements}`);
    console.log(`    JS Resources:         ${p.jsResourceCount} files (${p.totalJsSizeHuman})`);
    console.log(`    CSS Resources:        ${p.cssResourceCount} files (${p.totalCssSizeHuman})`);
    console.log(`    Total Requests:       ${p.totalNetworkRequests}`);
    console.log(`    Total Transferred:    ${p.totalTransferredHuman}`);

    if (p.topResources?.length > 0) {
      console.log(`    Top Resources:`);
      p.topResources.slice(0, 5).forEach(res => {
        console.log(`      [${res.type}] ${res.sizeHuman} - ${res.url.slice(0, 70)}`);
      });
    }

    console.log(`\n  ACCESSIBILITY:`);
    console.log(`    Contrast issues (unique pairs): ${a.contrastSummary?.uniqueFailingCombinations ?? 0}`);
    if (a.contrastIssues?.length > 0) {
      a.contrastIssues.slice(0, 5).forEach(ci => {
        console.log(`      FAIL: ${ci.element} "${ci.text}" ratio=${ci.ratio}:1 (need ${ci.threshold}:1)`);
      });
    }

    console.log(`    #8a8a95 muted color checks:`);
    if (a.mutedColorCheck) {
      a.mutedColorCheck.forEach(mc => {
        console.log(`      ${mc.fg} on ${mc.bg}: ${mc.ratio}:1 | AA normal: ${mc.passAA_normal ? "PASS" : "FAIL"} | AA large: ${mc.passAA_large ? "PASS" : "FAIL"}`);
      });
    }

    console.log(`    Unlabeled buttons:    ${a.unlabeledButtons?.length ?? 0}`);
    console.log(`    Unlabeled inputs:     ${a.unlabeledInputs?.length ?? 0}`);
    console.log(`    Empty links:          ${a.emptyLinks?.length ?? 0}`);
    console.log(`    Images missing alt:   ${a.missingAltImages}`);
    console.log(`    Heading issues:       ${a.headingIssues?.length ?? 0}`);
    if (a.headingIssues?.length) {
      a.headingIssues.forEach(hi => console.log(`      - ${hi}`));
    }
    console.log(`    ARIA landmarks:`);
    if (a.ariaLandmarks) {
      Object.entries(a.ariaLandmarks).forEach(([k, v]) => {
        console.log(`      ${k}: ${v ? "PRESENT" : "MISSING"}`);
      });
    }
    console.log(`    Focusable elements:   ${a.focusableCount}`);
    console.log(`    Keyboard nav test:`);
    if (a.keyboardNav) {
      console.log(`      Tabbable elements:  ${a.keyboardNav.tabbableElements}`);
      console.log(`      With focus indicator: ${a.keyboardNav.focusableWithOutline}/${Math.min(a.keyboardNav.tabbableElements, 15)} tested`);
    }

    if (r.featureAudits && Object.keys(r.featureAudits).length > 0) {
      console.log(`\n  FEATURE AUDITS:`);
      for (const [feature, audit] of Object.entries(r.featureAudits)) {
        console.log(`    ${feature}:`);
        console.log(`      ${JSON.stringify(audit, null, 2).split("\n").join("\n      ")}`);
      }
    }
  }

  await browser.close();
  log("\nAudit complete.");
}

main().catch(err => {
  console.error("Audit failed:", err);
  process.exit(1);
});
