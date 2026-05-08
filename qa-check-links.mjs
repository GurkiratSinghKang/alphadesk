import { chromium } from 'playwright';

const QA_USERNAME = process.env.ALPHADESK_QA_USERNAME || "admin";
function getQaPassword() {
  const password = process.env.ALPHADESK_QA_PASSWORD;
  if (!password) {
    throw new Error("ALPHADESK_QA_PASSWORD is required for authenticated QA login");
  }
  return password;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });

  // Check login page footer links
  await page.goto('https://tradingalpha.net', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const footerLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    return links.map(a => ({ text: a.textContent?.trim(), href: a.href }))
                .filter(l => l.text && (l.text.includes('Privacy') || l.text.includes('Terms') || l.text.includes('Risk') || l.text.includes('Doc') || l.text.includes('Setting')));
  });
  console.log('Footer/legal links:', JSON.stringify(footerLinks, null, 2));

  // Also check all nav links after login
  const userInput = page.locator('#login-username');
  const passInput = page.locator('#login-password');
  await userInput.fill(QA_USERNAME);
  await passInput.fill(getQaPassword());
  await page.locator('button[type="submit"]').click({ force: true });
  await page.waitForTimeout(5000);

  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => ({ text: a.textContent?.trim()?.substring(0, 40), href: a.href }));
  });
  console.log('\nAll links after login:', JSON.stringify(allLinks, null, 2));

  // Check logo
  const logoInfo = await page.evaluate(() => {
    const candidates = document.querySelectorAll('[class*="logo"], [class*="Logo"], a > svg, header a:first-child, nav a:first-child');
    return Array.from(candidates).map(el => ({
      tag: el.tagName,
      href: el.href || el.closest('a')?.href,
      cls: el.className?.toString?.()?.substring(0, 60),
      text: el.textContent?.trim()?.substring(0, 30)
    }));
  });
  console.log('\nLogo elements:', JSON.stringify(logoInfo, null, 2));

  // Check nav structure
  const navInfo = await page.evaluate(() => {
    const nav = document.querySelector('header, nav, [class*="header"], [class*="navbar"]');
    if (!nav) return 'No nav found';
    // Check if buttons are used for navigation instead of <a> tags
    const buttons = Array.from(nav.querySelectorAll('button')).map(b => b.textContent?.trim()?.substring(0, 30));
    const links = Array.from(nav.querySelectorAll('a')).map(a => ({ text: a.textContent?.trim()?.substring(0, 30), href: a.href }));
    return { buttons, links };
  });
  console.log('\nNav structure:', JSON.stringify(navInfo, null, 2));

  // Check strategy links on dashboard
  const strategyInfo = await page.evaluate(() => {
    const all = document.querySelectorAll('[class*="strateg"], [class*="Strateg"]');
    return Array.from(all).slice(0, 10).map(el => ({
      tag: el.tagName,
      cls: el.className?.toString?.()?.substring(0, 60),
      text: el.textContent?.trim()?.substring(0, 60),
      hasLink: !!el.querySelector('a') || el.tagName === 'A',
      href: el.href || el.querySelector('a')?.href
    }));
  });
  console.log('\nStrategy elements:', JSON.stringify(strategyInfo, null, 2));

  // Check for "loading" or "spinner" text in loaded analytics page
  await page.goto('https://tradingalpha.net/analytics', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(6000);
  const loadingCheck = await page.evaluate(() => {
    const html = document.body.innerHTML.toLowerCase();
    const matches = [];
    if (html.includes('spinner')) matches.push('spinner in HTML');
    if (html.includes('loading')) matches.push('loading in HTML');
    // Check for visible loading elements
    const visibleLoading = Array.from(document.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="Loading"], [class*="Spinner"]'))
      .filter(el => el.offsetParent !== null);
    if (visibleLoading.length > 0) matches.push(`${visibleLoading.length} visible loading elements`);
    return matches;
  });
  console.log('\nLoading state on analytics after 6s:', JSON.stringify(loadingCheck));

  await browser.close();
})();
