import { chromium } from 'playwright';

const BASE = 'https://tradingalpha.net';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Dump all inputs
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
      tag: el.tagName,
      type: el.type,
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      className: el.className?.substring(0, 100),
      ariaLabel: el.getAttribute('aria-label'),
      value: el.value,
      outerHTML: el.outerHTML.substring(0, 200)
    }));
  });
  console.log('=== ALL INPUTS ===');
  console.log(JSON.stringify(inputs, null, 2));

  // Dump all buttons
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).map(el => ({
      tag: el.tagName,
      type: el.type,
      text: el.textContent?.trim()?.substring(0, 50),
      className: el.className?.substring(0, 100),
      outerHTML: el.outerHTML.substring(0, 200)
    }));
  });
  console.log('\n=== ALL BUTTONS ===');
  console.log(JSON.stringify(buttons, null, 2));

  // Dump form area HTML
  const formHTML = await page.evaluate(() => {
    const form = document.querySelector('form');
    if (form) return form.outerHTML.substring(0, 2000);
    // Look for sign-in section
    const signIn = Array.from(document.querySelectorAll('*')).find(el =>
      el.textContent?.includes('Sign In') && el.querySelector('input')
    );
    if (signIn) return signIn.outerHTML.substring(0, 2000);
    return 'No form found';
  });
  console.log('\n=== FORM HTML ===');
  console.log(formHTML);

  // Dump all text near inputs
  const formContext = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    return Array.from(inputs).map(inp => {
      const parent = inp.closest('div');
      return {
        inputHTML: inp.outerHTML,
        parentText: parent?.textContent?.trim()?.substring(0, 100),
        label: inp.labels?.[0]?.textContent
      };
    });
  });
  console.log('\n=== INPUT CONTEXT ===');
  console.log(JSON.stringify(formContext, null, 2));

  await browser.close();
})();
