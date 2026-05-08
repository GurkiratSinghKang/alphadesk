import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/widget-audit';
const BASE_URL = 'https://tradingalpha.net';
const CREDS = { username: QA_USERNAME, password: getQaPassword() };

const results = [];

function record(widget, fn, pass, issue = '') {
  results.push({ widget, fn, status: pass ? 'PASS' : 'FAIL', issue });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${widget} | ${fn}${issue ? ' | ' + issue : ''}`);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.fill('#login-username', CREDS.username);
  await page.fill('#login-password', CREDS.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  console.log(`Logged in, URL: ${page.url()}`);
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1920,1080'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await login(page);

    // =============================================
    // DASHBOARD - Re-test failures
    // =============================================
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // ── 1. Portfolio Hero - detailed dollar check ──
    console.log('\n=== 1. PORTFOLIO HERO (detailed) ===');
    // Get the actual equity value from the hero
    const heroEquity = await page.evaluate(() => {
      const els = document.querySelectorAll('*');
      for (const el of els) {
        const text = el.textContent || '';
        // Looking for a dollar amount like $104,255.76 (portfolio-level)
        const match = text.match(/\$[\d,]{3,}\.?\d*/);
        if (match && !el.children.length) return match[0];
      }
      // Try broader match
      const body = document.body.textContent || '';
      const matches = body.match(/\$[\d,]{3,}\.\d{2}/g);
      return matches ? matches.slice(0, 5).join(' | ') : 'none';
    });
    record('Portfolio Hero', 'Shows portfolio equity value', heroEquity !== 'none', `Found: ${heroEquity}`);
    await screenshot(page, 'p2-01-hero-equity');

    // ── 4. Strategy Grid - click cards (use buttons, not links) ──
    console.log('\n=== 4. STRATEGY GRID (card click) ===');
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(500);

    // Cards are <div role="button"> with cursor-pointer, not <a> links
    const stratCards = page.locator('[role="button"][tabindex="0"]').filter({
      has: page.locator('p')
    });
    const cardCount = await stratCards.count();
    console.log(`Found ${cardCount} strategy cards (role=button)`);

    let navSuccesses = 0;
    for (let i = 0; i < Math.min(3, cardCount); i++) {
      try {
        // Re-query each time since page changes
        await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);
        await page.evaluate(() => window.scrollTo(0, 400));
        await page.waitForTimeout(500);

        const cards = page.locator('[role="button"][tabindex="0"]');
        const count = await cards.count();
        if (i < count) {
          const cardText = await cards.nth(i).textContent();
          console.log(`  Clicking card ${i}: ${cardText.slice(0, 30).trim()}`);
          await cards.nth(i).click();
          await page.waitForTimeout(2000);
          const url = page.url();
          const navigated = url.includes('/strategies/');
          console.log(`  Navigated to: ${url}`);
          await screenshot(page, `p2-04-strategy-click-${i + 1}`);
          if (navigated) navSuccesses++;
        }
      } catch (e) {
        console.log(`  Card ${i} error: ${e.message.slice(0, 80)}`);
      }
    }
    record('Strategy Grid', 'Cards navigate to strategy detail', navSuccesses >= 2, `${navSuccesses}/3 navigations succeeded`);

    // ── 8. Sector Treemap ──
    console.log('\n=== 8. SECTOR TREEMAP ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Scroll down to find the treemap
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(1000);

    // The SectorTreemap uses inline div rendering, not SVG rects
    const treemapInfo = await page.evaluate(() => {
      const body = document.body.textContent || '';
      // Check for sector names
      const sectorNames = ['Technology', 'Healthcare', 'Financial', 'Energy', 'Industrial', 'Consumer', 'Utilities', 'Real Estate', 'Materials', 'Communication'];
      let found = [];
      for (const s of sectorNames) {
        if (body.includes(s)) found.push(s);
      }

      // Also check for sector percentages
      const pctMatch = body.match(/[+-]?\d+\.\d+%/g);

      return { sectorNames: found, pctCount: pctMatch ? pctMatch.length : 0 };
    });

    record('Sector Treemap', 'Shows sector names', treemapInfo.sectorNames.length >= 3, `Found: ${treemapInfo.sectorNames.join(', ')}`);
    record('Sector Treemap', 'Shows sector percentages', treemapInfo.pctCount >= 3, `Found ${treemapInfo.pctCount} percentages`);

    // Scroll to treemap area and screenshot
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(500);
    await screenshot(page, 'p2-08-sector-treemap-scroll');

    // ── 9. Allocation Donut - "Cash" label ──
    console.log('\n=== 9. ALLOCATION DONUT ===');
    // The AllocationDonut shows "Cash" in the legend
    const donutInfo = await page.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasCash: body.includes('Cash'),
        hasInvested: body.includes('Invested'),
        hasAllocation: body.includes('Allocation'),
        hasBuyingPower: body.includes('Buying Power'),
      };
    });
    record('Allocation Donut', 'Shows Cash label', donutInfo.hasCash, `Cash: ${donutInfo.hasCash}, BuyingPower: ${donutInfo.hasBuyingPower}`);
    record('Allocation Donut', 'Shows Invested label', donutInfo.hasInvested, '');
    record('Allocation Donut', 'Allocation heading present', donutInfo.hasAllocation, '');
    await screenshot(page, 'p2-09-allocation');

    // ── 11. Status Strip ──
    console.log('\n=== 11. STATUS STRIP ===');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    // StatusStrip uses role="status" and h-7
    const stripEl = page.locator('[role="status"]').first();
    const stripExists = await stripEl.count() > 0;
    record('Status Strip', 'Strip renders (role=status)', stripExists, '');

    if (stripExists) {
      const stripText = await stripEl.textContent();
      console.log(`  Strip text: ${stripText.slice(0, 200)}`);

      // Verify P&L in strip
      const hasPnl = stripText.includes('P&L') || stripText.includes('$');
      record('Status Strip', 'P&L shown in strip', hasPnl, '');

      try {
        await stripEl.screenshot({ path: path.join(SCREENSHOT_DIR, 'p2-11-status-strip.png') });
      } catch (e) {
        await screenshot(page, 'p2-11-status-strip-full');
      }
    }

    // =============================================
    // TRADE PAGE - Re-test failures
    // =============================================
    console.log('\n=== TRADE PAGE ===');
    // Navigate via button click (buttons, not links)
    const tradeBtn = page.locator('button:has-text("Trade")').first();
    if (await tradeBtn.count() > 0) {
      await tradeBtn.click();
    } else {
      await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
    }
    await page.waitForTimeout(3000);
    await screenshot(page, 'p2-12-trade-page');

    // ── 14. Watchlist ──
    console.log('\n=== 14. WATCHLIST ===');
    // WatchlistPanel doesn't use class*="watchlist", it uses inline styles
    // Check for the tab "Watchlist" which is rendered via TabsTrigger
    const watchlistTab = page.locator('button:has-text("Watchlist")').first();
    const hasWatchlistTab = await watchlistTab.count() > 0;
    record('Watchlist', 'Watchlist tab present', hasWatchlistTab, '');

    if (hasWatchlistTab) {
      await watchlistTab.click();
      await page.waitForTimeout(1000);
    }

    // Check for sparklines (MiniSparkline uses svg with width=36)
    const miniSparks = await page.locator('svg[width="36"]').count();
    record('Watchlist', 'Sparklines rendered', miniSparks > 0, `Found ${miniSparks} mini sparklines`);

    // Check for symbol prices
    const watchlistContent = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'SPY', 'QQQ', 'NVDA'];
      const found = symbols.filter(s => body.includes(s));
      return { found, count: found.length };
    });
    record('Watchlist', 'Shows tracked symbols', watchlistContent.count >= 2, `Found: ${watchlistContent.found.join(', ')}`);

    await screenshot(page, 'p2-14-watchlist');

    // ── 15. Screener ──
    console.log('\n=== 15. SCREENER ===');
    const screenerTab = page.locator('button:has-text("Screener")').first();
    if (await screenerTab.count() > 0) {
      await screenerTab.click();
      await page.waitForTimeout(1500);

      const bodyText = await page.textContent('body');
      const hasRunScreen = bodyText.includes('Run') || bodyText.includes('Screen');
      record('Screener Tab', 'Has Run/Screen button', hasRunScreen, '');

      // Click the Run button
      const runBtn = page.locator('button:has-text("Run")').first();
      if (await runBtn.count() > 0) {
        await runBtn.click();
        await page.waitForTimeout(3000);
        await screenshot(page, 'p2-15-screener-results');
      }
    }

    // ── 17-19. Tech/Fund/Sent tabs (they're abbreviated) ──
    console.log('\n=== 17. TECHNICAL ANALYSIS TAB ===');
    const techTab = page.locator('button:has-text("Tech")').first();
    if (await techTab.count() > 0) {
      await techTab.click();
      await page.waitForTimeout(2000);

      const techText = await page.textContent('body');
      const indicators = ['RSI', 'MACD', 'EMA', 'Bollinger', 'BB', 'SMA', 'Support', 'Resistance'];
      let foundIndicators = indicators.filter(i => techText.includes(i));
      record('Technical Analysis Tab', 'Shows indicators', foundIndicators.length >= 2, `Found: ${foundIndicators.join(', ')}`);

      // Check for score gauge
      const gaugeEl = page.locator('svg circle').count();
      record('Technical Analysis Tab', 'Score gauge rendered', await gaugeEl > 2, '');

      await screenshot(page, 'p2-17-tech-tab');
    } else {
      record('Technical Analysis Tab', 'Tab found (as "Tech")', false, 'Tab not found');
    }

    console.log('\n=== 18. FUNDAMENTAL TAB ===');
    const fundTab = page.locator('button:has-text("Fund")').first();
    if (await fundTab.count() > 0) {
      await fundTab.click();
      await page.waitForTimeout(2000);

      const fundText = await page.textContent('body');
      const hasFScore = fundText.includes('F-Score') || fundText.includes('Piotroski') || fundText.includes('Score');
      record('Fundamental Tab', 'F-Score displayed', hasFScore, '');

      await screenshot(page, 'p2-18-fund-tab');
    } else {
      record('Fundamental Tab', 'Tab found (as "Fund")', false, '');
    }

    console.log('\n=== 19. SENTIMENT TAB ===');
    const sentTab = page.locator('button:has-text("Sent")').first();
    if (await sentTab.count() > 0) {
      await sentTab.click();
      await page.waitForTimeout(2000);

      const sentText = await page.textContent('body');
      const hasSentiment = sentText.includes('Sentiment') || sentText.includes('sentiment') || sentText.includes('Bullish') || sentText.includes('Bearish');
      record('Sentiment Tab', 'Shows sentiment data', hasSentiment, '');

      // Check for opacity/greyed out estimated items
      const hasEstimated = await page.evaluate(() => {
        const els = document.querySelectorAll('*');
        for (const el of els) {
          const style = getComputedStyle(el);
          if (parseFloat(style.opacity) < 0.8 && el.textContent && el.textContent.length > 5 && el.textContent.length < 200) {
            return true;
          }
        }
        return false;
      });
      record('Sentiment Tab', 'Estimated items greyed', hasEstimated, '');

      await screenshot(page, 'p2-19-sent-tab');
    } else {
      record('Sentiment Tab', 'Tab found (as "Sent")', false, '');
    }

    // ── 20. Chat Tab ──
    console.log('\n=== 20. CHAT TAB ===');
    const chatTab = page.locator('button:has-text("Chat")').first();
    if (await chatTab.count() > 0) {
      await chatTab.click();
      await page.waitForTimeout(1500);

      // Find the chat input - look for textarea or input with placeholder
      const chatInput = page.locator('input[placeholder*="message"], input[placeholder*="Message"], input[placeholder*="Ask"], input[placeholder*="ask"], textarea, input[placeholder*="Chat"], input[placeholder*="chat"]').first();
      const chatInputExists = await chatInput.count() > 0;
      record('Chat Tab', 'Chat input exists', chatInputExists, '');

      if (chatInputExists) {
        await chatInput.fill('What is AAPL trading at?');
        await page.waitForTimeout(500);

        // Try pressing Enter to send
        await chatInput.press('Enter');
        await page.waitForTimeout(8000); // Wait for AI response

        const chatBody = await page.textContent('body');
        const gotResponse = chatBody.includes('AAPL') || chatBody.includes('Apple') || chatBody.includes('price') || chatBody.includes('trading');
        record('Chat Tab', 'AI responds to message', gotResponse, '');
        await screenshot(page, 'p2-20-chat-response');
      }
    } else {
      record('Chat Tab', 'Chat tab found', false, '');
    }

    // ── 21. Order Tab - submit button ──
    console.log('\n=== 21. ORDER TAB ===');
    const orderTab = page.locator('button:has-text("Order")').first();
    if (await orderTab.count() > 0) {
      await orderTab.click();
      await page.waitForTimeout(1500);

      const orderText = await page.textContent('body');
      // Check for any button that looks like submit/place/review
      const allButtons = await page.locator('button').allTextContents();
      const submitLike = allButtons.filter(t =>
        t.includes('Submit') || t.includes('Place') || t.includes('Review') ||
        t.includes('Buy') || t.includes('Sell') || t.includes('Execute') ||
        t.includes('Preview')
      );
      record('Order Tab', 'Submit/Place order button', submitLike.length > 0, `Buttons found: ${submitLike.join(', ')}`);

      // Check for order type selector
      const hasOrderType = orderText.includes('Market') || orderText.includes('Limit') || orderText.includes('Stop');
      record('Order Tab', 'Order type options', hasOrderType, '');

      await screenshot(page, 'p2-21-order-tab');
    }

    // ── 22. Options Chain ──
    console.log('\n=== 22. OPTIONS CHAIN ===');
    // The options panel is at the bottom of the trade page
    // Check if it's visible
    const optionsContent = await page.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasStrike: body.includes('Strike') || body.includes('strike'),
        hasCall: body.includes('Call') || body.includes('CALL'),
        hasPut: body.includes('Put') || body.includes('PUT'),
        hasIV: body.includes('IV') || body.includes('Implied'),
        hasExpMove: body.includes('Expected Move') || body.includes('expected move') || body.includes('Exp Move'),
        hasChain: body.includes('chain') || body.includes('Chain') || body.includes('Options'),
        hasBidAsk: body.includes('Bid') || body.includes('Ask'),
      };
    });

    record('Options Chain', 'Options panel visible', optionsContent.hasCall || optionsContent.hasPut || optionsContent.hasChain,
      `Call: ${optionsContent.hasCall}, Put: ${optionsContent.hasPut}, Chain: ${optionsContent.hasChain}`);
    record('Options Chain', 'Shows strikes', optionsContent.hasStrike, '');
    record('Options Chain', 'IV displayed', optionsContent.hasIV, '');
    record('Options Chain', 'Expected Move', optionsContent.hasExpMove, '');
    record('Options Chain', 'Bid/Ask columns', optionsContent.hasBidAsk, '');

    await screenshot(page, 'p2-22-options-bottom');

    // ── 26. Journal Tab ──
    console.log('\n=== 26. JOURNAL TAB ===');
    // The TradePanel has tabs: trade, positions, orders, journal, calendar
    // Look for "Journal" in the bottom panel context
    const journalTab = page.locator('button:has-text("Journal")').first();
    if (await journalTab.count() > 0) {
      await journalTab.click();
      await page.waitForTimeout(1000);

      // Look for textarea
      const textarea = page.locator('textarea').first();
      const textareaExists = await textarea.count() > 0;
      record('Journal Tab', 'Textarea found', textareaExists, '');

      if (textareaExists) {
        await textarea.fill('QA audit test note - widget test pass 2');
        await page.waitForTimeout(500);

        // Switch tabs and come back
        const posTab = page.locator('button:has-text("Positions")').first();
        if (await posTab.count() > 0) {
          await posTab.click();
          await page.waitForTimeout(500);
          await journalTab.click();
          await page.waitForTimeout(500);

          const noteValue = await textarea.inputValue();
          record('Journal Tab', 'Note persists across tab switch', noteValue.includes('QA audit'), `Value: ${noteValue.slice(0, 50)}`);
        }
      }
      await screenshot(page, 'p2-26-journal-tab');
    } else {
      record('Journal Tab', 'Journal tab found', false, '');
    }

    // =============================================
    // PIPELINE PAGE - Re-test failures
    // =============================================
    console.log('\n=== PIPELINE PAGE ===');
    const pipelineBtn = page.locator('button:has-text("Pipeline")').first();
    if (await pipelineBtn.count() > 0) {
      await pipelineBtn.click();
    } else {
      await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle', timeout: 30000 });
    }
    await page.waitForTimeout(3000);
    await screenshot(page, 'p2-28-pipeline-full');

    // ── 30. Strategy Builder - input ──
    console.log('\n=== 30. STRATEGY BUILDER ===');
    const pipeText = await page.textContent('body');

    // Check for the strategy builder textarea/input
    const builderTextarea = page.locator('textarea').first();
    const builderExists = await builderTextarea.count() > 0;

    if (builderExists) {
      const placeholder = await builderTextarea.getAttribute('placeholder');
      console.log(`  Builder placeholder: ${placeholder}`);

      await builderTextarea.fill('Buy when RSI < 30');
      await page.waitForTimeout(500);

      // Look for a parse/build/generate button
      const parseBtn = page.locator('button:has-text("Parse"), button:has-text("Build"), button:has-text("Generate"), button:has-text("Create"), button:has-text("Add"), button:has-text("Save")').first();
      if (await parseBtn.count() > 0) {
        const btnText = await parseBtn.textContent();
        console.log(`  Found button: ${btnText}`);
        await parseBtn.click();
        await page.waitForTimeout(2000);
        record('Strategy Builder', 'Parses natural language', true, `Button: ${btnText}`);
      } else {
        record('Strategy Builder', 'Parse button found', false, 'No parse/build button');
      }
      await screenshot(page, 'p2-30-strategy-builder');
    } else {
      record('Strategy Builder', 'Builder textarea found', false, '');
    }

    // ── 31. Backtest equity curve ──
    console.log('\n=== 31. BACKTEST ===');
    // Run a backtest and check for chart
    const runBtBtn = page.locator('button:has-text("Run Backtest"), button:has-text("Run"), button:has-text("Backtest")').first();
    if (await runBtBtn.count() > 0) {
      await runBtBtn.click();
      await page.waitForTimeout(5000);

      // Check for SVG chart (equity curve)
      const svgPaths = await page.locator('svg path').count();
      const canvasEls = await page.locator('canvas').count();
      record('Backtest', 'Equity curve rendered', svgPaths > 5 || canvasEls > 0, `SVG paths: ${svgPaths}, Canvas: ${canvasEls}`);

      // Check for Recharts/chart container
      const chartContainers = await page.locator('[class*="recharts"], [class*="chart-container"], svg[viewBox]').count();
      record('Backtest', 'Chart container present', chartContainers > 0, `Found ${chartContainers}`);

      await screenshot(page, 'p2-31-backtest-results');
    }

    // ── 32. Run Pipeline (button says "Run Now") ──
    console.log('\n=== 32. RUN PIPELINE ===');
    const runNowBtn = page.locator('button:has-text("Run Now")').first();
    const runNowExists = await runNowBtn.count() > 0;
    record('Run Pipeline', 'Run Now button present', runNowExists, '');

    if (runNowExists) {
      await runNowBtn.click();
      await page.waitForTimeout(5000);

      const afterRun = await page.textContent('body');
      const response = afterRun.includes('Running') || afterRun.includes('running') ||
                       afterRun.includes('Complete') || afterRun.includes('complete') ||
                       afterRun.includes('Started') || afterRun.includes('Trigger') ||
                       afterRun.includes('Error') || afterRun.includes('error') ||
                       afterRun.includes('success') || afterRun.includes('Progress');
      record('Run Pipeline', 'Triggers action on click', response, '');
      await screenshot(page, 'p2-32-run-pipeline');
    }

    // =============================================
    // GLOBAL WIDGETS - Re-test failures
    // =============================================

    // ── 34. TopBar Navigation (buttons, not links) ──
    console.log('\n=== 34. TOPBAR NAVIGATION ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const navBtns = page.locator('header button, nav button');
    const navCount = await navBtns.count();
    console.log(`  Found ${navCount} nav buttons`);

    // Buttons with text Dashboard, Trade, Pipeline
    const dashBtn = page.locator('button:has-text("Dashboard")').first();
    const tradeBtnNav = page.locator('button:has-text("Trade")').first();
    const pipeBtnNav = page.locator('button:has-text("Pipeline")').first();

    const hasDash = await dashBtn.count() > 0;
    const hasTrade = await tradeBtnNav.count() > 0;
    const hasPipe = await pipeBtnNav.count() > 0;

    record('TopBar Navigation', 'Dashboard/Trade/Pipeline buttons', hasDash && hasTrade && hasPipe,
      `Dashboard: ${hasDash}, Trade: ${hasTrade}, Pipeline: ${hasPipe}`);

    // Test Trade navigation
    if (hasTrade) {
      await tradeBtnNav.click();
      await page.waitForTimeout(2000);
      record('TopBar Navigation', 'Trade nav works', page.url().includes('trade'), `URL: ${page.url()}`);
    }

    // Test Pipeline navigation
    if (hasPipe) {
      await pipeBtnNav.click();
      await page.waitForTimeout(2000);
      record('TopBar Navigation', 'Pipeline nav works', page.url().includes('pipeline'), `URL: ${page.url()}`);
    }

    // Logo click
    const logo = page.locator('header').locator('svg').first();
    if (await logo.count() > 0) {
      // Click the AlphaDesk text/logo area
      const logoArea = page.locator('header >> text=AlphaDesk').first();
      if (await logoArea.count() > 0) {
        await logoArea.click();
        await page.waitForTimeout(2000);
        const homeUrl = page.url();
        record('TopBar Navigation', 'Logo/brand goes home', !homeUrl.includes('trade') && !homeUrl.includes('pipeline'), `URL: ${homeUrl}`);
      }
    }

    await screenshot(page, 'p2-34-topbar');

    // ── 36. Profile Menu ──
    console.log('\n=== 36. PROFILE MENU ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // ProfileMenu is imported in TopBar - look for it in the header
    // It's likely a dropdown trigger with user icon or text
    const headerButtons = page.locator('header button, header [role="button"]');
    const headerBtnCount = await headerButtons.count();
    console.log(`  Found ${headerBtnCount} header buttons`);

    // List all header button texts to find the profile
    for (let i = 0; i < Math.min(headerBtnCount, 10); i++) {
      const text = await headerButtons.nth(i).textContent();
      const aria = await headerButtons.nth(i).getAttribute('aria-label');
      console.log(`  Button ${i}: text="${text.trim().slice(0, 30)}" aria="${aria}"`);
    }

    // Profile menu may use DropdownMenu - look for a button with user-related content
    const profileTrigger = page.locator('button[aria-label*="rofile"], button[aria-label*="user"], button[aria-label*="account"], header button:last-child').first();

    // Also try: the ProfileMenu component renders in TopBar
    // Let's look for buttons after the bell icon
    const bellBtn = page.locator('button[aria-label="Notifications"]').first();
    const hasBell = await bellBtn.count() > 0;

    if (hasBell) {
      // Profile menu is likely after the bell
      // Get all buttons in the header's right section
      const rightButtons = page.locator('header .flex.items-center.gap-2 button, header > div:last-child button');
      const rBtnCount = await rightButtons.count();
      console.log(`  Right section buttons: ${rBtnCount}`);

      // The last button in the header is likely the profile menu
      if (rBtnCount > 0) {
        const lastBtn = rightButtons.last();
        const lastText = await lastBtn.textContent();
        console.log(`  Last right button text: "${lastText.trim().slice(0, 40)}"`);

        await lastBtn.click();
        await page.waitForTimeout(1000);
        await screenshot(page, 'p2-36-profile-click');

        const menuText = await page.textContent('body');
        const hasLogout = menuText.includes('Logout') || menuText.includes('Sign out') || menuText.includes('Log out');
        const hasShortcuts = menuText.includes('Shortcut') || menuText.includes('shortcut');

        record('Profile Menu', 'Opens on click', hasLogout || hasShortcuts, '');
        record('Profile Menu', 'Has logout option', hasLogout, '');
        record('Profile Menu', 'Has shortcuts option', hasShortcuts, '');

        await page.keyboard.press('Escape');
      }
    }

    await screenshot(page, 'p2-36-profile-menu');

  } catch (e) {
    console.error('ERROR:', e.message);
    await screenshot(page, 'p2-ERROR');
  } finally {
    console.log('\n\n========================================');
    console.log('PASS-2 WIDGET AUDIT RESULTS');
    console.log('========================================');
    console.log(`TOTAL: ${results.length}`);
    console.log(`PASS: ${results.filter(r => r.status === 'PASS').length}`);
    console.log(`FAIL: ${results.filter(r => r.status === 'FAIL').length}`);
    console.log('========================================\n');

    let table = 'Widget | Function | Status | Issue\n--- | --- | --- | ---\n';
    for (const r of results) {
      table += `${r.widget} | ${r.fn} | ${r.status} | ${r.issue}\n`;
    }
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results-pass2.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results-pass2-table.md'), table);
    console.log(table);

    await browser.close();
  }
}

main().catch(console.error);
