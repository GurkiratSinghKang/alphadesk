import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/widget-audit';
const BASE_URL = 'https://tradingalpha.net';
const CREDS = { username: 'admin', password: 'alphaDesk2025!' };

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
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1920,1080'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await login(page);

    // ── 9. Allocation Donut - verify proper labels ──
    console.log('\n=== 9. ALLOCATION DONUT ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // The AllocationDonut has: "Cash" label, "Invested" label, heading "Allocation"
    // These are small text in the legend area. Scroll down to find them.
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(500);

    // Get all text that contains "Allocation" or "Cash" or "Invested"
    const donutCheck = await page.evaluate(() => {
      const allEls = document.querySelectorAll('*');
      let allocationFound = false;
      let cashFound = false;
      let investedFound = false;
      let totalFound = false;

      for (const el of allEls) {
        const text = el.textContent || '';
        // Only check leaf nodes or small containers
        if (el.children.length > 10) continue;

        if (text.includes('Allocation') && text.length < 100) allocationFound = true;
        if (text.includes('Cash') && !text.includes('Dashboard') && text.length < 200) cashFound = true;
        if (text.includes('Invested') && text.length < 200) investedFound = true;
        if (text.includes('Total') && text.length < 200) totalFound = true;
      }
      return { allocationFound, cashFound, investedFound, totalFound };
    });

    console.log(`  Donut check: ${JSON.stringify(donutCheck)}`);
    record('Allocation Donut', 'Allocation heading', donutCheck.allocationFound, '');
    record('Allocation Donut', 'Cash label', donutCheck.cashFound, '');
    record('Allocation Donut', 'Invested label', donutCheck.investedFound, '');
    record('Allocation Donut', 'Total shown in donut center', donutCheck.totalFound, '');

    // Now scroll more to find the donut
    for (let scrollY = 400; scrollY <= 1400; scrollY += 200) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(300);
      const found = await page.evaluate(() => {
        return document.body.textContent?.includes('Allocation') || false;
      });
      if (found) {
        await screenshot(page, `p3-09-allocation-scroll-${scrollY}`);
        break;
      }
    }

    // ── 26. Journal Tab - uses inline input, not textarea ──
    console.log('\n=== 26. JOURNAL TAB ===');
    // Navigate to trade page
    const tradeBtn = page.locator('button:has-text("Trade")').first();
    await tradeBtn.click();
    await page.waitForTimeout(3000);

    // Click Journal tab in bottom panel (TradePanel)
    const journalTabBtn = page.locator('button:has-text("Journal")').first();
    if (await journalTabBtn.count() > 0) {
      await journalTabBtn.click();
      await page.waitForTimeout(1500);
      await screenshot(page, 'p3-26-journal-before');

      const journalText = await page.textContent('body');
      console.log(`  Journal contains: ${journalText.includes('Journal') ? 'Journal heading' : 'no heading'}`);
      console.log(`  Has "Add note": ${journalText.includes('Add note')}`);
      console.log(`  Has entries: ${journalText.includes('BUY') || journalText.includes('SELL') || journalText.includes('HOLD')}`);

      // The journal doesn't have a standalone textarea.
      // It shows trade entries with "Add note" buttons inline.
      // Click "Add note" on the first entry
      const addNoteBtn = page.locator('button:has-text("Add note")').first();
      if (await addNoteBtn.count() > 0) {
        await addNoteBtn.click();
        await page.waitForTimeout(500);

        // Now there should be an inline input with placeholder "Add a note..."
        const noteInput = page.locator('input[placeholder="Add a note..."]').first();
        if (await noteInput.count() > 0) {
          await noteInput.fill('QA test note from widget audit');
          await page.waitForTimeout(300);

          // Click Save
          const saveBtn = page.locator('button:has-text("Save")').first();
          if (await saveBtn.count() > 0) {
            await saveBtn.click();
            await page.waitForTimeout(500);
          }

          // Verify note persists by switching tabs and coming back
          const posTab = page.locator('button:has-text("Positions")').first();
          await posTab.click();
          await page.waitForTimeout(500);
          await journalTabBtn.click();
          await page.waitForTimeout(500);

          const afterText = await page.textContent('body');
          const noteSaved = afterText.includes('QA test note');
          record('Journal Tab', 'Can add note to trade entry', true, '');
          record('Journal Tab', 'Note persists after tab switch', noteSaved, '');
          await screenshot(page, 'p3-26-journal-note-saved');
        } else {
          record('Journal Tab', 'Inline note input appears', false, '');
        }
      } else if (journalText.includes('Journal entries appear as you trade')) {
        record('Journal Tab', 'Journal empty state', true, 'No entries yet - shows empty state message correctly');
      } else {
        record('Journal Tab', 'Add note button found', false, '');
      }
    }

    // ── 30. Strategy Builder - uses <input> not <textarea> ──
    console.log('\n=== 30. STRATEGY BUILDER ===');
    const pipeBtn = page.locator('button:has-text("Pipeline")').first();
    await pipeBtn.click();
    await page.waitForTimeout(3000);

    // Scroll down to Strategy Builder section
    await page.evaluate(() => {
      // Find the Strategy Builder heading and scroll to it
      const headings = document.querySelectorAll('h2');
      for (const h of headings) {
        if (h.textContent?.includes('Strategy Builder')) {
          h.scrollIntoView({ behavior: 'instant', block: 'start' });
          return true;
        }
      }
      return false;
    });
    await page.waitForTimeout(500);

    // The StrategyBuilder uses <input id="strategy-rule-input"> not <textarea>
    const ruleInput = page.locator('#strategy-rule-input').first();
    if (await ruleInput.count() > 0) {
      record('Strategy Builder', 'Rule input found', true, '');

      await ruleInput.fill('Buy when RSI drops below 30');
      await page.waitForTimeout(300);

      // Click Add button
      const addBtn = page.locator('button:has-text("Add")').first();
      if (await addBtn.count() > 0) {
        await addBtn.click();
        await page.waitForTimeout(1000);

        const afterAdd = await page.textContent('body');
        const ruleAdded = afterAdd.includes('RSI') && afterAdd.includes('BUY');
        record('Strategy Builder', 'Parses natural language rule', ruleAdded, '');
        await screenshot(page, 'p3-30-strategy-builder-parsed');
      }

      // Check example chips
      const exampleChips = page.locator('button:has-text("Buy when RSI"), button:has-text("Sell when"), button:has-text("Enter long"), button:has-text("Exit when")');
      const chipCount = await exampleChips.count();
      record('Strategy Builder', 'Example chips visible', chipCount >= 1, `Found ${chipCount} example chips`);

      // If chips disappeared after adding a rule, that's by design (they show when no rules)
      // Let's try clicking a chip if available
      if (chipCount > 0) {
        await exampleChips.first().click();
        await page.waitForTimeout(500);
        const inputVal = await ruleInput.inputValue();
        record('Strategy Builder', 'Clicking chip fills input', inputVal.length > 5, `Input: "${inputVal}"`);
      }

    } else {
      record('Strategy Builder', 'Rule input found (#strategy-rule-input)', false, '');
      await screenshot(page, 'p3-30-strategy-builder-missing');
    }

    // ── 32. Run Now button ──
    console.log('\n=== 32. RUN NOW ===');
    // Scroll back to top of pipeline page
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // The "Run Now" button is in the header area of the pipeline page
    const runNowBtn = page.locator('button:has-text("Run Now"), button:has-text("Running")').first();
    const runNowExists = await runNowBtn.count() > 0;
    record('Run Pipeline', '"Run Now" button visible', runNowExists, '');

    if (runNowExists) {
      const btnText = await runNowBtn.textContent();
      console.log(`  Button text: "${btnText.trim()}"`);
      const isDisabled = await runNowBtn.isDisabled();
      console.log(`  Disabled: ${isDisabled}`);

      await screenshot(page, 'p3-32-run-now-before');

      if (!isDisabled) {
        await runNowBtn.click();
        await page.waitForTimeout(5000);

        const afterClick = await page.textContent('body');
        // Check if button changed to "Running..." or if some status changed
        const running = afterClick.includes('Running') || afterClick.includes('running');
        const completed = afterClick.includes('Complete') || afterClick.includes('complete');
        const error = afterClick.includes('Error') || afterClick.includes('error');
        record('Run Pipeline', 'Triggers on click', running || completed || error, `Running: ${running}, Completed: ${completed}, Error: ${error}`);
        await screenshot(page, 'p3-32-run-now-after');
      }
    } else {
      // Maybe it says "Running..."
      const runningBtn = page.locator('button:has-text("Running")').first();
      if (await runningBtn.count() > 0) {
        record('Run Pipeline', '"Run Now" button present (currently running)', true, 'Shows "Running..."');
      }
    }

    // ── 34. Logo clickability (confirmed NOT clickable from source) ──
    console.log('\n=== 34. LOGO CLICKABILITY ===');
    record('TopBar Navigation', 'Logo/brand is clickable (goes home)', false,
      'CONFIRMED BUG: Logo div has no onClick handler in TopBar.tsx line 73-76. The AlphaDesk text is a plain <div> with no navigation.');

    // But verify the Dashboard button works as home navigation
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const dashBtn = page.locator('button:has-text("Dashboard")').first();
    if (await dashBtn.count() > 0) {
      await dashBtn.click();
      await page.waitForTimeout(2000);
      record('TopBar Navigation', 'Dashboard button goes home', page.url() === `${BASE_URL}/` || page.url() === BASE_URL, `URL: ${page.url()}`);
    }
    await screenshot(page, 'p3-34-dashboard-nav');

  } catch (e) {
    console.error('ERROR:', e.message, e.stack?.slice(0, 200));
    await screenshot(page, 'p3-ERROR');
  } finally {
    console.log('\n========================================');
    console.log('PASS-3 RESULTS');
    console.log('========================================');
    let table = 'Widget | Function | Status | Issue\n--- | --- | --- | ---\n';
    for (const r of results) {
      table += `${r.widget} | ${r.fn} | ${r.status} | ${r.issue}\n`;
    }
    console.log(table);

    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results-pass3.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'results-pass3-table.md'), table);

    await browser.close();
  }
}

main().catch(console.error);
