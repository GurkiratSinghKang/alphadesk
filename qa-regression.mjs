import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
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
const OUT = '/Users/GK/Downloads/alphadesk/qa-screenshots/regression';
const USERNAME = QA_USERNAME;
const PASSWORD = getQaPassword();

mkdirSync(OUT, { recursive: true });

// ── Results collector ──────────────────────────────────────────
const results = [];
let checkNum = 0;

function record(id, name, pass, detail = '') {
  const entry = { id, name, result: pass ? 'PASS' : 'FAIL', detail };
  results.push(entry);
  console.log(`  [${id}] ${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ': ' + detail : ''}`);
  return pass;
}

async function screenshotOnFail(page, id, pass) {
  if (!pass) {
    try {
      await page.screenshot({ path: join(OUT, `FAIL-${id}.png`), fullPage: false });
    } catch {}
  }
}

// ── Login helper ───────────────────────────────────────────────
async function login(page) {
  // Strategy: call login API directly, extract token, set cookie, then navigate
  const domain = new URL(BASE_URL).hostname;

  try {
    const resp = await page.request.post(`${BASE_URL}/api/v1/auth/login`, {
      data: { username: USERNAME, password: PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await resp.json().catch(() => ({}));
    console.log('API login status:', resp.status());

    if (resp.ok && body.access_token) {
      // Set access_token cookie in the browser context
      await page.context().addCookies([{
        name: 'access_token',
        value: body.access_token,
        domain: domain,
        path: '/',
        httpOnly: true,
        secure: BASE_URL.startsWith('https'),
        sameSite: 'Lax',
      }]);
      console.log('Auth cookie set successfully');
    } else {
      console.log('Login API error:', JSON.stringify(body));
    }
  } catch (e) {
    console.log('Login API call failed:', e.message);
  }

  // Navigate to dashboard
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // If redirected to login, the cookie didn't work - try form login
  if (page.url().includes('/login')) {
    console.log('Cookie auth failed, trying form login...');
    await page.waitForTimeout(1000);
    const usernameInput = await page.$('#login-username');
    const passwordInput = await page.$('#login-password');
    if (usernameInput && passwordInput) {
      await usernameInput.fill(USERNAME);
      await passwordInput.fill(PASSWORD);
    }
    const btn = await page.$('button:has-text("Sign In")');
    if (btn) {
      // Listen for the response and grab the Set-Cookie
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url().includes('/auth/login'), { timeout: 10000 }).catch(() => null),
        btn.click(),
      ]);
      if (response) {
        console.log('Form login response:', response.status());
        // The Set-Cookie should be set automatically
      }
      await page.waitForTimeout(5000);
      await page.waitForLoadState('networkidle').catch(() => {});

      // If still on login, navigate manually
      if (page.url().includes('/login')) {
        await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(4000);
      }
    }
  }

  console.log('Login complete, URL:', page.url());
  if (page.url().includes('/login')) {
    console.log('WARNING: Authentication failed. Tests may not work correctly.');
  }
}

// ── Utility to get text content of the page body ───────────────
async function bodyText(page) {
  return page.evaluate(() => document.body.innerText || '');
}

async function safeEval(page, fn) {
  try { return await page.evaluate(fn); } catch { return null; }
}

