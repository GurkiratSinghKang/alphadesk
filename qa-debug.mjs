import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";

const BASE = "http://localhost:3000";
const SCREENSHOT_DIR = "./qa-screenshots";

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  });

  // Capture ALL console output
  const allLogs = [];

  // Test login page first (no auth needed)
  const page = await context.newPage();
  page.on("console", (msg) => allLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => allLogs.push(`[PAGE_ERROR] ${err.message}`));
  page.on("requestfailed", (req) => allLogs.push(`[NET_FAIL] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`));

  console.log("Navigating to login page...");
  const response = await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 15000 });
  console.log("Response status:", response?.status());

  await page.waitForTimeout(3000);

  // Check what's in the DOM
  const htmlContent = await page.content();
  writeFileSync(`${SCREENSHOT_DIR}/login-dom.html`, htmlContent);
  console.log("HTML length:", htmlContent.length);

  // Check computed styles on body
  const bodyStyles = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const cs = window.getComputedStyle(body);
    const hcs = window.getComputedStyle(html);
    return {
      bodyBg: cs.backgroundColor,
      bodyColor: cs.color,
      bodyDisplay: cs.display,
      bodyOverflow: cs.overflow,
      bodyHeight: cs.height,
      htmlBg: hcs.backgroundColor,
      htmlColor: hcs.color,
      htmlClasses: html.className,
      bodyClasses: body.className,
      childCount: body.children.length,
      innerTextLength: body.innerText.length,
      innerText: body.innerText.slice(0, 500),
      allElements: document.querySelectorAll("*").length,
      stylesheets: document.styleSheets.length,
      loadedCSS: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.href),
      styleElements: document.querySelectorAll("style").length,
    };
  });
  console.log("Body styles:", JSON.stringify(bodyStyles, null, 2));

  // Check if any CSS variables are defined
  const cssVars = await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    return {
      "--background": cs.getPropertyValue("--background"),
      "--foreground": cs.getPropertyValue("--foreground"),
      "--primary": cs.getPropertyValue("--primary"),
      "--card": cs.getPropertyValue("--card"),
      "--muted": cs.getPropertyValue("--muted"),
      "--muted-foreground": cs.getPropertyValue("--muted-foreground"),
    };
  });
  console.log("CSS Variables:", JSON.stringify(cssVars, null, 2));

  // Force a visible background for screenshot
  await page.evaluate(() => {
    document.documentElement.style.backgroundColor = "#0a0a0f";
    document.body.style.backgroundColor = "#0a0a0f";
  });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/05-login-forced-bg.png`, fullPage: true });

  // Screenshot without forcing - but with emulateMedia
  const page2 = await context.newPage();
  page2.on("console", (msg) => allLogs.push(`[p2-${msg.type()}] ${msg.text()}`));
  await page2.emulateMedia({ colorScheme: "dark" });

  // Set auth cookie
  await context.addCookies([{
    name: "access_token",
    value: "bypass",
    domain: "localhost",
    path: "/",
  }]);

  await page2.goto(BASE, { waitUntil: "load", timeout: 30000 });
  await page2.waitForTimeout(5000);

  const dashInfo = await page2.evaluate(() => {
    return {
      title: document.title,
      bodyText: document.body.innerText.slice(0, 1000),
      elementCount: document.querySelectorAll("*").length,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyDisplay: getComputedStyle(document.body).display,
      firstChildTag: document.body.children[0]?.tagName,
      firstChildId: document.body.children[0]?.id,
      firstChildClasses: document.body.children[0]?.className,
      divCount: document.querySelectorAll("div").length,
      buttonCount: document.querySelectorAll("button").length,
      inputCount: document.querySelectorAll("input").length,
      svgCount: document.querySelectorAll("svg").length,
    };
  });
  console.log("\nDashboard info:", JSON.stringify(dashInfo, null, 2));

  await page2.evaluate(() => {
    // Force visibility
    document.documentElement.style.backgroundColor = "#0a0a0f";
    document.body.style.backgroundColor = "#0a0a0f";
    document.body.style.overflow = "visible";
    document.body.style.height = "auto";
  });
  await page2.screenshot({ path: `${SCREENSHOT_DIR}/06-dashboard-forced-bg.png`, fullPage: true });

  // Also try non-fullPage screenshot (viewport only)
  await page2.screenshot({ path: `${SCREENSHOT_DIR}/07-dashboard-viewport.png`, fullPage: false });

  // Console log summary
  writeFileSync(`${SCREENSHOT_DIR}/console-logs.txt`, allLogs.join("\n"));
  console.log(`\nConsole logs (${allLogs.length} total):`);
  allLogs.forEach(l => console.log("  ", l));

  await browser.close();
}

main().catch(console.error);
