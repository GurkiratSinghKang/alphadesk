#!/usr/bin/env node
// Strict visual regression harness for high-signal app surfaces.
//
// Usage:
//   node qa/harness/visual-regression.mjs --base=http://localhost:3000 --update-baseline
//   node qa/harness/visual-regression.mjs --base=http://localhost:3000
// Quality gates run by default: route/first-viewport assertions, tap targets,
// focus visibility, and text contrast/readability. Use --skip-quality only
// when debugging raw screenshot drift.

import { chromium } from "playwright";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const VISUAL_ROOT = path.join(ROOT, "qa", "visual");
const BASELINE_DIR = path.join(VISUAL_ROOT, "baseline");
const CURRENT_DIR = path.join(VISUAL_ROOT, "current");
const DIFF_DIR = path.join(VISUAL_ROOT, "diff");

const VIEWPORTS = {
  "desktop-1440": { width: 1440, height: 960, isMobile: false },
  "mobile-390": { width: 390, height: 844, isMobile: true },
};

// QA r1 C3: extended from 6 → 22 routes so every shipped surface gets the
// strict tap-target / contrast / focus / overflow audit. Cases without a
// matching FIRST_VIEWPORT_EXPECTATIONS entry still get every quality check
// run; only the optional route-integrity / visible-text-grouping checks are
// skipped. New cases will need a `--update-baseline` run on first execution.
const CASES = [
  // Authenticated app
  { name: "dashboard-desktop", path: "/", viewport: "desktop-1440" },
  { name: "trade-desktop", path: "/trade", viewport: "desktop-1440" },
  { name: "strategies-desktop", path: "/strategies", viewport: "desktop-1440" },
  { name: "strategies-detail-desktop", path: "/strategies/momentum-quality", viewport: "desktop-1440" },
  { name: "strategies-earnings-desktop", path: "/strategies/earnings-options-play", viewport: "desktop-1440" },
  { name: "strategies-tar-desktop", path: "/strategies/trading-agents-research", viewport: "desktop-1440" },
  { name: "analytics-desktop", path: "/analytics", viewport: "desktop-1440" },
  { name: "alerts-desktop", path: "/alerts", viewport: "desktop-1440" },
  { name: "pipeline-desktop", path: "/pipeline", viewport: "desktop-1440" },
  { name: "reports-desktop", path: "/reports", viewport: "desktop-1440" },
  { name: "settings-desktop", path: "/settings", viewport: "desktop-1440" },
  // Public / auth-adjacent
  { name: "login-desktop", path: "/login", viewport: "desktop-1440" },
  { name: "login-reset-desktop", path: "/login/reset", viewport: "desktop-1440" },
  { name: "request-access-desktop", path: "/request-access", viewport: "desktop-1440" },
  { name: "about-desktop", path: "/about", viewport: "desktop-1440" },
  { name: "contact-desktop", path: "/contact", viewport: "desktop-1440" },
  { name: "docs-desktop", path: "/docs", viewport: "desktop-1440" },
  { name: "help-earnings-desktop", path: "/help/earnings-data", viewport: "desktop-1440" },
  { name: "privacy-desktop", path: "/privacy", viewport: "desktop-1440" },
  { name: "terms-desktop", path: "/terms", viewport: "desktop-1440" },
  { name: "risk-desktop", path: "/risk", viewport: "desktop-1440" },
  // Mobile spot-checks for the highest-traffic surfaces
  { name: "dashboard-mobile", path: "/", viewport: "mobile-390" },
  { name: "trade-mobile", path: "/trade", viewport: "mobile-390" },
];