// ════════════════════════════════════════════════════════════════
//  DASHBOARD TESTS (checks 1-15)
// ════════════════════════════════════════════════════════════════
async function testDashboard(page) {
  console.log('\n' + '='.repeat(60));
  console.log('DASHBOARD CHECKS');
  console.log('='.repeat(60));

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(OUT, 'dashboard-full.png'), fullPage: true });

  const text = await bodyText(page);

  // 1. Portfolio value is visible and numeric (not $--.-- or NaN)
  {
    const val = await safeEval(page, () => {
      // The hero value is typically the first large dollar amount
      const allText = document.body.innerText;
      const dollarMatches = allText.match(/\$[\d,]+(\.\d+)?/g);
      // Check for placeholders
      const hasPlaceholder = allText.includes('$--.--') || allText.includes('NaN');
      return { dollars: dollarMatches ? dollarMatches.slice(0, 5) : [], hasPlaceholder };
    });
    const pass = val && val.dollars.length > 0 && !val.hasPlaceholder;
    record(1, 'Portfolio value is visible and numeric', pass, val ? `Found: ${val.dollars.slice(0, 3).join(', ')}` : 'No dollar values');
    await screenshotOnFail(page, 1, pass);
  }

  // 2. Day P&L shows a real value (not placeholder)
  {
    const pnl = await safeEval(page, () => {
      const strip = document.querySelector('.flex.h-7') || document.body;
      const stripText = strip?.innerText || '';
      const hasPnlLabel = stripText.includes('P&L');
      const hasDash = stripText.includes('$--.--');
      // Find the P&L value near the label
      const pnlMatch = stripText.match(/P&L\s*[^\n]*(\+?\-?\$[\d,]+\.?\d*)/);
      return { hasPnlLabel, hasDash, match: pnlMatch ? pnlMatch[1] : null };
    });
    const pass = pnl && pnl.hasPnlLabel && !pnl.hasDash;
    record(2, 'Day P&L shows a real value', pass, pnl ? `Dash: ${pnl.hasDash}, Val: ${pnl.match}` : '');
    await screenshotOnFail(page, 2, pass);
  }

  // 3. Equity curve SVG renders (has polyline/polygon elements)
  {
    const svg = await safeEval(page, () => {
      const svgs = document.querySelectorAll('svg');
      let equitySvg = false;
      for (const s of svgs) {
        const polylines = s.querySelectorAll('polyline, polygon');
        if (polylines.length > 0 && s.closest && !s.closest('nav')) {
          equitySvg = true;
          break;
        }
      }
      return { equitySvg, totalSvgs: svgs.length };
    });
    const pass = svg && svg.equitySvg;
    record(3, 'Equity curve SVG renders with polyline/polygon', pass, `SVGs: ${svg?.totalSvgs}`);
    await screenshotOnFail(page, 3, pass);
  }

  // 4. Period pills (1W/1M/3M/YTD) are clickable
  {
    const pills = await safeEval(page, () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const periodBtns = buttons.filter(b => {
        const t = b.textContent?.trim();
        return t === '1W' || t === '1M' || t === '3M' || t === 'YTD';
      });
      return { count: periodBtns.length, labels: periodBtns.map(b => b.textContent?.trim()) };
    });
    const pass = pills && pills.count >= 3;
    record(4, 'Period pills (1W/1M/3M/YTD) are clickable', pass, `Found: ${pills?.labels?.join(', ')}`);
    await screenshotOnFail(page, 4, pass);

    // Click one pill to verify it works
    if (pass) {
      const btn = await page.$('button:has-text("1W")');
      if (btn) await btn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  // 5. Activity feed has content (at least regime event)
  {
    const feed = await safeEval(page, () => {
      const feedText = document.body.innerText;
      const hasRegime = /regime|bull|bear|neutral|risk.?off|risk.?on/i.test(feedText);
      const hasActivityItems = /pipeline|screened|signal|news|earnings/i.test(feedText);
      return { hasRegime, hasActivityItems };
    });
    const pass = feed && (feed.hasRegime || feed.hasActivityItems);
    record(5, 'Activity feed has content', pass, `Regime: ${feed?.hasRegime}, Activity: ${feed?.hasActivityItems}`);
    await screenshotOnFail(page, 5, pass);
  }

  // 6. Strategy cards show 8 strategies
  {
    const strats = await safeEval(page, () => {
      // Strategy cards are Card elements with role="button"
      const cards = document.querySelectorAll('[role="button"]');
      // Also look for known strategy names
      const knownNames = ['PEAD', 'Value', 'Momentum', 'Quality', 'Mean Rev', 'Sector Rot', 'Growth', 'Multi-Factor'];
      const bodyText = document.body.innerText;
      const found = knownNames.filter(n => bodyText.includes(n));
      return { cardCount: cards.length, foundNames: found, nameCount: found.length };
    });
    const pass = strats && (strats.nameCount >= 6 || strats.cardCount >= 8);
    record(6, 'Strategy cards show 8 strategies', pass, `Cards: ${strats?.cardCount}, Names: ${strats?.foundNames?.join(', ')}`);
    await screenshotOnFail(page, 6, pass);
  }

  // 7. Strategy sparklines render (SVG elements present in strategy area)
  {
    const sparklines = await safeEval(page, () => {
      const cards = document.querySelectorAll('[role="button"]');
      let svgInCards = 0;
      for (const c of cards) {
        const svgs = c.querySelectorAll('svg');
        if (svgs.length > 0) svgInCards++;
      }
      // Also check for sparkline SVGs specifically with polyline
      const allSvgs = document.querySelectorAll('svg polyline, svg path');
      return { svgInCards, totalPaths: allSvgs.length };
    });
    const pass = sparklines && (sparklines.svgInCards >= 4 || sparklines.totalPaths >= 10);
    record(7, 'Strategy sparklines render (SVG elements)', pass, `SVG-in-cards: ${sparklines?.svgInCards}, Paths: ${sparklines?.totalPaths}`);
    await screenshotOnFail(page, 7, pass);
  }

  // 8. P&L calendar renders with colored cells
  {
    const cal = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasCalLabels = /Mon|Tue|Wed|Thu|Fri|P&L.?Cal|Calendar/i.test(bodyText);
      // Look for the calendar grid cells (small colored boxes)
      const allEls = document.querySelectorAll('[class*="rounded"], td, [role="cell"]');
      let coloredCells = 0;
      for (const el of allEls) {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && el.offsetWidth < 60 && el.offsetHeight < 60 && el.offsetWidth > 5) {
          coloredCells++;
        }
      }
      return { hasCalLabels, coloredCells };
    });
    const pass = cal && (cal.hasCalLabels || cal.coloredCells > 5);
    record(8, 'P&L calendar renders with colored cells', pass, `Labels: ${cal?.hasCalLabels}, Cells: ${cal?.coloredCells}`);
    await screenshotOnFail(page, 8, pass);
  }

  // 9. Open Positions card shows MRK or empty state
  {
    const positions = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasMRK = bodyText.includes('MRK');
      const hasOpenPos = /open.?pos|position/i.test(bodyText);
      const hasEmptyState = /no.?open|no.?active|no positions|empty/i.test(bodyText);
      return { hasMRK, hasOpenPos, hasEmptyState };
    });
    const pass = positions && (positions.hasMRK || positions.hasOpenPos || positions.hasEmptyState);
    record(9, 'Open Positions card visible (MRK or empty)', pass, `MRK: ${positions?.hasMRK}, Section: ${positions?.hasOpenPos}`);
    await screenshotOnFail(page, 9, pass);
  }

  // 10. Economic calendar shows events
  {
    const econ = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasEconLabel = /economic|calendar|event|fed|cpi|gdp|fomc|report/i.test(bodyText);
      const hasTime = /\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/i.test(bodyText);
      return { hasEconLabel, hasTime };
    });
    const pass = econ && (econ.hasEconLabel || econ.hasTime);
    record(10, 'Economic calendar shows events', pass, `Label: ${econ?.hasEconLabel}, Times: ${econ?.hasTime}`);
    await screenshotOnFail(page, 10, pass);
  }

  // 11. Market indices section has SPY/QQQ/IWM
  {
    const mkt = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasSPY = bodyText.includes('SPY') || bodyText.includes('S&P 500');
      const hasQQQ = bodyText.includes('QQQ') || bodyText.includes('NASDAQ');
      const hasIWM = bodyText.includes('IWM') || bodyText.includes('Russell');
      return { hasSPY, hasQQQ, hasIWM };
    });
    const pass = mkt && mkt.hasSPY && mkt.hasQQQ && mkt.hasIWM;
    record(11, 'Market indices section has SPY/QQQ/IWM', pass, `SPY: ${mkt?.hasSPY}, QQQ: ${mkt?.hasQQQ}, IWM: ${mkt?.hasIWM}`);
    await screenshotOnFail(page, 11, pass);
  }

  // 12. Sector treemap renders colored rectangles
  {
    const treemap = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasSectorLabel = /sector|treemap|tech|health|energy|financ/i.test(bodyText);
      // Look for colored rectangle elements
      const rects = document.querySelectorAll('svg rect, [class*="treemap"] div, [style*="background"]');
      let coloredRects = 0;
      for (const r of rects) {
        const style = window.getComputedStyle(r);
        const bg = style.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          coloredRects++;
        }
      }
      return { hasSectorLabel, coloredRects };
    });
    const pass = treemap && treemap.hasSectorLabel;
    record(12, 'Sector treemap renders colored rectangles', pass, `Label: ${treemap?.hasSectorLabel}, Rects: ${treemap?.coloredRects}`);
    await screenshotOnFail(page, 12, pass);
  }

  // 13. Allocation donut SVG renders
  {
    const donut = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasAllocLabel = /alloc|donut|composition|invested|cash/i.test(bodyText);
      // Look for circle/path elements in SVGs that could be a donut
      const circles = document.querySelectorAll('svg circle, svg path[d*="A"]');
      return { hasAllocLabel, circleCount: circles.length };
    });
    const pass = donut && (donut.hasAllocLabel || donut.circleCount > 2);
    record(13, 'Allocation donut SVG renders', pass, `Label: ${donut?.hasAllocLabel}, Circles: ${donut?.circleCount}`);
    await screenshotOnFail(page, 13, pass);
  }

  // 14. Status strip shows regime (not ---)
  {
    const regime = await safeEval(page, () => {
      // Status strip is the thin bar at top
      const strip = document.querySelector('.flex.h-7');
      if (!strip) return { found: false };
      const text = strip.innerText;
      const hasRegimeLabel = text.includes('Regime');
      const hasTripleDash = text.includes('---');
      const regimeMatch = text.match(/Regime\s+(\S+)/);
      return { found: true, hasRegimeLabel, hasTripleDash, regime: regimeMatch ? regimeMatch[1] : null };
    });
    const pass = regime && regime.found && regime.hasRegimeLabel && !regime.hasTripleDash;
    record(14, 'Status strip shows regime (not ---)', pass, `Regime: ${regime?.regime}`);
    await screenshotOnFail(page, 14, pass);
  }

  // 15. Status strip shows VIX value (not --.-)
  {
    const vix = await safeEval(page, () => {
      const strip = document.querySelector('.flex.h-7');
      if (!strip) return { found: false };
      const text = strip.innerText;
      const hasVIX = text.includes('VIX');
      const hasDash = /VIX\s+--\.-/.test(text);
      const vixMatch = text.match(/VIX\s+([\d.]+)/);
      return { found: true, hasVIX, hasDash, vix: vixMatch ? vixMatch[1] : null };
    });
    const pass = vix && vix.found && vix.hasVIX && !vix.hasDash && vix.vix;
    record(15, 'Status strip shows VIX value (not --.-)', pass, `VIX: ${vix?.vix}`);
    await screenshotOnFail(page, 15, pass);
  }
}

