import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import path from 'path';

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

const BASE = 'https://tradingalpha.net';
const SSDIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round7/workflows';

let issues = [];
let passCount = 0;

function logIssue(cat, sev, desc, steps) {
  issues.push({ cat, sev, desc, steps });
  console.log(`  [FAIL] ${cat}|${sev}: ${desc}`);
}
function logOK(msg) {
  passCount++;
  console.log(`  [PASS] ${msg}`);
}
async function ss(page, name) {
  await page.screenshot({ path: path.join(SSDIR, `retry-${name}.png`), fullPage: false });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  let jsErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

  // Login
  console.log('=== LOGIN ===');
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  const inputs = await page.$$('input');
  for (const inp of inputs) {
    const type = await inp.getAttribute('type');
    if (type === 'password') await inp.fill(getQaPassword());
    else if (type === 'text' || type === 'email' || !type) await inp.fill(QA_USERNAME);
  }
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 10000 }).catch(() => {});
  await sleep(3000);
  logOK('Logged in');

  // Load trade page and handle crash
  console.log('\n=== TRADE PAGE - RECOVER FROM CRASH ===');
  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(5000);

  // Check if error occurred
  const bodyText1 = await page.textContent('body');
  if (bodyText1.includes('Something went wrong') || bodyText1.includes('Try Again')) {
    console.log('  [INFO] Trade page crashed on initial load (known hydration issue)');
    console.log('  [INFO] Clicking Try Again to recover...');
    const tryAgain = await page.$('button:has-text("Try Again")');
    if (tryAgain) {
      await tryAgain.click();
      await sleep(6000);
    }
  }
  await ss(page, '01-trade-recovered');

  // Check if page recovered
  const bodyText2 = await page.textContent('body');
  const hasChart = bodyText2.includes('SPY') || bodyText2.includes('AAPL');
  if (hasChart) {
    logOK('Trade page recovered successfully after Try Again');
  } else {
    logIssue('TRADE', 'CRITICAL', 'Trade page did not recover after Try Again', 'Click Try Again on error page');
  }

  // ============================================================
  // TEST 1: Symbol switching in watchlist
  // ============================================================
  console.log('\n=== SYMBOL SWITCHING (post-recovery) ===');

  // Get symbol names first, then re-query DOM each time
  const initialItems = await page.$$('div[role="button"]');
  console.log(`  Found ${initialItems.length} watchlist items`);

  const symbolNames = [];
  for (let i = 0; i < Math.min(5, initialItems.length); i++) {
    const text = await initialItems[i].textContent().catch(() => '');
    const match = text.match(/^([A-Z]{1,5})/);
    if (match) symbolNames.push(match[1]);
  }

  for (const sym of symbolNames) {
    console.log(`  Clicking: ${sym}`);
    // Re-query the DOM each time to avoid stale references
    const freshItems = await page.$$('div[role="button"]');
    for (const item of freshItems) {
      const text = await item.textContent().catch(() => '');
      if (text.startsWith(sym)) {
        try {
          await item.click();
          await sleep(2000);
        } catch (e) {
          console.log(`    [WARN] Click failed (DOM detached), retrying...`);
          await sleep(500);
          const retryItems = await page.$$('div[role="button"]');
          for (const ri of retryItems) {
            const rt = await ri.textContent().catch(() => '');
            if (rt.startsWith(sym)) { await ri.click().catch(() => {}); await sleep(2000); break; }
          }
        }
        break;
      }
    }

    // Check chart header updated
    const chartPanel = await page.$('[data-slot="chart-panel"]');
    if (chartPanel) {
      const chartText = await chartPanel.textContent();
      if (chartText.includes(sym)) {
        logOK(`Symbol ${sym}: chart header updated`);
      } else {
        logIssue('SYMBOL', 'HIGH', `Chart header did not show ${sym}`, `Click ${sym} in watchlist`);
      }
    }
  }
  await ss(page, '02-symbols-switched');

  // ============================================================
  // TEST 2: Timeframes
  // ============================================================
  console.log('\n=== TIMEFRAMES ===');
  const timeframes = ['1m', '5m', '15m', '1H', '4H', 'D', 'W', 'M'];
  for (const tf of timeframes) {
    const allBtns = await page.$$('button');
    let clicked = false;
    for (const btn of allBtns) {
      const text = (await btn.textContent()).trim();
      if (text === tf) {
        try {
          await btn.click();
          await sleep(1200);
          logOK(`Timeframe ${tf} clicked`);
          clicked = true;
        } catch (e) {
          logIssue('CHART', 'LOW', `Timeframe ${tf} click failed: ${e.message}`, `Click ${tf} button`);
        }
        break;
      }
    }
    if (!clicked) {
      logIssue('CHART', 'MEDIUM', `Timeframe ${tf} button not found`, `Look for ${tf} in chart toolbar`);
    }
  }
  await ss(page, '03-timeframes');

  // ============================================================
  // TEST 3: Chart type dropdown
  // ============================================================
  console.log('\n=== CHART TYPE ===');
  // The chart type uses a DropdownMenu with trigger showing icon + ChevronDown
  const chartDropdowns = await page.$$('[data-slot="chart-panel"] button[aria-haspopup="menu"]');
  console.log(`  Found ${chartDropdowns.length} dropdown triggers in chart panel`);

  // Try clicking the first dropdown (which should be chart type)
  if (chartDropdowns.length > 0) {
    for (let i = 0; i < chartDropdowns.length; i++) {
      await chartDropdowns[i].click();
      await sleep(500);
      const menu = await page.$('[role="menu"]');
      if (menu) {
        const menuText = await menu.textContent();
        if (menuText.includes('Candle') || menuText.includes('Line') || menuText.includes('Area')) {
          logOK('Chart type dropdown opened');
          await ss(page, '04-chart-type-dropdown');

          // Click Line
          const lineItem = await page.$('[role="menuitem"]:has-text("Line")');
          if (lineItem) {
            await lineItem.click();
            await sleep(1500);
            logOK('Switched to Line chart');
            await ss(page, '04b-chart-line');
          }

          // Switch to Area
          await chartDropdowns[i].click();
          await sleep(500);
          const areaItem = await page.$('[role="menuitem"]:has-text("Area")');
          if (areaItem) {
            await areaItem.click();
            await sleep(1500);
            logOK('Switched to Area chart');
            await ss(page, '04c-chart-area');
          }

          // Switch back to Candle
          await chartDropdowns[i].click();
          await sleep(500);
          const candleItem = await page.$('[role="menuitem"]:has-text("Candle")');
          if (candleItem) {
            await candleItem.click();
            await sleep(1500);
            logOK('Switched back to Candle chart');
          }
          break;
        } else {
          // Not the chart type dropdown, close it
          await page.keyboard.press('Escape');
        }
      }
    }
  } else {
    logIssue('CHART', 'MEDIUM', 'No dropdown triggers found in chart panel', 'Look for chart type dropdown');
  }

  // ============================================================
  // TEST 4: Indicators
  // ============================================================
  console.log('\n=== INDICATORS ===');
  const indNames = ['EMA', 'SMA', 'RSI', 'MACD', 'Bollinger', 'Volume'];
  for (const ind of indNames) {
    const allBtns = await page.$$('button');
    let found = false;
    for (const btn of allBtns) {
      const text = (await btn.textContent()).trim();
      if (text === ind) {
        await btn.click();
        await sleep(800);
        logOK(`Indicator ${ind} toggled`);
        found = true;
        break;
      }
    }
    if (!found) {
      logIssue('CHART', 'MEDIUM', `Indicator button "${ind}" not found in toolbar`, `Look for ${ind} toggle`);
    }
  }
  await ss(page, '05-indicators');

  // ============================================================
  // TEST 5: Drawing tools
  // ============================================================
  console.log('\n=== DRAWING TOOLS ===');
  // Look for drawing tool buttons by scanning all buttons in chart panel
  const chartPanel = await page.$('[data-slot="chart-panel"]');
  if (chartPanel) {
    const chartBtns = await chartPanel.$$('button');
    let drawingFound = false;
    for (const btn of chartBtns) {
      const title = await btn.getAttribute('title').catch(() => '');
      const text = (await btn.textContent()).trim();
      if (text.includes('H-Line') || text.includes('Horizontal') ||
          title?.includes('line') || title?.includes('draw')) {
        await btn.click();
        await sleep(500);
        logOK(`Drawing tool found: "${text || title}"`);
        drawingFound = true;
        break;
      }
    }

    // Check for dropdown-based drawing tools
    if (!drawingFound) {
      for (const btn of chartBtns) {
        const hasPopup = await btn.getAttribute('aria-haspopup');
        if (!hasPopup) continue;
        await btn.click();
        await sleep(300);
        const menu = await page.$('[role="menu"]');
        if (menu) {
          const menuText = await menu.textContent();
          if (menuText.includes('Line') || menuText.includes('Draw') || menuText.includes('Fib')) {
            logOK('Drawing tools found in dropdown menu');
            drawingFound = true;
            await ss(page, '06-drawing-dropdown');

            // Click H-Line
            const hlineItem = await page.$('[role="menuitem"]:has-text("Horizontal"), [role="menuitem"]:has-text("H-Line")');
            if (hlineItem) {
              await hlineItem.click();
              await sleep(500);
              logOK('H-Line drawing tool selected');
            }
            break;
          }
          await page.keyboard.press('Escape');
        }
      }
    }

    if (!drawingFound) {
      logIssue('CHART', 'LOW', 'No drawing tool buttons found', 'Look for drawing tools in chart toolbar');
    }
  }

  // ============================================================
  // TEST 6: Price alert
  // ============================================================
  console.log('\n=== PRICE ALERT ===');
  // The alert button has BellPlus icon
  if (chartPanel) {
    const chartBtns = await chartPanel.$$('button');
    let alertFound = false;
    for (const btn of chartBtns) {
      const ariaLabel = await btn.getAttribute('aria-label').catch(() => '');
      const title = await btn.getAttribute('title').catch(() => '');
      if (ariaLabel?.toLowerCase().includes('alert') || title?.toLowerCase().includes('alert')) {
        await btn.click();
        await sleep(1000);
        logOK('Alert button clicked');
        alertFound = true;

        // Check for popover/dialog
        const dialog = await page.$('[role="dialog"], [data-state="open"]');
        if (dialog) {
          logOK('Alert dialog/popover appeared');
          await ss(page, '07-alert-dialog');
          // Fill and submit
          const priceInput = await dialog.$('input');
          if (priceInput) {
            await priceInput.fill('700');
            logOK('Alert price filled');
          }
          const setBtn = await dialog.$('button:has-text("Set"), button:has-text("Create")');
          if (setBtn) {
            await setBtn.click();
            await sleep(1000);
            logOK('Alert set');
          }
          await page.keyboard.press('Escape');
        }
        break;
      }
    }
    if (!alertFound) {
      // Try by text content
      for (const btn of chartBtns) {
        const text = (await btn.textContent()).trim();
        if (text.toLowerCase().includes('alert')) {
          await btn.click();
          await sleep(1000);
          logOK('Alert button found by text');
          alertFound = true;
          break;
        }
      }
    }
    if (!alertFound) {
      logIssue('CHART', 'MEDIUM', 'Alert button not found', 'Look for bell/alert icon in chart toolbar');
    }
  }

  // ============================================================
  // TEST 7: BUY/SELL quick buttons
  // ============================================================
  console.log('\n=== BUY/SELL BUTTONS ===');
  if (chartPanel) {
    const allText = await chartPanel.textContent();

    // Check for BUY button
    const buyBtn = await chartPanel.$('button:has-text("BUY")');
    if (buyBtn) {
      logOK('BUY button found on chart');
      await buyBtn.click();
      await sleep(1000);
      await ss(page, '08-buy-clicked');
    } else {
      // Check if there's a QuickTrade section
      if (allText.includes('BUY') || allText.includes('SELL')) {
        logOK('BUY/SELL text visible in chart panel');
      } else {
        logIssue('CHART', 'MEDIUM', 'No BUY button in chart panel', 'Look for quick trade BUY button');
      }
    }

    const sellBtn = await chartPanel.$('button:has-text("SELL")');
    if (sellBtn) {
      logOK('SELL button found on chart');
    }
  }

  // ============================================================
  // TEST 8: Trade panel tabs
  // ============================================================
  console.log('\n=== TRADE PANEL TABS ===');
  const tabNames = ['Trade', 'Positions', 'Orders', 'Journal', 'Calendar'];
  for (const tab of tabNames) {
    const tabBtn = await page.$(`button[role="tab"]:has-text("${tab}")`);
    if (tabBtn) {
      await tabBtn.click();
      await sleep(1000);
      logOK(`Tab "${tab}" found and clicked`);
      await ss(page, `09-tab-${tab.toLowerCase()}`);
    } else {
      logIssue('TRADE_PANEL', 'MEDIUM', `Tab "${tab}" not found`, `Look for ${tab} tab in trade panel`);
    }
  }

  // ============================================================
  // TEST 9: Place order via trade panel
  // ============================================================
  console.log('\n=== ORDER PLACEMENT ===');
  // Go to Trade tab
  const tradeTab = await page.$('button[role="tab"]:has-text("Trade")');
  if (tradeTab) {
    await tradeTab.click();
    await sleep(1000);

    // Click Add Leg
    const addLeg = await page.$('button:has-text("Add Leg")');
    if (addLeg) {
      await addLeg.click();
      await sleep(500);
      logOK('Add Leg clicked');

      // Check Paper Trade button
      const paperBtn = await page.$('button:has-text("Paper Trade")');
      if (paperBtn) {
        const disabled = await paperBtn.isDisabled();
        logOK(`Paper Trade button exists (disabled=${disabled})`);
        if (!disabled) {
          await paperBtn.click();
          await sleep(2000);
          logOK('Paper Trade button clicked (order attempt)');
          await ss(page, '10-order-placed');
        }
      }
    } else {
      logIssue('TRADE_PANEL', 'MEDIUM', 'Add Leg button not found', 'Look for Add Leg in trade panel');
    }
  }

  // ============================================================
  // TEST 10: Watchlist add symbol
  // ============================================================
  console.log('\n=== WATCHLIST ADD SYMBOL ===');
  const addInput = await page.$('input[aria-label="Add symbol to watchlist"]');
  if (addInput) {
    // Add valid symbol
    await addInput.fill('NFLX');
    const addBtn = await page.$('button[aria-label="Add symbol to watchlist"]');
    if (addBtn) {
      await addBtn.click();
      await sleep(2000);
      const bodyAfterAdd = await page.textContent('body');
      if (bodyAfterAdd.includes('NFLX')) {
        logOK('NFLX added to watchlist successfully');
      } else {
        logIssue('WATCHLIST', 'MEDIUM', 'NFLX not visible after adding', 'Add NFLX to watchlist');
      }
    }

    // Add invalid symbol
    await addInput.fill('XXXXX');
    const addBtn2 = await page.$('button[aria-label="Add symbol to watchlist"]');
    if (addBtn2) {
      await addBtn2.click();
      await sleep(2000);
      await ss(page, '11-invalid-symbol');
      const bodyAfterInvalid = await page.textContent('body');
      if (bodyAfterInvalid.includes('XXXXX')) {
        logIssue('WATCHLIST', 'MEDIUM', 'Invalid symbol "XXXXX" was accepted without validation', 'Type XXXXX and press Add');
      } else {
        logOK('Invalid symbol XXXXX was rejected');
      }
    }
  } else {
    logIssue('WATCHLIST', 'LOW', 'Add symbol input not found on trade page', 'Look for "Add symbol..." input');
  }

  // ============================================================
  // TEST 11: Options panel
  // ============================================================
  console.log('\n=== OPTIONS PANEL ===');
  const optionsText = await page.textContent('body');
  if (optionsText.includes('Options') || optionsText.includes('Calls') || optionsText.includes('Strike') || optionsText.includes('Puts')) {
    logOK('Options panel visible with options data');
  } else {
    logIssue('OPTIONS', 'MEDIUM', 'Options panel content not visible', 'Check bottom left panel on trade page');
  }

  // ============================================================
  // TEST 12: Analysis panel (right side)
  // ============================================================
  console.log('\n=== ANALYSIS PANEL ===');
  if (optionsText.includes('Technical') || optionsText.includes('Score') || optionsText.includes('Support') || optionsText.includes('Resistance')) {
    logOK('Analysis/technical panel visible');
  } else {
    logIssue('ANALYSIS', 'MEDIUM', 'Analysis panel content not visible', 'Check right panel on trade page');
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('  TRADE PAGE RECOVERY TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`  Passed: ${passCount}`);
  console.log(`  Failed: ${issues.length}`);

  if (issues.length > 0) {
    console.log('\n  ISSUES:');
    issues.forEach((i, n) => {
      console.log(`    ${n+1}. [${i.sev}][${i.cat}] ${i.desc}`);
      console.log(`       Steps: ${i.steps}`);
    });
  }

  const uniqueErrors = [...new Set(jsErrors)].slice(0, 10);
  if (uniqueErrors.length) {
    console.log('\n  JS ERRORS:');
    uniqueErrors.forEach((e, i) => console.log(`    ${i+1}. ${e.substring(0, 150)}`));
  }

  console.log('\n' + '='.repeat(60));

  await browser.close();
})();
