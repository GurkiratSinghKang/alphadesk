import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'https://tradingalpha.net';
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/eval-round3/perf';
const CREDS = { user: 'admin', pass: 'alphaDesk2025!' };

const PAGES_TO_TEST = [
  { name: 'home', path: '/' },
  { name: 'trade', path: '/trade' },
  { name: 'pipeline', path: '/pipeline' },
  { name: 'strategies-pead', path: '/strategies/pead' },
];

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'login-debug.png'), fullPage: true });
  // Use the actual IDs from the login form
  await page.fill('#login-username', CREDS.user);
  await page.fill('#login-password', CREDS.pass);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
}

async function measurePageLoad(context, pagePath, pageName) {
  const page = await context.newPage();
  const apiCalls = [];
  const resourceSizes = [];

  // Intercept network requests
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/') || url.includes('/v1/') || url.includes('tradingalpha.net/api')) {
      apiCalls.push({ url, method: req.method() });
    }
  });

  page.on('response', async (resp) => {
    const url = resp.url();
    try {
      const headers = resp.headers();
      const size = parseInt(headers['content-length'] || '0', 10);
      const contentType = headers['content-type'] || '';
      if (url.endsWith('.js') || url.endsWith('.css') || contentType.includes('javascript') || contentType.includes('css')) {
        resourceSizes.push({ url: url.split('/').pop()?.substring(0, 60), size, contentType });
      }
    } catch (e) {}
  });

  const startTime = Date.now();
  await page.goto(`${BASE}${pagePath}`, { waitUntil: 'networkidle', timeout: 30000 });
  const loadTime = Date.now() - startTime;

  // Wait for any lazy-loaded content
  await page.waitForTimeout(3000);

  // Take screenshot
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `page-load-${pageName}.png`),
    fullPage: true,
  });

  // Count DOM nodes
  const domNodeCount = await page.evaluate(() => document.querySelectorAll('*').length);

  // Check for duplicate API calls
  const urlCounts = {};
  apiCalls.forEach(c => {
    const key = `${c.method} ${c.url}`;
    urlCounts[key] = (urlCounts[key] || 0) + 1;
  });
  const duplicates = Object.entries(urlCounts).filter(([, v]) => v > 1);

  await page.close();

  return {
    pageName,
    pagePath,
    loadTime,
    apiCallCount: apiCalls.length,
    apiCalls: apiCalls.map(c => `${c.method} ${c.url.substring(0, 100)}`),
    duplicateApiCalls: duplicates,
    domNodeCount,
    resourceSizes: resourceSizes.sort((a, b) => b.size - a.size).slice(0, 10),
  };
}