const FIRST_VIEWPORT_EXPECTATIONS = {
  "dashboard-desktop": {
    expectedPath: "/",
    groups: [
      { label: "control-room", all: ["control room"] },
      { label: "action-or-risk", any: ["action stack", "risk gates", "working orders", "largest exposure"] },
      { label: "account-context", any: ["book equity", "buying power", "day p/l", "positions"] },
    ],
  },
  "dashboard-mobile": {
    expectedPath: "/",
    groups: [
      { label: "control-room", all: ["control room"] },
      { label: "mobile-action-priority", any: ["action stack", "risk gate", "working orders", "largest exposure"] },
      { label: "account-context", any: ["book equity", "day p/l", "strategies"] },
    ],
  },
  "trade-desktop": {
    expectedPath: "/trade",
    groups: [
      { label: "trade-context", all: ["trade", "spy"] },
      { label: "quote-context", any: ["last", "bid", "ask", "spread"] },
      { label: "chart-visible", any: ["full canvas chart", "candles", "chart ready"] },
      { label: "ticket-visible", any: ["execution ticket", "place order", "pre-trade impact"] },
    ],
  },
  "trade-mobile": {
    expectedPath: "/trade",
    groups: [
      { label: "trade-context", all: ["trade", "spy"] },
      { label: "quote-context", any: ["last", "bid", "ask", "spread"] },
      { label: "chart-first-viewport", any: ["full canvas chart", "chart ready", "candles"] },
    ],
  },
  "strategies-desktop": {
    expectedPath: "/strategies",
    groups: [
      { label: "strategy-heading", all: ["strategies"] },
      { label: "strategy-status", any: ["active", "paused", "paper only"] },
      { label: "strategy-card", any: ["cross-sectional", "momentum", "post-earnings", "regime"] },
    ],
  },
  "analytics-desktop": {
    expectedPath: "/analytics",
    groups: [
      { label: "analytics-heading", all: ["portfolio analytics"] },
      { label: "empty-or-data-state", any: ["awaiting data", "closed trades", "drawdown", "returns"] },
      { label: "next-action", any: ["place your first trade", "1w", "1m", "ytd"] },
    ],
  },
};

function parseArgs(argv) {
  const args = {
    base: process.env.ALPHADESK_BASE || "http://localhost:3000",
    updateBaseline: false,
    caseFilter: null,
    headless: true,
    pixelThreshold: 1,
    maxChangedRatio: 0.0001,
    maxMeanDelta: 0.03,
    quality: true,
    minReadableFont: 12,
    minTextContrast: 4.5,
    minLargeTextContrast: 3,
    minMobileTapTarget: 40,
    minDesktopTapTarget: 24,
    maxTapTargetFailures: 0,
    focusSamples: 8,
    minFocusSamples: 3,
    maxContrastFailures: 0,
    maxFontSizeFailures: 0,
    maxHorizontalOverflow: 1,
  };

  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "base") args.base = value;
    if (key === "update-baseline") args.updateBaseline = true;
    if (key === "case") args.caseFilter = value.split(",").filter(Boolean);
    if (key === "headless") args.headless = value !== "false";
    if (key === "pixel-threshold") args.pixelThreshold = Number(value);
    if (key === "max-changed-ratio") args.maxChangedRatio = Number(value);
    if (key === "max-mean-delta") args.maxMeanDelta = Number(value);
    if (key === "skip-quality") args.quality = false;
    if (key === "min-readable-font") args.minReadableFont = Number(value);
    if (key === "min-text-contrast") args.minTextContrast = Number(value);
    if (key === "min-large-text-contrast") args.minLargeTextContrast = Number(value);
    if (key === "min-mobile-tap-target") args.minMobileTapTarget = Number(value);
    if (key === "min-desktop-tap-target") args.minDesktopTapTarget = Number(value);
    if (key === "max-tap-target-failures") args.maxTapTargetFailures = Number(value);
    if (key === "focus-samples") args.focusSamples = Number(value);
    if (key === "min-focus-samples") args.minFocusSamples = Number(value);
    if (key === "max-contrast-failures") args.maxContrastFailures = Number(value);
    if (key === "max-font-size-failures") args.maxFontSizeFailures = Number(value);
    if (key === "max-horizontal-overflow") args.maxHorizontalOverflow = Number(value);
  }

  args.base = args.base.replace(/\/+$/, "");
  return args;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function hardenPageForVisualDiff(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition-property: none !important;
        transition-duration: 0s !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
      }
      .status-breathe { animation: none !important; }
      [role="region"][aria-label="Notifications"] {
        display: none !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts?.ready);
}

