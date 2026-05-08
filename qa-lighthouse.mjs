// qa-lighthouse.mjs -- Comprehensive Lighthouse-style audit using Playwright
// Audits: Performance, Best Practices, SEO, Accessibility
// Pages: /, /trade, /pipeline, /strategies/pead

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE_URL = 'https://tradingalpha.net';
const LOGIN_USER = QA_USERNAME;
const LOGIN_PASS = getQaPassword();
const PAGES = ['/', '/trade', '/pipeline', '/strategies/pead'];
const OUTPUT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/lighthouse';

mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Color contrast helpers ────────────────────────────────────────────────
function parseRGB(str) {
  if (!str) return null;
  const m = str.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

function sRGBtoLinear(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function isLargeText(fontSize, fontWeight) {
  const size = parseFloat(fontSize);
  const bold = parseInt(fontWeight) >= 700 || fontWeight === 'bold';
  return size >= 24 || (size >= 18.66 && bold);
}

// ─── Audit functions ───────────────────────────────────────────────────────

async function auditPerformance(page, url) {
  const results = { score: 100, issues: [], metrics: {} };

  // Collect network requests
  const requests = [];
  const resourceSizes = { js: [], css: [], other: [] };
  let totalTransferred = 0;

  page.on('requestfinished', async (req) => {
    requests.push(req.url());
    try {
      const resp = req.response ? await req.response() : null;
      if (resp) {
        const headers = await resp.allHeaders();
        const size = parseInt(headers['content-length'] || '0');
        totalTransferred += size;
        const urlStr = req.url();
        if (urlStr.endsWith('.js') || urlStr.includes('.js?') || (headers['content-type'] || '').includes('javascript')) {
          resourceSizes.js.push({ url: urlStr.split('/').pop()?.split('?')[0], size });
        } else if (urlStr.endsWith('.css') || urlStr.includes('.css?') || (headers['content-type'] || '').includes('css')) {
          resourceSizes.css.push({ url: urlStr.split('/').pop()?.split('?')[0], size });
        } else {
          resourceSizes.other.push({ url: urlStr.split('/').pop()?.split('?')[0], size });
        }
      }
    } catch (_) { /* ignore */ }
  });

  // Navigate
  const navStart = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000); // let late resources settle
  const loadTime = Date.now() - navStart;

  // Performance timing
  const perfTiming = await page.evaluate(() => {
    const t = performance.timing;
    return {
      loadEventEnd: t.loadEventEnd,
      navigationStart: t.navigationStart,
      domContentLoadedEventEnd: t.domContentLoadedEventEnd,
      responseEnd: t.responseEnd,
    };
  });
  const pageLoadTime = perfTiming.loadEventEnd > 0
    ? perfTiming.loadEventEnd - perfTiming.navigationStart
    : loadTime;

  // DOM element count
  const domCount = await page.evaluate(() => document.querySelectorAll('*').length);

  // FCP via PerformanceObserver
  const fcp = await page.evaluate(() => {
    return new Promise((resolve) => {
      const entries = performance.getEntriesByName('first-contentful-paint');
      if (entries.length > 0) return resolve(entries[0].startTime);
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.name === 'first-contentful-paint') {
            obs.disconnect();
            return resolve(e.startTime);
          }
        }
      });
      obs.observe({ type: 'paint', buffered: true });
      setTimeout(() => resolve(null), 3000);
    });
  });

  // LCP
  const lcp = await page.evaluate(() => {
    return new Promise((resolve) => {
      const entries = performance.getEntriesByType('largest-contentful-paint');
      if (entries.length > 0) return resolve(entries[entries.length - 1].startTime);
      const obs = new PerformanceObserver((list) => {
        const e = list.getEntries();
        if (e.length > 0) {
          obs.disconnect();
          return resolve(e[e.length - 1].startTime);
        }
      });
      try { obs.observe({ type: 'largest-contentful-paint', buffered: true }); } catch (_) {}
      setTimeout(() => resolve(null), 3000);
    });
  });

  // CLS
  const cls = await page.evaluate(() => {
    return new Promise((resolve) => {
      let clsValue = 0;
      const entries = performance.getEntriesByType('layout-shift');
      if (entries.length > 0) {
        for (const e of entries) {
          if (!e.hadRecentInput) clsValue += e.value;
        }
        return resolve(clsValue);
      }
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) clsValue += e.value;
        }
      });
      try { obs.observe({ type: 'layout-shift', buffered: true }); } catch (_) {}
      setTimeout(() => { obs.disconnect(); resolve(clsValue); }, 2000);
    });
  });

  // Resource counts
  const resourceCounts = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    let jsCount = 0, cssCount = 0, totalSize = 0;
    for (const e of entries) {
      totalSize += e.transferSize || 0;
      if (e.initiatorType === 'script' || e.name.includes('.js')) jsCount++;
      if (e.initiatorType === 'link' || e.name.includes('.css')) cssCount++;
    }
    return { jsCount, cssCount, totalResources: entries.length, totalSize };
  });

  results.metrics = {
    pageLoadTimeMs: pageLoadTime,
    domElementCount: domCount,
    firstContentfulPaintMs: fcp ? Math.round(fcp) : 'N/A',
    largestContentfulPaintMs: lcp ? Math.round(lcp) : 'N/A',
    cumulativeLayoutShift: cls ? parseFloat(cls.toFixed(4)) : 0,
    jsResourceCount: resourceCounts.jsCount,
    cssResourceCount: resourceCounts.cssCount,
    totalResources: resourceCounts.totalResources,
    totalTransferredBytes: resourceCounts.totalSize || totalTransferred,
    networkRequestCount: requests.length,
  };

  // Score deductions
  if (pageLoadTime > 5000) { results.score -= 20; results.issues.push(`Page load time is ${pageLoadTime}ms (>5s)`); }
  else if (pageLoadTime > 3000) { results.score -= 10; results.issues.push(`Page load time is ${pageLoadTime}ms (>3s)`); }

  if (domCount > 1500) { results.score -= 10; results.issues.push(`DOM has ${domCount} elements (>1500)`); }
  else if (domCount > 800) { results.score -= 5; results.issues.push(`DOM has ${domCount} elements (>800)`); }

  if (fcp && fcp > 3000) { results.score -= 15; results.issues.push(`FCP is ${Math.round(fcp)}ms (>3s)`); }
  else if (fcp && fcp > 1800) { results.score -= 7; results.issues.push(`FCP is ${Math.round(fcp)}ms (>1.8s)`); }

  if (lcp && lcp > 4000) { results.score -= 15; results.issues.push(`LCP is ${Math.round(lcp)}ms (>4s)`); }
  else if (lcp && lcp > 2500) { results.score -= 7; results.issues.push(`LCP is ${Math.round(lcp)}ms (>2.5s)`); }

  if (cls > 0.25) { results.score -= 15; results.issues.push(`CLS is ${cls.toFixed(4)} (>0.25)`); }
  else if (cls > 0.1) { results.score -= 7; results.issues.push(`CLS is ${cls.toFixed(4)} (>0.1)`); }

  if (requests.length > 80) { results.score -= 5; results.issues.push(`${requests.length} network requests (>80)`); }

  results.score = Math.max(0, results.score);
  return results;
}

