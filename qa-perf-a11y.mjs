/**
 * AlphaDesk Performance & Accessibility Audit Script
 *
 * Measures per-page: load time, DOM element count, TTI proxy, resource sizes,
 * total transferred bytes, layout shifts (CLS), and network request count.
 *
 * Usage:
 *   node qa-perf-a11y.mjs
 *
 * Prerequisites:
 *   npm install playwright   (already in root package.json)
 *   npx playwright install chromium
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

const OUT_DIR = path.resolve("qa-screenshots/expert-ux");
const REPORT_PATH = path.join(OUT_DIR, "perf-a11y-raw.json");

fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Helpers ────────────────────────────────────────────────────

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // ── Login ──────────────────────────────────────────────────
  console.log("[1/5] Logging in...");
  try {
    await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[placeholder="admin"]', CREDS.username);
    await page.fill('input[type="password"]', CREDS.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/", { timeout: 15000 });
    console.log("  Logged in successfully.");
  } catch (err) {
    console.error("  Login failed:", err.message);
    await browser.close();
    process.exit(1);
  }

  const results = [];

  // ── Audit each page ────────────────────────────────────────
  for (const pg of PAGES) {
    console.log(`\n[Auditing] ${pg.name}...`);
    const url = `${BASE_URL}${pg.path}`;
    const pageResult = {
      name: pg.name,
      url,
      loadTimeMs: 0,
      domElements: 0,
      ttiProxyMs: 0,
      totalTransferredBytes: 0,
      networkRequests: 0,
      clsScore: 0,
      resources: [],
      a11y: {},
    };

    // Track network requests + sizes
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

      // Track JS/CSS specifically
      const ct = (response.headers()["content-type"] || "").toLowerCase();
      if (
        reqUrl.endsWith(".js") ||
        reqUrl.endsWith(".css") ||
        ct.includes("javascript") ||
        ct.includes("css")
      ) {
        const type = ct.includes("css") || reqUrl.endsWith(".css") ? "CSS" : "JS";
        const shortUrl = reqUrl.replace(BASE_URL, "").split("?")[0];
        resourceList.push({ type, url: shortUrl, size });
      }
    });

    // Layout shift tracking via PerformanceObserver injection
    const clsPromise = page.evaluate(() => {
      return new Promise((resolve) => {
        let cls = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              cls += entry.value;
            }
          }
        });
        try {
          observer.observe({ type: "layout-shift", buffered: true });
        } catch {}
        // Resolve after 5s or when page settles
        setTimeout(() => {
          observer.disconnect();
          resolve(cls);
        }, 5000);
      });
    }).catch(() => 0);

    // Navigate and measure load time
    const navStart = Date.now();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } catch (err) {
      console.warn(`  Navigation timeout for ${pg.name}: ${err.message}`);
    }
    const navEnd = Date.now();
    pageResult.loadTimeMs = navEnd - navStart;

    // Wait a bit for dynamic content
    await page.waitForTimeout(3000);

    // DOM element count
    pageResult.domElements = await page.evaluate(() => document.querySelectorAll("*").length);

    // TTI proxy: time until main thread is idle (via performance timeline)
    pageResult.ttiProxyMs = await page
      .evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        if (nav && nav.domInteractive) {
          return Math.round(nav.domInteractive);
        }
        return 0;
      })
      .catch(() => 0);

    // Collect CLS
    const clsResult = await clsPromise;
    pageResult.clsScore = typeof clsResult === "number" ? clsResult : 0;

    // Summarize network
    pageResult.networkRequests = requestLog.length;
    pageResult.totalTransferredBytes = requestLog.reduce((s, r) => s + r.size, 0);

    // Top resources by size
    resourceList.sort((a, b) => b.size - a.size);
    pageResult.resources = resourceList.slice(0, 15).map((r) => ({
      ...r,
      sizeHuman: fmtBytes(r.size),
    }));

    // ── Accessibility checks ────────────────────────────────
    const a11y = await page.evaluate(() => {
      const issues = [];

      // 1. Images without alt text
      const imgs = document.querySelectorAll("img");
      let missingAlt = 0;
      imgs.forEach((img) => {
        if (!img.alt && !img.getAttribute("aria-hidden")) missingAlt++;
      });
      if (missingAlt > 0) issues.push(`${missingAlt} image(s) missing alt text`);

      // 2. Interactive elements without accessible names
      const buttons = document.querySelectorAll("button, [role='button']");
      let unlabeledButtons = 0;
      buttons.forEach((btn) => {
        const text = btn.textContent?.trim() || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const title = btn.getAttribute("title") || "";
        if (!text && !ariaLabel && !title) unlabeledButtons++;
      });
      if (unlabeledButtons > 0) issues.push(`${unlabeledButtons} button(s) without accessible name`);

      // 3. Links without text
      const links = document.querySelectorAll("a");
      let emptyLinks = 0;
      links.forEach((a) => {
        const text = a.textContent?.trim() || "";
        const ariaLabel = a.getAttribute("aria-label") || "";
        if (!text && !ariaLabel) emptyLinks++;
      });
      if (emptyLinks > 0) issues.push(`${emptyLinks} link(s) without accessible text`);

      // 4. Form inputs without labels
      const inputs = document.querySelectorAll("input, select, textarea");
      let unlabeledInputs = 0;
      inputs.forEach((inp) => {
        const id = inp.id;
        const ariaLabel = inp.getAttribute("aria-label") || "";
        const ariaLabelledBy = inp.getAttribute("aria-labelledby") || "";
        const placeholder = inp.getAttribute("placeholder") || "";
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        if (!hasLabel && !ariaLabel && !ariaLabelledBy && !placeholder) unlabeledInputs++;
      });
      if (unlabeledInputs > 0) issues.push(`${unlabeledInputs} input(s) without label/aria-label`);

      // 5. Heading structure
      const headings = [];
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
        headings.push({ level: parseInt(h.tagName[1]), text: h.textContent?.trim().slice(0, 50) });
      });
      let headingIssues = [];
      const h1Count = headings.filter((h) => h.level === 1).length;
      if (h1Count === 0) headingIssues.push("No <h1> found");
      if (h1Count > 1) headingIssues.push(`${h1Count} <h1> elements (should be 1)`);
      for (let i = 1; i < headings.length; i++) {
        if (headings[i].level > headings[i - 1].level + 1) {
          headingIssues.push(`Heading skip: h${headings[i - 1].level} -> h${headings[i].level}`);
          break;
        }
      }

      // 6. Focus indicators (check computed outline on focusable elements)
      const focusable = document.querySelectorAll("button, a, input, select, textarea, [tabindex]");
      let noFocusIndicator = 0;
      // (Can't fully check :focus styles without actually focusing -- just count focusable elements)
      const focusableCount = focusable.length;

      // 7. ARIA roles
      const ariaRoles = document.querySelectorAll("[role]").length;

      // 8. Color contrast note -- #555 on #0a0a0f
      // #555555 on #0a0a0f: luminance ratio calculation
      function relativeLuminance(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const srgb = [r, g, b].map((c) =>
          c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
        );
        return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
      }
      const l1 = relativeLuminance("#555555");
      const l2 = relativeLuminance("#0a0a0f");
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

      return {
        issues,
        headings,
        headingIssues,
        focusableCount,
        ariaRoles,
        contrastRatio555: ratio.toFixed(2),
        totalElements: document.querySelectorAll("*").length,
      };
    });

    pageResult.a11y = a11y;

    // Take screenshot
    const screenshotName = pg.path.replace(/\//g, "_").replace(/^_/, "") || "dashboard";
    await page.screenshot({
      path: path.join(OUT_DIR, `perf-${screenshotName}.png`),
      fullPage: true,
    });

    results.push(pageResult);

    // Clear listeners for next page
    page.removeAllListeners("response");

    console.log(`  Load: ${pageResult.loadTimeMs}ms | DOM: ${pageResult.domElements} | Requests: ${pageResult.networkRequests} | Transfer: ${fmtBytes(pageResult.totalTransferredBytes)} | CLS: ${pageResult.clsScore.toFixed(4)}`);
  }

  // ── Save raw results ──────────────────────────────────────
  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2));
  console.log(`\nRaw results saved to ${REPORT_PATH}`);

  await browser.close();

  // ── Print summary ─────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════");
  console.log("  ALPHADESK PERFORMANCE AUDIT SUMMARY");
  console.log("═══════════════════════════════════════════════\n");

  for (const r of results) {
    console.log(`── ${r.name} ──`);
    console.log(`  Load Time:       ${r.loadTimeMs}ms`);
    console.log(`  DOM Elements:    ${r.domElements}`);
    console.log(`  TTI (proxy):     ${r.ttiProxyMs}ms`);
    console.log(`  Network Reqs:    ${r.networkRequests}`);
    console.log(`  Transferred:     ${fmtBytes(r.totalTransferredBytes)}`);
    console.log(`  CLS Score:       ${r.clsScore.toFixed(4)}`);
    console.log(`  A11y Issues:     ${r.a11y.issues?.length ?? 0}`);
    if (r.a11y.issues?.length) {
      r.a11y.issues.forEach((i) => console.log(`    - ${i}`));
    }
    if (r.a11y.headingIssues?.length) {
      r.a11y.headingIssues.forEach((i) => console.log(`    - ${i}`));
    }
    console.log(`  Contrast #555:   ${r.a11y.contrastRatio555}:1 (WCAG AA requires 4.5:1)`);
    if (r.resources.length > 0) {
      console.log(`  Top Resources:`);
      r.resources.slice(0, 5).forEach((res) => {
        console.log(`    [${res.type}] ${res.sizeHuman} - ${res.url.slice(0, 80)}`);
      });
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