function compareImages({ baseline, current, diff, args }) {
  const script = path.join(__dirname, "visual_compare.py");
  const result = spawnSync(
    "python3",
    [
      script,
      "--baseline",
      baseline,
      "--current",
      current,
      "--diff",
      diff,
      "--pixel-threshold",
      String(args.pixelThreshold),
      "--max-changed-ratio",
      String(args.maxChangedRatio),
      "--max-mean-delta",
      String(args.maxMeanDelta),
    ],
    { encoding: "utf8" },
  );

  let payload;
  try {
    payload = JSON.parse(result.stdout.trim() || "{}");
  } catch {
    payload = { pass: false, reason: "invalid-compare-output", stdout: result.stdout, stderr: result.stderr };
  }
  return { ok: result.status === 0, payload };
}

async function maybeLogin(context, base) {
  const user = process.env.ALPHADESK_TEST_USER;
  const pass = process.env.ALPHADESK_TEST_PASS;
  if (!user || !pass) {
    await seedVisualAuthCookie(context, base);
    return;
  }

  const page = await context.newPage();
  try {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#login-username").fill(user, { timeout: 5_000 });
    await page.locator("#login-password").fill(pass, { timeout: 5_000 });
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {}),
      page.locator("button[type=submit]").click(),
    ]);
  } finally {
    await page.close().catch(() => {});
  }
}

function createVisualAccessToken() {
  const encode = (payload) => Buffer.from(JSON.stringify(payload)).toString("base64url");
  const header = encode({ alg: "none", typ: "JWT" });
  const body = encode({
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    role: "admin",
    sub: "visual-regression",
  });
  return `${header}.${body}.`;
}

async function seedVisualAuthCookie(context, base) {
  await context.addCookies([
    {
      name: "access_token",
      value: createVisualAccessToken(),
      url: base,
      sameSite: "Lax",
      httpOnly: true,
    },
  ]);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function checkResult(name, pass, payload = {}) {
  return {
    name,
    status: pass ? "pass" : "fail",
    ...payload,
  };
}

function qualityPassed(quality) {
  return !quality || quality.status === "skipped" || quality.status === "pass";
}

function summarizeQualityFailures(quality) {
  if (!quality || quality.status !== "fail") return "";
  return quality.checks
    .filter((check) => check.status === "fail")
    .map((check) => check.name)
    .join(",");
}

function ruleMatches(rule, text) {
  const normalized = normalizeText(text);
  const all = rule.all ?? [];
  const any = rule.any ?? [];
  const allPass = all.length === 0 || all.every((needle) => normalized.includes(normalizeText(needle)));
  const anyPass = any.length === 0 || any.some((needle) => normalized.includes(normalizeText(needle)));
  return allPass && anyPass;
}

async function auditFirstViewport(page, item, args) {
  const expected = FIRST_VIEWPORT_EXPECTATIONS[item.name];
  const snapshot = await page.evaluate(() => {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      pathname: window.location.pathname,
      title: document.title,
    };

    const texts = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return node.textContent?.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      },
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent) continue;
      const style = window.getComputedStyle(parent);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        parent.closest("[hidden], [aria-hidden='true']")
      ) {
        continue;
      }

      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      range.detach();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        rect.right <= 0 ||
        rect.left >= window.innerWidth
      ) {
        continue;
      }
      texts.push(node.textContent.trim().replace(/\s+/g, " "));
    }

    return { viewport, visibleText: texts.join(" ") };
  });

  const failures = [];
  if (expected?.expectedPath && snapshot.viewport.pathname !== expected.expectedPath) {
    failures.push({
      label: "route-integrity",
      expectedPath: expected.expectedPath,
      actualPath: snapshot.viewport.pathname,
      title: snapshot.viewport.title,
    });
  }

  const overflow = snapshot.viewport.scrollWidth - snapshot.viewport.width;
  if (overflow > args.maxHorizontalOverflow) {
    failures.push({
      label: "horizontal-overflow",
      overflowPx: Number(overflow.toFixed(2)),
      allowedPx: args.maxHorizontalOverflow,
    });
  }

  for (const group of expected?.groups ?? []) {
    if (!ruleMatches(group, snapshot.visibleText)) {
      failures.push({
        label: group.label,
        requiredAll: group.all ?? [],
        requiredAny: group.any ?? [],
      });
    }
  }

  return checkResult("first-viewport", failures.length === 0, {
    failures,
    actualPath: snapshot.viewport.pathname,
    expectedPath: expected?.expectedPath ?? null,
    visibleTextSample: snapshot.visibleText.slice(0, 500),
  });
}