async function auditBestPractices(page, url) {
  const results = { score: 100, issues: [], details: {} };
  const consoleErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1500);

  // 1. Links with href
  const linkIssues = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    const bad = [];
    links.forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || href === '' || href === '#') {
        bad.push({ text: (a.textContent || '').trim().slice(0, 40), href: href || 'missing' });
      }
    });
    return bad;
  });
  if (linkIssues.length > 0) {
    results.score -= Math.min(15, linkIssues.length * 3);
    results.issues.push(`${linkIssues.length} link(s) without proper href`);
    results.details.linksWithoutHref = linkIssues;
  }

  // 2. Images without alt
  const imgIssues = await page.evaluate(() => {
    const imgs = document.querySelectorAll('img');
    const bad = [];
    imgs.forEach((img) => {
      const alt = img.getAttribute('alt');
      const ariaHidden = img.getAttribute('aria-hidden');
      const role = img.getAttribute('role');
      if ((alt === null || alt === undefined) && ariaHidden !== 'true' && role !== 'presentation') {
        bad.push({ src: (img.getAttribute('src') || '').slice(0, 60) });
      }
    });
    return bad;
  });
  if (imgIssues.length > 0) {
    results.score -= Math.min(15, imgIssues.length * 3);
    results.issues.push(`${imgIssues.length} image(s) without alt text`);
    results.details.imagesWithoutAlt = imgIssues;
  }

  // 3. Console errors
  if (consoleErrors.length > 0) {
    results.score -= Math.min(15, consoleErrors.length * 3);
    results.issues.push(`${consoleErrors.length} console error(s) on load`);
    results.details.consoleErrors = consoleErrors.slice(0, 10);
  }

  // 4. HTTPS for all resources
  const httpResources = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    return entries.filter((e) => e.name.startsWith('http://')).map((e) => e.name);
  });
  if (httpResources.length > 0) {
    results.score -= 20;
    results.issues.push(`${httpResources.length} resource(s) loaded over HTTP (not HTTPS)`);
    results.details.httpResources = httpResources.slice(0, 10);
  }

  // 5. Mixed content check (same as above, already caught)
  const mixedContent = httpResources.length > 0;
  if (mixedContent) {
    results.issues.push('Mixed content detected (HTTP resources on HTTPS page)');
    results.details.mixedContent = true;
  }

  // 6. Doctype
  const hasDoctype = await page.evaluate(() => {
    return document.doctype !== null;
  });
  if (!hasDoctype) {
    results.score -= 10;
    results.issues.push('Document is missing a valid doctype');
  }

  // 7. Charset
  const hasCharset = await page.evaluate(() => {
    const meta = document.querySelector('meta[charset], meta[http-equiv="Content-Type"]');
    return meta !== null;
  });
  if (!hasCharset) {
    results.score -= 5;
    results.issues.push('Document is missing charset declaration');
  }

  results.score = Math.max(0, results.score);
  return results;
}

