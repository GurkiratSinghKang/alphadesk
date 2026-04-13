import { chromium } from 'playwright';
import { join } from 'path';

const BASE = 'https://tradingalpha.net';
const DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round7/visual';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Helper: screenshot with name
  async function snap(name) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(DIR, `${name}.png`), fullPage: false });
    console.log(`  [SNAP] ${name}.png`);
  }

  async function snapFull(name) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(DIR, `${name}.png`), fullPage: true });
    console.log(`  [SNAP-FULL] ${name}.png`);
  }

  // ─── 1. LOGIN PAGE ───
  console.log('\n=== LOGIN PAGE ===');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await snap('01_login_page');

  // ─── 2. PERFORM LOGIN ───
  console.log('\n=== LOGGING IN ===');
  await page.fill('input[type="text"], input[name="username"], input[placeholder*="user" i], input[placeholder*="email" i]', 'admin');
  await page.fill('input[type="password"]', 'alphaDesk2025!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await snap('02_post_login');

  // ─── 3. DASHBOARD ───
  console.log('\n=== DASHBOARD ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await snap('03_dashboard_top');

  // Scroll through dashboard
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await snap('04_dashboard_mid');

  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await snap('05_dashboard_bottom');

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await snap('06_dashboard_end');

  // Also get a full page screenshot
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await snapFull('07_dashboard_full');

  // ─── 4. TRADE PAGE ───
  console.log('\n=== TRADE PAGE ===');
  await page.goto(`${BASE}/trade`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await snap('08_trade_top');

  // Check for tabs on trade page
  const tradeTabs = await page.$$('button[role="tab"], [data-tab], .tab, [class*="tab"]');
  console.log(`  Found ${tradeTabs.length} potential tabs on trade page`);

  // Try clicking each tab and screenshot
  let tabIdx = 0;
  for (const tab of tradeTabs.slice(0, 6)) {
    try {
      const label = await tab.textContent();
      if (label && label.trim().length > 0 && label.trim().length < 30) {
        await tab.click();
        await page.waitForTimeout(1500);
        await snap(`09_trade_tab_${tabIdx}_${label.trim().replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)}`);
        tabIdx++;
      }
    } catch (e) {}
  }

  // Scroll trade page
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await snap('10_trade_scrolled');
  await snapFull('11_trade_full');

  // ─── 5. PIPELINE PAGE ───
  console.log('\n=== PIPELINE PAGE ===');
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await snap('12_pipeline_top');
  await snapFull('13_pipeline_full');

  // ─── 6. STRATEGIES ───
  console.log('\n=== STRATEGY: PEAD ===');
  await page.goto(`${BASE}/strategies/pead`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await snap('14_pead_top');

  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await snap('15_pead_mid');
  await page.evaluate(() => window.scrollTo(0, 0));
  await snapFull('16_pead_full');

  console.log('\n=== STRATEGY: MOMENTUM QUALITY ===');
  await page.goto(`${BASE}/strategies/momentum-quality`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await snap('17_momentum_top');

  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await snap('18_momentum_mid');
  await page.evaluate(() => window.scrollTo(0, 0));
  await snapFull('19_momentum_full');

  // ─── 7. STATIC PAGES ───
  console.log('\n=== STATIC PAGES ===');
  for (const pg of ['privacy', 'terms', 'risk', 'docs']) {
    await page.goto(`${BASE}/${pg}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await snap(`20_${pg}`);
    await snapFull(`21_${pg}_full`);
  }

  // ─── 8. COMMAND PALETTE (Ctrl+K) ───
  console.log('\n=== COMMAND PALETTE ===');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(1500);
  await snap('30_command_palette');
  // Type something to see search results
  await page.keyboard.type('trade');
  await page.waitForTimeout(1000);
  await snap('31_command_palette_search');
  await page.keyboard.press('Escape');

  // ─── 9. PROFILE MENU ───
  console.log('\n=== PROFILE MENU ===');
  await page.waitForTimeout(500);
  // Try various selectors for profile/avatar button
  const profileBtn = await page.$('[class*="avatar"], [class*="profile"], [class*="user-menu"], button:has(img[alt*="avatar" i]), [aria-label*="profile" i], [aria-label*="user" i]');
  if (profileBtn) {
    await profileBtn.click();
    await page.waitForTimeout(1000);
    await snap('32_profile_menu');
  } else {
    // Try clicking in top-right corner area where profile usually is
    const btns = await page.$$('button');
    for (const btn of btns.slice(-5)) {
      const text = await btn.textContent();
      const box = await btn.boundingBox();
      if (box && box.x > 1600) {
        await btn.click();
        await page.waitForTimeout(1000);
        await snap('32_profile_menu');
        break;
      }
    }
  }

  // ─── 10. KEYBOARD SHORTCUTS (?) ───
  console.log('\n=== KEYBOARD SHORTCUTS ===');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('?');
  await page.waitForTimeout(1500);
  await snap('33_keyboard_shortcuts');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Also try Shift+?
  await page.keyboard.press('Shift+/');
  await page.waitForTimeout(1500);
  await snap('34_keyboard_shortcuts_alt');

  await browser.close();
  console.log('\n=== AUDIT COMPLETE ===');
})();
