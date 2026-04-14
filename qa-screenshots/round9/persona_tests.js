/**
 * AlphaDesk 20-Persona QA Test Suite
 * Tests the app at https://tradingalpha.net as 20 different user personas.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://tradingalpha.net';
const SCREENSHOT_DIR = path.join(__dirname);
const LOGIN_USER = 'admin';
const LOGIN_PASS = 'alphaDesk2025!';

const results = {};

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  const userInput = page.locator('input[type="text"], input[name="username"], input[placeholder*="user" i], input[placeholder*="email" i]').first();
  const passInput = page.locator('input[type="password"]').first();
  await userInput.fill(LOGIN_USER);
  await passInput.fill(LOGIN_PASS);
  const loginBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In"), button:has-text("Log in")').first();
  await loginBtn.click();
  await page.waitForTimeout(3000);
}

// ========================================
// PERSONA 1: Day Trader
// ========================================
async function persona1_dayTrader(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);
    await screenshot(page, '01_daytrader_dashboard');

    // Try switching to 1m chart
    const chartLinks = page.locator('a[href*="chart"], button:has-text("Chart"), a:has-text("Chart")');
    if (await chartLinks.count() > 0) {
      await chartLinks.first().click();
      await page.waitForTimeout(2000);
      worked.push('Found chart section');
    } else {
      issues.push('No chart section found in navigation');
    }

    // Look for timeframe selectors
    const tf1m = page.locator('button:has-text("1m"), button:has-text("1M"), [data-timeframe="1m"]');
    const tf5m = page.locator('button:has-text("5m"), button:has-text("5M"), [data-timeframe="5m"]');
    if (await tf1m.count() > 0) {
      await tf1m.first().click();
      await page.waitForTimeout(1000);
      worked.push('1m timeframe available');
    } else {
      issues.push('No 1-minute timeframe selector found');
    }
    if (await tf5m.count() > 0) {
      worked.push('5m timeframe available');
    } else {
      issues.push('No 5-minute timeframe selector found');
    }

    // Look for quick order / BUY button
    const buyBtn = page.locator('button:has-text("Buy"), button:has-text("BUY"), button:has-text("Quick Order")');
    if (await buyBtn.count() > 0) {
      worked.push('BUY button present');
      await buyBtn.first().click();
      await page.waitForTimeout(1000);
      await screenshot(page, '01_daytrader_buy');
    } else {
      issues.push('No quick BUY button found for fast order entry');
    }

    await screenshot(page, '01_daytrader_final');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Day Trader', tried: 'Switch to 1m/5m charts, find quick BUY button', worked, issues };
}

// ========================================
// PERSONA 2: Swing Trader
// ========================================
async function persona2_swingTrader(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);

    // Navigate to strategies or charts for daily/weekly analysis
    const stratLinks = page.locator('a[href*="strat"], a:has-text("Strategies"), a:has-text("Strategy")');
    if (await stratLinks.count() > 0) {
      await stratLinks.first().click();
      await page.waitForTimeout(2000);
      worked.push('Found strategies section');
    }

    // Check for RSI/MACD indicators
    const pageText = await page.textContent('body');
    if (pageText.includes('RSI')) worked.push('RSI indicator mentioned');
    else issues.push('No RSI indicator data visible');
    if (pageText.includes('MACD')) worked.push('MACD indicator mentioned');
    else issues.push('No MACD indicator data visible');

    // Look for daily/weekly timeframes
    const tfD = page.locator('button:has-text("1D"), button:has-text("Daily"), button:has-text("D")');
    const tfW = page.locator('button:has-text("1W"), button:has-text("Weekly"), button:has-text("W")');
    if (await tfD.count() > 0) worked.push('Daily timeframe available');
    else issues.push('No daily timeframe selector');
    if (await tfW.count() > 0) worked.push('Weekly timeframe available');
    else issues.push('No weekly timeframe selector');

    await screenshot(page, '02_swingtrader');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Swing Trader', tried: 'Check daily/weekly charts, RSI/MACD indicators', worked, issues };
}

// ========================================
// PERSONA 3: Options Trader
// ========================================
async function persona3_optionsTrader(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);
    const pageText = await page.textContent('body');

    // Check for options chain
    const optionsLinks = page.locator('a:has-text("Options"), a[href*="option"], button:has-text("Options Chain")');
    if (await optionsLinks.count() > 0) {
      await optionsLinks.first().click();
      await page.waitForTimeout(2000);
      worked.push('Found options section');
    } else {
      issues.push('No options chain or options page found');
    }

    // Check for IV data
    if (pageText.includes('IV Rank') || pageText.includes('iv_rank') || pageText.includes('Implied Volatility')) {
      worked.push('IV data visible somewhere');
    } else {
      issues.push('No IV Rank or implied volatility data visible');
    }

    // Check for multi-leg strategies
    if (pageText.includes('Spread') || pageText.includes('Straddle') || pageText.includes('Iron Condor')) {
      worked.push('Multi-leg strategy terms found');
    } else {
      issues.push('No multi-leg options strategy support (spreads, straddles)');
    }

    await screenshot(page, '03_options_trader');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Options Trader', tried: 'Find options chain, IV data, multi-leg strategies', worked, issues };
}

// ========================================
// PERSONA 4: Portfolio Manager
// ========================================
async function persona4_portfolioManager(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);
    await screenshot(page, '04_pm_dashboard');

    const pageText = await page.textContent('body');

    // Check dashboard elements
    if (pageText.includes('Equity') || pageText.includes('equity') || pageText.includes('Portfolio Value')) {
      worked.push('Portfolio equity/value displayed');
    } else {
      issues.push('No portfolio equity or value displayed on dashboard');
    }

    if (pageText.includes('P&L') || pageText.includes('Profit') || pageText.includes('pnl')) {
      worked.push('P&L data visible');
    } else {
      issues.push('No P&L data visible');
    }

    // Check for allocation donut/chart
    const svgElements = page.locator('svg, canvas, .chart, .donut, [class*="chart"]');
    if (await svgElements.count() > 0) {
      worked.push('Charts/visualizations present');
    } else {
      issues.push('No allocation charts or donut charts found');
    }

    // Check for positions
    const posLink = page.locator('a:has-text("Position"), a[href*="position"], a:has-text("Portfolio")');
    if (await posLink.count() > 0) {
      await posLink.first().click();
      await page.waitForTimeout(2000);
      await screenshot(page, '04_pm_positions');
      worked.push('Positions page accessible');
    }

    await screenshot(page, '04_pm_final');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Portfolio Manager', tried: 'Check dashboard, allocation charts, open positions, P&L', worked, issues };
}

// ========================================
// PERSONA 5: Quant/Algo Trader
// ========================================
async function persona5_quantTrader(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);

    // Navigate to strategies
    const stratLink = page.locator('a:has-text("Strategies"), a[href*="strat"]').first();
    if (await stratLink.count() > 0) {
      await stratLink.click();
      await page.waitForTimeout(2000);
      worked.push('Strategies page loaded');
      await screenshot(page, '05_quant_strategies');
    } else {
      issues.push('No strategies page found');
    }

    // Check for backtest
    const backtestLink = page.locator('a:has-text("Backtest"), a[href*="backtest"], button:has-text("Backtest")');
    if (await backtestLink.count() > 0) {
      await backtestLink.first().click();
      await page.waitForTimeout(2000);
      worked.push('Backtest page accessible');
      await screenshot(page, '05_quant_backtest');
    } else {
      issues.push('No backtest page or button found');
    }

    // Check pipeline
    const pipelineLink = page.locator('a:has-text("Pipeline"), a[href*="pipeline"]');
    if (await pipelineLink.count() > 0) {
      await pipelineLink.first().click();
      await page.waitForTimeout(2000);
      worked.push('Pipeline page accessible');
      await screenshot(page, '05_quant_pipeline');
    } else {
      issues.push('No pipeline page found');
    }

    await screenshot(page, '05_quant_final');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Quant/Algo Trader', tried: 'Check strategy pages, run backtest, check pipeline', worked, issues };
}

// ========================================
// PERSONA 6: Risk Manager
// ========================================
async function persona6_riskManager(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);
    const pageText = await page.textContent('body');

    // Check for risk metrics
    if (pageText.includes('VaR') || pageText.includes('Value at Risk')) worked.push('VaR metric visible');
    else issues.push('No VaR data visible');

    if (pageText.includes('Drawdown') || pageText.includes('drawdown')) worked.push('Drawdown data visible');
    else issues.push('No drawdown metric visible');

    if (pageText.includes('Regime') || pageText.includes('regime') || pageText.includes('VIX')) worked.push('Regime/VIX indicator visible');
    else issues.push('No regime or VIX indicator visible on dashboard');

    // Navigate to portfolio view
    const portLink = page.locator('a:has-text("Portfolio"), a[href*="portfolio"]');
    if (await portLink.count() > 0) {
      await portLink.first().click();
      await page.waitForTimeout(2000);
      worked.push('Portfolio page accessible');
    }

    if (pageText.includes('Exposure') || pageText.includes('exposure')) worked.push('Exposure data visible');
    else issues.push('No exposure data visible');

    await screenshot(page, '06_risk_manager');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Risk Manager', tried: 'Check exposure data, drawdown, VaR, regime indicator', worked, issues };
}

// ========================================
// PERSONA 7: New User (First Time)
// ========================================
async function persona7_newUser(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    // Check landing page before login
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const landingText = await page.textContent('body');
    await screenshot(page, '07_newuser_landing');

    if (landingText.includes('trading') || landingText.includes('Trading') || landingText.includes('AlphaDesk')) {
      worked.push('Landing page explains what the app does');
    } else {
      issues.push('Landing page does not clearly explain what the app is for');
    }

    // Look for sign up
    const signupBtn = page.locator('a:has-text("Sign Up"), button:has-text("Register"), a:has-text("Create Account"), a:has-text("Sign up")');
    if (await signupBtn.count() > 0) {
      worked.push('Sign up option available');
    } else {
      issues.push('No sign up / register option found for new users');
    }

    // Look for docs / help
    const docsLink = page.locator('a:has-text("Docs"), a:has-text("Help"), a:has-text("Documentation"), a:has-text("Guide")');
    if (await docsLink.count() > 0) {
      worked.push('Documentation/help link found');
    } else {
      issues.push('No documentation or help link for new users');
    }

    await screenshot(page, '07_newuser_final');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'New User', tried: 'Understand landing page, find sign up, look for docs', worked, issues };
}

// ========================================
// PERSONA 8: Mobile User
// ========================================
async function persona8_mobileUser(browser) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);
    await screenshot(page, '08_mobile_dashboard');

    // Check if dashboard is usable on mobile
    const body = await page.locator('body').boundingBox();
    if (body) {
      worked.push(`Page renders at mobile width (${body.width}px)`);
    }

    // Check for horizontal scrollbar
    const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (hasHScroll) {
      issues.push('Horizontal scroll detected on mobile -- content overflows viewport');
    } else {
      worked.push('No horizontal overflow on mobile');
    }

    // Check if navigation is accessible
    const hamburger = page.locator('button[aria-label*="menu" i], button:has-text("Menu"), .hamburger, [class*="mobile-menu"], [class*="drawer"]');
    const nav = page.locator('nav, [role="navigation"]');
    if (await hamburger.count() > 0 || await nav.count() > 0) {
      worked.push('Mobile navigation found');
    } else {
      issues.push('No mobile navigation menu (hamburger) found');
    }

    // Try navigating
    const links = page.locator('a[href]');
    const linkCount = await links.count();
    if (linkCount > 3) {
      await links.nth(Math.min(2, linkCount - 1)).click();
      await page.waitForTimeout(2000);
      worked.push('Navigation works on mobile');
    }

    await screenshot(page, '08_mobile_nav');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Mobile User', tried: 'Login on mobile, check dashboard, navigate', worked, issues };
}

// ========================================
// PERSONA 9: Keyboard-Only User
// ========================================
async function persona9_keyboardUser(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Tab through the login form
    let tabCount = 0;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      tabCount++;
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? { tag: el.tagName, type: el.type || '', text: el.textContent?.substring(0, 30) || '' } : null;
      });
      if (focused && (focused.tag === 'INPUT' || focused.tag === 'BUTTON')) {
        break;
      }
    }

    if (tabCount < 10) {
      worked.push('Can Tab to form inputs');
    } else {
      issues.push('Could not Tab to form inputs within 10 presses');
    }

    // Login with keyboard
    await login(page);

    // Tab through main navigation
    let foundNavItems = 0;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const outline = window.getComputedStyle(el).outline;
        return {
          tag: el.tagName,
          text: el.textContent?.substring(0, 30) || '',
          hasVisibleFocus: outline !== 'none' && outline !== '' && outline !== '0px none rgb(0, 0, 0)',
          role: el.getAttribute('role') || ''
        };
      });
      if (focused && (focused.tag === 'A' || focused.tag === 'BUTTON')) foundNavItems++;
    }

    if (foundNavItems > 3) {
      worked.push(`Can Tab through ${foundNavItems} interactive elements`);
    } else {
      issues.push('Cannot Tab through navigation -- few or no focusable elements');
    }

    // Check focus visibility
    const focusVisible = await page.evaluate(() => {
      document.querySelectorAll('a, button').forEach(el => el.focus());
      const el = document.activeElement;
      if (!el) return false;
      const outline = window.getComputedStyle(el).outline;
      return outline !== 'none' && outline !== '';
    });
    if (focusVisible) worked.push('Focus indicators visible');
    else issues.push('No visible focus indicators on interactive elements');

    await screenshot(page, '09_keyboard');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Keyboard-Only User', tried: 'Navigate full app using only Tab/Enter/Escape', worked, issues };
}

// ========================================
// PERSONA 10: Screen Reader User
// ========================================
async function persona10_screenReaderUser(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);

    // Check for h1
    const h1Count = await page.locator('h1').count();
    if (h1Count > 0) worked.push(`Found ${h1Count} h1 heading(s)`);
    else issues.push('No h1 heading found -- screen readers need heading structure');

    // Check heading hierarchy
    const headings = await page.evaluate(() => {
      const hs = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      return Array.from(hs).map(h => ({ level: parseInt(h.tagName[1]), text: h.textContent?.substring(0, 40) }));
    });
    if (headings.length > 2) worked.push(`${headings.length} headings found`);
    else issues.push(`Only ${headings.length} heading(s) found -- weak heading structure`);

    // Check buttons have labels
    const unlabeledBtns = await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      let unlabeled = 0;
      btns.forEach(b => {
        const hasLabel = b.textContent?.trim() || b.getAttribute('aria-label') || b.getAttribute('title');
        if (!hasLabel) unlabeled++;
      });
      return { total: btns.length, unlabeled };
    });
    if (unlabeledBtns.unlabeled === 0) worked.push(`All ${unlabeledBtns.total} buttons are labeled`);
    else issues.push(`${unlabeledBtns.unlabeled}/${unlabeledBtns.total} buttons have no accessible label`);

    // Check images have alt text
    const imgs = await page.evaluate(() => {
      const images = document.querySelectorAll('img');
      let noAlt = 0;
      images.forEach(img => { if (!img.alt) noAlt++; });
      return { total: images.length, noAlt };
    });
    if (imgs.total > 0 && imgs.noAlt > 0) {
      issues.push(`${imgs.noAlt}/${imgs.total} images missing alt text`);
    } else if (imgs.total > 0) {
      worked.push('All images have alt text');
    }

    // Check ARIA landmarks
    const landmarks = await page.evaluate(() => {
      const roles = ['main', 'navigation', 'banner', 'contentinfo', 'complementary'];
      const found = {};
      roles.forEach(r => {
        found[r] = document.querySelectorAll(`[role="${r}"], ${r === 'banner' ? 'header' : r === 'contentinfo' ? 'footer' : r === 'navigation' ? 'nav' : r}`).length;
      });
      return found;
    });
    if (landmarks.main > 0 || landmarks.navigation > 0) worked.push('ARIA landmarks present');
    else issues.push('No ARIA landmarks (main, navigation, etc.) found');

    await screenshot(page, '10_screenreader');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Screen Reader User', tried: 'Check aria labels, heading structure, landmarks', worked, issues };
}

// ========================================
// PERSONA 11: Impatient User
// ========================================
async function persona11_impatientUser(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);

    // Rapid page switching -- click multiple nav items fast
    const navLinks = await page.locator('nav a, aside a, [class*="sidebar"] a').all();
    const clickedPages = [];
    let errors = 0;

    for (let i = 0; i < Math.min(navLinks.length, 8); i++) {
      try {
        const href = await navLinks[i].getAttribute('href');
        const text = (await navLinks[i].textContent())?.trim();
        await navLinks[i].click();
        await page.waitForTimeout(300); // Don't wait for load -- impatient!
        clickedPages.push(text || href);
      } catch (e) {
        errors++;
      }
    }

    if (clickedPages.length > 3) worked.push(`Rapidly clicked ${clickedPages.length} pages`);
    if (errors > 0) issues.push(`${errors} navigation errors during rapid clicking`);

    // Check if page crashed or shows error
    const pageText = await page.textContent('body');
    if (pageText.includes('Error') || pageText.includes('500') || pageText.includes('crashed')) {
      issues.push('Page shows error after rapid navigation');
    } else {
      worked.push('App survived rapid navigation without crash');
    }

    // Check for loading states
    const loaders = page.locator('.loading, .spinner, [class*="skeleton"], [class*="loader"], [aria-busy="true"]');
    if (await loaders.count() > 0) {
      worked.push('Loading indicators present');
    } else {
      issues.push('No loading indicators -- user gets no feedback while data loads');
    }

    await screenshot(page, '11_impatient');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Impatient User', tried: 'Rapidly switch pages, click before data loads', worked, issues };
}

// ========================================
// PERSONA 12: Data-Skeptical PM
// ========================================
async function persona12_dataSkeptical(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);

    // Check P&L consistency
    const pageText = await page.textContent('body');

    // Look for numbers that might be P&L values
    const numbers = await page.evaluate(() => {
      const text = document.body.textContent || '';
      const pnlMatches = text.match(/[-+]?\$[\d,]+\.?\d*/g) || [];
      const pctMatches = text.match(/[-+]?\d+\.?\d*%/g) || [];
      return { dollars: pnlMatches.slice(0, 10), percents: pctMatches.slice(0, 10) };
    });

    if (numbers.dollars.length > 0) worked.push(`Found ${numbers.dollars.length} dollar values`);
    else issues.push('No dollar values visible on dashboard');

    if (numbers.percents.length > 0) worked.push(`Found ${numbers.percents.length} percentage values`);

    // Check if values are realistic
    const unrealistic = numbers.dollars.filter(d => {
      const val = parseFloat(d.replace(/[$,]/g, ''));
      return Math.abs(val) > 10000000; // > 10M seems wrong for a paper account
    });
    if (unrealistic.length > 0) issues.push(`Unrealistically large values: ${unrealistic.join(', ')}`);
    else worked.push('Dollar values appear realistic');

    // Check strategy page for performance data
    const stratLink = page.locator('a:has-text("Strategies"), a[href*="strat"]').first();
    if (await stratLink.count() > 0) {
      await stratLink.click();
      await page.waitForTimeout(2000);
      const stratText = await page.textContent('body');
      if (stratText.includes('return') || stratText.includes('Return') || stratText.includes('performance')) {
        worked.push('Strategy performance data visible');
      } else {
        issues.push('No strategy return/performance data shown');
      }
    }

    await screenshot(page, '12_data_skeptic');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Data-Skeptical PM', tried: 'Verify P&L values, check data consistency', worked, issues };
}

