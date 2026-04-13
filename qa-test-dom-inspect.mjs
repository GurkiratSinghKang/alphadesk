import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const BASE = 'https://tradingalpha.net';
const SSDIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round7/workflows';

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Login
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  const inputs = await page.$$('input');
  for (const inp of inputs) {
    const type = await inp.getAttribute('type');
    if (type === 'password') await inp.fill('alphaDesk2025!');
    else if (type === 'text' || type === 'email' || !type) await inp.fill('admin');
  }
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 10000 }).catch(() => {});
  await sleep(3000);

  // Load trade and recover
  await page.goto(BASE + '/trade', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(5000);

  const bodyText = await page.textContent('body');
  if (bodyText.includes('Try Again')) {
    console.log('Clicking Try Again...');
    await page.click('button:has-text("Try Again")');
    await sleep(6000);
  }

  await page.screenshot({ path: path.join(SSDIR, 'dom-inspect.png'), fullPage: false });

  // Dump ALL buttons on the page with their text, attributes
  console.log('=== ALL BUTTONS ON PAGE ===');
  const buttons = await page.$$eval('button', btns =>
    btns.map(b => ({
      text: b.textContent?.trim().substring(0, 50),
      role: b.getAttribute('role'),
      ariaLabel: b.getAttribute('aria-label'),
      ariaHaspopup: b.getAttribute('aria-haspopup'),
      type: b.getAttribute('type'),
      disabled: b.disabled,
      className: b.className?.substring(0, 80),
      parentId: b.parentElement?.id,
      parentDataSlot: b.closest('[data-slot]')?.getAttribute('data-slot'),
    }))
  );

  for (const b of buttons) {
    console.log(`  "${b.text}" role=${b.role} aria-label="${b.ariaLabel}" haspopup=${b.ariaHaspopup} slot=${b.parentDataSlot}`);
  }

  // Dump all tab triggers
  console.log('\n=== ALL TAB TRIGGERS ===');
  const tabs = await page.$$eval('button[role="tab"], [role="tab"]', els =>
    els.map(e => ({
      text: e.textContent?.trim(),
      role: e.getAttribute('role'),
      value: e.getAttribute('value') || e.getAttribute('data-value'),
      ariaSelected: e.getAttribute('aria-selected'),
    }))
  );
  for (const t of tabs) {
    console.log(`  "${t.text}" role=${t.role} value=${t.value} selected=${t.ariaSelected}`);
  }

  // Dump all inputs
  console.log('\n=== ALL INPUTS ===');
  const allInputs = await page.$$eval('input', els =>
    els.map(e => ({
      type: e.getAttribute('type'),
      placeholder: e.getAttribute('placeholder'),
      ariaLabel: e.getAttribute('aria-label'),
      name: e.getAttribute('name'),
      value: e.value,
    }))
  );
  for (const inp of allInputs) {
    console.log(`  type=${inp.type} placeholder="${inp.placeholder}" aria-label="${inp.ariaLabel}" name="${inp.name}"`);
  }

  // Check data-slot elements
  console.log('\n=== DATA-SLOT ELEMENTS ===');
  const slots = await page.$$eval('[data-slot]', els =>
    els.map(e => ({
      slot: e.getAttribute('data-slot'),
      tag: e.tagName,
      childCount: e.children.length,
      textSnippet: e.textContent?.substring(0, 100),
    }))
  );
  for (const s of slots) {
    console.log(`  data-slot="${s.slot}" tag=${s.tag} children=${s.childCount}`);
  }

  // Check if chart panel has content after recovery
  console.log('\n=== CHART PANEL CONTENT CHECK ===');
  const chartPanel = await page.$('[data-slot="chart-panel"]');
  if (chartPanel) {
    const cpText = await chartPanel.textContent();
    console.log(`  Chart panel text (first 200 chars): ${cpText.substring(0, 200)}`);
    const cpButtons = await chartPanel.$$('button');
    console.log(`  Chart panel has ${cpButtons.length} buttons`);
    for (const btn of cpButtons) {
      const t = await btn.textContent();
      console.log(`    button: "${t.trim().substring(0, 40)}"`);
    }
  } else {
    console.log('  [!] No [data-slot="chart-panel"] found!');
    // Check for the error still being shown
    const errorText = await page.textContent('body');
    console.log(`  Body text (first 200): ${errorText.substring(0, 200)}`);
  }

  await browser.close();
})();
