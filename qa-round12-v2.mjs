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

const SCREENSHOT_DIR = '/Users/GK/Downloads/alphadesk/qa-screenshots/round12';
const BASE_URL = 'https://tradingalpha.net';
const bugs = [];

function reportBug(description, severity, screenshot, steps) {
  bugs.push({ description, severity, screenshot, steps });
  console.log(`[BUG ${severity}] ${description}`);
}

function log(msg) {
  console.log(`[INFO] ${msg}`);
}

async function ss(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  log(`Screenshot: ${name}.png`);
  return filePath;
}

(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Track console and network errors per-page
  const allConsoleErrors = [];
  const allNetworkErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      allConsoleErrors.push({ text: msg.text(), url: page.url() });
    }
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      allNetworkErrors.push({ url: response.url(), status: response.status(), page: page.url() });
    }
  });

  // ===== LOGIN =====
  log('=== LOGIN ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Dump HTML of the login form to understand structure
  const loginFormHtml = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    return Array.from(inputs).map(i => ({
      tag: i.tagName,
      type: i.type,
      name: i.name,
      id: i.id,
      placeholder: i.placeholder,
      className: i.className.substring(0, 100),
      autoComplete: i.autocomplete,
    }));
  });
  log(`Login inputs found: ${JSON.stringify(loginFormHtml)}`);

  // Try to find inputs by any means
  const allInputs = await page.$$('input');
  log(`Total input elements: ${allInputs.length}`);

  if (allInputs.length >= 2) {
    // First input = username, second = password
    await allInputs[0].fill(QA_USERNAME);
    await allInputs[1].fill(getQaPassword());

    // Find submit button
    const buttons = await page.$$('button');
    const buttonTexts = await Promise.all(buttons.map(b => b.textContent()));
    log(`Buttons: ${buttonTexts.map(t => t.trim()).join(', ')}`);

    // Click Sign In
    for (const btn of buttons) {
      const text = (await btn.textContent()).trim();
      if (text.includes('Sign') || text.includes('Login') || text.includes('Submit')) {
        await btn.click();
        break;
      }
    }

    await page.waitForTimeout(5000);
    const currentUrl = page.url();
    log(`After login URL: ${currentUrl}`);

    if (currentUrl.includes('login')) {
      reportBug('Login does not redirect after valid credentials', 'P0', 'login-stuck', 'Enter configured QA credentials, click Sign In, stays on login page');
      await ss(page, 'login-stuck');
    } else {
      log('Login successful!');
    }
  } else {
    reportBug('Login form has fewer than 2 input fields', 'P0', 'login-no-inputs', 'Navigate to /login');
    await ss(page, 'login-no-inputs');
  }

  await ss(page, '00-after-login');

  // ===== PHASE 1: Dashboard =====
  log('\n=== PHASE 1: Dashboard ===');

  // Make sure we're on the dashboard
  if (!page.url().includes('login')) {
    await page.waitForTimeout(3000);
  } else {
    // Try API-based login
    log('Trying API-based login...');
    const authCreds = { username: QA_USERNAME, password: getQaPassword() };
    const loginResp = await page.evaluate(async ({ username, password }) => {
      try {
        const resp = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ username, password }).toString()
        });
        const data = await resp.json();
        return { status: resp.status, data };
      } catch (e) {
        return { error: e.message };
      }
    }, authCreds);
    log(`API login response: ${JSON.stringify(loginResp)}`);

    if (loginResp.data?.access_token) {
      // Store token and navigate
      await page.evaluate(token => {
        localStorage.setItem('token', token);
        localStorage.setItem('access_token', token);
      }, loginResp.data.access_token);
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
      log(`After token-set URL: ${page.url()}`);
    }
  }

  await ss(page, '01-dashboard');

  // Check if we're actually logged in by looking for dashboard content
  const dashContent = await page.evaluate(() => {
    return {
      bodyText: document.body.innerText.substring(0, 500),
      hasLogin: document.body.innerText.includes('Sign In'),
      url: window.location.href,
    };
  });
  log(`Dashboard state: url=${dashContent.url}, hasLogin=${dashContent.hasLogin}`);
  log(`Dashboard content preview: ${dashContent.bodyText.substring(0, 200)}`);

  if (dashContent.hasLogin) {
    // We're still on login page, try different approach
    log('Still on login page. Trying form submission via JS...');

    // Try fetching the auth endpoint differently (JSON body)
    const authCreds = { username: QA_USERNAME, password: getQaPassword() };
    const loginResp2 = await page.evaluate(async ({ username, password }) => {
      try {
        const resp = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        return { status: resp.status, text: await resp.text() };
      } catch (e) {
        return { error: e.message };
      }
    }, authCreds);
    log(`API login v2: ${JSON.stringify(loginResp2)}`);

    // Also try OAuth2 form style
    const loginResp3 = await page.evaluate(async ({ username, password }) => {
      try {
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);
        const resp = await fetch('/api/v1/auth/login', {
          method: 'POST',
          body: formData
        });
        return { status: resp.status, text: await resp.text() };
      } catch (e) {
        return { error: e.message };
      }
    }, authCreds);
    log(`API login v3 (FormData): ${JSON.stringify(loginResp3)}`);

    // Try /auth/token endpoint (FastAPI default)
    const loginResp4 = await page.evaluate(async ({ username, password }) => {
      try {
        const resp = await fetch('/api/v1/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ username, password }).toString()
        });
        return { status: resp.status, text: await resp.text() };
      } catch (e) {
        return { error: e.message };
      }
    }, authCreds);
    log(`API login v4 (/auth/token): ${JSON.stringify(loginResp4)}`);
  }

  // At this point check what the backend expects
  log('Checking backend API endpoints...');
  const apiCheck = await page.evaluate(async () => {
    const endpoints = [
      '/api/v1/auth/login',
      '/api/v1/auth/token',
      '/api/auth/login',
      '/auth/login',
      '/api/login'
    ];
    const results = {};
    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, { method: 'OPTIONS' });
        results[ep] = resp.status;
      } catch (e) {
        results[ep] = 'error';
      }
    }
    return results;
  });
  log(`API endpoint check: ${JSON.stringify(apiCheck)}`);

  // Get the frontend code to understand auth flow
  await ss(page, '01b-current-state');

  await browser.close();
  log('\nScript complete. Need to understand login flow first.');
})();
