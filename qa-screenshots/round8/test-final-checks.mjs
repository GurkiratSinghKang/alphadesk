import { chromium } from 'playwright';
const BASE = 'https://tradingalpha.net';
const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round8';

let shotNum = 90;
async function shot(page, name) {
  shotNum++;
  const path = `${DIR}/${String(shotNum).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`SHOT: ${path}`);
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Login
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);
  const inputs = await page.$$('input:not([type="hidden"])');
  await inputs[0].fill('admin');
  await inputs[1].fill('alphaDesk2025!');
  await page.click('button[type="submit"]');
  await sleep(5000);

  // ===== 1. CHART PRICE MISMATCH INVESTIGATION =====
  console.log('\n=== CHART PRICE MISMATCH ===');
  // Load trade page - try until it doesn't crash
  let loaded = false;
  for (let i = 0; i < 5; i++) {
    await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(5000);
    const crashed = await page.evaluate(() => document.body.textContent.includes('Something went wrong'));
    if (!crashed) { loaded = true; break; }
    console.log(`  Trade page crash attempt ${i+1}, retrying...`);
  }

  if (loaded) {
    // The chart header shows "SPY $650.12" - but the chart's last candle and current price are around $682
    // This is suspicious - $650.12 is way off from the $682 range visible in chart
    const priceAnalysis = await page.evaluate(() => {
      const text = document.body.innerText;
      // Find the main header text
      const headerMatch = text.match(/SPY\s+\$(\d+\.\d{2})\s+([+-]?\d+\.\d+)\s*\(([+-]?\d+\.\d+%)\)/);
      // Find current level from key levels
      const currentMatch = text.match(/Current\s+\$(\d+\.\d{2})/);
      // Find bid/ask
      const bidAskMatch = text.match(/(\d{3}\.\d{2})\s*\/\s*(\d{3}\.\d{2})\s+spread/);
      // Find H: L: values
      const hlMatch = text.match(/H:\s*(\d{3}\.\d{2})\s+L:\s*(\d{3}\.\d{2})/);

      return {
        headerLine: headerMatch ? { price: headerMatch[1], change: headerMatch[2], changePct: headerMatch[3] } : null,
        currentLevel: currentMatch ? currentMatch[1] : null,
        bidAsk: bidAskMatch ? { bid: bidAskMatch[1], ask: bidAskMatch[2] } : null,
        highLow: hlMatch ? { high: hlMatch[1], low: hlMatch[2] } : null
      };
    });
    console.log(`Price analysis: ${JSON.stringify(priceAnalysis)}`);

    // Take full trade page shot at higher zoom
    await shot(page, 'trade-full-final');

    // Zoom into chart header specifically
    await page.screenshot({ path: `${DIR}/92-chart-header-closeup.png`, clip: { x: 20, y: 55, width: 700, height: 40 } });
    console.log('SHOT: chart-header-closeup');

    // ===== 2. REGIME LABEL CHECK =====
    console.log('\n=== REGIME LABEL ===');
    const regimeOnTrade = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        const t = el.textContent.trim();
        if (t.startsWith('Regime') && t.length < 50 && el.children.length < 3) {
          return t;
        }
      }
      return null;
    });
    console.log(`Trade page regime: ${regimeOnTrade}`);

    // Check dashboard regime
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(3000);
    const regimeOnDash = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        const t = el.textContent.trim();
        if (t.startsWith('Regime') && t.length < 50 && el.children.length < 3) {
          return t;
        }
      }
      return null;
    });
    console.log(`Dashboard regime: ${regimeOnDash}`);

    // ===== 3. STATUS STRIP - ALL ITEMS =====
    console.log('\n=== STATUS STRIP FULL ANALYSIS ===');
    await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(5000);
    const nocrash = !(await page.evaluate(() => document.body.textContent.includes('Something went wrong')));
    if (nocrash) {
      // Zoom into status strip
      await page.screenshot({ path: `${DIR}/93-status-strip-zoom.png`, clip: { x: 0, y: 42, width: 700, height: 20 } });
      console.log('SHOT: status-strip-zoom');

      const stripFull = await page.evaluate(() => {
        const strip = [];
        // The status strip is typically at y ~45-55px, narrow bar
        const els = Array.from(document.querySelectorAll('*'));
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          if (rect.top >= 40 && rect.top <= 60 && rect.height < 30 && rect.height > 10) {
            const t = el.textContent.trim();
            if (t.length > 0 && t.length < 80 && el.children.length < 3) {
              const s = window.getComputedStyle(el);
              strip.push({ text: t, color: s.color, opacity: s.opacity, fontSize: s.fontSize });
            }
          }
        }
        return strip;
      });
      console.log(`Status strip items: ${JSON.stringify(strip)}`);
    }

    // ===== 4. DASHBOARD - PORTFOLIO VALUE DISPLAYED =====
    console.log('\n=== DASHBOARD HERO VALUES ===');
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(4000);

    // Take zoomed screenshot of the hero section
    await page.screenshot({ path: `${DIR}/94-hero-portfolio.png`, clip: { x: 10, y: 55, width: 500, height: 60 } });
    console.log('SHOT: hero-portfolio');

    const heroValues = await page.evaluate(() => {
      // Find the hero section with PORTFOLIO and DAY P&L labels
      const body = document.body.innerText;
      const portfolioMatch = body.match(/PORTFOLIO\s+(\$[\d,]+\.\d{2})/);
      const dayPnlMatch = body.match(/DAY P&L\s+(-?\$[\d,]+\.\d{2})\s*\((-?\d+\.\d+%)\)/);
      return {
        portfolio: portfolioMatch ? portfolioMatch[1] : null,
        dayPnl: dayPnlMatch ? { value: dayPnlMatch[1], pct: dayPnlMatch[2] } : null,
        rawHero: body.substring(0, 400)
      };
    });
    console.log(`Hero values: ${JSON.stringify(heroValues)}`);

    // ===== 5. STRATEGY CARDS - SCROLL THROUGH ALL =====
    console.log('\n=== ALL STRATEGY CARDS ===');
    // Scroll to strategies section
    await page.evaluate(() => {
      const el = document.querySelector('h2, h3, [class*="heading"]');
      // Find "Strategies" heading
      const els = Array.from(document.querySelectorAll('*'));
      for (const e of els) {
        if (e.textContent.trim() === 'Strategies' || e.textContent.trim().startsWith('Strategies')) {
          e.scrollIntoView();
          break;
        }
      }
    });
    await sleep(1000);

    // Take wide screenshot of strategy cards area
    await page.screenshot({ path: `${DIR}/95-strategies-all.png`, clip: { x: 690, y: 60, width: 750, height: 700 } });
    console.log('SHOT: strategies-all');

    // Scroll more to see remaining cards
    await page.evaluate(() => window.scrollBy(0, 500));
    await sleep(500);
    await page.screenshot({ path: `${DIR}/96-strategies-more.png`, clip: { x: 690, y: 60, width: 750, height: 700 } });
    console.log('SHOT: strategies-more');

    // ===== 6. P&L CALENDAR DETAIL =====
    console.log('\n=== P&L CALENDAR ===');
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    // Find the calendar section
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      for (const e of els) {
        if (e.textContent.trim().startsWith('April P&L') || e.textContent.trim().includes('P&L') && e.textContent.includes('April')) {
          e.scrollIntoView();
          break;
        }
      }
    });
    await sleep(500);
    await shot(page, 'pnl-calendar');

    // ===== 7. OPEN POSITIONS TABLE =====
    console.log('\n=== OPEN POSITIONS ===');
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      for (const e of els) {
        if (e.textContent.trim() === 'Open Positions') {
          e.scrollIntoView();
          break;
        }
      }
    });
    await sleep(500);
    await shot(page, 'open-positions');

    const positionsData = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      const results = [];
      tables.forEach(t => {
        const text = t.textContent.trim();
        if (text.includes('MRK') || text.includes('Symbol') || text.includes('Qty')) {
          results.push(text.substring(0, 300));
        }
      });
      return results;
    });
    console.log(`Positions tables: ${JSON.stringify(positionsData)}`);

    // ===== 8. NEWS/ACTIVITY SECTION =====
    console.log('\n=== NEWS SECTION ===');
    await page.evaluate(() => window.scrollTo(0, 9999));
    await sleep(500);
    await shot(page, 'news-section');

    // ===== 9. ECONOMIC CALENDAR & SECTOR PERFORMANCE =====
    console.log('\n=== ECONOMIC CALENDAR & SECTOR HEATMAP ===');
    const econContent = await page.evaluate(() => {
      const body = document.body.textContent;
      const econStart = body.indexOf('Economic Calendar');
      const econSnippet = econStart >= 0 ? body.substring(econStart, econStart + 400) : 'NOT FOUND';

      const sectorStart = body.indexOf('Sector Performance');
      const sectorSnippet = sectorStart >= 0 ? body.substring(sectorStart, sectorStart + 300) : 'NOT FOUND';

      return { econSnippet, sectorSnippet };
    });
    console.log(`Econ Calendar: ${econContent.econSnippet.substring(0, 200)}`);
    console.log(`Sector Perf: ${econContent.sectorSnippet.substring(0, 200)}`);

    // ===== 10. PORTFOLIO CONSISTENCY: HERO vs PROFILE vs STATUS =====
    console.log('\n=== PORTFOLIO CONSISTENCY FINAL ===');
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(3000);

    // Get hero value
    const heroPort = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/PORTFOLIO\s+(\$[\d,]+\.\d{2})/);
      return match ? match[1] : null;
    });

    // Get status strip P&L
    const stripPnl = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        const t = el.textContent.trim();
        if (/^P&L/.test(t) && t.length < 60) return t;
      }
      return null;
    });

    // Open profile menu to get portfolio from there
    const avatarBtns = await page.$$('button');
    for (const btn of avatarBtns) {
      const rect = await btn.boundingBox();
      if (rect && rect.x > 1380 && rect.y < 50) {
        await btn.click();
        await sleep(1500);
        break;
      }
    }
    const menuPort = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/Equity\s*(\$[\d,]+\.\d{2})/);
      return match ? match[1] : null;
    });

    console.log(`  Hero PORTFOLIO: ${heroPort}`);
    console.log(`  Status strip: ${stripPnl}`);
    console.log(`  Profile menu Equity: ${menuPort}`);

    // Check consistency
    if (heroPort && menuPort) {
      const heroVal = parseFloat(heroPort.replace(/[$,]/g, ''));
      const menuVal = parseFloat(menuPort.replace(/[$,]/g, ''));
      const diff = Math.abs(heroVal - menuVal);
      console.log(`  Difference: $${diff.toFixed(2)} (${diff < 1 ? 'CONSISTENT' : diff < 100 ? 'CLOSE - possible timing' : 'MISMATCH'})`);
    }
  }

  await browser.close();
  console.log('\n=== FINAL CHECKS COMPLETE ===');
})();