async function auditSEO(page, url) {
  const results = { score: 100, issues: [], details: {} };

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1000);

  // 1. Meta description
  const metaDesc = await page.evaluate(() => {
    const m = document.querySelector('meta[name="description"]');
    return m ? m.getAttribute('content') : null;
  });
  if (!metaDesc) {
    results.score -= 15;
    results.issues.push('Missing meta description');
  } else if (metaDesc.length < 50) {
    results.score -= 5;
    results.issues.push(`Meta description is too short (${metaDesc.length} chars)`);
    results.details.metaDescription = metaDesc;
  }

  // 2. Title tag
  const title = await page.evaluate(() => document.title);
  if (!title || title.trim().length === 0) {
    results.score -= 20;
    results.issues.push('Missing or empty title tag');
  } else if (title.length < 10) {
    results.score -= 5;
    results.issues.push(`Title tag is too short: "${title}"`);
  }
  results.details.title = title || 'missing';

  // 3. Viewport meta
  const hasViewport = await page.evaluate(() => {
    return document.querySelector('meta[name="viewport"]') !== null;
  });
  if (!hasViewport) {
    results.score -= 15;
    results.issues.push('Missing viewport meta tag');
  }

  // 4. Document language
  const lang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
  if (!lang) {
    results.score -= 10;
    results.issues.push('Document language is not set (<html lang="...">)');
  }
  results.details.language = lang || 'not set';

  // 5. Heading hierarchy
  const headingIssues = await page.evaluate(() => {
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const issues = [];
    let lastLevel = 0;
    let h1Count = 0;
    headings.forEach((h) => {
      const level = parseInt(h.tagName[1]);
      if (level === 1) h1Count++;
      if (lastLevel > 0 && level > lastLevel + 1) {
        issues.push(`Heading skip: h${lastLevel} -> h${level} ("${(h.textContent || '').trim().slice(0, 30)}")`);
      }
      lastLevel = level;
    });
    if (h1Count === 0) issues.push('No h1 element found');
    if (h1Count > 1) issues.push(`Multiple h1 elements found (${h1Count})`);
    return { issues, h1Count, totalHeadings: headings.length };
  });
  if (headingIssues.issues.length > 0) {
    results.score -= Math.min(15, headingIssues.issues.length * 5);
    results.issues.push(...headingIssues.issues);
  }
  results.details.headings = headingIssues;

  results.score = Math.max(0, results.score);
  return results;
}