async function auditTapTargets(page, viewport, args) {
  const threshold = viewport.isMobile ? args.minMobileTapTarget : args.minDesktopTapTarget;
  const audit = await page.evaluate((minSize) => {
    const selector = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "[role='button']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='checkbox']",
      "[role='radio']",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    function labelFor(el) {
      return (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.getAttribute("placeholder") ||
        el.textContent ||
        el.id ||
        el.getAttribute("href") ||
        el.tagName
      ).trim().replace(/\s+/g, " ").slice(0, 90);
    }

    const failures = [];
    const targets = [];
    for (const el of document.querySelectorAll(selector)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.matches("[disabled], [aria-disabled='true']")) continue;
      if (el.closest("[hidden], [aria-hidden='true']")) continue;

      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.pointerEvents === "none" ||
        Number(style.opacity) === 0 ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        rect.right <= 0 ||
        rect.left >= window.innerWidth
      ) {
        continue;
      }

      const visibleWidth = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
      const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      if (visibleWidth < minSize || visibleHeight < minSize) {
        continue;
      }

      const target = {
        label: labelFor(el),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
      };
      targets.push(target);

      const clipped =
        rect.left < -1 ||
        rect.top < -1 ||
        rect.right > window.innerWidth + 1 ||
        rect.bottom > window.innerHeight + 1;
      if (rect.width < minSize || rect.height < minSize || clipped) {
        failures.push({
          ...target,
          requiredMin: minSize,
          clipped,
        });
      }
    }
    return { targetCount: targets.length, failures: failures.slice(0, 20) };
  }, threshold);

  return checkResult(
    "tap-targets",
    audit.failures.length <= args.maxTapTargetFailures,
    {
      minSizePx: threshold,
      targetCount: audit.targetCount,
      failureCount: audit.failures.length,
      allowedFailures: args.maxTapTargetFailures,
      failures: audit.failures,
    },
  );
}

async function auditFocusVisibility(page, args) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
  });

  const samples = [];
  const failures = [];
  const seen = new Set();
  const maxTabs = Math.max(args.focusSamples * 4, 12);

  for (let i = 0; i < maxTabs && samples.length < args.focusSamples; i += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(50);
    const sample = await page.evaluate(() => {
      function colorLooksVisible(value) {
        if (!value || value === "transparent") return false;
        const oklMatches = [...value.matchAll(/\bokl(?:ab|ch)\([^)]*\/\s*([0-9.]+)/gi)];
        if (oklMatches.some((match) => Number(match[1]) > 0)) return true;
        const colorMatches = [...value.matchAll(/rgba?\(([^)]+)\)/gi)];
        if (!colorMatches.length) return value !== "none";
        return colorMatches.some((match) => {
          const parts = match[1].split(",").map((part) => part.trim());
          return parts[3] == null || Number(parts[3]) > 0;
        });
      }

      function pathFor(el) {
        const parts = [];
        let node = el;
        while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
          const tag = node.tagName.toLowerCase();
          const id = node.id ? `#${node.id}` : "";
          const role = node.getAttribute("role") ? `[role=${node.getAttribute("role")}]` : "";
          parts.unshift(`${tag}${id}${role}`);
          node = node.parentElement;
        }
        return parts.join(">");
      }

      function labelFor(el) {
        return (
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.getAttribute("placeholder") ||
          el.textContent ||
          el.id ||
          el.tagName
        ).trim().replace(/\s+/g, " ").slice(0, 90);
      }

      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        rect.right <= 0 ||
        rect.left >= window.innerWidth
      ) {
        return null;
      }

      const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
      const outlineVisible =
        outlineWidth >= 1 &&
        style.outlineStyle !== "none" &&
        colorLooksVisible(style.outlineColor);
      const shadowVisible = style.boxShadow !== "none" && colorLooksVisible(style.boxShadow);
      const visible = outlineVisible || shadowVisible;

      return {
        key: pathFor(el),
        label: labelFor(el),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
        outlineWidth,
        outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
        visible,
      };
    });

    if (!sample || seen.has(sample.key)) continue;
    seen.add(sample.key);
    samples.push(sample);
    if (!sample.visible) failures.push(sample);
  }

  if (samples.length < args.minFocusSamples) {
    failures.push({
      label: "insufficient-focus-samples",
      sampled: samples.length,
      required: args.minFocusSamples,
    });
  }

  return checkResult("focus-visibility", failures.length === 0, {
    sampled: samples.length,
    requiredSamples: args.minFocusSamples,
    failures: failures.slice(0, 12),
    samples: samples.map(({ key, label, tag, role, visible }) => ({ key, label, tag, role, visible })),
  });
}

