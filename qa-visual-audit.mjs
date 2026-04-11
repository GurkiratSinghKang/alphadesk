import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'https://tradingalpha.net';
const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/visual-audit';
const USERNAME = 'admin';
const PASSWORD = 'GK1355$$gk';

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const PAGES = [
  { path: '/', name: 'dashboard', label: 'Dashboard' },
  { path: '/trade', name: 'trade', label: 'Trade' },
  { path: '/pipeline', name: 'pipeline', label: 'Pipeline' },
  { path: '/strategies/pead', name: 'strategies-pead', label: 'Strategies PEAD' },
  { path: '/strategies/momentum-quality', name: 'strategies-momentum', label: 'Strategies Momentum Quality' },
];

const BAD_TEXT_PATTERNS = [
  { pattern: /\bNaN\b/, label: 'NaN' },
  { pattern: /\bundefined\b/, label: 'undefined' },
  { pattern: /\bnull\b/i, label: 'null' },
  { pattern: /\[object Object\]/, label: '[object Object]' },
  { pattern: /\bInfinity\b/, label: 'Infinity' },
  { pattern: /\b-Infinity\b/, label: '-Infinity' },
  { pattern: /Error:/i, label: 'Error message' },
];

const allFindings = [];
const allConsoleErrors = [];

function addFinding(page, category, description, severity, screenshot = null) {
  const finding = {
    id: `F${String(allFindings.length + 1).padStart(3, '0')}`,
    page,
    category,
    description,
    severity,
    screenshot,
    timestamp: new Date().toISOString(),
  };
  allFindings.push(finding);
  const sev = severity.toUpperCase();
  console.log(`  [${sev}] ${finding.id}: ${description}`);
  return finding;
}

async function login(page) {
  console.log('\n=== Logging in ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'login-page.png'), fullPage: true });

  // Debug: dump all input elements
  const inputs = await page.$$eval('input', els => els.map(e => ({
    type: e.type, name: e.name, placeholder: e.placeholder, id: e.id, className: e.className?.substring(0, 60)
  })));
  console.log('  Found inputs:', JSON.stringify(inputs, null, 2));

  const buttons = await page.$$eval('button', els => els.map(e => ({
    text: e.textContent?.trim(), type: e.type, className: e.className?.substring(0, 60)
  })));
  console.log('  Found buttons:', JSON.stringify(buttons, null, 2));

  // Fill username - use locator API for reliability
  const allInputs = await page.$$('input');
  if (allInputs.length >= 2) {
    // First input = username, second = password
    await allInputs[0].fill(USERNAME);
    await allInputs[1].fill(PASSWORD);
  } else {
    // Try by label
    await page.getByLabel(/username/i).fill(USERNAME);
    await page.getByLabel(/password/i).fill(PASSWORD);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'login-filled.png'), fullPage: true });

  // Click Sign In
  const signInBtn = await page.$('button:has-text("Sign In"), button:has-text("Login"), button:has-text("Sign in"), button[type="submit"]');
  if (signInBtn) {
    await signInBtn.click();
    console.log('  Clicked Sign In button');
  } else {
    // Fallback: press Enter
    await allInputs[1].press('Enter');
    console.log('  Pressed Enter to submit');
  }

  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'post-login.png'), fullPage: true });
  console.log('  Login completed. Current URL:', page.url());
}

async function captureConsoleErrors(page, pageName) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push({ page: pageName, message: msg.text(), url: msg.location()?.url || '' });
    }
  });
  page.on('pageerror', (err) => {
    errors.push({ page: pageName, message: err.message, type: 'pageerror' });
  });
  return errors;
}

async function checkBadTextPatterns(page, pageName) {
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  const findings = [];

  for (const { pattern, label } of BAD_TEXT_PATTERNS) {
    const matches = bodyText.match(new RegExp(pattern.source, pattern.flags + 'g'));
    if (matches) {
      // Find surrounding context for each match
      const lines = bodyText.split('\n');
      for (const line of lines) {
        if (pattern.test(line)) {
          const trimmed = line.trim().substring(0, 150);
          if (trimmed.length > 0) {
            // Skip lines where "null" or "undefined" appear in natural English context
            const falsePositiveCheck = trimmed.toLowerCase();
            if (label === 'null' && (falsePositiveCheck.includes('annualized') || falsePositiveCheck.includes('description'))) continue;
            findings.push({ label, context: trimmed, count: matches.length });
          }
        }
      }
    }
  }
  return findings;
}