async function testAccessibility(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 1. Color contrast check - sample text elements
  const contrastIssues = await page.evaluate(() => {
    const issues = [];
    const textElements = document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, a, button, label, td, th, li, div');
    const checked = new Set();

    for (const el of Array.from(textElements).slice(0, 200)) {
      const style = window.getComputedStyle(el);
      const color = style.color;
      const bg = style.backgroundColor;
      const fontSize = parseFloat(style.fontSize);
      const text = el.textContent?.trim()?.substring(0, 30);

      if (!text || checked.has(text)) continue;
      checked.add(text);

      // Parse rgb values
      const parseColor = (c) => {
        const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
      };

      const fg = parseColor(color);
      const bgc = parseColor(bg);
      if (!fg || !bgc) continue;

      // Skip transparent backgrounds
      if (bg === 'rgba(0, 0, 0, 0)') continue;

      // Relative luminance
      const luminance = (c) => {
        const srgb = [c.r, c.g, c.b].map(v => {
          v = v / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
      };

      const l1 = luminance(fg);
      const l2 = luminance(bgc);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

      const isLargeText = fontSize >= 18 || (fontSize >= 14 && style.fontWeight >= 700);
      const threshold = isLargeText ? 3.0 : 4.5;

      if (ratio < threshold) {
        issues.push({
          text: text.substring(0, 30),
          color,
          bg,
          ratio: ratio.toFixed(2),
          threshold,
          fontSize: fontSize.toFixed(1),
        });
      }
    }
    return issues;
  });

  // 2. Keyboard navigation - count tabbable elements
  const keyboardData = await page.evaluate(() => {
    const tabbable = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const interactive = document.querySelectorAll(
      'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick]'
    );

    // Check which interactive elements are NOT tabbable
    const notTabbable = [];
    interactive.forEach(el => {
      const tag = el.tagName.toLowerCase();
      const tabIndex = el.getAttribute('tabindex');
      if (tabIndex === '-1' || (el.closest('[aria-hidden="true"]'))) {
        notTabbable.push({
          tag,
          text: el.textContent?.trim()?.substring(0, 30),
          role: el.getAttribute('role'),
        });
      }
    });

    return {
      tabbableCount: tabbable.length,
      interactiveCount: interactive.length,
      notTabbable,
    };
  });

  // 3. Screen reader support - buttons/links without labels
  const srIssues = await page.evaluate(() => {
    const issues = [];
    const elements = document.querySelectorAll('button, a[href], [role="button"], input, select, textarea');

    elements.forEach(el => {
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim();
      const ariaLabel = el.getAttribute('aria-label');
      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      const title = el.getAttribute('title');
      const alt = el.querySelector('img')?.getAttribute('alt');
      const placeholder = el.getAttribute('placeholder');
      const id = el.getAttribute('id');

      // For inputs, check for associated label
      let hasLabel = false;
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        if (id) {
          hasLabel = !!document.querySelector(`label[for="${id}"]`);
        }
        hasLabel = hasLabel || !!el.closest('label');
      }

      const hasAccessibleName = !!(text || ariaLabel || ariaLabelledBy || title || alt || placeholder || hasLabel);

      if (!hasAccessibleName) {
        issues.push({
          tag,
          role: el.getAttribute('role'),
          classes: el.className?.toString()?.substring(0, 50),
          html: el.outerHTML?.substring(0, 100),
        });
      }
    });

    return issues;
  });

  // 4. Form accessibility
  const formIssues = await page.evaluate(() => {
    const issues = [];
    const inputs = document.querySelectorAll('input, select, textarea');

    inputs.forEach(el => {
      const id = el.getAttribute('id');
      const name = el.getAttribute('name');
      const ariaLabel = el.getAttribute('aria-label');
      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      const placeholder = el.getAttribute('placeholder');
      const type = el.getAttribute('type');

      let hasLabel = false;
      if (id) {
        hasLabel = !!document.querySelector(`label[for="${id}"]`);
      }
      hasLabel = hasLabel || !!el.closest('label');

      const hasAccessibleLabel = hasLabel || !!ariaLabel || !!ariaLabelledBy;

      issues.push({
        tag: el.tagName.toLowerCase(),
        type,
        name,
        hasLabel,
        hasAriaLabel: !!ariaLabel,
        hasAriaLabelledBy: !!ariaLabelledBy,
        hasPlaceholder: !!placeholder,
        accessible: hasAccessibleLabel,
      });
    });

    return issues;
  });

  // 5. Focus visibility
  const focusData = await page.evaluate(() => {
    const results = [];
    const focusable = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    // Check if any custom focus styles exist in stylesheets
    let hasCustomFocusStyles = false;
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText?.includes(':focus') || rule.selectorText?.includes(':focus-visible')) {
            hasCustomFocusStyles = true;
            break;
          }
        }
      } catch (e) {}
    }

    return {
      focusableCount: focusable.length,
      hasCustomFocusStyles,
    };
  });

  // Actually test tab focus ring visibility
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'focus-visibility-1.png'),
    fullPage: false,
  });

  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
  }
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'focus-visibility-2.png'),
    fullPage: false,
  });

  // 6. Heading hierarchy
  const headingData = await page.evaluate(() => {
    const headings = [];
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      headings.push({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim()?.substring(0, 50),
      });
    });

    // Check for hierarchy issues
    const issues = [];
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level > headings[i - 1].level + 1) {
        issues.push({
          from: `h${headings[i - 1].level}`,
          to: `h${headings[i].level}`,
          text: headings[i].text,
        });
      }
    }

    const h1Count = headings.filter(h => h.level === 1).length;

    return { headings, issues, h1Count };
  });

  await page.close();

  return {
    contrastIssues,
    keyboardData,
    srIssues,
    formIssues,
    focusData,
    headingData,
  };
}