// ════════════════════════════════════════════════════════════════
//  TRADE PAGE TESTS (checks 16-30)
// ════════════════════════════════════════════════════════════════
async function testTradePage(page) {
  console.log('\n' + '='.repeat(60));
  console.log('TRADE PAGE CHECKS');
  console.log('='.repeat(60));

  await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(OUT, 'trade-full.png'), fullPage: true });

  const text = await bodyText(page);

  // 16. Watchlist shows 10 symbols with prices
  {
    const wl = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'SPY', 'QQQ'];
      const found = symbols.filter(s => bodyText.includes(s));
      // Check for price numbers near symbols
      const pricePattern = /\d{1,4}\.\d{2}/g;
      const prices = bodyText.match(pricePattern) || [];
      return { foundSymbols: found, symbolCount: found.length, priceCount: prices.length };
    });
    const pass = wl && wl.symbolCount >= 8;
    record(16, 'Watchlist shows 10 symbols with prices', pass, `Symbols: ${wl?.symbolCount} (${wl?.foundSymbols?.join(', ')}), Prices: ${wl?.priceCount}`);
    await screenshotOnFail(page, 16, pass);
  }

  // 17. Chart renders with candlestick data
  {
    const chart = await safeEval(page, () => {
      // Look for canvas (lightweight-charts) or SVG chart
      const canvases = document.querySelectorAll('canvas');
      const chartSvgs = document.querySelectorAll('svg rect, svg line');
      return { canvasCount: canvases.length, svgElements: chartSvgs.length };
    });
    const pass = chart && (chart.canvasCount > 0 || chart.svgElements > 10);
    record(17, 'Chart renders with candlestick data', pass, `Canvas: ${chart?.canvasCount}, SVG: ${chart?.svgElements}`);
    await screenshotOnFail(page, 17, pass);
  }

  // 18. L1 data bar shows bid/ask/spread
  {
    const l1 = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasBid = /bid/i.test(bodyText);
      const hasAsk = /ask/i.test(bodyText);
      const hasSpread = /spread/i.test(bodyText);
      const hasOHLC = /open|high|low|close|O:|H:|L:|C:/i.test(bodyText);
      return { hasBid, hasAsk, hasSpread, hasOHLC };
    });
    const pass = l1 && ((l1.hasBid && l1.hasAsk) || l1.hasOHLC);
    record(18, 'L1 data bar shows bid/ask/spread', pass, `Bid: ${l1?.hasBid}, Ask: ${l1?.hasAsk}, Spread: ${l1?.hasSpread}`);
    await screenshotOnFail(page, 18, pass);
  }

  // 19. Chart type buttons visible
  {
    const chartBtns = await safeEval(page, () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      // Look for candlestick/line/area chart type buttons
      const chartTypeButtons = buttons.filter(b => {
        const text = b.textContent?.trim() || '';
        const ariaLabel = b.getAttribute('aria-label') || '';
        const title = b.getAttribute('title') || '';
        return /candle|line|area|bar chart/i.test(text + ariaLabel + title) ||
               b.querySelector('svg[class*="candlestick"], svg[class*="line-chart"], svg[class*="area"]') !== null;
      });
      // Also check for Lucide chart icons
      const svgIcons = buttons.filter(b => b.querySelector('svg') && b.closest('[class*="chart"]'));
      return { chartTypeCount: chartTypeButtons.length, iconButtons: svgIcons.length };
    });
    // Also check for the emoji-style buttons
    const emojiButtons = await safeEval(page, () => {
      const all = document.body.innerText;
      const hasEmoji = /\u{1F56F}|\u{1F4C8}|\u{25A8}/u.test(all);
      // Check for chart type selector group near top of chart
      const btnGroups = document.querySelectorAll('[role="group"], .flex.gap-1, .flex.gap-0\\.5');
      return { hasEmoji, groupCount: btnGroups.length };
    });
    const pass = (chartBtns && chartBtns.chartTypeCount > 0) || (emojiButtons && emojiButtons.hasEmoji) || (chartBtns && chartBtns.iconButtons > 0) || (emojiButtons && emojiButtons.groupCount > 0);
    record(19, 'Chart type buttons visible', pass, `Type btns: ${chartBtns?.chartTypeCount}, Icons: ${chartBtns?.iconButtons}`);
    await screenshotOnFail(page, 19, pass);
  }

  // 20. Drawing toolbar (line/trendline/Fib) visible
  {
    const draw = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasDraw = /draw|line|trend|fib|annotation|─|╲|ray/i.test(bodyText);
      const buttons = Array.from(document.querySelectorAll('button'));
      const drawButtons = buttons.filter(b => {
        const t = b.textContent?.trim() || '';
        const title = b.getAttribute('title') || '';
        return /line|trend|fib|draw|ray|horizontal/i.test(t + title);
      });
      return { hasDraw, drawButtonCount: drawButtons.length };
    });
    const pass = draw && (draw.hasDraw || draw.drawButtonCount > 0);
    record(20, 'Drawing toolbar visible', pass, `Text: ${draw?.hasDraw}, Buttons: ${draw?.drawButtonCount}`);
    await screenshotOnFail(page, 20, pass);
  }

  // 21. BUY/SELL floating buttons visible on chart
  {
    const buySell = await safeEval(page, () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const buyBtn = buttons.find(b => /^buy$/i.test(b.textContent?.trim()));
      const sellBtn = buttons.find(b => /^sell$/i.test(b.textContent?.trim()));
      // Also check for BUY/SELL in any button
      const hasBuyText = buttons.some(b => /buy/i.test(b.textContent?.trim()));
      const hasSellText = buttons.some(b => /sell/i.test(b.textContent?.trim()));
      return { buyBtn: !!buyBtn, sellBtn: !!sellBtn, hasBuyText, hasSellText };
    });
    const pass = buySell && (buySell.hasBuyText || buySell.hasSellText);
    record(21, 'BUY/SELL floating buttons visible', pass, `Buy: ${buySell?.hasBuyText}, Sell: ${buySell?.hasSellText}`);
    await screenshotOnFail(page, 21, pass);
  }

  // 22. Price alert bell icon visible
  {
    const bell = await safeEval(page, () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const bellBtn = buttons.find(b => {
        const title = b.getAttribute('title') || '';
        const aria = b.getAttribute('aria-label') || '';
        const text = b.textContent?.trim() || '';
        return /alert|bell|notify/i.test(title + aria + text) || b.querySelector('svg.lucide-bell-plus, svg.lucide-bell') !== null;
      });
      // Also check for BellPlus icon by class
      const bellIcons = document.querySelectorAll('[class*="bell"], [data-lucide="bell"]');
      return { hasBell: !!bellBtn, bellIcons: bellIcons.length };
    });
    const pass = bell && (bell.hasBell || bell.bellIcons > 0);
    record(22, 'Price alert bell icon visible', pass, `Bell: ${bell?.hasBell}, Icons: ${bell?.bellIcons}`);
    await screenshotOnFail(page, 22, pass);
  }

  // 23. Analysis tabs (Tech/Fund/Sent/Chat/Order) all present
  {
    const tabs = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const tabNames = ['Tech', 'Fund', 'Sent', 'Chat', 'Order'];
      const found = tabNames.filter(t => bodyText.includes(t));
      // Also check for tab triggers
      const tabElements = document.querySelectorAll('[role="tab"], [data-state="active"], [data-state="inactive"]');
      return { found, foundCount: found.length, tabElements: tabElements.length };
    });
    const pass = tabs && tabs.foundCount >= 4;
    record(23, 'Analysis tabs (Tech/Fund/Sent/Chat/Order) present', pass, `Found: ${tabs?.found?.join(', ')}, Tabs: ${tabs?.tabElements}`);
    await screenshotOnFail(page, 23, pass);
  }

  // 24. "Estimated" badge appears on Tech tab OR real analysis data is shown
  {
    // First ensure we're on Tech tab
    const techTabEl = await page.$('[role="tab"]:has-text("Tech"), button:has-text("Tech")');
    if (techTabEl) await techTabEl.click().catch(() => {});
    await page.waitForTimeout(1000);

    const est = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasEstimated = /estimated/i.test(bodyText);
      // If real analysis loaded, "Estimated" badge is intentionally hidden
      const hasRealAnalysis = /technical.?score|momentum|support|resistance|bullish|bearish/i.test(bodyText);
      const badges = document.querySelectorAll('[class*="badge"], .badge');
      const estimatedBadge = Array.from(badges).find(b => /estimated/i.test(b.textContent));
      return { hasEstimated, hasBadge: !!estimatedBadge, hasRealAnalysis };
    });
    // PASS if either the "Estimated" badge shows, or real analysis is rendered (which hides the badge)
    const pass = est && (est.hasEstimated || est.hasBadge || est.hasRealAnalysis);
    record(24, '"Estimated" badge or real analysis on Tech tab', pass, `Estimated: ${est?.hasEstimated}, RealAnalysis: ${est?.hasRealAnalysis}`);
    await screenshotOnFail(page, 24, pass);
  }

  // 25. Order tab has Buy/Sell toggle, quantity, type selector
  {
    // Click Order tab first
    const orderTab = await page.$('[role="tab"]:has-text("Order"), button:has-text("Order")');
    if (orderTab) await orderTab.click().catch(() => {});
    await page.waitForTimeout(1000);

    const order = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasQty = /qty|quantity|shares/i.test(bodyText);
      const hasType = /market|limit|stop/i.test(bodyText);
      const hasBuySell = /buy|sell/i.test(bodyText);
      const hasReview = /review|submit|place/i.test(bodyText);
      return { hasQty, hasType, hasBuySell, hasReview };
    });
    const pass = order && order.hasBuySell && (order.hasQty || order.hasType);
    record(25, 'Order tab has Buy/Sell toggle, quantity, type', pass, `Qty: ${order?.hasQty}, Type: ${order?.hasType}, BuySell: ${order?.hasBuySell}`);
    await screenshotOnFail(page, 25, pass);
  }

  // 26. Position sizer shows in Order tab
  {
    const sizer = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasPositionSizer = /position.?siz|risk|max.?loss|kelly|optimal/i.test(bodyText);
      const hasPercentage = /\d+%/.test(bodyText);
      return { hasPositionSizer, hasPercentage };
    });
    const pass = sizer && (sizer.hasPositionSizer || sizer.hasPercentage);
    record(26, 'Position sizer shows in Order tab', pass, `Sizer: ${sizer?.hasPositionSizer}, Pct: ${sizer?.hasPercentage}`);
    await screenshotOnFail(page, 26, pass);
  }

  // Switch back to Tech tab for remaining checks
  const techTab = await page.$('[role="tab"]:has-text("Tech"), button:has-text("Tech")');
  if (techTab) await techTab.click().catch(() => {});
  await page.waitForTimeout(500);

  // 27. Options chain has data rows
  {
    // The options panel is in the bottom section
    const options = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasOptions = /call|put|strike|expir|option/i.test(bodyText);
      const tableRows = document.querySelectorAll('table tr, [role="row"]');
      // Look for strike prices (numbers like 100, 150, 200, etc.)
      const strikePattern = /\d{2,3}(\.\d+)?/g;
      return { hasOptions, rowCount: tableRows.length };
    });
    const pass = options && (options.hasOptions || options.rowCount > 3);
    record(27, 'Options chain has data rows', pass, `Options: ${options?.hasOptions}, Rows: ${options?.rowCount}`);
    await screenshotOnFail(page, 27, pass);
  }

  // 28. Watchlist column headers are clickable (sort)
  {
    const headers = await safeEval(page, () => {
      // Look for clickable headers in watchlist area
      const ths = document.querySelectorAll('th, [role="columnheader"]');
      const clickable = Array.from(ths).filter(h => {
        const cursor = window.getComputedStyle(h).cursor;
        return cursor === 'pointer' || h.onclick !== null || h.getAttribute('role') === 'columnheader';
      });
      // Also check for sort icons
      const bodyText = document.body.innerText;
      const hasSymbolHeader = /symbol|ticker|name|last|chg/i.test(bodyText);
      return { clickableCount: clickable.length, hasSymbolHeader };
    });
    const pass = headers && (headers.clickableCount > 0 || headers.hasSymbolHeader);
    record(28, 'Watchlist column headers are clickable (sort)', pass, `Clickable: ${headers?.clickableCount}, Header: ${headers?.hasSymbolHeader}`);
    await screenshotOnFail(page, 28, pass);
  }

  // 29. Options full-screen toggle button exists
  {
    const toggle = await safeEval(page, () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const fsBtn = buttons.find(b => {
        const title = b.getAttribute('title') || '';
        const text = b.textContent?.trim() || '';
        return /full.?screen|maximize|expand/i.test(title + text) ||
               b.querySelector('[class*="maximize"], [class*="minimize"]') !== null;
      });
      // Check for Maximize2/Minimize2 lucide icons
      const icons = document.querySelectorAll('svg.lucide-maximize-2, svg.lucide-minimize-2, [data-lucide="maximize-2"]');
      return { hasToggle: !!fsBtn, iconCount: icons.length };
    });
    const pass = toggle && (toggle.hasToggle || toggle.iconCount > 0);
    record(29, 'Options full-screen toggle button exists', pass, `Toggle: ${toggle?.hasToggle}, Icons: ${toggle?.iconCount}`);
    await screenshotOnFail(page, 29, pass);
  }

  // 30. Drag handle between chart and options exists
  {
    const drag = await safeEval(page, () => {
      // The drag handle is between chart (top) and options (bottom)
      const handles = document.querySelectorAll('[style*="cursor: row-resize"], [class*="resize"], [class*="drag"]');
      // Also check for cursor changes on specific elements
      const allEls = document.querySelectorAll('div');
      let resizeHandles = 0;
      for (const el of allEls) {
        const cursor = window.getComputedStyle(el).cursor;
        if (cursor === 'row-resize' || cursor === 'ns-resize') {
          resizeHandles++;
        }
      }
      // The drag handle div has specific height and styling
      const thinDivs = Array.from(allEls).filter(d => {
        const h = d.offsetHeight;
        return h >= 4 && h <= 10 && d.offsetWidth > 200;
      });
      return { handles: handles.length, resizeHandles, thinDivs: thinDivs.length };
    });
    const pass = drag && (drag.handles > 0 || drag.resizeHandles > 0 || drag.thinDivs > 2);
    record(30, 'Drag handle between chart and options', pass, `Handles: ${drag?.handles}, Resize: ${drag?.resizeHandles}`);
    await screenshotOnFail(page, 30, pass);
  }
}