async function checkOverflow(page, pageName) {
  const overflows = await page.evaluate(() => {
    const results = [];
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      // Check for horizontal overflow out of viewport
      if (rect.right > window.innerWidth + 5 && rect.width > 50) {
        const tag = el.tagName.toLowerCase();
        const cls = el.className?.toString().substring(0, 80) || '';
        const text = el.textContent?.substring(0, 60) || '';
        results.push({
          type: 'overflow-viewport',
          element: `${tag}.${cls}`,
          text,
          right: Math.round(rect.right),
          viewportWidth: window.innerWidth,
        });
      }
      // Check text overflow / truncation
      if (el.scrollWidth > el.clientWidth + 2 && style.overflow === 'hidden') {
        const tag = el.tagName.toLowerCase();
        const cls = el.className?.toString().substring(0, 80) || '';
        const text = el.textContent?.substring(0, 80) || '';
        if (text.trim().length > 0) {
          results.push({
            type: 'text-truncation',
            element: `${tag}.${cls}`,
            text,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          });
        }
      }
    }
    return results.slice(0, 30); // limit
  });
  return overflows;
}

async function checkEmptySections(page, pageName) {
  const empties = await page.evaluate(() => {
    const results = [];
    // Check for containers that might be empty
    const containers = document.querySelectorAll(
      'div[class*="card"], div[class*="panel"], div[class*="section"], div[class*="chart"], div[class*="table"], div[class*="widget"], section, article'
    );
    for (const el of containers) {
      const rect = el.getBoundingClientRect();
      // Visible container but with no text content
      if (rect.height > 50 && rect.width > 100 && rect.height < 2000) {
        const textContent = el.innerText?.trim() || '';
        const hasCanvas = el.querySelector('canvas, svg');
        const hasImg = el.querySelector('img');
        if (textContent.length === 0 && !hasCanvas && !hasImg) {
          const cls = el.className?.toString().substring(0, 100) || '';
          results.push({
            element: `${el.tagName.toLowerCase()}.${cls}`,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
    }
    return results.slice(0, 20);
  });
  return empties;
}

async function checkColorConsistency(page, pageName) {
  const colorIssues = await page.evaluate(() => {
    const results = [];
    const allElements = document.querySelectorAll('*');

    for (const el of allElements) {
      const text = el.innerText?.trim() || '';
      const style = window.getComputedStyle(el);
      const color = style.color;

      // Check for elements displaying numbers with +/- or % that may indicate profit/loss
      const numMatch = text.match(/^([+-]?\$?[\d,.]+%?)$/);
      if (!numMatch) continue;

      const isNegative = text.startsWith('-');
      const isPositive = text.startsWith('+');

      if (!isNegative && !isPositive) continue;

      // Parse RGB
      const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!rgbMatch) continue;

      const [, r, g, b] = rgbMatch.map(Number);

      if (isNegative) {
        // Negative values should be red-ish (r > g and r > b)
        if (g > r && g > 100) {
          results.push({
            text,
            color,
            expected: 'red/negative',
            actual: 'green-ish',
            element: el.tagName.toLowerCase(),
            cls: el.className?.toString().substring(0, 60) || '',
          });
        }
      }
      if (isPositive) {
        // Positive values should be green-ish (g > r)
        if (r > g && r > 100) {
          results.push({
            text,
            color,
            expected: 'green/positive',
            actual: 'red-ish',
            element: el.tagName.toLowerCase(),
            cls: el.className?.toString().substring(0, 60) || '',
          });
        }
      }
    }
    return results.slice(0, 20);
  });
  return colorIssues;
}

async function checkOverlapping(page, pageName) {
  const overlaps = await page.evaluate(() => {
    const results = [];
    const interactive = document.querySelectorAll('button, a, input, select, [role="button"]');
    const rects = [];

    for (const el of interactive) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      rects.push({
        el,
        rect,
        tag: el.tagName.toLowerCase(),
        text: el.textContent?.substring(0, 40) || '',
        cls: el.className?.toString().substring(0, 60) || '',
      });
    }

    // Check pairs for overlap
    for (let i = 0; i < rects.length && i < 100; i++) {
      for (let j = i + 1; j < rects.length && j < 100; j++) {
        const a = rects[i].rect;
        const b = rects[j].rect;
        const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const overlapArea = overlapX * overlapY;
        const areaA = a.width * a.height;
        const areaB = b.width * b.height;
        const minArea = Math.min(areaA, areaB);

        if (overlapArea > minArea * 0.3 && overlapArea > 100) {
          // Check if one is a parent of the other (that's OK)
          if (!rects[i].el.contains(rects[j].el) && !rects[j].el.contains(rects[i].el)) {
            results.push({
              elementA: `${rects[i].tag} "${rects[i].text}"`,
              elementB: `${rects[j].tag} "${rects[j].text}"`,
              overlapArea,
            });
          }
        }
      }
    }
    return results.slice(0, 10);
  });
  return overlaps;
}

async function checkBrokenSVGCharts(page, pageName) {
  const svgIssues = await page.evaluate(() => {
    const results = [];
    const svgs = document.querySelectorAll('svg');

    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 30) continue;

      const paths = svg.querySelectorAll('path, line, rect, circle, polyline, polygon');
      const texts = svg.querySelectorAll('text');

      // SVG with significant size but very few drawing elements
      if (paths.length === 0 && rect.width > 100 && rect.height > 50) {
        results.push({
          type: 'empty-svg',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          pathCount: paths.length,
          textCount: texts.length,
          id: svg.id || '',
          cls: svg.className?.baseVal?.substring(0, 80) || '',
        });
      }

      // Check for SVGs with NaN in path data
      for (const path of paths) {
        const d = path.getAttribute('d') || '';
        if (d.includes('NaN') || d.includes('undefined') || d.includes('Infinity')) {
          results.push({
            type: 'corrupt-path',
            pathData: d.substring(0, 100),
            svgClass: svg.className?.baseVal?.substring(0, 80) || '',
          });
        }
      }
    }

    // Also check canvas elements
    const canvases = document.querySelectorAll('canvas');
    for (const canvas of canvases) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 50) {
        results.push({
          type: 'canvas-chart',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          note: 'Canvas detected - cannot inspect content programmatically',
        });
      }
    }
    return results;
  });
  return svgIssues;
}