async function auditAccessibility(page, url) {
  const results = { score: 100, issues: [], details: {} };

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1500);

  // 1. Interactive elements with accessible names
  const interactiveIssues = await page.evaluate(() => {
    const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [tabindex]';
    const els = document.querySelectorAll(selectors);
    const bad = [];
    els.forEach((el) => {
      const name =
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        el.getAttribute('title') ||
        el.textContent?.trim() ||
        el.getAttribute('placeholder') ||
        el.getAttribute('alt') ||
        el.getAttribute('value');
      if (!name || name.length === 0) {
        bad.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          id: el.id || '',
          classes: (el.className || '').toString().slice(0, 40),
        });
      }
    });
    return bad;
  });
  if (interactiveIssues.length > 0) {
    results.score -= Math.min(20, interactiveIssues.length * 2);
    results.issues.push(`${interactiveIssues.length} interactive element(s) without accessible names`);
    results.details.interactiveWithoutNames = interactiveIssues.slice(0, 20);
  }

  // 2. Color contrast
  const contrastIssues = await page.evaluate(() => {
    // Collect visible text elements (limit to avoid performance issues)
    const textSelectors = 'p, span, a, button, h1, h2, h3, h4, h5, h6, li, td, th, label, div, strong, em, small';
    const els = document.querySelectorAll(textSelectors);
    const items = [];
    const limit = 300; // sample up to 300 elements
    let count = 0;
    for (const el of els) {
      if (count >= limit) break;
      const text = el.textContent?.trim();
      if (!text || text.length === 0) continue;
      // Only check leaf-ish nodes (with direct text)
      const hasDirectText = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && n.textContent?.trim().length > 0
      );
      if (!hasDirectText) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      items.push({
        text: text.slice(0, 30),
        color: cs.color,
        bg: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        tag: el.tagName.toLowerCase(),
      });
      count++;
    }
    return items;
  });

  const contrastFails = [];
  for (const item of contrastIssues) {
    const fg = parseRGB(item.color);
    let bg = parseRGB(item.bg);
    if (!fg) continue;
    // If background is transparent/rgba(0,0,0,0), assume white background
    if (!bg || (item.bg && item.bg.includes('rgba') && item.bg.includes(', 0)'))) {
      bg = [255, 255, 255]; // assume white
    }
    const ratio = contrastRatio(fg, bg);
    const large = isLargeText(item.fontSize, item.fontWeight);
    const threshold = large ? 3.0 : 4.5;
    if (ratio < threshold) {
      contrastFails.push({
        text: item.text,
        tag: item.tag,
        color: item.color,
        background: item.bg,
        contrastRatio: parseFloat(ratio.toFixed(2)),
        required: threshold,
        isLargeText: large,
      });
    }
  }
  if (contrastFails.length > 0) {
    results.score -= Math.min(25, contrastFails.length);
    results.issues.push(`${contrastFails.length} element(s) with insufficient color contrast`);
    results.details.contrastIssues = contrastFails.slice(0, 20);
  }

  // 3. Form inputs with labels
  const formIssues = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input, select, textarea');
    const bad = [];
    inputs.forEach((inp) => {
      const type = inp.getAttribute('type');
      if (type === 'hidden' || type === 'submit' || type === 'button') return;
      const id = inp.id;
      const hasLabel = id ? document.querySelector(`label[for="${id}"]`) !== null : false;
      const hasAriaLabel = inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby');
      const hasTitle = inp.getAttribute('title');
      const parentLabel = inp.closest('label');
      if (!hasLabel && !hasAriaLabel && !hasTitle && !parentLabel) {
        bad.push({
          tag: inp.tagName.toLowerCase(),
          type: type || '',
          id: id || '',
          name: inp.getAttribute('name') || '',
          placeholder: inp.getAttribute('placeholder') || '',
        });
      }
    });
    return bad;
  });
  if (formIssues.length > 0) {
    results.score -= Math.min(15, formIssues.length * 3);
    results.issues.push(`${formIssues.length} form input(s) without labels`);
    results.details.inputsWithoutLabels = formIssues.slice(0, 15);
  }

  // 4. Focus indicators
  const focusIssues = await page.evaluate(async () => {
    const focusable = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const bad = [];
    const limit = 20;
    let count = 0;
    for (const el of focusable) {
      if (count >= limit) break;
      const before = getComputedStyle(el);
      const outlineBefore = before.outline;
      const borderBefore = before.border;
      const boxShadowBefore = before.boxShadow;
      el.focus();
      await new Promise((r) => setTimeout(r, 50));
      const after = getComputedStyle(el);
      const hasVisibleFocus =
        after.outline !== outlineBefore ||
        after.border !== borderBefore ||
        after.boxShadow !== boxShadowBefore ||
        after.outlineWidth !== '0px';
      if (!hasVisibleFocus && after.outlineStyle === 'none' && after.outlineWidth === '0px') {
        bad.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 30),
          id: el.id || '',
        });
      }
      count++;
    }
    return bad;
  });
  if (focusIssues.length > 0) {
    results.score -= Math.min(10, focusIssues.length * 2);
    results.issues.push(`${focusIssues.length} element(s) may lack visible focus indicators`);
    results.details.focusIssues = focusIssues.slice(0, 10);
  }

  // 5. Tab order (check tabindex values)
  const tabOrderIssues = await page.evaluate(() => {
    const els = document.querySelectorAll('[tabindex]');
    const bad = [];
    els.forEach((el) => {
      const ti = parseInt(el.getAttribute('tabindex') || '0');
      if (ti > 0) {
        bad.push({
          tag: el.tagName.toLowerCase(),
          tabindex: ti,
          text: (el.textContent || '').trim().slice(0, 30),
        });
      }
    });
    return bad;
  });
  if (tabOrderIssues.length > 0) {
    results.score -= Math.min(10, tabOrderIssues.length * 3);
    results.issues.push(`${tabOrderIssues.length} element(s) with positive tabindex (disrupts natural tab order)`);
    results.details.tabOrderIssues = tabOrderIssues;
  }

  // 6. ARIA attributes validation
  const ariaIssues = await page.evaluate(() => {
    const validAriaAttrs = new Set([
      'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden',
      'aria-expanded', 'aria-haspopup', 'aria-controls', 'aria-live',
      'aria-atomic', 'aria-busy', 'aria-checked', 'aria-current',
      'aria-disabled', 'aria-invalid', 'aria-modal', 'aria-pressed',
      'aria-required', 'aria-selected', 'aria-sort', 'aria-valuemax',
      'aria-valuemin', 'aria-valuenow', 'aria-valuetext', 'aria-owns',
      'aria-relevant', 'aria-roledescription', 'aria-activedescendant',
      'aria-colcount', 'aria-colindex', 'aria-colspan', 'aria-rowcount',
      'aria-rowindex', 'aria-rowspan', 'aria-level', 'aria-multiline',
      'aria-multiselectable', 'aria-orientation', 'aria-placeholder',
      'aria-posinset', 'aria-setsize', 'aria-autocomplete', 'aria-errormessage',
      'aria-details', 'aria-flowto', 'aria-keyshortcuts',
    ]);
    const allEls = document.querySelectorAll('*');
    const bad = [];
    allEls.forEach((el) => {
      for (const attr of el.attributes) {
        if (attr.name.startsWith('aria-') && !validAriaAttrs.has(attr.name)) {
          bad.push({
            tag: el.tagName.toLowerCase(),
            attribute: attr.name,
            value: attr.value.slice(0, 30),
          });
        }
      }
      // Check aria-labelledby/describedby references exist
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const ids = labelledBy.split(/\s+/);
        for (const id of ids) {
          if (!document.getElementById(id)) {
            bad.push({
              tag: el.tagName.toLowerCase(),
              attribute: 'aria-labelledby',
              value: `references missing id "${id}"`,
            });
          }
        }
      }
    });
    return bad;
  });
  if (ariaIssues.length > 0) {
    results.score -= Math.min(10, ariaIssues.length * 2);
    results.issues.push(`${ariaIssues.length} invalid or broken ARIA attribute(s)`);
    results.details.ariaIssues = ariaIssues.slice(0, 15);
  }

  // 7. Landmark regions
  const landmarks = await page.evaluate(() => {
    const found = {
      main: document.querySelectorAll('main, [role="main"]').length,
      nav: document.querySelectorAll('nav, [role="navigation"]').length,
      banner: document.querySelectorAll('header, [role="banner"]').length,
      contentinfo: document.querySelectorAll('footer, [role="contentinfo"]').length,
      complementary: document.querySelectorAll('aside, [role="complementary"]').length,
    };
    return found;
  });
  results.details.landmarks = landmarks;
  if (landmarks.main === 0) {
    results.score -= 10;
    results.issues.push('Missing <main> or [role="main"] landmark');
  }
  if (landmarks.nav === 0) {
    results.score -= 5;
    results.issues.push('Missing <nav> or [role="navigation"] landmark');
  }

  results.score = Math.max(0, results.score);
  return results;
}