async function auditContrastAndReadability(page, args) {
  const audit = await page.evaluate((thresholds) => {
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext("2d");

    function parseColor(value) {
      if (!value || !colorContext) return { r: 0, g: 0, b: 0, a: 0 };
      colorContext.fillStyle = "#000000";
      colorContext.fillStyle = value;
      const parsed = colorContext.fillStyle;
      if (parsed.startsWith("#")) {
        const hex = parsed.slice(1);
        const full = hex.length === 3
          ? hex.split("").map((part) => part + part).join("")
          : hex.padEnd(6, "0").slice(0, 6);
        return {
          r: Number.parseInt(full.slice(0, 2), 16),
          g: Number.parseInt(full.slice(2, 4), 16),
          b: Number.parseInt(full.slice(4, 6), 16),
          a: 1,
        };
      }
      const match = parsed.match(/rgba?\(([^)]+)\)/i);
      if (!match) return { r: 0, g: 0, b: 0, a: 0 };
      const parts = match[1].split(",").map((part) => part.trim());
      return {
        r: Number(parts[0]) || 0,
        g: Number(parts[1]) || 0,
        b: Number(parts[2]) || 0,
        a: parts[3] == null ? 1 : Number(parts[3]),
      };
    }

    function composite(top, bottom) {
      const alpha = top.a + bottom.a * (1 - top.a);
      if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
        a: alpha,
      };
    }

    function luminance(channel) {
      const value = channel / 255;
      return value <= 0.03928
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    }

    function contrastRatio(fg, bg) {
      const l1 = 0.2126 * luminance(fg.r) + 0.7152 * luminance(fg.g) + 0.0722 * luminance(fg.b);
      const l2 = 0.2126 * luminance(bg.r) + 0.7152 * luminance(bg.g) + 0.0722 * luminance(bg.b);
      const light = Math.max(l1, l2);
      const dark = Math.min(l1, l2);
      return (light + 0.05) / (dark + 0.05);
    }

    function effectiveBackground(el) {
      const chain = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        chain.unshift(node);
        node = node.parentElement;
      }

      let bg = parseColor(window.getComputedStyle(document.body).backgroundColor);
      if (bg.a === 0) bg = { r: 8, g: 8, b: 6, a: 1 };
      for (const item of chain) {
        const color = parseColor(window.getComputedStyle(item).backgroundColor);
        if (color.a > 0) bg = composite(color, bg);
      }
      if (bg.a < 1) bg = composite(bg, { r: 8, g: 8, b: 6, a: 1 });
      return bg;
    }

    function textLabel(value) {
      return value.trim().replace(/\s+/g, " ").slice(0, 100);
    }

    const contrastFailures = [];
    const fontSizeFailures = [];
    const samples = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = node.textContent?.trim() ?? "";
          if (!/[a-z0-9$%]/i.test(text)) return NodeFilter.FILTER_REJECT;
          if (text.length < 2) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || parent.closest("[hidden], [aria-hidden='true']")) continue;

      const style = window.getComputedStyle(parent);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        continue;
      }

      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      range.detach();
      if (
        rect.width <= 1 ||
        rect.height <= 1 ||
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        rect.right <= 0 ||
        rect.left >= window.innerWidth
      ) {
        continue;
      }

      const fontSize = Number.parseFloat(style.fontSize) || 0;
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const bg = effectiveBackground(parent);
      let fg = parseColor(style.color);
      const opacity = Number.parseFloat(style.opacity);
      if (Number.isFinite(opacity) && opacity < 1) fg = { ...fg, a: fg.a * opacity };
      if (fg.a < 1) fg = composite(fg, bg);
      const ratio = contrastRatio(fg, bg);
      const required = isLarge ? thresholds.minLargeTextContrast : thresholds.minTextContrast;
      const sample = {
        text: textLabel(node.textContent ?? ""),
        fontSize: Number(fontSize.toFixed(2)),
        fontWeight,
        contrast: Number(ratio.toFixed(2)),
        requiredContrast: required,
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
      };
      samples.push(sample);

      if (fontSize < thresholds.minReadableFont) {
        fontSizeFailures.push({
          ...sample,
          requiredFontSize: thresholds.minReadableFont,
        });
      }

      if (ratio < required) {
        contrastFailures.push(sample);
      }
    }

    contrastFailures.sort((a, b) => a.contrast - b.contrast);
    fontSizeFailures.sort((a, b) => a.fontSize - b.fontSize);

    return {
      sampleCount: samples.length,
      contrastFailureCount: contrastFailures.length,
      fontSizeFailureCount: fontSizeFailures.length,
      worstContrast: contrastFailures.slice(0, 12),
      smallestText: fontSizeFailures.slice(0, 12),
    };
  }, {
    minReadableFont: args.minReadableFont,
    minTextContrast: args.minTextContrast,
    minLargeTextContrast: args.minLargeTextContrast,
  });

  const pass =
    audit.contrastFailureCount <= args.maxContrastFailures &&
    audit.fontSizeFailureCount <= args.maxFontSizeFailures;

  return checkResult("contrast-readability", pass, {
    sampleCount: audit.sampleCount,
    contrastFailureCount: audit.contrastFailureCount,
    fontSizeFailureCount: audit.fontSizeFailureCount,
    allowedContrastFailures: args.maxContrastFailures,
    allowedFontSizeFailures: args.maxFontSizeFailures,
    minReadableFont: args.minReadableFont,
    minTextContrast: args.minTextContrast,
    minLargeTextContrast: args.minLargeTextContrast,
    worstContrast: audit.worstContrast,
    smallestText: audit.smallestText,
  });
}