async function checkZIndex(page, pageName) {
  const zIssues = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('*');

    for (const el of allEls) {
      const style = window.getComputedStyle(el);
      const zIndex = parseInt(style.zIndex);
      if (isNaN(zIndex) || zIndex < 10) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Check if this high z-index element covers important content
      const isFixed = style.position === 'fixed' || style.position === 'sticky';
      const isAbsolute = style.position === 'absolute';

      if ((isFixed || isAbsolute) && zIndex > 100 && rect.width > 200) {
        results.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className?.toString().substring(0, 80) || '',
          zIndex,
          position: style.position,
          bounds: {
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          text: el.textContent?.substring(0, 50) || '',
        });
      }
    }
    return results.slice(0, 10);
  });
  return zIssues;
}

async function checkTableAlignment(page, pageName) {
  const tableIssues = await page.evaluate(() => {
    const results = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      if (rows.length < 2) continue;

      // Check if header count matches data cell count
      const headerCells = rows[0].querySelectorAll('th, td');
      const headerCount = headerCells.length;

      for (let i = 1; i < Math.min(rows.length, 10); i++) {
        const dataCells = rows[i].querySelectorAll('td, th');
        if (dataCells.length !== headerCount && dataCells.length > 0) {
          results.push({
            type: 'column-mismatch',
            tableClass: table.className?.substring(0, 80) || '',
            headerColumns: headerCount,
            rowColumns: dataCells.length,
            rowIndex: i,
          });
        }
      }

      // Check for very wide tables causing overflow
      const tableRect = table.getBoundingClientRect();
      const parentRect = table.parentElement?.getBoundingClientRect();
      if (parentRect && tableRect.width > parentRect.width + 10) {
        results.push({
          type: 'table-overflow',
          tableClass: table.className?.substring(0, 80) || '',
          tableWidth: Math.round(tableRect.width),
          parentWidth: Math.round(parentRect.width),
        });
      }
    }

    // Also check div-based tables (grid layouts)
    const gridContainers = document.querySelectorAll('[class*="grid"], [class*="table"], [role="grid"], [role="table"]');
    for (const grid of gridContainers) {
      const rect = grid.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const parentRect = grid.parentElement?.getBoundingClientRect();
      if (parentRect && rect.right > parentRect.right + 20) {
        results.push({
          type: 'grid-overflow',
          element: grid.tagName.toLowerCase(),
          cls: grid.className?.toString().substring(0, 80) || '',
          width: Math.round(rect.width),
          parentWidth: Math.round(parentRect.width),
        });
      }
    }
    return results.slice(0, 20);
  });
  return tableIssues;
}