// ========================================
// PERSONA 13: Compliance Officer
// ========================================
async function persona13_complianceOfficer(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    // Check for legal pages
    for (const legalPage of ['privacy', 'terms', 'risk-disclosure', 'legal', 'disclaimer']) {
      const resp = await page.goto(`${BASE_URL}/${legalPage}`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
      if (resp && resp.status() === 200) {
        worked.push(`/${legalPage} page exists`);
      } else {
        issues.push(`No /${legalPage} page found`);
      }
    }

    await login(page);
    const pageText = await page.textContent('body');

    // Check for risk disclaimers
    if (pageText.includes('risk') || pageText.includes('Risk') || pageText.includes('disclaimer')) {
      worked.push('Risk-related content visible in app');
    } else {
      issues.push('No risk disclaimers visible in app');
    }

    // Check for trade logging / audit trail
    const tradeLink = page.locator('a:has-text("Trade"), a[href*="trade"], a:has-text("History"), a:has-text("Activity")');
    if (await tradeLink.count() > 0) {
      await tradeLink.first().click();
      await page.waitForTimeout(2000);
      worked.push('Trade history / activity page accessible');
    } else {
      issues.push('No trade history or audit trail page found');
    }

    await screenshot(page, '13_compliance');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Compliance Officer', tried: 'Check legal pages, risk disclaimers, audit trail', worked, issues };
}

// ========================================
// PERSONA 14: API Power User
// ========================================
async function persona14_apiUser(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    // Test login API
    const loginResp = await page.goto(`${BASE_URL}/api/v1/auth/login`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);

    // Login and get token
    const tokenResp = await page.evaluate(async (url) => {
      const resp = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'alphaDesk2025!' })
      });
      return { status: resp.status, data: await resp.json().catch(() => null) };
    }, BASE_URL);

    if (tokenResp.status === 200 && tokenResp.data?.access_token) {
      worked.push('Login API returns valid token');
      const token = tokenResp.data.access_token;

      // Test key endpoints
      const endpoints = [
        '/api/v1/screener',
        '/api/v1/trades/positions',
        '/api/v1/pipeline/status',
        '/api/v1/market-overview',
        '/api/v1/strategies'
      ];

      for (const ep of endpoints) {
        const resp = await page.evaluate(async ({ url, ep, token }) => {
          const r = await fetch(`${url}${ep}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          return { status: r.status, ok: r.ok };
        }, { url: BASE_URL, ep, token });
        if (resp.ok) worked.push(`${ep} returns 200`);
        else issues.push(`${ep} returns ${resp.status}`);
      }
    } else {
      issues.push(`Login API failed with status ${tokenResp.status}`);
    }

    await screenshot(page, '14_api_user');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'API Power User', tried: 'Test key API endpoints, check response formats', worked, issues };
}

// ========================================
// PERSONA 15: Backtester
// ========================================
async function persona15_backtester(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);

    // Find backtest page
    const btLink = page.locator('a:has-text("Backtest"), a[href*="backtest"]');
    if (await btLink.count() > 0) {
      await btLink.first().click();
      await page.waitForTimeout(2000);
      worked.push('Backtest page found');
      await screenshot(page, '15_backtester_page');

      // Try running a backtest
      const stratSelect = page.locator('select, [role="combobox"], [class*="select"]');
      if (await stratSelect.count() > 0) {
        worked.push('Strategy selector found');
      } else {
        issues.push('No strategy selector on backtest page');
      }

      const runBtn = page.locator('button:has-text("Run"), button:has-text("Start"), button:has-text("Backtest")');
      if (await runBtn.count() > 0) {
        await runBtn.first().click();
        await page.waitForTimeout(5000);
        worked.push('Run backtest button clicked');
        await screenshot(page, '15_backtester_result');
      } else {
        issues.push('No run/start button on backtest page');
      }
    } else {
      issues.push('No backtest page found');
    }

    await screenshot(page, '15_backtester_final');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Backtester', tried: 'Find backtest page, run SMA/RSI/MACD backtests', worked, issues };
}

// ========================================
// PERSONA 16: News Trader
// ========================================
async function persona16_newsTrader(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);

    // Check for news section
    const newsLink = page.locator('a:has-text("News"), a[href*="news"]');
    if (await newsLink.count() > 0) {
      await newsLink.first().click();
      await page.waitForTimeout(2000);
      worked.push('News page found');
      await screenshot(page, '16_news_page');
    } else {
      issues.push('No dedicated news page');
    }

    // Check for activity feed
    const activityFeed = page.locator('[class*="activity"], [class*="feed"], [class*="news"]');
    const pageText = await page.textContent('body');
    if (pageText.includes('headline') || pageText.includes('news') || pageText.includes('News')) {
      worked.push('News content visible');
    } else {
      issues.push('No news headlines or activity feed visible');
    }

    // Check if headlines are real (look for dates)
    const hasDatePatterns = /\d{4}-\d{2}-\d{2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d+ (hour|minute|day|week)s? ago/i.test(pageText);
    if (hasDatePatterns) {
      worked.push('News items have timestamps');
    } else {
      issues.push('No dates/timestamps on news items -- unclear if data is fresh');
    }

    await screenshot(page, '16_news_final');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'News Trader', tried: 'Check news section, activity feed, headline freshness', worked, issues };
}

// ========================================
// PERSONA 17: Multi-Monitor Trader
// ========================================
async function persona17_multiMonitor(browser) {
  const context = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);
    await screenshot(page, '17_ultrawide_dashboard');

    // Check layout at ultrawide
    const bodyWidth = await page.evaluate(() => {
      const main = document.querySelector('main, [class*="content"], [class*="main"]');
      if (main) return main.getBoundingClientRect().width;
      return document.body.scrollWidth;
    });

    if (bodyWidth > 1920) {
      worked.push(`Content uses ultrawide space (${Math.round(bodyWidth)}px)`);
    } else if (bodyWidth > 0) {
      issues.push(`Content capped at ${Math.round(bodyWidth)}px -- does not use full 2560px ultrawide`);
    }

    // Check for excessive whitespace
    const hasMaxWidth = await page.evaluate(() => {
      const main = document.querySelector('main, [class*="content"], [class*="layout"]');
      if (main) {
        const style = window.getComputedStyle(main);
        return style.maxWidth !== 'none' && style.maxWidth !== '';
      }
      return false;
    });
    if (hasMaxWidth) {
      issues.push('Content has max-width constraint -- lots of empty space on ultrawide');
    } else {
      worked.push('Content stretches to fill screen');
    }

    // Navigate to multiple pages at ultrawide
    const pages = ['strategies', 'screener', 'backtest'];
    for (const p of pages) {
      const link = page.locator(`a[href*="${p}"]`).first();
      if (await link.count() > 0) {
        await link.click();
        await page.waitForTimeout(1500);
        await screenshot(page, `17_ultrawide_${p}`);
      }
    }

    await screenshot(page, '17_ultrawide_final');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Multi-Monitor Trader', tried: 'Check layout at 2560x1440', worked, issues };
}

// ========================================
// PERSONA 18: Strategy Researcher
// ========================================
async function persona18_strategyResearcher(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);

    // Go to strategies page
    const stratLink = page.locator('a:has-text("Strategies"), a[href*="strat"]').first();
    if (await stratLink.count() > 0) {
      await stratLink.click();
      await page.waitForTimeout(2000);
      worked.push('Strategies page loaded');
      await screenshot(page, '18_researcher_strategies');
    }

    // Count strategy cards/links
    const stratCards = page.locator('[class*="strategy"], [class*="card"]');
    const cardCount = await stratCards.count();
    if (cardCount >= 8) {
      worked.push(`Found ${cardCount} strategy cards/elements`);
    } else {
      issues.push(`Only ${cardCount} strategy cards found (expected 8+)`);
    }

    // Try clicking into individual strategy detail pages
    const detailLinks = page.locator('a[href*="strategy/"], a[href*="strategies/"]');
    const detailCount = await detailLinks.count();
    let detailsWorking = 0;
    let detailsBroken = 0;

    for (let i = 0; i < Math.min(detailCount, 4); i++) {
      try {
        const href = await detailLinks.nth(i).getAttribute('href');
        await detailLinks.nth(i).click();
        await page.waitForTimeout(2000);
        const text = await page.textContent('body');
        if (text.length > 200) {
          detailsWorking++;
        }
        // Go back
        await page.goBack();
        await page.waitForTimeout(1000);
      } catch (e) {
        detailsBroken++;
      }
    }

    if (detailsWorking > 0) worked.push(`${detailsWorking} strategy detail pages load correctly`);
    if (detailsBroken > 0) issues.push(`${detailsBroken} strategy detail pages failed to load`);
    if (detailCount === 0) issues.push('No strategy detail page links found');

    // Check for thesis/parameters documentation
    const pageText = await page.textContent('body');
    if (pageText.includes('thesis') || pageText.includes('Thesis') || pageText.includes('parameter') || pageText.includes('Parameter')) {
      worked.push('Strategy thesis/parameters documented');
    } else {
      issues.push('No strategy thesis or parameters documentation found');
    }

    await screenshot(page, '18_researcher_final');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Strategy Researcher', tried: 'Check all strategy detail pages, read thesis/parameters', worked, issues };
}

// ========================================
// PERSONA 19: Weekend Planner
// ========================================
async function persona19_weekendPlanner(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    await login(page);
    const pageText = await page.textContent('body');

    // Check for stale data indicators
    if (pageText.includes('Last updated') || pageText.includes('as of') || pageText.includes('Updated')) {
      worked.push('Data timestamps visible');
    } else {
      issues.push('No data freshness timestamps -- unclear if prices are current or stale');
    }

    // Check if market status is shown
    if (pageText.includes('Market Closed') || pageText.includes('Market Open') || pageText.includes('Pre-Market') || pageText.includes('After Hours')) {
      worked.push('Market status indicator visible');
    } else {
      issues.push('No market open/closed status indicator');
    }

    // Navigate to screener
    const screenerLink = page.locator('a:has-text("Screener"), a[href*="screener"]');
    if (await screenerLink.count() > 0) {
      await screenerLink.first().click();
      await page.waitForTimeout(2000);
      worked.push('Screener loads outside market hours');
    }

    // Check portfolio view
    const portLink = page.locator('a:has-text("Portfolio"), a[href*="portfolio"], a:has-text("Position")');
    if (await portLink.count() > 0) {
      await portLink.first().click();
      await page.waitForTimeout(2000);
      worked.push('Portfolio view loads outside market hours');
    }

    // Check if backtest works outside market hours
    const btLink = page.locator('a:has-text("Backtest"), a[href*="backtest"]');
    if (await btLink.count() > 0) {
      await btLink.first().click();
      await page.waitForTimeout(2000);
      worked.push('Backtest available outside market hours');
    }

    await screenshot(page, '19_weekend');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Weekend Planner', tried: 'Check what works when market is closed, data staleness', worked, issues };
}

// ========================================
// PERSONA 20: Security Auditor
// ========================================
async function persona20_securityAuditor(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const issues = [];
  const worked = [];
  try {
    // Test unauthenticated access
    const protectedPages = ['/dashboard', '/strategies', '/screener', '/portfolio'];
    for (const pp of protectedPages) {
      const resp = await page.goto(`${BASE_URL}${pp}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      const url = page.url();
      if (url.includes('login') || (resp && resp.status() === 401)) {
        worked.push(`${pp} redirects to login (protected)`);
      } else {
        issues.push(`${pp} accessible without authentication`);
      }
    }

    // Check response headers
    const resp = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const headers = resp.headers();
    const securityHeaders = {
      'x-frame-options': 'Prevents clickjacking',
      'x-content-type-options': 'Prevents MIME sniffing',
      'strict-transport-security': 'Enforces HTTPS',
      'content-security-policy': 'Prevents XSS',
      'x-xss-protection': 'XSS filter'
    };
    for (const [header, desc] of Object.entries(securityHeaders)) {
      if (headers[header]) worked.push(`${header} header present`);
      else issues.push(`Missing ${header} header (${desc})`);
    }

    // Test expired/invalid token
    const apiResp = await page.evaluate(async (url) => {
      const resp = await fetch(`${url}/api/v1/trades/positions`, {
        headers: { 'Authorization': 'Bearer invalid_token_12345' }
      });
      return { status: resp.status };
    }, BASE_URL);
    if (apiResp.status === 401 || apiResp.status === 403) {
      worked.push('Invalid tokens are rejected (401/403)');
    } else {
      issues.push(`Invalid token returns ${apiResp.status} instead of 401/403`);
    }

    // Test rate limiting
    const rateLimitResults = await page.evaluate(async (url) => {
      const results = [];
      for (let i = 0; i < 10; i++) {
        const resp = await fetch(`${url}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'test', password: 'wrong' })
        });
        results.push(resp.status);
      }
      return results;
    }, BASE_URL);
    const has429 = rateLimitResults.includes(429);
    if (has429) worked.push('Rate limiting active on failed logins');
    else issues.push('No rate limiting on failed login attempts (10 attempts all returned ' + rateLimitResults[0] + ')');

    // Check cookies
    const cookies = await context.cookies();
    const secureCookies = cookies.filter(c => c.secure);
    const httpOnlyCookies = cookies.filter(c => c.httpOnly);
    if (cookies.length > 0) {
      if (secureCookies.length < cookies.length) issues.push('Some cookies not marked Secure');
      if (httpOnlyCookies.length < cookies.length) issues.push('Some cookies not marked HttpOnly');
    }

    await screenshot(page, '20_security');
  } catch (e) {
    issues.push(`Error: ${e.message}`);
  }
  await context.close();
  return { persona: 'Security Auditor', tried: 'Test auth, security headers, rate limiting, tokens', worked, issues };
}

// ========================================
// MAIN
// ========================================
(async () => {
  console.log('Starting 20-persona test suite...\n');
  const browser = await chromium.launch({ headless: true });

  const personas = [
    persona1_dayTrader,
    persona2_swingTrader,
    persona3_optionsTrader,
    persona4_portfolioManager,
    persona5_quantTrader,
    persona6_riskManager,
    persona7_newUser,
    persona8_mobileUser,
    persona9_keyboardUser,
    persona10_screenReaderUser,
    persona11_impatientUser,
    persona12_dataSkeptical,
    persona13_complianceOfficer,
    persona14_apiUser,
    persona15_backtester,
    persona16_newsTrader,
    persona17_multiMonitor,
    persona18_strategyResearcher,
    persona19_weekendPlanner,
    persona20_securityAuditor,
  ];

  const allResults = [];
  for (let i = 0; i < personas.length; i++) {
    const fn = personas[i];
    const name = fn.name.replace('persona', 'Persona ').replace(/_/g, ' ');
    console.log(`[${i + 1}/20] Running ${name}...`);
    try {
      const result = await fn(browser);
      allResults.push(result);
      console.log(`  Worked: ${result.worked.length} | Issues: ${result.issues.length}`);
    } catch (e) {
      console.log(`  FAILED: ${e.message}`);
      allResults.push({ persona: name, tried: 'N/A', worked: [], issues: [`Test suite error: ${e.message}`] });
    }
  }

  await browser.close();

  // Output JSON results
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'persona_results.json'), JSON.stringify(allResults, null, 2));
  console.log('\nAll tests complete. Results saved to persona_results.json');

  // Print summary
  console.log('\n=== SUMMARY ===');
  for (const r of allResults) {
    console.log(`\n${r.persona}:`);
    console.log(`  Tried: ${r.tried}`);
    console.log(`  Worked (${r.worked.length}):`);
    r.worked.forEach(w => console.log(`    + ${w}`));
    console.log(`  Issues (${r.issues.length}):`);
    r.issues.forEach(i => console.log(`    - ${i}`));
  }
})();
