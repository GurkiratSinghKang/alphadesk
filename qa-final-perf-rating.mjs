/**
 * AlphaDesk FINAL Performance & Accessibility Rating Script
 *
 * Measures per page (/, /trade, /pipeline, /strategies/pead):
 *   1. Page load time
 *   2. DOM element count
 *   3. FCP (First Contentful Paint)
 *   4. Total transferred bytes
 *   5. Network request count
 *   6. Color contrast (including #8a8a95 on #0a0a0f)
 *   7. Form input labels
 *   8. ARIA landmarks
 *   9. Heading hierarchy
 *
 * Rates 1-10 on 8 categories and produces overall score + top 5 shortcomings.
 *
 * Usage: node qa-final-perf-rating.mjs
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
  { name: "Dashboard", path: "/" },
  { name: "Trade", path: "/trade" },
  { name: "Pipeline", path: "/pipeline" },
  { name: "Strategy Detail", path: "/strategies/pead" },
];

const OUT_DIR = path.resolve("qa-screenshots/final-rating");
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

// ── Color math ────────────────────────────────────────────────────
function relativeLuminance(r, g, b) {
  const srgb = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(l1, l2) {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Pre-calculate #8a8a95 on #0a0a0f
const MUTED_FG = { r: 0x8a, g: 0x8a, b: 0x95 };
const DARK_BG = { r: 0x0a, g: 0x0a, b: 0x0f };
const mutedFgLum = relativeLuminance(MUTED_FG.r, MUTED_FG.g, MUTED_FG.b);
const darkBgLum = relativeLuminance(DARK_BG.r, DARK_BG.g, DARK_BG.b);
const MUTED_RATIO = contrastRatio(mutedFgLum, darkBgLum);

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const loginPage = await context.newPage();

  // ── Login ─────────────────────────────────────────────────────
  log("Logging in...");
  try {
    await loginPage.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 30000 });
    await loginPage.fill('input[placeholder="admin"]', CREDS.username);
    await loginPage.fill('input[type="password"]', CREDS.password);
    await loginPage.click('button[type="submit"]');
    await loginPage.waitForURL("**/", { timeout: 15000 });
    log("Login successful.");
  } catch (err) {
    // Fallback login selectors
    try {
      await loginPage.fill("input:first-of-type", CREDS.username);
      await loginPage.fill('input[type="password"]', CREDS.password);
      await loginPage.click('button[type="submit"]');
      await loginPage.waitForURL("**/", { timeout: 15000 });
      log("Login successful (fallback).");
    } catch (err2) {
      console.error("Login failed:", err2.message);
      await browser.close();
      process.exit(1);
    }
  }

  // Grab cookies for reuse
  const cookies = await context.cookies();

  const allPageResults = [];

  // ══════════════════════════════════════════════════════════════
  // AUDIT EACH PAGE
  // ══════════════════════════════════════════════════════════════

  for (const pg of PAGES) {
    log(`\n========== Auditing: ${pg.name} (${pg.path}) ==========`);
    const url = `${BASE_URL}${pg.path}`;

    // Fresh page with network interception
    const page = await context.newPage();
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
        reqUrl.endsWith(".js") ||
        reqUrl.endsWith(".css") ||
        ct.includes("javascript") ||
        ct.includes("css")
      ) {
        const type =
          ct.includes("css") || reqUrl.endsWith(".css") ? "CSS" : "JS";
        const shortUrl = reqUrl.replace(BASE_URL, "").split("?")[0];
        resourceList.push({ type, url: shortUrl, size });
      }
    });

    // Navigate and measure
    const navStart = Date.now();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } catch (err) {
      log(`  Navigation warning: ${err.message}`);
    }
    const navEnd = Date.now();

    await page.waitForTimeout(2000); // let lazy-loaded content appear

    // ── 1. Page Load Time ──────────────────────────────────────
    const loadTimeMs = navEnd - navStart;

    // ── 2. DOM Element Count ───────────────────────────────────
    const domElements = await page
      .evaluate(() => document.querySelectorAll("*").length)
      .catch(() => 0);

    // ── 3. FCP ─────────────────────────────────────────────────
    const fcp = await page
      .evaluate(() => {
        const entries = performance.getEntriesByName(
          "first-contentful-paint"
        );
        return entries.length > 0 ? Math.round(entries[0].startTime) : null;
      })
      .catch(() => null);

    // ── 4. Total Transferred Bytes ─────────────────────────────
    const totalTransferred = requestLog.reduce((s, r) => s + r.size, 0);

    // ── 5. Network Request Count ───────────────────────────────
    const networkRequests = requestLog.length;

    // JS/CSS breakdown
    const jsResources = resourceList.filter((r) => r.type === "JS");
    const cssResources = resourceList.filter((r) => r.type === "CSS");
    const totalJsSize = jsResources.reduce((s, r) => s + r.size, 0);
    const totalCssSize = cssResources.reduce((s, r) => s + r.size, 0);

    log(
      `  Load: ${loadTimeMs}ms | FCP: ${fcp ?? "N/A"}ms | DOM: ${domElements} | Requests: ${networkRequests} | Transfer: ${fmtBytes(totalTransferred)}`
    );
    log(
      `  JS: ${jsResources.length} files (${fmtBytes(totalJsSize)}) | CSS: ${cssResources.length} files (${fmtBytes(totalCssSize)})`
    );

    // ── 6-9. Accessibility Audit ─────────────────────────────
    const a11y = await page.evaluate(() => {
      const results = {
        // 6. Color Contrast
        contrast: {
          totalChecked: 0,
          failCount: 0,
          failures: [],
          mutedColorInstances: 0,
        },
        // 7. Form Input Labels
        forms: {
          totalInputs: 0,
          labeled: 0,
          unlabeled: [],
        },
        // 8. ARIA Landmarks
        landmarks: {
          main: false,
          nav: false,
          banner: false,
          complementary: false,
          contentinfo: false,
          search: false,
          count: 0,
        },
        // 9. Heading Hierarchy
        headings: {
          list: [],
          h1Count: 0,
          issues: [],
        },
        // Additional
        unlabeledButtons: [],
        emptyLinks: [],
        focusable: { total: 0, withIndicator: 0 },
        ariaRoleCount: 0,
        missingAltImages: 0,
      };

      // ── Contrast helpers ─────────────────────────────────────
      function relLum(r, g, b) {
        const s = [r / 255, g / 255, b / 255].map((c) =>
          c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
        );
        return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
      }
      function cr(l1, l2) {
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }
      function parseColor(str) {
        if (
          !str ||
          str === "transparent" ||
          str === "rgba(0, 0, 0, 0)"
        )
          return null;
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m)
          return {
            r: parseInt(m[1]),
            g: parseInt(m[2]),
            b: parseInt(m[3]),
          };
        return null;
      }
      function isLargeText(el) {
        const s = getComputedStyle(el);
        const sz = parseFloat(s.fontSize);
        const wt =
          parseInt(s.fontWeight) ||
          (s.fontWeight === "bold" ? 700 : 400);
        return sz >= 18.66 || (sz >= 14 && wt >= 700);
      }

      // ── 6. Color Contrast ────────────────────────────────────
      const textEls = document.querySelectorAll(
        "p, span, a, button, label, h1, h2, h3, h4, h5, h6, td, th, li, div, small, strong, em"
      );
      const seenPairs = new Set();

      textEls.forEach((el) => {
        const text = el.textContent?.trim();
        if (!text || text.length === 0) return;
        if (
          el.children.length > 3 &&
          el.tagName !== "BUTTON" &&
          el.tagName !== "A"
        )
          return;
        const style = getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          return;

        const fg = parseColor(style.color);
        if (!fg) return;

        results.contrast.totalChecked++;

        // Check if this element uses the specific #8a8a95 range
        if (
          Math.abs(fg.r - 0x8a) <= 5 &&
          Math.abs(fg.g - 0x8a) <= 5 &&
          Math.abs(fg.b - 0x95) <= 5
        ) {
          results.contrast.mutedColorInstances++;
        }

        // Find effective background
        let effectiveBg = parseColor(style.backgroundColor);
        if (!effectiveBg) {
          let parent = el.parentElement;
          while (parent) {
            const pBg = parseColor(
              getComputedStyle(parent).backgroundColor
            );
            if (pBg) {
              effectiveBg = pBg;
              break;
            }
            parent = parent.parentElement;
          }
        }
        if (!effectiveBg) effectiveBg = { r: 10, g: 10, b: 15 }; // #0a0a0f

        const fgLum = relLum(fg.r, fg.g, fg.b);
        const bgLum = relLum(
          effectiveBg.r,
          effectiveBg.g,
          effectiveBg.b
        );
        const ratio = cr(fgLum, bgLum);
        const large = isLargeText(el);
        const threshold = large ? 3.0 : 4.5;

        if (ratio < threshold) {
          const key = `${style.color}|${style.backgroundColor}`;
          if (!seenPairs.has(key)) {
            seenPairs.add(key);
            results.contrast.failCount++;
            results.contrast.failures.push({
              element: el.tagName.toLowerCase(),
              text: text.slice(0, 50),
              fg: style.color,
              bg: style.backgroundColor || "(inherited)",
              ratio: ratio.toFixed(2),
              threshold,
              large,
            });
          }
        }
      });

      // ── 7. Form Input Labels ─────────────────────────────────
      document
        .querySelectorAll("input, select, textarea")
        .forEach((inp) => {
          results.forms.totalInputs++;
          const id = inp.id;
          const ariaLabel = inp.getAttribute("aria-label") || "";
          const ariaLabelledBy =
            inp.getAttribute("aria-labelledby") || "";
          const placeholder = inp.getAttribute("placeholder") || "";
          const hasForLabel =
            id && document.querySelector(`label[for="${id}"]`);
          const wrappedInLabel = inp.closest("label") !== null;

          if (
            hasForLabel ||
            ariaLabel ||
            ariaLabelledBy ||
            placeholder ||
            wrappedInLabel
          ) {
            results.forms.labeled++;
          } else {
            results.forms.unlabeled.push({
              tag: inp.tagName.toLowerCase(),
              type: inp.type || "",
              name: inp.name || "",
              classes: (inp.className || "").slice(0, 80),
            });
          }
        });

      // ── 8. ARIA Landmarks ────────────────────────────────────
      results.landmarks.main = !!document.querySelector(
        "main, [role='main']"
      );
      results.landmarks.nav = !!document.querySelector(
        "nav, [role='navigation']"
      );
      results.landmarks.banner = !!document.querySelector(
        "header, [role='banner']"
      );
      results.landmarks.complementary = !!document.querySelector(
        "aside, [role='complementary']"
      );
      results.landmarks.contentinfo = !!document.querySelector(
        "footer, [role='contentinfo']"
      );
      results.landmarks.search = !!document.querySelector(
        "[role='search']"
      );
      results.landmarks.count = [
        "main",
        "nav",
        "banner",
        "complementary",
        "contentinfo",
        "search",
      ].filter((k) => results.landmarks[k]).length;

      // ── 9. Heading Hierarchy ─────────────────────────────────
      document
        .querySelectorAll("h1, h2, h3, h4, h5, h6")
        .forEach((h) => {
          results.headings.list.push({
            level: parseInt(h.tagName[1]),
            text: h.textContent?.trim().slice(0, 60),
          });
        });
      results.headings.h1Count = results.headings.list.filter(
        (h) => h.level === 1
      ).length;
      if (results.headings.h1Count === 0)
        results.headings.issues.push("No <h1> element found");
      if (results.headings.h1Count > 1)
        results.headings.issues.push(
          `${results.headings.h1Count} <h1> elements (expected 1)`
        );
      for (let i = 1; i < results.headings.list.length; i++) {
        const prev = results.headings.list[i - 1].level;
        const curr = results.headings.list[i].level;
        if (curr > prev + 1) {
          results.headings.issues.push(
            `Heading level skipped: h${prev} -> h${curr} ("${results.headings.list[i].text}")`
          );
        }
      }

      // ── Buttons without labels ───────────────────────────────
      document
        .querySelectorAll("button, [role='button']")
        .forEach((btn) => {
          const text = btn.textContent?.trim() || "";
          const ariaLabel = btn.getAttribute("aria-label") || "";
          const title = btn.getAttribute("title") || "";
          if (!text && !ariaLabel && !title) {
            results.unlabeledButtons.push({
              tag: btn.tagName.toLowerCase(),
              classes: (btn.className || "").slice(0, 80),
              html: btn.innerHTML?.slice(0, 80) || "",
            });
          }
        });

      // ── Empty links ──────────────────────────────────────────
      document.querySelectorAll("a").forEach((a) => {
        const text = a.textContent?.trim() || "";
        const ariaLabel = a.getAttribute("aria-label") || "";
        if (!text && !ariaLabel) {
          results.emptyLinks.push({
            href: (a.href || "").slice(0, 80),
            html: a.innerHTML?.slice(0, 80) || "",
          });
        }
      });

      // ── Focusable elements ───────────────────────────────────
      const focusable = document.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      results.focusable.total = focusable.length;

      for (let i = 0; i < Math.min(focusable.length, 20); i++) {
        const el = focusable[i];
        el.focus();
        const s = getComputedStyle(el);
        const hasOutline =
          s.outlineWidth !== "0px" && s.outlineStyle !== "none";
        const hasBoxShadow = s.boxShadow !== "none";
        const hasRing = el.matches(":focus-visible");
        if (hasOutline || hasBoxShadow || hasRing) {
          results.focusable.withIndicator++;
        }
      }

      // ── ARIA roles ───────────────────────────────────────────
      results.ariaRoleCount = document.querySelectorAll("[role]").length;

      // ── Images without alt ───────────────────────────────────
      document.querySelectorAll("img").forEach((img) => {
        if (!img.alt && !img.getAttribute("aria-hidden"))
          results.missingAltImages++;
      });

      return results;
    });

    // Screenshot
    const ssPath = path.join(OUT_DIR, `${pg.path.replace(/\//g, "_") || "dashboard"}.png`);
    await page.screenshot({ path: ssPath, fullPage: false });

    allPageResults.push({
      name: pg.name,
      path: pg.path,
      url,
      perf: {
        loadTimeMs,
        domElements,
        fcp,
        totalTransferred,
        totalTransferredHuman: fmtBytes(totalTransferred),
        networkRequests,
        jsFiles: jsResources.length,
        jsSize: totalJsSize,
        jsSizeHuman: fmtBytes(totalJsSize),
        cssFiles: cssResources.length,
        cssSize: totalCssSize,
        cssSizeHuman: fmtBytes(totalCssSize),
        topResources: resourceList
          .sort((a, b) => b.size - a.size)
          .slice(0, 5)
          .map((r) => ({ ...r, sizeHuman: fmtBytes(r.size) })),
      },
      a11y,
    });

    log(
      `  Contrast: ${a11y.contrast.totalChecked} checked, ${a11y.contrast.failCount} unique failures | Muted #8a8a95 instances: ${a11y.contrast.mutedColorInstances}`
    );
    log(
      `  Forms: ${a11y.forms.labeled}/${a11y.forms.totalInputs} labeled | Landmarks: ${a11y.landmarks.count}/6`
    );
    log(
      `  Headings: ${a11y.headings.list.length} total, h1s: ${a11y.headings.h1Count}, issues: ${a11y.headings.issues.length}`
    );
    log(
      `  Buttons unlabeled: ${a11y.unlabeledButtons.length} | Empty links: ${a11y.emptyLinks.length}`
    );
    log(
      `  Focusable: ${a11y.focusable.total} total, ${a11y.focusable.withIndicator}/20 sampled have indicators`
    );

    await page.close();
  }

  await browser.close();

  // ══════════════════════════════════════════════════════════════
  // GENERATE RATINGS
  // ══════════════════════════════════════════════════════════════

  log("\n\n========== GENERATING RATINGS ==========\n");

  // Aggregate stats
  const avgLoad =
    allPageResults.reduce((s, r) => s + r.perf.loadTimeMs, 0) /
    allPageResults.length;
  const avgFcp =
    allPageResults
      .filter((r) => r.perf.fcp !== null)
      .reduce((s, r) => s + r.perf.fcp, 0) /
    Math.max(
      1,
      allPageResults.filter((r) => r.perf.fcp !== null).length
    );
  const avgDOM =
    allPageResults.reduce((s, r) => s + r.perf.domElements, 0) /
    allPageResults.length;
  const avgTransfer =
    allPageResults.reduce((s, r) => s + r.perf.totalTransferred, 0) /
    allPageResults.length;
  const avgRequests =
    allPageResults.reduce((s, r) => s + r.perf.networkRequests, 0) /
    allPageResults.length;
  const maxJS = Math.max(...allPageResults.map((r) => r.perf.jsSize));
  const totalContrastFails = allPageResults.reduce(
    (s, r) => s + r.a11y.contrast.failCount,
    0
  );
  const totalContrastChecked = allPageResults.reduce(
    (s, r) => s + r.a11y.contrast.totalChecked,
    0
  );
  const totalMutedInstances = allPageResults.reduce(
    (s, r) => s + r.a11y.contrast.mutedColorInstances,
    0
  );
  const totalInputs = allPageResults.reduce(
    (s, r) => s + r.a11y.forms.totalInputs,
    0
  );
  const totalLabeled = allPageResults.reduce(
    (s, r) => s + r.a11y.forms.labeled,
    0
  );
  const totalUnlabeledButtons = allPageResults.reduce(
    (s, r) => s + r.a11y.unlabeledButtons.length,
    0
  );
  const totalEmptyLinks = allPageResults.reduce(
    (s, r) => s + r.a11y.emptyLinks.length,
    0
  );
  const avgLandmarks =
    allPageResults.reduce((s, r) => s + r.a11y.landmarks.count, 0) /
    allPageResults.length;
  const pagesWithH1Issues = allPageResults.filter(
    (r) => r.a11y.headings.h1Count !== 1
  ).length;
  const totalHeadingIssues = allPageResults.reduce(
    (s, r) => s + r.a11y.headings.issues.length,
    0
  );
  const avgFocusIndicatorRate =
    allPageResults.reduce(
      (s, r) =>
        s +
        (r.a11y.focusable.total > 0
          ? r.a11y.focusable.withIndicator / Math.min(r.a11y.focusable.total, 20)
          : 0),
      0
    ) / allPageResults.length;

  // ── Rating Functions ─────────────────────────────────────────

  // 1. Page Load Performance (based on avg load + FCP)
  function ratePageLoad() {
    // <1s = 10, 1-2s = 8, 2-3s = 6, 3-5s = 4, >5s = 2
    let score = 10;
    if (avgLoad > 5000) score = 2;
    else if (avgLoad > 3000) score = 4;
    else if (avgLoad > 2000) score = 6;
    else if (avgLoad > 1500) score = 7;
    else if (avgLoad > 1000) score = 8;

    // FCP penalty
    if (avgFcp > 3000) score = Math.max(2, score - 2);
    else if (avgFcp > 2000) score = Math.max(3, score - 1);

    return {
      score: Math.min(10, Math.max(1, score)),
      details: `Avg load: ${Math.round(avgLoad)}ms, Avg FCP: ${Math.round(avgFcp)}ms, Avg requests: ${Math.round(avgRequests)}`,
    };
  }

  // 2. Bundle Efficiency (JS/CSS sizes, request count)
  function rateBundleEfficiency() {
    let score = 10;
    // JS size: <500KB = 10, 500-1MB = 8, 1-2MB = 6, >2MB = 3
    if (maxJS > 2 * 1024 * 1024) score = 3;
    else if (maxJS > 1024 * 1024) score = 6;
    else if (maxJS > 512 * 1024) score = 8;

    // Request count penalty
    if (avgRequests > 80) score = Math.max(2, score - 3);
    else if (avgRequests > 50) score = Math.max(3, score - 2);
    else if (avgRequests > 30) score = Math.max(4, score - 1);

    // Transfer size penalty
    if (avgTransfer > 5 * 1024 * 1024) score = Math.max(2, score - 2);
    else if (avgTransfer > 3 * 1024 * 1024) score = Math.max(3, score - 1);

    return {
      score: Math.min(10, Math.max(1, score)),
      details: `Max JS bundle: ${fmtBytes(maxJS)}, Avg transfer: ${fmtBytes(Math.round(avgTransfer))}, Avg requests: ${Math.round(avgRequests)}`,
    };
  }

  // 3. DOM Complexity
  function rateDOMComplexity() {
    let score = 10;
    // <500 = 10, 500-1000 = 8, 1000-2000 = 6, 2000-3000 = 4, >3000 = 2
    if (avgDOM > 3000) score = 2;
    else if (avgDOM > 2000) score = 4;
    else if (avgDOM > 1500) score = 5;
    else if (avgDOM > 1000) score = 6;
    else if (avgDOM > 700) score = 7;
    else if (avgDOM > 500) score = 8;

    return {
      score: Math.min(10, Math.max(1, score)),
      details: `Avg DOM elements: ${Math.round(avgDOM)}, Range: ${Math.min(...allPageResults.map((r) => r.perf.domElements))}-${Math.max(...allPageResults.map((r) => r.perf.domElements))}`,
    };
  }

  // 4. Color Contrast (WCAG AA)
  function rateColorContrast() {
    let score = 10;
    const failRate =
      totalContrastChecked > 0
        ? totalContrastFails / totalContrastChecked
        : 0;

    // #8a8a95 on #0a0a0f specific check
    const mutedPassesAA = MUTED_RATIO >= 4.5;

    if (failRate > 0.3) score = 2;
    else if (failRate > 0.2) score = 3;
    else if (failRate > 0.15) score = 4;
    else if (failRate > 0.1) score = 5;
    else if (failRate > 0.05) score = 6;
    else if (failRate > 0.02) score = 7;
    else if (failRate > 0.01) score = 8;
    else if (failRate > 0) score = 9;

    // Muted color penalty
    if (!mutedPassesAA && totalMutedInstances > 10) score = Math.max(2, score - 2);
    else if (!mutedPassesAA && totalMutedInstances > 0) score = Math.max(3, score - 1);

    return {
      score: Math.min(10, Math.max(1, score)),
      details: `${totalContrastFails}/${totalContrastChecked} unique failing pairs (${(failRate * 100).toFixed(1)}%), #8a8a95 on #0a0a0f ratio: ${MUTED_RATIO.toFixed(2)}:1 (AA normal requires 4.5:1) ${mutedPassesAA ? "PASS" : "FAIL"}, ${totalMutedInstances} muted-color instances found`,
    };
  }

  // 5. Keyboard Navigation
  function rateKeyboardNav() {
    let score = 10;
    // Focus indicator rate
    if (avgFocusIndicatorRate < 0.3) score = 3;
    else if (avgFocusIndicatorRate < 0.5) score = 5;
    else if (avgFocusIndicatorRate < 0.7) score = 6;
    else if (avgFocusIndicatorRate < 0.8) score = 7;
    else if (avgFocusIndicatorRate < 0.9) score = 8;
    else if (avgFocusIndicatorRate < 1.0) score = 9;

    return {
      score: Math.min(10, Math.max(1, score)),
      details: `Avg focus indicator rate: ${(avgFocusIndicatorRate * 100).toFixed(0)}% of sampled elements have visible focus indicators`,
    };
  }

  // 6. Screen Reader Support
  function rateScreenReaderSupport() {
    let score = 10;

    // Landmark coverage
    if (avgLandmarks < 2) score = Math.max(2, score - 4);
    else if (avgLandmarks < 3) score = Math.max(3, score - 3);
    else if (avgLandmarks < 4) score = Math.max(4, score - 2);

    // ARIA role usage
    const avgRoles =
      allPageResults.reduce((s, r) => s + r.a11y.ariaRoleCount, 0) /
      allPageResults.length;
    if (avgRoles < 3) score = Math.max(3, score - 2);
    else if (avgRoles < 5) score = Math.max(4, score - 1);

    // Heading issues
    if (pagesWithH1Issues > 2) score = Math.max(3, score - 2);
    else if (pagesWithH1Issues > 0) score = Math.max(4, score - 1);
    if (totalHeadingIssues > 4) score = Math.max(3, score - 2);
    else if (totalHeadingIssues > 2) score = Math.max(4, score - 1);

    // Unlabeled buttons
    if (totalUnlabeledButtons > 10) score = Math.max(3, score - 2);
    else if (totalUnlabeledButtons > 5) score = Math.max(4, score - 1);

    // Empty links
    if (totalEmptyLinks > 5) score = Math.max(3, score - 1);

    return {
      score: Math.min(10, Math.max(1, score)),
      details: `Avg landmarks: ${avgLandmarks.toFixed(1)}/6, Avg ARIA roles: ${avgRoles.toFixed(0)}, Unlabeled buttons: ${totalUnlabeledButtons}, Empty links: ${totalEmptyLinks}, H1 issues on ${pagesWithH1Issues} pages, ${totalHeadingIssues} heading hierarchy issues`,
    };
  }

  // 7. Form Accessibility
  function rateFormAccessibility() {
    let score = 10;
    const labelRate = totalInputs > 0 ? totalLabeled / totalInputs : 1;

    if (labelRate < 0.5) score = 2;
    else if (labelRate < 0.6) score = 3;
    else if (labelRate < 0.7) score = 4;
    else if (labelRate < 0.8) score = 5;
    else if (labelRate < 0.85) score = 6;
    else if (labelRate < 0.9) score = 7;
    else if (labelRate < 0.95) score = 8;
    else if (labelRate < 1.0) score = 9;

    return {
      score: Math.min(10, Math.max(1, score)),
      details: `${totalLabeled}/${totalInputs} inputs labeled (${(labelRate * 100).toFixed(0)}%)`,
    };
  }

  // 8. Focus Management
  function rateFocusManagement() {
    let score = 7; // default baseline (hard to fully test programmatically)

    // Check for skip links, focus traps, etc.
    const avgFocusable =
      allPageResults.reduce((s, r) => s + r.a11y.focusable.total, 0) /
      allPageResults.length;

    if (avgFocusIndicatorRate >= 0.8) score = Math.min(10, score + 1);
    if (avgFocusIndicatorRate < 0.5) score = Math.max(3, score - 2);

    // Unlabeled interactive elements are a focus management issue
    if (totalUnlabeledButtons + totalEmptyLinks > 15) score = Math.max(3, score - 2);
    else if (totalUnlabeledButtons + totalEmptyLinks > 5) score = Math.max(4, score - 1);

    return {
      score: Math.min(10, Math.max(1, score)),
      details: `Avg focusable elements: ${Math.round(avgFocusable)}, Focus indicator coverage: ${(avgFocusIndicatorRate * 100).toFixed(0)}%, Unlabeled interactive: ${totalUnlabeledButtons + totalEmptyLinks}`,
    };
  }

  // Compute all ratings
  const ratings = {
    "Page Load Performance": ratePageLoad(),
    "Bundle Efficiency": rateBundleEfficiency(),
    "DOM Complexity": rateDOMComplexity(),
    "Color Contrast (WCAG AA)": rateColorContrast(),
    "Keyboard Navigation": rateKeyboardNav(),
    "Screen Reader Support": rateScreenReaderSupport(),
    "Form Accessibility": rateFormAccessibility(),
    "Focus Management": rateFocusManagement(),
  };

  const overallScore =
    Object.values(ratings).reduce((s, r) => s + r.score, 0) /
    Object.keys(ratings).length;

  // ── Identify Top 5 Shortcomings ──────────────────────────────

  const shortcomings = [];

  // Collect all issues
  if (!MUTED_RATIO >= 4.5 || totalMutedInstances > 0) {
    shortcomings.push({
      severity: MUTED_RATIO < 4.5 ? 10 - ratings["Color Contrast (WCAG AA)"].score + 3 : 1,
      issue: `#8a8a95 on #0a0a0f contrast ratio is ${MUTED_RATIO.toFixed(2)}:1 (needs 4.5:1 for WCAG AA normal text). Found ${totalMutedInstances} instances across pages.`,
    });
  }

  if (totalContrastFails > 0) {
    shortcomings.push({
      severity: totalContrastFails,
      issue: `${totalContrastFails} unique color contrast failures found across ${allPageResults.length} pages (${totalContrastChecked} elements checked).`,
    });
  }

  allPageResults.forEach((r) => {
    if (r.a11y.headings.issues.length > 0) {
      r.a11y.headings.issues.forEach((hi) => {
        shortcomings.push({
          severity: 4,
          issue: `${r.name}: ${hi}`,
        });
      });
    }
  });

  if (totalUnlabeledButtons > 0) {
    shortcomings.push({
      severity: totalUnlabeledButtons + 2,
      issue: `${totalUnlabeledButtons} buttons/interactive elements lack accessible labels (no text, aria-label, or title).`,
    });
  }

  if (totalEmptyLinks > 0) {
    shortcomings.push({
      severity: totalEmptyLinks + 1,
      issue: `${totalEmptyLinks} links have no accessible text or aria-label.`,
    });
  }

  if (totalInputs > totalLabeled) {
    shortcomings.push({
      severity: (totalInputs - totalLabeled) + 3,
      issue: `${totalInputs - totalLabeled} form inputs lack proper labels (no label[for], aria-label, or placeholder).`,
    });
  }

  if (avgLandmarks < 4) {
    shortcomings.push({
      severity: Math.round(6 - avgLandmarks),
      issue: `Incomplete ARIA landmark coverage: avg ${avgLandmarks.toFixed(1)}/6 landmark types present. Missing landmarks reduce screen reader navigation efficiency.`,
    });
  }

  if (avgLoad > 2000) {
    shortcomings.push({
      severity: Math.round(avgLoad / 1000),
      issue: `Page load times average ${Math.round(avgLoad)}ms. Target is under 2000ms for good user experience.`,
    });
  }

  if (avgDOM > 1500) {
    shortcomings.push({
      severity: Math.round(avgDOM / 500),
      issue: `High DOM complexity: avg ${Math.round(avgDOM)} elements. Consider virtualization or lazy rendering for complex views.`,
    });
  }

  if (avgFocusIndicatorRate < 0.8) {
    shortcomings.push({
      severity: Math.round((1 - avgFocusIndicatorRate) * 10),
      issue: `Only ${(avgFocusIndicatorRate * 100).toFixed(0)}% of focusable elements have visible focus indicators. Keyboard users cannot reliably track focus.`,
    });
  }

  shortcomings.sort((a, b) => b.severity - a.severity);
  const top5 = shortcomings.slice(0, 5);

  // ══════════════════════════════════════════════════════════════
  // GENERATE MARKDOWN REPORT
  // ══════════════════════════════════════════════════════════════

  let md = `# AlphaDesk Final Performance & Accessibility Rating\n\n`;
  md += `**Date:** ${new Date().toISOString().split("T")[0]}\n`;
  md += `**URL:** ${BASE_URL}\n`;
  md += `**Pages Audited:** ${allPageResults.map((r) => r.path).join(", ")}\n\n`;
  md += `---\n\n`;

  // ── Per-Page Metrics ─────────────────────────────────────────
  md += `## Per-Page Metrics\n\n`;

  for (const r of allPageResults) {
    md += `### ${r.name} (\`${r.path}\`)\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Page Load Time | ${r.perf.loadTimeMs}ms |\n`;
    md += `| DOM Element Count | ${r.perf.domElements} |\n`;
    md += `| First Contentful Paint (FCP) | ${r.perf.fcp !== null ? r.perf.fcp + "ms" : "N/A"} |\n`;
    md += `| Total Transferred Bytes | ${r.perf.totalTransferredHuman} (${r.perf.totalTransferred} bytes) |\n`;
    md += `| Network Request Count | ${r.perf.networkRequests} |\n`;
    md += `| JS Files / Size | ${r.perf.jsFiles} files / ${r.perf.jsSizeHuman} |\n`;
    md += `| CSS Files / Size | ${r.perf.cssFiles} files / ${r.perf.cssSizeHuman} |\n`;
    md += `\n`;

    // Contrast
    md += `**Color Contrast:** ${r.a11y.contrast.totalChecked} elements checked, ${r.a11y.contrast.failCount} unique failing combinations\n`;
    if (r.a11y.contrast.failures.length > 0) {
      md += `<details><summary>Contrast failures (${r.a11y.contrast.failures.length})</summary>\n\n`;
      md += `| Element | Text | FG | BG | Ratio | Threshold |\n`;
      md += `|---------|------|----|----|-------|-----------|\n`;
      for (const f of r.a11y.contrast.failures.slice(0, 15)) {
        md += `| ${f.element} | ${f.text.replace(/\|/g, "\\|").slice(0, 30)} | ${f.fg} | ${f.bg.slice(0, 25)} | ${f.ratio}:1 | ${f.threshold}:1 |\n`;
      }
      md += `\n</details>\n\n`;
    } else {
      md += `\n`;
    }

    // Form labels
    md += `**Form Labels:** ${r.a11y.forms.labeled}/${r.a11y.forms.totalInputs} inputs labeled`;
    if (r.a11y.forms.unlabeled.length > 0) {
      md += ` -- unlabeled: ${r.a11y.forms.unlabeled.map((u) => `${u.tag}[type=${u.type}]`).join(", ")}`;
    }
    md += `\n\n`;

    // ARIA Landmarks
    md += `**ARIA Landmarks:** `;
    const lm = r.a11y.landmarks;
    md += `main=${lm.main ? "Y" : "N"}, nav=${lm.nav ? "Y" : "N"}, banner=${lm.banner ? "Y" : "N"}, complementary=${lm.complementary ? "Y" : "N"}, contentinfo=${lm.contentinfo ? "Y" : "N"}, search=${lm.search ? "Y" : "N"} (${lm.count}/6)\n\n`;

    // Headings
    md += `**Heading Hierarchy:** `;
    if (r.a11y.headings.list.length === 0) {
      md += `No headings found\n`;
    } else {
      md += `${r.a11y.headings.list.map((h) => `h${h.level}`).join(" > ")}\n`;
      if (r.a11y.headings.issues.length > 0) {
        md += `  - Issues: ${r.a11y.headings.issues.join("; ")}\n`;
      }
    }
    md += `\n`;

    // Other a11y
    md += `**Other:** ${r.a11y.unlabeledButtons.length} unlabeled buttons, ${r.a11y.emptyLinks.length} empty links, ${r.a11y.focusable.total} focusable elements, ${r.a11y.ariaRoleCount} ARIA roles\n\n`;
    md += `---\n\n`;
  }

  // ── Specific #8a8a95 Check ───────────────────────────────────
  md += `## Specific Color Check: #8a8a95 on #0a0a0f\n\n`;
  md += `| Foreground | Background | Ratio | WCAG AA Normal (4.5:1) | WCAG AA Large (3:1) |\n`;
  md += `|------------|------------|-------|------------------------|---------------------|\n`;
  md += `| #8a8a95 | #0a0a0f | ${MUTED_RATIO.toFixed(2)}:1 | ${MUTED_RATIO >= 4.5 ? "PASS" : "FAIL"} | ${MUTED_RATIO >= 3.0 ? "PASS" : "FAIL"} |\n`;
  md += `\nInstances of this muted color found across all pages: **${totalMutedInstances}**\n\n`;
  md += `---\n\n`;

  // ── Ratings ──────────────────────────────────────────────────
  md += `## Ratings (1-10)\n\n`;
  md += `| # | Category | Score | Details |\n`;
  md += `|---|----------|-------|---------|\n`;

  let i = 1;
  for (const [name, rating] of Object.entries(ratings)) {
    const bar = "█".repeat(rating.score) + "░".repeat(10 - rating.score);
    md += `| ${i} | **${name}** | **${rating.score}/10** ${bar} | ${rating.details} |\n`;
    i++;
  }

  md += `\n`;
  md += `### OVERALL SCORE: **${overallScore.toFixed(1)} / 10**\n\n`;

  // Visual bar
  const fullBlocks = Math.floor(overallScore);
  const overallBar =
    "█".repeat(fullBlocks) + "░".repeat(10 - fullBlocks);
  md += `\`${overallBar}\` ${overallScore.toFixed(1)}/10\n\n`;

  md += `---\n\n`;

  // ── Top 5 Shortcomings ───────────────────────────────────────
  md += `## Top 5 Shortcomings\n\n`;
  top5.forEach((s, idx) => {
    md += `${idx + 1}. **${s.issue}**\n`;
  });

  md += `\n---\n\n`;

  // ── Raw Data Summary ─────────────────────────────────────────
  md += `## Aggregate Statistics\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Avg Page Load | ${Math.round(avgLoad)}ms |\n`;
  md += `| Avg FCP | ${Math.round(avgFcp)}ms |\n`;
  md += `| Avg DOM Elements | ${Math.round(avgDOM)} |\n`;
  md += `| Avg Transfer Size | ${fmtBytes(Math.round(avgTransfer))} |\n`;
  md += `| Avg Network Requests | ${Math.round(avgRequests)} |\n`;
  md += `| Total Contrast Failures | ${totalContrastFails} / ${totalContrastChecked} |\n`;
  md += `| Total Unlabeled Inputs | ${totalInputs - totalLabeled} / ${totalInputs} |\n`;
  md += `| Total Unlabeled Buttons | ${totalUnlabeledButtons} |\n`;
  md += `| Total Empty Links | ${totalEmptyLinks} |\n`;
  md += `| Avg Landmarks Present | ${avgLandmarks.toFixed(1)} / 6 |\n`;
  md += `| Pages with H1 Issues | ${pagesWithH1Issues} / ${allPageResults.length} |\n`;
  md += `| Focus Indicator Rate | ${(avgFocusIndicatorRate * 100).toFixed(0)}% |\n`;
  md += `\n`;

  md += `*Generated by qa-final-perf-rating.mjs on ${new Date().toISOString()}*\n`;

  // ── Save ─────────────────────────────────────────────────────
  const mdPath = path.join(OUT_DIR, "perf-a11y-rating.md");
  fs.writeFileSync(mdPath, md, "utf-8");
  log(`\nReport saved to: ${mdPath}`);

  // Also save raw JSON
  const jsonPath = path.join(OUT_DIR, "perf-a11y-raw.json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      { pages: allPageResults, ratings, overallScore, top5Shortcomings: top5 },
      null,
      2
    ),
    "utf-8"
  );
  log(`Raw data saved to: ${jsonPath}`);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("  ALPHADESK FINAL PERFORMANCE & ACCESSIBILITY RATING");
  console.log("=".repeat(60));
  for (const [name, rating] of Object.entries(ratings)) {
    const bar = "█".repeat(rating.score) + "░".repeat(10 - rating.score);
    console.log(`  ${bar} ${rating.score}/10  ${name}`);
  }
  console.log("-".repeat(60));
  console.log(
    `  OVERALL: ${overallScore.toFixed(1)} / 10`
  );
  console.log("=".repeat(60));
  console.log("\nTop 5 Shortcomings:");
  top5.forEach((s, idx) => {
    console.log(`  ${idx + 1}. ${s.issue}`);
  });
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