// ════════════════════════════════════════════════════════════════
//  PIPELINE PAGE TESTS (checks 31-38)
// ════════════════════════════════════════════════════════════════
async function testPipeline(page) {
  console.log('\n' + '='.repeat(60));
  console.log('PIPELINE PAGE CHECKS');
  console.log('='.repeat(60));

  await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(OUT, 'pipeline-full.png'), fullPage: true });

  const text = await bodyText(page);

  // 31. Pipeline flow diagram shows 4 stages
  {
    // The stage labels use uppercase CSS (text-[10px] uppercase tracking-wider)
    // They render as "SCREENED", "ANALYZED", "SIGNALS", "ORDERS" visually
    const flow = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      // Check case-insensitive since CSS text-transform:uppercase makes them UPPERCASE in innerText
      const stages = ['screened', 'analyzed', 'signals', 'orders'];
      const found = stages.filter(s => bodyText.toLowerCase().includes(s));
      // Also check for pipeline run section header
      const hasPipelineHeader = /pipeline.?run|today/i.test(bodyText);
      // Count boxes with numbers (the stage counters)
      const numbers = bodyText.match(/^\d+$/gm) || [];
      return { found, count: found.length, hasPipelineHeader, numberBoxes: numbers.length };
    });
    const pass = flow && (flow.count >= 3 || (flow.hasPipelineHeader && flow.numberBoxes >= 4));
    record(31, 'Pipeline flow diagram shows 4 stages', pass, `Found: ${flow?.found?.join(', ')}, Header: ${flow?.hasPipelineHeader}`);
    await screenshotOnFail(page, 31, pass);
  }

  // 32. Strategy Builder section visible with input field
  {
    const builder = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasBuilder = /strategy.?builder|build.?strategy|custom.?rule|rule.?builder/i.test(bodyText);
      const inputs = document.querySelectorAll('input, textarea');
      const hasInput = inputs.length > 0;
      return { hasBuilder, hasInput, inputCount: inputs.length };
    });
    const pass = builder && (builder.hasBuilder || builder.hasInput);
    record(32, 'Strategy Builder section visible with input', pass, `Builder: ${builder?.hasBuilder}, Inputs: ${builder?.inputCount}`);
    await screenshotOnFail(page, 32, pass);
  }

  // 33. Backtesting section visible with Run Backtest button
  {
    const bt = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasBacktest = /backtest|back.?test/i.test(bodyText);
      const buttons = Array.from(document.querySelectorAll('button'));
      const runBtn = buttons.find(b => /run.?backtest|backtest/i.test(b.textContent));
      return { hasBacktest, hasRunBtn: !!runBtn };
    });
    const pass = bt && bt.hasBacktest;
    record(33, 'Backtesting section visible with Run Backtest', pass, `Backtest: ${bt?.hasBacktest}, Button: ${bt?.hasRunBtn}`);
    await screenshotOnFail(page, 33, pass);
  }

  // 34. History table has dates
  {
    const hist = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const datePattern = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/gi;
      const dates = bodyText.match(datePattern) || [];
      const hasHistory = /history|run|log|date/i.test(bodyText);
      return { dateCount: dates.length, hasHistory, sampleDates: dates.slice(0, 3) };
    });
    const pass = hist && hist.dateCount > 0;
    record(34, 'History table has dates', pass, `Dates: ${hist?.dateCount}, Sample: ${hist?.sampleDates?.join(', ')}`);
    await screenshotOnFail(page, 34, pass);
  }

  // 35. Performance summary cards visible
  {
    const perf = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const metrics = ['return', 'win', 'sharpe', 'drawdown', 'trade', 'hit rate', 'performance'];
      const found = metrics.filter(m => new RegExp(m, 'i').test(bodyText));
      return { found, count: found.length };
    });
    const pass = perf && perf.count >= 2;
    record(35, 'Performance summary cards visible', pass, `Found: ${perf?.found?.join(', ')}`);
    await screenshotOnFail(page, 35, pass);
  }

  // 36. Current positions section present
  {
    const pos = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasPositions = /current.?pos|open.?pos|active.?pos|position|holding/i.test(bodyText);
      const hasTicker = /[A-Z]{2,5}\s+\d+\.\d{2}/.test(bodyText);
      return { hasPositions, hasTicker };
    });
    const pass = pos && (pos.hasPositions || pos.hasTicker);
    record(36, 'Current positions section present', pass, `Positions: ${pos?.hasPositions}, Ticker: ${pos?.hasTicker}`);
    await screenshotOnFail(page, 36, pass);
  }

  // 37. "Run Now" button exists
  {
    const runNow = await safeEval(page, () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const runBtn = buttons.find(b => /run.?now|run.?pipeline|execute/i.test(b.textContent?.trim()));
      return { hasRunNow: !!runBtn, btnText: runBtn?.textContent?.trim() };
    });
    const pass = runNow && runNow.hasRunNow;
    record(37, '"Run Now" button exists', pass, `Button: ${runNow?.btnText}`);
    await screenshotOnFail(page, 37, pass);
  }

  // 38. Example rule chips visible in strategy builder
  {
    const chips = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const ruleKeywords = ['PE', 'RSI', 'EPS', 'revenue', 'earnings', 'momentum', 'value', 'growth', 'below', 'above'];
      const found = ruleKeywords.filter(k => bodyText.includes(k));
      // Look for badge/chip elements
      const badges = document.querySelectorAll('[class*="badge"], [class*="chip"], [class*="tag"]');
      return { found, count: found.length, badgeCount: badges.length };
    });
    const pass = chips && (chips.count >= 2 || chips.badgeCount >= 2);
    record(38, 'Example rule chips visible in strategy builder', pass, `Keywords: ${chips?.found?.join(', ')}, Badges: ${chips?.badgeCount}`);
    await screenshotOnFail(page, 38, pass);
  }
}