async function runQualityChecks(page, item, viewport, args) {
  if (!args.quality) {
    return { status: "skipped", checks: [] };
  }

  const checks = [
    await auditFirstViewport(page, item, args),
    await auditTapTargets(page, viewport, args),
    await auditFocusVisibility(page, args),
    await auditContrastAndReadability(page, args),
  ];
  const failures = checks.filter((check) => check.status === "fail");
  return {
    status: failures.length ? "fail" : "pass",
    checks,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const cases = CASES.filter((item) => !args.caseFilter || args.caseFilter.includes(item.name));

  await ensureDir(BASELINE_DIR);
  await ensureDir(CURRENT_DIR);
  await ensureDir(DIFF_DIR);

  const browser = await chromium.launch({ headless: args.headless });
  const context = await browser.newContext({
    colorScheme: "dark",
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });

  await context.addInitScript(() => {
    const fixedNow = Date.parse("2026-05-01T14:30:00-04:00");
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedNow]));
      }
      static now() {
        return fixedNow;
      }
    }
    globalThis.Date = FixedDate;
    Math.random = () => 0.42;
    window.localStorage?.setItem("alphadesk-tour-complete", "1");
    window.localStorage?.setItem("alphadesk.onboarding_dismissed", "true");
  });

  await maybeLogin(context, args.base);

  const results = [];
  try {
    for (const item of cases) {
      const viewport = VIEWPORTS[item.viewport];
      const page = await context.newPage();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const current = path.join(CURRENT_DIR, `${item.name}.png`);
      const baseline = path.join(BASELINE_DIR, `${item.name}.png`);
      const diff = path.join(DIFF_DIR, `${item.name}.diff.png`);

      // QA r2-5: many app routes have long-poll / SSE / WS that prevent
      // true networkidle (e.g. /strategies/* polls strategy state). Use
      // domcontentloaded + a fixed grace period instead — same approach
      // as qa/harness/helpers.mjs waitForReady (matches run-all.mjs).
      await page.goto(`${args.base}${item.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      try {
        await page.waitForLoadState("networkidle", { timeout: 5_000 });
      } catch {
        // Tolerate networkidle timeout — long-poll routes settle visually
        // long before the network does.
      }
      await page.waitForTimeout(1_500);
      await hardenPageForVisualDiff(page);
      await page.screenshot({
        path: current,
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      const quality = await runQualityChecks(page, item, viewport, args);
      await page.close().catch(() => {});

      if (args.updateBaseline) {
        if (!qualityPassed(quality)) {
          results.push({
            ...item,
            status: "fail",
            current,
            baseline,
            quality,
          });
          console.error(`[visual] fail ${item.name} quality=${summarizeQualityFailures(quality)}`);
          continue;
        }
        await fs.copyFile(current, baseline);
        results.push({ ...item, status: "baseline-updated", current, baseline, quality });
        console.log(`[visual] baseline updated: ${item.name}`);
        continue;
      }

      if (!(await exists(baseline))) {
        results.push({ ...item, status: "missing-baseline", current, baseline, quality });
        console.error(`[visual] missing baseline: ${item.name}. Run with --update-baseline once.`);
        continue;
      }

      const comparison = compareImages({ baseline, current, diff, args });
      const status = comparison.ok && qualityPassed(quality) ? "pass" : "fail";
      results.push({ ...item, status, ...comparison.payload, quality });
      const changed = comparison.payload.changedRatio == null
        ? "n/a"
        : `${(comparison.payload.changedRatio * 100).toFixed(5)}%`;
      const qualitySummary = quality.status === "pass" || quality.status === "skipped"
        ? quality.status
        : `fail:${summarizeQualityFailures(quality)}`;
      console.log(`[visual] ${status.padEnd(4)} ${item.name} changed=${changed} quality=${qualitySummary}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  await fs.writeFile(
    path.join(VISUAL_ROOT, "manifest.json"),
    JSON.stringify({
      baseUrl: args.base,
      updatedAt: new Date().toISOString(),
      thresholds: {
        pixelThreshold: args.pixelThreshold,
        maxChangedRatio: args.maxChangedRatio,
        maxMeanDelta: args.maxMeanDelta,
        minReadableFont: args.minReadableFont,
        minTextContrast: args.minTextContrast,
        minLargeTextContrast: args.minLargeTextContrast,
        minMobileTapTarget: args.minMobileTapTarget,
        minDesktopTapTarget: args.minDesktopTapTarget,
        maxTapTargetFailures: args.maxTapTargetFailures,
        focusSamples: args.focusSamples,
        minFocusSamples: args.minFocusSamples,
        maxContrastFailures: args.maxContrastFailures,
        maxFontSizeFailures: args.maxFontSizeFailures,
        maxHorizontalOverflow: args.maxHorizontalOverflow,
      },
      results,
    }, null, 2),
    "utf8",
  );

  const failures = results.filter((item) => item.status === "fail" || item.status === "missing-baseline");
  if (failures.length) {
    console.error(`[visual] ${failures.length} strict visual check(s) failed.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[visual] fatal:", error);
  process.exit(1);
});