async function checkBrokenIcons(page, pageName) {
  const iconIssues = await page.evaluate(() => {
    const results = [];

    // Check for broken images
    const images = document.querySelectorAll('img');
    for (const img of images) {
      if (!img.complete || img.naturalWidth === 0) {
        results.push({
          type: 'broken-image',
          src: img.src?.substring(0, 150) || '',
          alt: img.alt || '',
          cls: img.className?.substring(0, 80) || '',
        });
      }
    }

    // Check for icon elements with no visible content
    const icons = document.querySelectorAll('i, span[class*="icon"], svg[class*="icon"]');
    for (const icon of icons) {
      const rect = icon.getBoundingClientRect();
      const style = window.getComputedStyle(icon);
      if (rect.width === 0 && rect.height === 0 && style.display !== 'none') {
        results.push({
          type: 'invisible-icon',
          tag: icon.tagName.toLowerCase(),
          cls: icon.className?.toString().substring(0, 80) || '',
        });
      }
    }

    // Check for font-awesome / material icons with empty content
    const faIcons = document.querySelectorAll('[class*="fa-"], [class*="material-icon"], [class*="lucide"]');
    for (const icon of faIcons) {
      const style = window.getComputedStyle(icon, '::before');
      const content = style.content;
      if (content === 'none' || content === '""' || content === "''") {
        results.push({
          type: 'empty-icon-font',
          cls: icon.className?.toString().substring(0, 80) || '',
        });
      }
    }

    return results.slice(0, 20);
  });
  return iconIssues;
}