// ─── Main execution ────────────────────────────────────────────────────────

async function main() {
  console.log('=== AlphaDesk Lighthouse-Style Audit ===\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Login
  console.log('[*] Logging in...');
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    // Try root if /login doesn't exist
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  }
  await page.waitForTimeout(1500);

  // Try to find login form
  const usernameField = await page.$('input[name="username"], input[type="text"], input[name="email"], input[type="email"], #username, #email');
  const passwordField = await page.$('input[name="password"], input[type="password"], #password');

  if (usernameField && passwordField) {
    await usernameField.fill(LOGIN_USER);
    await passwordField.fill(LOGIN_PASS);
    const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in")');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await passwordField.press('Enter');
    }
    await page.waitForTimeout(3000);
    console.log('[+] Login attempted. Current URL:', page.url());
  } else {
    console.log('[!] Login form not found, proceeding anyway...');
  }

  // Take post-login screenshot
  await page.screenshot({ path: join(OUTPUT_DIR, 'post-login.png'), fullPage: false });

  const fullReport = {
    auditDate: new Date().toISOString(),
    baseUrl: BASE_URL,
    pages: {},
    summary: { overallScore: 0, categoryAverages: {} },
  };

  const categoryScores = { performance: [], bestPractices: [], seo: [], accessibility: [] };

  for (const pagePath of PAGES) {
    const url = `${BASE_URL}${pagePath}`;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[*] Auditing: ${pagePath}`);
    console.log('='.repeat(60));

    const pageReport = {};

    // Performance
    try {
      console.log('  [*] Performance audit...');
      const perfPage = await context.newPage();
      pageReport.performance = await auditPerformance(perfPage, url);
      await perfPage.close();
      console.log(`  [+] Performance: ${pageReport.performance.score}/100`);
      categoryScores.performance.push(pageReport.performance.score);
    } catch (e) {
      console.log(`  [!] Performance audit error: ${e.message}`);
      pageReport.performance = { score: 0, issues: [`Audit error: ${e.message}`], metrics: {} };
      categoryScores.performance.push(0);
    }

    // Best Practices
    try {
      console.log('  [*] Best Practices audit...');
      const bpPage = await context.newPage();
      pageReport.bestPractices = await auditBestPractices(bpPage, url);
      await bpPage.close();
      console.log(`  [+] Best Practices: ${pageReport.bestPractices.score}/100`);
      categoryScores.bestPractices.push(pageReport.bestPractices.score);
    } catch (e) {
      console.log(`  [!] Best Practices audit error: ${e.message}`);
      pageReport.bestPractices = { score: 0, issues: [`Audit error: ${e.message}`], details: {} };
      categoryScores.bestPractices.push(0);
    }

    // SEO
    try {
      console.log('  [*] SEO audit...');
      const seoPage = await context.newPage();
      pageReport.seo = await auditSEO(seoPage, url);
      await seoPage.close();
      console.log(`  [+] SEO: ${pageReport.seo.score}/100`);
      categoryScores.seo.push(pageReport.seo.score);
    } catch (e) {
      console.log(`  [!] SEO audit error: ${e.message}`);
      pageReport.seo = { score: 0, issues: [`Audit error: ${e.message}`], details: {} };
      categoryScores.seo.push(0);
    }

    // Accessibility
    try {
      console.log('  [*] Accessibility audit...');
      const a11yPage = await context.newPage();
      pageReport.accessibility = await auditAccessibility(a11yPage, url);
      await a11yPage.close();
      console.log(`  [+] Accessibility: ${pageReport.accessibility.score}/100`);
      categoryScores.accessibility.push(pageReport.accessibility.score);
    } catch (e) {
      console.log(`  [!] Accessibility audit error: ${e.message}`);
      pageReport.accessibility = { score: 0, issues: [`Audit error: ${e.message}`], details: {} };
      categoryScores.accessibility.push(0);
    }

    // Screenshot
    try {
      const screenshotPage = await context.newPage();
      await screenshotPage.goto(url, { waitUntil: 'load', timeout: 30000 });
      await screenshotPage.waitForTimeout(1500);
      const safeName = pagePath === '/' ? 'home' : pagePath.replace(/\//g, '_').replace(/^_/, '');
      await screenshotPage.screenshot({ path: join(OUTPUT_DIR, `${safeName}.png`), fullPage: true });
      await screenshotPage.close();
    } catch (e) {
      console.log(`  [!] Screenshot error: ${e.message}`);
    }

    fullReport.pages[pagePath] = pageReport;
  }

  // Calculate averages
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  fullReport.summary.categoryAverages = {
    performance: avg(categoryScores.performance),
    bestPractices: avg(categoryScores.bestPractices),
    seo: avg(categoryScores.seo),
    accessibility: avg(categoryScores.accessibility),
  };
  fullReport.summary.overallScore = avg([
    fullReport.summary.categoryAverages.performance,
    fullReport.summary.categoryAverages.bestPractices,
    fullReport.summary.categoryAverages.seo,
    fullReport.summary.categoryAverages.accessibility,
  ]);

  // Write JSON report
  writeFileSync(join(OUTPUT_DIR, 'report.json'), JSON.stringify(fullReport, null, 2));
  console.log(`\n[+] JSON report saved to ${join(OUTPUT_DIR, 'report.json')}`);

  // Generate markdown summary
  let md = `# AlphaDesk Lighthouse Audit Report\n\n`;
  md += `**Date:** ${fullReport.auditDate}\n`;
  md += `**Site:** ${BASE_URL}\n\n`;
  md += `## Overall Score: ${fullReport.summary.overallScore}/100\n\n`;
  md += `| Category | Average Score |\n`;
  md += `|----------|---------------|\n`;
  md += `| Performance | ${fullReport.summary.categoryAverages.performance}/100 |\n`;
  md += `| Best Practices | ${fullReport.summary.categoryAverages.bestPractices}/100 |\n`;
  md += `| SEO | ${fullReport.summary.categoryAverages.seo}/100 |\n`;
  md += `| Accessibility | ${fullReport.summary.categoryAverages.accessibility}/100 |\n\n`;

  for (const [pagePath, pageData] of Object.entries(fullReport.pages)) {
    md += `---\n\n## Page: \`${pagePath}\`\n\n`;

    for (const [category, data] of Object.entries(pageData)) {
      const catName = category === 'bestPractices' ? 'Best Practices' :
        category.charAt(0).toUpperCase() + category.slice(1);
      md += `### ${catName} (${data.score}/100)\n\n`;

      if (data.metrics) {
        md += `**Metrics:**\n`;
        for (const [key, val] of Object.entries(data.metrics)) {
          const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
          const display = typeof val === 'number' && key.includes('Bytes')
            ? `${(val / 1024).toFixed(1)} KB`
            : typeof val === 'number' && key.includes('Ms')
            ? `${val} ms`
            : val;
          md += `- ${label}: ${display}\n`;
        }
        md += '\n';
      }

      if (data.issues && data.issues.length > 0) {
        md += `**Issues (${data.issues.length}):**\n`;
        for (const issue of data.issues) {
          md += `- ${issue}\n`;
        }
        md += '\n';
      } else {
        md += `No issues found.\n\n`;
      }

      // Show detail highlights
      if (data.details) {
        const detailKeys = Object.keys(data.details);
        if (detailKeys.length > 0) {
          md += `**Details:**\n`;
          for (const key of detailKeys) {
            const val = data.details[key];
            if (Array.isArray(val) && val.length > 0) {
              md += `- ${key}: ${val.length} item(s)\n`;
              for (const item of val.slice(0, 5)) {
                md += `  - ${JSON.stringify(item)}\n`;
              }
              if (val.length > 5) md += `  - ... and ${val.length - 5} more\n`;
            } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
              md += `- ${key}: ${JSON.stringify(val)}\n`;
            } else {
              md += `- ${key}: ${val}\n`;
            }
          }
          md += '\n';
        }
      }
    }
  }

  md += `---\n\n*Generated by qa-lighthouse.mjs on ${fullReport.auditDate}*\n`;

  writeFileSync(join(OUTPUT_DIR, 'summary.md'), md);
  console.log(`[+] Summary saved to ${join(OUTPUT_DIR, 'summary.md')}`);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('AUDIT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Overall Score: ${fullReport.summary.overallScore}/100`);
  console.log(`  Performance:    ${fullReport.summary.categoryAverages.performance}/100`);
  console.log(`  Best Practices: ${fullReport.summary.categoryAverages.bestPractices}/100`);
  console.log(`  SEO:            ${fullReport.summary.categoryAverages.seo}/100`);
  console.log(`  Accessibility:  ${fullReport.summary.categoryAverages.accessibility}/100`);

  for (const [pagePath, pageData] of Object.entries(fullReport.pages)) {
    console.log(`\n  ${pagePath}:`);
    for (const [category, data] of Object.entries(pageData)) {
      const issues = data.issues?.length || 0;
      console.log(`    ${category}: ${data.score}/100 (${issues} issue${issues !== 1 ? 's' : ''})`);
    }
  }

  await browser.close();
  console.log('\n[+] Audit complete.');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