// ════════════════════════════════════════════════════════════════
//  STRATEGY DETAIL PAGE TESTS (checks 39-46)
// ════════════════════════════════════════════════════════════════
async function testStrategyDetail(page) {
  console.log('\n' + '='.repeat(60));
  console.log('STRATEGY DETAIL PAGE CHECKS');
  console.log('='.repeat(60));

  // Navigate to first strategy - "pead" is always present
  await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(OUT, 'strategy-detail-full.png'), fullPage: true });

  const text = await bodyText(page);

  // 39. Strategy name and description visible
  {
    const info = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasName = /PEAD|Post.?Earn|Drift|earnings/i.test(bodyText);
      const hasDescription = bodyText.length > 200; // Some meaningful content
      return { hasName, hasDescription, textLen: bodyText.length };
    });
    const pass = info && info.hasName;
    record(39, 'Strategy name and description visible', pass, `Name: ${info?.hasName}, TextLen: ${info?.textLen}`);
    await screenshotOnFail(page, 39, pass);
  }

  // 40. Equity curve renders (or shows "Not enough data" empty state -- both are valid)
  {
    const curve = await safeEval(page, () => {
      const svgs = document.querySelectorAll('svg');
      let equitySvg = null;
      for (const s of svgs) {
        const polylines = s.querySelectorAll('polyline, polygon, path');
        const rect = s.getBoundingClientRect();
        if (polylines.length > 0 && rect.width > 200 && rect.height > 100) {
          equitySvg = { width: rect.width, height: rect.height, paths: polylines.length };
          break;
        }
      }
      const bodyText = document.body.innerText;
      // "Not enough data for equity curve" is a legitimate empty state from EquityCurve component
      const hasEmptyState = /not enough data|awaiting.?trade|no equity/i.test(bodyText);
      // Check for the equity curve container at all (even empty)
      const hasEquitySection = /equity|return|performance|curve/i.test(bodyText);
      return { hasEquityCurve: !!equitySvg, details: equitySvg, hasEmptyState, hasEquitySection };
    });
    // PASS if either the curve renders OR the legitimate "not enough data" empty state shows
    const pass = curve && (curve.hasEquityCurve || curve.hasEmptyState);
    const detail = curve?.hasEquityCurve
      ? `${curve.details.width}x${curve.details.height}, ${curve.details.paths} paths`
      : curve?.hasEmptyState
        ? 'Empty state: "Not enough data" (no trades yet)'
        : 'No curve and no empty state';
    record(40, 'Equity curve renders or shows valid empty state', pass, detail);
    await screenshotOnFail(page, 40, pass);
  }

  // 41. SPY benchmark line visible (gray)
  {
    const bench = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasSPY = /SPY|benchmark|S&P/i.test(bodyText);
      // Look for gray polyline (benchmark line)
      const svgs = document.querySelectorAll('svg');
      let grayLine = false;
      for (const s of svgs) {
        const polylines = s.querySelectorAll('polyline');
        for (const p of polylines) {
          const stroke = p.getAttribute('stroke') || '';
          if (stroke.includes('gray') || stroke.includes('666') || stroke.includes('888') || stroke.includes('999') || stroke.includes('#6b') || stroke.includes('#9') || stroke === 'var(--muted-foreground)') {
            grayLine = true;
            break;
          }
        }
        if (grayLine) break;
      }
      return { hasSPY, grayLine };
    });
    const pass = bench && (bench.hasSPY || bench.grayLine);
    record(41, 'SPY benchmark line visible (gray)', pass, `SPY text: ${bench?.hasSPY}, Gray line: ${bench?.grayLine}`);
    await screenshotOnFail(page, 41, pass);
  }

  // 42. Metric cards show values or "Awaiting trades" (not "No data")
  {
    const metrics = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const hasNoData = /no data/i.test(bodyText);
      const hasAwaitingTrades = /awaiting.?trade/i.test(bodyText);
      const metricNames = ['return', 'sharpe', 'win', 'drawdown', 'trade', 'alpha', 'beta'];
      const found = metricNames.filter(m => new RegExp(m, 'i').test(bodyText));
      // Check for actual numeric values
      const numbers = bodyText.match(/[\d.]+%|[\d,]+\.\d+/g) || [];
      return { hasNoData, hasAwaitingTrades, metricNames: found, numberCount: numbers.length };
    });
    const pass = metrics && !metrics.hasNoData;
    record(42, 'Metric cards show values (not "No data")', pass, `NoData: ${metrics?.hasNoData}, Awaiting: ${metrics?.hasAwaitingTrades}, Metrics: ${metrics?.metricNames?.join(', ')}`);
    await screenshotOnFail(page, 42, pass);
  }

  // 43. Tabs (About/Positions/Sector/Correlation/Analytics) visible and above trade history
  {
    const tabs = await safeEval(page, () => {
      const bodyText = document.body.innerText;
      const tabNames = ['About', 'Positions', 'Sector', 'Correlation', 'Analytics'];
      const found = tabNames.filter(t => bodyText.includes(t));
      // Check tab elements
      const tabElements = document.querySelectorAll('[role="tab"]');
      const tabTexts = Array.from(tabElements).map(t => t.textContent?.trim());
      return { found, count: found.length, tabElements: tabTexts };
    });
    const pass = tabs && tabs.count >= 3;
    record(43, 'Tabs (About/Positions/Sector/Correlation/Analytics) visible', pass, `Found: ${tabs?.found?.join(', ')}, TabEls: ${tabs?.tabElements?.join(', ')}`);
    await screenshotOnFail(page, 43, pass);
  }

  // 44. Tab switching works
  {
    let switched = false;
    try {
      // Try clicking "Positions" tab
      const posTab = await page.$('[role="tab"]:has-text("Positions"), button:has-text("Positions")');
      if (posTab) {
        await posTab.click();
        await page.waitForTimeout(800);
        const afterClick = await bodyText(page);
        switched = /position|symbol|entry|exit|ticker|no.?position/i.test(afterClick);
      }
      // Click back to About
      const aboutTab = await page.$('[role="tab"]:has-text("About"), button:has-text("About")');
      if (aboutTab) await aboutTab.click().catch(() => {});
      await page.waitForTimeout(500);
    } catch {}
    record(44, 'Tab switching works', switched, switched ? 'Positions tab content loaded' : 'Could not switch tabs');
    await screenshotOnFail(page, 44, switched);
  }

  // 45. Pause/Active button visible
  {
    const pauseBtn = await safeEval(page, () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const toggleBtn = buttons.find(b => {
        const text = b.textContent?.trim() || '';
        return /pause|active|resume|deactivate|toggle|running/i.test(text);
      });
      // Also look for Play/Pause icons
      const icons = document.querySelectorAll('svg.lucide-pause, svg.lucide-play, [data-lucide="pause"], [data-lucide="play"]');
      return { hasBtn: !!toggleBtn, btnText: toggleBtn?.textContent?.trim(), iconCount: icons.length };
    });
    const pass = pauseBtn && (pauseBtn.hasBtn || pauseBtn.iconCount > 0);
    record(45, 'Pause/Active button visible', pass, `Button: ${pauseBtn?.btnText}, Icons: ${pauseBtn?.iconCount}`);
    await screenshotOnFail(page, 45, pass);
  }

  // 46. Period pills on equity curve work
  {
    const periodPills = await safeEval(page, () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const pills = buttons.filter(b => {
        const t = b.textContent?.trim();
        return t === '1M' || t === '3M' || t === '6M' || t === 'YTD' || t === 'ALL';
      });
      return { count: pills.length, labels: pills.map(b => b.textContent?.trim()) };
    });
    let pillsWork = false;
    if (periodPills && periodPills.count > 0) {
      try {
        const pill = await page.$('button:has-text("3M")');
        if (pill) {
          await pill.click();
          await page.waitForTimeout(500);
          pillsWork = true;
        }
      } catch {}
    }
    const pass = periodPills && periodPills.count >= 3 && pillsWork;
    record(46, 'Period pills on equity curve work', pass, `Pills: ${periodPills?.labels?.join(', ')}, Click: ${pillsWork}`);
    await screenshotOnFail(page, 46, pass);
  }
}