async function checkBundles(context) {
  const page = await context.newPage();
  const jsResources = [];
  const cssResources = [];

  page.on('response', async (resp) => {
    const url = resp.url();
    const headers = resp.headers();
    const contentType = headers['content-type'] || '';

    if (contentType.includes('javascript') || url.match(/\.js(\?|$)/)) {
      let size = 0;
      try {
        const body = await resp.body();
        size = body.length;
      } catch (e) {
        size = parseInt(headers['content-length'] || '0', 10);
      }
      jsResources.push({
        url: url.split('/').pop()?.substring(0, 80),
        fullUrl: url.substring(0, 120),
        size,
        sizeKB: (size / 1024).toFixed(1),
      });
    }

    if (contentType.includes('css') || url.match(/\.css(\?|$)/)) {
      let size = 0;
      try {
        const body = await resp.body();
        size = body.length;
      } catch (e) {
        size = parseInt(headers['content-length'] || '0', 10);
      }
      cssResources.push({
        url: url.split('/').pop()?.substring(0, 80),
        size,
        sizeKB: (size / 1024).toFixed(1),
      });
    }
  });

  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.close();

  return {
    jsResources: jsResources.sort((a, b) => b.size - a.size),
    cssResources: cssResources.sort((a, b) => b.size - a.size),
    totalJS_KB: (jsResources.reduce((s, r) => s + r.size, 0) / 1024).toFixed(1),
    totalCSS_KB: (cssResources.reduce((s, r) => s + r.size, 0) / 1024).toFixed(1),
    jsCount: jsResources.length,
    cssCount: cssResources.length,
  };
}

async function testLoginPage(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Check login form accessibility
  const loginFormA11y = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    const results = [];
    inputs.forEach(el => {
      results.push({
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        id: el.getAttribute('id'),
        ariaLabel: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('placeholder'),
        hasLabel: !!el.closest('label') || (el.id && !!document.querySelector(`label[for="${el.id}"]`)),
      });
    });
    return results;
  });

  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'login-page.png'),
    fullPage: true,
  });

  await page.close();
  return loginFormA11y;
}