async function takeKeyAreaScreenshots(page, pageName) {
  const screenshots = [];

  // Capture sections by scrolling and detecting key areas
  const sections = await page.evaluate(() => {
    const results = [];
    // Find major sections based on common patterns
    const selectors = [
      'header', 'nav', 'main', 'footer',
      '[class*="chart"]', '[class*="table"]', '[class*="card"]',
      '[class*="sidebar"]', '[class*="panel"]', '[class*="widget"]',
      '[class*="portfolio"]', '[class*="position"]', '[class*="order"]',
      '[class*="strategy"]', '[class*="metric"]', '[class*="stat"]',
      '[class*="summary"]', '[class*="overview"]', '[class*="performance"]',
      'table',
    ];

    const seen = new Set();
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 50) continue;
        const key = `${Math.round(rect.top)}-${Math.round(rect.left)}-${Math.round(rect.width)}-${Math.round(rect.height)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const cls = el.className?.toString()?.substring(0, 80) || '';
        const tag = el.tagName.toLowerCase();

        results.push({
          selector: sel,
          tag,
          cls,
          bounds: {
            x: Math.round(rect.left),
            y: Math.round(rect.top + window.scrollY),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      }
    }
    return results.slice(0, 25);
  });

  // Take cropped screenshots of first few sections
  let count = 0;
  for (const section of sections) {
    if (count >= 8) break;
    if (section.bounds.width < 150 || section.bounds.height < 80) continue;
    const filename = `${pageName}-section-${count}-${section.tag}.png`;
    try {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, filename),
        clip: {
          x: Math.max(0, section.bounds.x),
          y: Math.max(0, section.bounds.y),
          width: Math.min(section.bounds.width, 1920),
          height: Math.min(section.bounds.height, 2000),
        },
      });
      screenshots.push({ filename, ...section });
      count++;
    } catch (e) {
      // skip
    }
  }
  return screenshots;
}

async function auditPage(browser, pageConfig) {
  const { path, name, label } = pageConfig;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  AUDITING: ${label} (${path})`);
  console.log(`${'='.repeat(60)}`);

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    storageState: global.storageState || undefined,
  });
  const page = await context.newPage();

  // Set up console error capture
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({
        page: name,
        message: msg.text().substring(0, 300),
        url: msg.location()?.url || '',
      });
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push({
      page: name,
      message: err.message.substring(0, 300),
      type: 'pageerror',
    });
  });

  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000); // Let charts/data render

    // Full page screenshot
    const fullScreenshot = `${name}-fullpage.png`;
    await page.screenshot({
      path: join(SCREENSHOT_DIR, fullScreenshot),
      fullPage: true,
    });
    console.log(`  Full-page screenshot saved: ${fullScreenshot}`);

    // Viewport screenshot
    const viewportScreenshot = `${name}-viewport.png`;
    await page.screenshot({
      path: join(SCREENSHOT_DIR, viewportScreenshot),
    });

    // 1. Check bad text patterns
    console.log('\n  --- Bad Text Patterns ---');
    const badTexts = await checkBadTextPatterns(page, name);
    for (const bt of badTexts) {
      addFinding(label, 'bad-text', `Found "${bt.label}" in text: "${bt.context}"`, 'high', fullScreenshot);
    }
    if (badTexts.length === 0) console.log('    None found');

    // 2. Check overflow
    console.log('\n  --- Overflow / Truncation ---');
    const overflows = await checkOverflow(page, name);
    for (const of_ of overflows) {
      if (of_.type === 'overflow-viewport') {
        addFinding(label, 'overflow', `Element overflows viewport: ${of_.element} (right: ${of_.right}px, viewport: ${of_.viewportWidth}px)`, 'medium', fullScreenshot);
      } else if (of_.type === 'text-truncation') {
        addFinding(label, 'truncation', `Text truncated in ${of_.element}: "${of_.text}" (scrollW: ${of_.scrollWidth}, clientW: ${of_.clientWidth})`, 'low', fullScreenshot);
      }
    }
    if (overflows.length === 0) console.log('    None found');

    // 3. Check empty sections
    console.log('\n  --- Empty Sections ---');
    const empties = await checkEmptySections(page, name);
    for (const e of empties) {
      addFinding(label, 'empty-section', `Empty container: ${e.element} (${e.width}x${e.height}px)`, 'medium', fullScreenshot);
    }
    if (empties.length === 0) console.log('    None found');

    // 4. Check color consistency
    console.log('\n  --- Color Consistency ---');
    const colorIssues = await checkColorConsistency(page, name);
    for (const ci of colorIssues) {
      addFinding(label, 'color-inconsistency', `Value "${ci.text}" colored ${ci.actual} but expected ${ci.expected} (${ci.color})`, 'medium', fullScreenshot);
    }
    if (colorIssues.length === 0) console.log('    None found');

    // 5. Check overlapping elements
    console.log('\n  --- Overlapping Elements ---');
    const overlaps = await checkOverlapping(page, name);
    for (const ol of overlaps) {
      addFinding(label, 'overlap', `Overlapping interactive elements: ${ol.elementA} and ${ol.elementB} (overlap: ${ol.overlapArea}px^2)`, 'high', fullScreenshot);
    }
    if (overlaps.length === 0) console.log('    None found');

    // 6. Check SVG / canvas charts
    console.log('\n  --- SVG/Chart Issues ---');
    const svgIssues = await checkBrokenSVGCharts(page, name);
    for (const si of svgIssues) {
      if (si.type === 'empty-svg') {
        addFinding(label, 'broken-chart', `Empty SVG chart: ${si.width}x${si.height}px, class="${si.cls}"`, 'high', fullScreenshot);
      } else if (si.type === 'corrupt-path') {
        addFinding(label, 'broken-chart', `Corrupt SVG path data: "${si.pathData}"`, 'critical', fullScreenshot);
      }
    }
    if (svgIssues.length === 0) console.log('    None found');

    // 7. Check z-index issues
    console.log('\n  --- Z-Index Issues ---');
    const zIssues = await checkZIndex(page, name);
    for (const zi of zIssues) {
      addFinding(label, 'z-index', `High z-index element: ${zi.tag}.${zi.cls} (z-index: ${zi.zIndex}, position: ${zi.position})`, 'low', fullScreenshot);
    }
    if (zIssues.length === 0) console.log('    None found');

    // 8. Check table alignment
    console.log('\n  --- Table Alignment ---');
    const tableIssues = await checkTableAlignment(page, name);
    for (const ti of tableIssues) {
      if (ti.type === 'column-mismatch') {
        addFinding(label, 'table-misalignment', `Table column mismatch: header has ${ti.headerColumns} cols, row ${ti.rowIndex} has ${ti.rowColumns} cols`, 'high', fullScreenshot);
      } else if (ti.type === 'table-overflow' || ti.type === 'grid-overflow') {
        addFinding(label, 'table-overflow', `Table/grid overflows container: ${ti.tableWidth || ti.width}px > parent ${ti.parentWidth}px`, 'medium', fullScreenshot);
      }
    }
    if (tableIssues.length === 0) console.log('    None found');

    // 9. Check broken icons
    console.log('\n  --- Broken Icons ---');
    const iconIssues = await checkBrokenIcons(page, name);
    for (const ii of iconIssues) {
      if (ii.type === 'broken-image') {
        addFinding(label, 'broken-icon', `Broken image: src="${ii.src}", alt="${ii.alt}"`, 'high', fullScreenshot);
      } else if (ii.type === 'invisible-icon') {
        addFinding(label, 'broken-icon', `Invisible icon: ${ii.tag}.${ii.cls}`, 'medium', fullScreenshot);
      }
    }
    if (iconIssues.length === 0) console.log('    None found');

    // 10. Console errors
    console.log('\n  --- Console Errors ---');
    if (consoleErrors.length > 0) {
      for (const ce of consoleErrors) {
        addFinding(label, 'console-error', `Console error: ${ce.message}`, 'medium', fullScreenshot);
        allConsoleErrors.push(ce);
      }
    } else {
      console.log('    None found');
    }

    // 11. Cropped section screenshots
    console.log('\n  --- Capturing Key Sections ---');
    const sectionScreenshots = await takeKeyAreaScreenshots(page, name);
    console.log(`    Captured ${sectionScreenshots.length} section screenshots`);

    // 12. Scroll-down to check below-fold content
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    if (pageHeight > 1200) {
      // Scroll to middle
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: join(SCREENSHOT_DIR, `${name}-scrolled-mid.png`),
      });

      // Scroll to bottom
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: join(SCREENSHOT_DIR, `${name}-scrolled-bottom.png`),
      });
    }

  } catch (err) {
    addFinding(label, 'page-error', `Failed to audit page: ${err.message}`, 'critical');
  } finally {
    await context.close();
  }
}