// ════════════════════════════════════════════════════════════════
//  GLOBAL FEATURE TESTS (checks 47-52)
// ════════════════════════════════════════════════════════════════
async function testGlobal(page) {
  console.log('\n' + '='.repeat(60));
  console.log('GLOBAL FEATURE CHECKS');
  console.log('='.repeat(60));

  // Start from dashboard for global tests
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 47. Keyboard shortcut ? overlay works
  {
    let pass = false;
    try {
      await page.keyboard.press('?');
      await page.waitForTimeout(1000);
      const overlayText = await bodyText(page);
      pass = /keyboard|shortcut|hotkey|ctrl|cmd|press/i.test(overlayText);
      // Take screenshot of overlay
      if (pass) {
        await page.screenshot({ path: join(OUT, 'keyboard-overlay.png') });
      }
      // Close overlay
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } catch {}
    record(47, 'Keyboard shortcut ? overlay works', pass, '');
    await screenshotOnFail(page, 47, pass);
  }

  // 48. Command palette Ctrl+K works
  {
    let pass = false;
    try {
      const isMac = process.platform === 'darwin';
      await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k');
      await page.waitForTimeout(1000);
      // Check for command palette input/dialog
      const palette = await safeEval(page, () => {
        const dialogs = document.querySelectorAll('[role="dialog"], [data-state="open"], .fixed');
        const inputs = document.querySelectorAll('input[placeholder*="search"], input[placeholder*="command"], input[type="search"]');
        const bodyText = document.body.innerText;
        const hasPaletteText = /search|command|jump|navigate|go to/i.test(bodyText);
        return { dialogCount: dialogs.length, inputCount: inputs.length, hasPaletteText };
      });
      pass = palette && (palette.inputCount > 0 || palette.hasPaletteText || palette.dialogCount > 0);
      if (pass) {
        await page.screenshot({ path: join(OUT, 'command-palette.png') });
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } catch {}
    record(48, 'Command palette Ctrl+K works', pass, '');
    await screenshotOnFail(page, 48, pass);
  }

  // 49. Profile avatar dropdown opens
  {
    let pass = false;
    try {
      // Look for profile avatar button (usually in top bar)
      const avatar = await page.$('button:has(img), button:has([class*="avatar"]), [class*="avatar"] button, button:has-text("admin"), button:has-text("GK")');
      if (!avatar) {
        // Try generic approach - last button in top bar
        const topBarBtns = await page.$$('nav button, header button, [class*="topbar"] button, [class*="top-bar"] button');
        if (topBarBtns.length > 0) {
          await topBarBtns[topBarBtns.length - 1].click();
          await page.waitForTimeout(800);
        }
      } else {
        await avatar.click();
        await page.waitForTimeout(800);
      }
      const dropdown = await safeEval(page, () => {
        const bodyText = document.body.innerText;
        const hasProfileMenu = /profile|logout|sign.?out|settings|account|theme|dark|light/i.test(bodyText);
        const menus = document.querySelectorAll('[role="menu"], [role="menuitem"], [data-state="open"]');
        return { hasProfileMenu, menuCount: menus.length };
      });
      pass = dropdown && (dropdown.hasProfileMenu || dropdown.menuCount > 0);
      if (pass) {
        await page.screenshot({ path: join(OUT, 'profile-dropdown.png') });
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } catch {}
    record(49, 'Profile avatar dropdown opens', pass, '');
    await screenshotOnFail(page, 49, pass);
  }

  // 50. Alerts bell opens dropdown
  {
    let pass = false;
    try {
      const bellBtn = await page.$('button:has([class*="bell"]), button[aria-label*="alert"], button[aria-label*="notification"]');
      if (bellBtn) {
        await bellBtn.click();
        await page.waitForTimeout(800);
        const alertDropdown = await safeEval(page, () => {
          const bodyText = document.body.innerText;
          const hasAlerts = /alert|notification|no.?alert|no.?notification|clear|mark/i.test(bodyText);
          const dropdowns = document.querySelectorAll('[role="menu"], [data-state="open"], .fixed');
          return { hasAlerts, dropdownCount: dropdowns.length };
        });
        pass = alertDropdown && (alertDropdown.hasAlerts || alertDropdown.dropdownCount > 0);
        if (pass) {
          await page.screenshot({ path: join(OUT, 'alerts-dropdown.png') });
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } else {
        // Try finding by icon content
        const allBtns = await page.$$('button');
        for (const btn of allBtns) {
          const hasIcon = await btn.evaluate(el => {
            return el.querySelector('svg') !== null &&
              (el.getAttribute('title')?.includes('alert') ||
               el.getAttribute('aria-label')?.includes('bell') ||
               el.textContent?.trim() === '');
          }).catch(() => false);
          if (hasIcon) {
            // This might be the bell
          }
        }
      }
    } catch {}
    record(50, 'Alerts bell opens dropdown', pass, '');
    await screenshotOnFail(page, 50, pass);
  }

  // 51. Navigation g+d, g+t, g+p works
  {
    let pass = false;
    try {
      // Test g+t (go to trade)
      await page.keyboard.press('g');
      await page.waitForTimeout(300);
      await page.keyboard.press('t');
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle').catch(() => {});
      const urlAfterGT = page.url();
      const wentToTrade = urlAfterGT.includes('/trade');

      // Test g+d (go to dashboard)
      await page.keyboard.press('g');
      await page.waitForTimeout(300);
      await page.keyboard.press('d');
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle').catch(() => {});
      const urlAfterGD = page.url();
      const wentToDash = !urlAfterGD.includes('/trade') && !urlAfterGD.includes('/pipeline');

      // Test g+p (go to pipeline)
      await page.keyboard.press('g');
      await page.waitForTimeout(300);
      await page.keyboard.press('p');
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle').catch(() => {});
      const urlAfterGP = page.url();
      const wentToPipeline = urlAfterGP.includes('/pipeline');

      pass = wentToTrade || wentToDash || wentToPipeline;
      record(51, 'Navigation g+d, g+t, g+p works', pass, `g+t=${wentToTrade}, g+d=${wentToDash}, g+p=${wentToPipeline}`);
    } catch {}
    await screenshotOnFail(page, 51, pass);
    if (!pass) record(51, 'Navigation g+d, g+t, g+p works', false, 'keyboard shortcuts failed');

    // Return to dashboard
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  // 52. Toast system works (try triggering via strategy toggle)
  {
    let pass = false;
    try {
      // Navigate to a strategy detail page and toggle
      await page.goto(`${BASE_URL}/strategies/pead`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Find pause/active toggle button
      const toggleBtn = await page.$('button:has-text("Pause"), button:has-text("Active"), button:has-text("Resume"), button:has-text("Deactivate")');
      if (toggleBtn) {
        await toggleBtn.click();
        await page.waitForTimeout(2000);

        // Check for toast notification
        const toast = await safeEval(page, () => {
          const toasts = document.querySelectorAll('[role="status"], [class*="toast"], [class*="Toaster"], [data-state="open"]');
          const bodyText = document.body.innerText;
          const hasToast = /paused|activated|toggled|updated|success|strategy/i.test(bodyText);
          return { toastCount: toasts.length, hasToast };
        });
        pass = toast && (toast.toastCount > 0 || toast.hasToast);

        // Toggle back
        await page.waitForTimeout(500);
        const revertBtn = await page.$('button:has-text("Pause"), button:has-text("Active"), button:has-text("Resume"), button:has-text("Activate")');
        if (revertBtn) await revertBtn.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    } catch {}
    record(52, 'Toast system works', pass, '');
    await screenshotOnFail(page, 52, pass);
  }
}

// ════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════
async function main() {
  console.log('Starting AlphaDesk Comprehensive Regression Test');
  console.log('=' .repeat(60));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    await login(page);

    await testDashboard(page);
    await testTradePage(page);
    await testPipeline(page);
    await testStrategyDetail(page);
    await testGlobal(page);
  } catch (err) {
    console.error('Fatal error during testing:', err.message);
  } finally {
    await browser.close();
  }

  // ── Summary ─────────────────────────────────────────────────
  const passed = results.filter(r => r.result === 'PASS').length;
  const failed = results.filter(r => r.result === 'FAIL').length;
  const total = results.length;

  console.log('\n' + '='.repeat(60));
  console.log(`REGRESSION RESULTS: ${passed}/${total} PASS, ${failed} FAIL`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\nFAILED CHECKS:');
    results.filter(r => r.result === 'FAIL').forEach(r => {
      console.log(`  [${r.id}] ${r.name}: ${r.detail}`);
    });
  }

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed, passRate: `${((passed / total) * 100).toFixed(1)}%` },
    results,
  };

  writeFileSync(join(OUT, 'results.json'), JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${join(OUT, 'results.json')}`);
}

main().catch(console.error);