// Also check all pages for heading hierarchy
async function checkHeadingsAllPages(context) {
  const results = {};
  for (const pg of PAGES_TO_TEST) {
    const page = await context.newPage();
    await page.goto(`${BASE}${pg.path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const headings = await page.evaluate(() => {
      const h = [];
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
        h.push({ level: parseInt(el.tagName[1]), text: el.textContent?.trim()?.substring(0, 50) });
      });
      return h;
    });

    results[pg.name] = headings;
    await page.close();
  }
  return results;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  console.log('=== Logging in ===');
  const loginPage = await context.newPage();
  await login(loginPage);
  console.log('Logged in, current URL:', loginPage.url());
  await loginPage.close();

  // Save cookies for reuse
  const cookies = await context.cookies();

  console.log('\n=== Testing login form accessibility ===');
  const loginContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const loginFormA11y = await testLoginPage(loginContext);
  console.log('Login form inputs:', JSON.stringify(loginFormA11y, null, 2));
  await loginContext.close();

  console.log('\n=== Page Load Performance ===');
  const perfResults = [];
  for (const pg of PAGES_TO_TEST) {
    console.log(`Testing ${pg.name} (${pg.path})...`);
    try {
      const result = await measurePageLoad(context, pg.path, pg.name);
      perfResults.push(result);
      console.log(`  Load time: ${result.loadTime}ms | API calls: ${result.apiCallCount} | DOM nodes: ${result.domNodeCount}`);
      if (result.duplicateApiCalls.length > 0) {
        console.log(`  DUPLICATE API CALLS:`, result.duplicateApiCalls);
      }
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      perfResults.push({ pageName: pg.name, pagePath: pg.path, error: e.message });
    }
  }

  console.log('\n=== Bundle Analysis ===');
  const bundleData = await checkBundles(context);
  console.log(`Total JS: ${bundleData.totalJS_KB} KB (${bundleData.jsCount} files)`);
  console.log(`Total CSS: ${bundleData.totalCSS_KB} KB (${bundleData.cssCount} files)`);
  console.log('Largest JS bundles:');
  bundleData.jsResources.slice(0, 8).forEach(r => {
    console.log(`  ${r.sizeKB} KB - ${r.url}`);
  });

  console.log('\n=== Accessibility Testing ===');
  const a11yResults = await testAccessibility(context);

  console.log(`\nColor Contrast Issues: ${a11yResults.contrastIssues.length}`);
  a11yResults.contrastIssues.slice(0, 10).forEach(i => {
    console.log(`  "${i.text}" - ratio ${i.ratio} (need ${i.threshold}) | fg: ${i.color} bg: ${i.bg}`);
  });

  console.log(`\nKeyboard Navigation:`);
  console.log(`  Tabbable elements: ${a11yResults.keyboardData.tabbableCount}`);
  console.log(`  Interactive elements: ${a11yResults.keyboardData.interactiveCount}`);
  console.log(`  Not tabbable: ${a11yResults.keyboardData.notTabbable.length}`);
  a11yResults.keyboardData.notTabbable.slice(0, 5).forEach(el => {
    console.log(`    ${el.tag} [${el.role}]: "${el.text}"`);
  });

  console.log(`\nScreen Reader Issues (no accessible name): ${a11yResults.srIssues.length}`);
  a11yResults.srIssues.slice(0, 10).forEach(i => {
    console.log(`  <${i.tag}> ${i.classes?.substring(0, 40)}`);
    console.log(`    HTML: ${i.html}`);
  });

  console.log(`\nForm Accessibility:`);
  const inaccessibleForms = a11yResults.formIssues.filter(f => !f.accessible);
  console.log(`  Total inputs: ${a11yResults.formIssues.length}`);
  console.log(`  Without accessible label: ${inaccessibleForms.length}`);
  inaccessibleForms.forEach(f => {
    console.log(`    <${f.tag} type="${f.type}" name="${f.name}"> hasPlaceholder: ${f.hasPlaceholder}`);
  });

  console.log(`\nFocus Management:`);
  console.log(`  Focusable elements: ${a11yResults.focusData.focusableCount}`);
  console.log(`  Custom focus styles: ${a11yResults.focusData.hasCustomFocusStyles}`);

  console.log(`\nHeading Hierarchy on /trade:`);
  console.log(`  H1 count: ${a11yResults.headingData.h1Count}`);
  a11yResults.headingData.headings.forEach(h => {
    console.log(`  ${'  '.repeat(h.level - 1)}h${h.level}: ${h.text}`);
  });
  if (a11yResults.headingData.issues.length > 0) {
    console.log(`  Hierarchy issues: ${a11yResults.headingData.issues.length}`);
    a11yResults.headingData.issues.forEach(i => {
      console.log(`    Skipped from ${i.from} to ${i.to}: "${i.text}"`);
    });
  }

  console.log('\n=== Headings on all pages ===');
  const allHeadings = await checkHeadingsAllPages(context);
  for (const [pageName, headings] of Object.entries(allHeadings)) {
    console.log(`\n${pageName}:`);
    headings.forEach(h => {
      console.log(`  ${'  '.repeat(h.level - 1)}h${h.level}: ${h.text}`);
    });
  }

  // Write full results to JSON
  const fullResults = { perfResults, bundleData, a11yResults, loginFormA11y, allHeadings };
  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'full-results.json'),
    JSON.stringify(fullResults, null, 2)
  );
  console.log('\n=== Full results saved to full-results.json ===');

  await browser.close();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