async function main() {
  console.log('Starting Visual Audit of AlphaDesk Trading App');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);

  const browser = await chromium.launch({ headless: true });

  try {
    // Step 1: Login
    const loginContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const loginPage = await loginContext.newPage();
    await login(loginPage);

    // Save storage state for reuse
    global.storageState = await loginContext.storageState();
    await loginContext.close();

    // Step 2: Audit each page
    for (const pageConfig of PAGES) {
      await auditPage(browser, pageConfig);
    }

  } finally {
    await browser.close();
  }

  // Generate findings report
  const report = {
    audit: {
      target: BASE_URL,
      date: new Date().toISOString(),
      viewport: '1920x1080',
      pages: PAGES.map((p) => p.path),
    },
    summary: {
      totalFindings: allFindings.length,
      bySeverity: {
        critical: allFindings.filter((f) => f.severity === 'critical').length,
        high: allFindings.filter((f) => f.severity === 'high').length,
        medium: allFindings.filter((f) => f.severity === 'medium').length,
        low: allFindings.filter((f) => f.severity === 'low').length,
      },
      byCategory: {},
      byPage: {},
    },
    findings: allFindings,
    consoleErrors: allConsoleErrors,
  };

  // Aggregate by category
  for (const f of allFindings) {
    report.summary.byCategory[f.category] = (report.summary.byCategory[f.category] || 0) + 1;
    report.summary.byPage[f.page] = (report.summary.byPage[f.page] || 0) + 1;
  }

  writeFileSync(
    join(SCREENSHOT_DIR, 'findings.json'),
    JSON.stringify(report, null, 2)
  );

  console.log('\n\n' + '='.repeat(60));
  console.log('  VISUAL AUDIT COMPLETE');
  console.log('='.repeat(60));
  console.log(`\nTotal findings: ${allFindings.length}`);
  console.log(`  Critical: ${report.summary.bySeverity.critical}`);
  console.log(`  High:     ${report.summary.bySeverity.high}`);
  console.log(`  Medium:   ${report.summary.bySeverity.medium}`);
  console.log(`  Low:      ${report.summary.bySeverity.low}`);
  console.log(`\nBy Category:`);
  for (const [cat, count] of Object.entries(report.summary.byCategory)) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`\nBy Page:`);
  for (const [pg, count] of Object.entries(report.summary.byPage)) {
    console.log(`  ${pg}: ${count}`);
  }
  console.log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);
  console.log(`Findings saved to: ${join(SCREENSHOT_DIR, 'findings.json')}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
