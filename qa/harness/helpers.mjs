// qa/harness/helpers.mjs
// Core helpers for the AlphaDesk QA harness.

import { promises as fs } from "node:fs";
import path from "node:path";
import { AUTH, CONSOLE_IGNORE, HYDRATION_MARKER, TIMEOUTS, VIEWPORTS } from "./config.mjs";

/* ─────────────────────────────── fs helpers ─────────────────────────────── */

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

export async function appendJsonl(file, obj) {
  await fs.appendFile(file, JSON.stringify(obj) + "\n", "utf8");
}

export function isoStamp() {
  // 2026-04-17T11-22-05Z — filesystem-safe.
  return new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "Z");
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/* ─────────────────── per-page event sinks (console + network) ─────────────── */

/**
 * Attach listeners that append to console.jsonl + network.jsonl for this page.
 * Returns a `detach()` to remove them.
 */
export function attachEventSinks(page, stepDir) {
  const consoleFile = path.join(stepDir, "console.jsonl");
  const networkFile = path.join(stepDir, "network.jsonl");

  // Pre-create both files so partial runs always have per-spec artifacts on
  // disk, even if no console/network event ever fires. Each subsequent append
  // is flushed synchronously by fs.appendFile.
  fs.writeFile(consoleFile, "", { flag: "a" }).catch(() => {});
  fs.writeFile(networkFile, "", { flag: "a" }).catch(() => {});

  const onConsole = (msg) => {
    const text = msg.text();
    if (CONSOLE_IGNORE.some((re) => re.test(text))) return;
    appendJsonl(consoleFile, {
      ts: new Date().toISOString(),
      level: msg.type(),
      text,
      location: msg.location(),
    }).catch(() => {});
  };

  const onPageError = (err) => {
    appendJsonl(consoleFile, {
      ts: new Date().toISOString(),
      level: "pageerror",
      text: err?.message || String(err),
      stack: err?.stack,
    }).catch(() => {});
  };

  const onRequest = (req) => {
    appendJsonl(networkFile, {
      ts: new Date().toISOString(),
      phase: "request",
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
    }).catch(() => {});
  };

  const onResponse = (res) => {
    appendJsonl(networkFile, {
      ts: new Date().toISOString(),
      phase: "response",
      status: res.status(),
      url: res.url(),
      fromCache: res.fromServiceWorker(),
    }).catch(() => {});
  };

  const onRequestFailed = (req) => {
    appendJsonl(networkFile, {
      ts: new Date().toISOString(),
      phase: "requestfailed",
      method: req.method(),
      url: req.url(),
      failure: req.failure()?.errorText,
    }).catch(() => {});
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  return () => {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  };
}

/* ─────────────────────────────── wait / ready ────────────────────────────── */

/**
 * Wait for the page to settle: networkidle + optional hydration marker.
 * Falls back to `domcontentloaded + 500ms`.
 */
export async function waitForReady(page, opts = {}) {
  const networkIdleTimeout = opts.networkIdleTimeout ?? TIMEOUTS.networkIdle;
  const hydrationTimeout = opts.hydrationTimeout ?? TIMEOUTS.hydration;
  try {
    await page.waitForLoadState("networkidle", { timeout: networkIdleTimeout });
  } catch {
    // Long-polling APIs (sse/ws) prevent true networkidle — fall through.
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    } catch {
      /* ignore */
    }
    await page.waitForTimeout(500);
  }
  try {
    await page.waitForSelector(HYDRATION_MARKER, { timeout: hydrationTimeout, state: "attached" });
  } catch {
    // App doesn't yet emit a hydration marker — short grace period.
    await page.waitForTimeout(500);
  }
}

/* ────────────────────────────────── login ───────────────────────────────── */

/**
 * Log in via the UI using env credentials. Aborts cleanly if env is unset.
 */
export async function login(page, baseUrl) {
  const user = process.env[AUTH.usernameEnv];
  const pass = process.env[AUTH.passwordEnv];
  if (!user || !pass) {
    throw new Error(
      `login(): missing env credentials. Set ${AUTH.usernameEnv} and ${AUTH.passwordEnv} before running the harness.`,
    );
  }
  await page.goto(baseUrl + AUTH.loginRoute, { waitUntil: "domcontentloaded", timeout: TIMEOUTS.navigation });
  await waitForReady(page);
  await page.fill(AUTH.usernameSelector, user);
  await page.fill(AUTH.passwordSelector, pass);
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: TIMEOUTS.networkIdle }).catch(() => {}),
    page.click(AUTH.submitSelector),
  ]);
  // Wait for redirect away from /login, within reason.
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: TIMEOUTS.networkIdle });
  } catch {
    /* caller can decide */
  }
  await waitForReady(page);
  // Dismiss the first-visit onboarding tour so its backdrop doesn't eat clicks.
  // See frontend/src/components/layout/OnboardingTour.tsx — either key dismisses.
  try {
    await page.evaluate(() => {
      try {
        localStorage.setItem("alphadesk.onboarding_dismissed", "true");
        localStorage.setItem("alphadesk-tour-complete", "1");
      } catch {
        /* ignore (private-mode etc.) */
      }
    });
  } catch {
    /* ignore */
  }
}

/* ──────────────────────────────── snapshot ──────────────────────────────── */

/**
 * Capture a PNG + DOM for `label`. Console/network jsonl are appended by sinks
 * attached in attachEventSinks — we just record the artifact filenames here.
 */
export async function takeSnapshot(page, runDir, label) {
  const safe = slugify(label);
  const pngPath = path.join(runDir, `${safe}.png`);
  const domPath = path.join(runDir, `${safe}.dom.html`);
  const artifacts = { png: null, dom: null };

  try {
    await page.screenshot({ path: pngPath, fullPage: true, animations: "disabled" });
    artifacts.png = path.basename(pngPath);
  } catch (e) {
    artifacts.pngError = e?.message || String(e);
  }

  try {
    // Wait for real body content before serializing (guards against 0-byte DOMs
    // where page.content() fired before React hydrated). If the wait times out
    // once, give 500ms of grace and try again; after that write whatever we have.
    let waited = false;
    try {
      await page.waitForFunction(
        () => document.body && document.body.innerHTML.length > 1000,
        null,
        { timeout: 3000 },
      );
      waited = true;
    } catch {
      waited = false;
    }
    if (!waited) {
      await page.waitForTimeout(500);
      try {
        await page.waitForFunction(
          () => document.body && document.body.innerHTML.length > 1000,
          null,
          { timeout: 1500 },
        );
      } catch {
        /* write whatever we've got */
      }
      artifacts.domRetry = true;
      // eslint-disable-next-line no-console
      console.warn(`[qa] snapshot DOM retry for ${label} at ${domPath}`);
    }
    const html = await page.content();
    await fs.writeFile(domPath, html, "utf8");
    artifacts.dom = path.basename(domPath);
    artifacts.domBytes = Buffer.byteLength(html, "utf8");
  } catch (e) {
    artifacts.domError = e?.message || String(e);
  }

  // console.jsonl + network.jsonl live at the step dir level (see runPage).
  artifacts.console = "console.jsonl";
  artifacts.network = "network.jsonl";

  return artifacts;
}

/* ────────────────────────────── step runner ─────────────────────────────── */

/**
 * Execute a single step. Returns `{ status: "pass"|"fail", ms, artifacts, error? }`.
 * Never throws unless given a truly fatal input.
 */
export async function runStep(page, step, runDir, baseUrl) {
  const start = Date.now();
  const result = { kind: step.kind, label: step.label || step.kind, status: "pass", ms: 0, artifacts: {} };

  try {
    switch (step.kind) {
      case "navigate": {
        const url = step.to?.startsWith("http") ? step.to : baseUrl + (step.to || "/");
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUTS.navigation });
        await waitForReady(page);
        break;
      }

      case "snapshot": {
        const artifacts = await takeSnapshot(page, runDir, step.label || `snapshot-${Date.now()}`);
        result.artifacts = artifacts;
        break;
      }

      case "click": {
        await page.click(step.selector, { timeout: TIMEOUTS.action, ...(step.options || {}) });
        if (step.waitFor) await page.waitForTimeout(step.waitFor);
        break;
      }

      case "type": {
        if (step.clear) await page.fill(step.selector, "");
        await page.fill(step.selector, step.value ?? "", { timeout: TIMEOUTS.action });
        break;
      }

      case "hover": {
        await page.hover(step.selector, { timeout: TIMEOUTS.action });
        if (step.waitFor) await page.waitForTimeout(step.waitFor);
        break;
      }

      case "hover-first-if-present": {
        // Hover the first match of `selector` if any exist; otherwise mark the
        // step `skipped` (not `fail`) so empty-state pages don't break the run.
        const count = await page.locator(step.selector).count().catch(() => 0);
        if (count === 0) {
          result.status = "skipped";
          result.skipReason = `no match for ${step.selector}`;
          break;
        }
        await page.locator(step.selector).first().hover({ timeout: TIMEOUTS.action });
        if (step.waitFor) await page.waitForTimeout(step.waitFor);
        break;
      }

      case "click-if-present": {
        // Click the first match of `selector` if any exist; otherwise mark the
        // step `skipped` so empty-state pages don't break the run. Used e.g.
        // for chart range buttons that only appear once data arrives.
        const count = await page.locator(step.selector).count().catch(() => 0);
        if (count === 0) {
          result.status = "skipped";
          result.skipReason = `no match for ${step.selector}`;
          break;
        }
        await page.locator(step.selector).first().click({ timeout: TIMEOUTS.action });
        if (step.waitFor) await page.waitForTimeout(step.waitFor);
        break;
      }

      case "press": {
        if (step.on) await page.focus(step.on, { timeout: TIMEOUTS.action });
        await page.keyboard.press(step.key);
        break;
      }

      case "scroll": {
        // Scroll to a selector, or by (x,y), or to bottom.
        if (step.selector) {
          await page.locator(step.selector).first().scrollIntoViewIfNeeded({ timeout: TIMEOUTS.action });
        } else if (step.y != null) {
          await page.evaluate(([x, y]) => window.scrollTo(x, y), [step.x ?? 0, step.y]);
        } else {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        }
        await page.waitForTimeout(step.waitFor ?? 200);
        break;
      }

      case "wait": {
        if (step.for === "networkidle") {
          await page.waitForLoadState("networkidle", { timeout: step.timeout ?? TIMEOUTS.networkIdle });
        } else if (step.for === "selector" && step.selector) {
          await page.waitForSelector(step.selector, { timeout: step.timeout ?? TIMEOUTS.action });
        } else if (step.for === "url" && step.url) {
          await page.waitForURL(step.url, { timeout: step.timeout ?? TIMEOUTS.networkIdle });
        } else {
          await page.waitForTimeout(step.timeout ?? 500);
        }
        break;
      }

      case "eval": {
        result.artifacts.evalResult = await page.evaluate(step.fn || step.expression);
        break;
      }

      case "set-viewport": {
        const vp = VIEWPORTS[step.viewport];
        if (!vp) throw new Error(`unknown viewport: ${step.viewport}`);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(200);
        break;
      }

      case "click-every": {
        // Click up to N matching elements inside `containerSelector`, snapshotting each.
        const containerSelector = step.containerSelector || "body";
        const itemSelector = step.itemSelector || "button, [role='button'], [role='tab']";
        const maxN = step.maxN ?? 5;
        const labelPrefix = step.labelPrefix || "item";
        const locator = page.locator(containerSelector).locator(itemSelector);
        const count = Math.min(await locator.count(), maxN);
        const items = [];
        for (let i = 0; i < count; i++) {
          const el = locator.nth(i);
          try {
            await el.scrollIntoViewIfNeeded({ timeout: 3000 });
            await el.click({ timeout: 3000, trial: false });
            await page.waitForTimeout(step.waitFor ?? 400);
            const artifacts = await takeSnapshot(page, runDir, `${labelPrefix}-${i}`);
            items.push({ idx: i, status: "pass", artifacts });
          } catch (e) {
            items.push({ idx: i, status: "fail", error: e?.message || String(e) });
          }
        }
        result.artifacts.items = items;
        break;
      }

      default:
        throw new Error(`unknown step kind: ${step.kind}`);
    }
  } catch (e) {
    result.status = "fail";
    result.error = e?.message || String(e);
    // Best-effort failure snapshot.
    try {
      const fail = await takeSnapshot(page, runDir, `${step.label || step.kind}-FAIL`);
      result.artifacts.failSnapshot = fail;
    } catch {
      /* swallow */
    }
  }

  result.ms = Date.now() - start;
  return result;
}

/* ─────────────────────────── page-level runner ──────────────────────────── */

/**
 * Run a spec against a given browser context.
 * Creates <runDir>/<spec.name>/<viewport>/ under which all artifacts for this page live.
 */
export async function runPage(context, spec, runRoot, baseUrl, viewportName) {
  const stepDir = path.join(runRoot, slugify(spec.name), viewportName);
  await ensureDir(stepDir);

  const vp = VIEWPORTS[viewportName] || VIEWPORTS["desktop-1440"];
  const page = await context.newPage();
  await page.setViewportSize({ width: vp.width, height: vp.height });

  const detach = attachEventSinks(page, stepDir);

  const pageResult = {
    name: spec.name,
    route: spec.route,
    viewport: viewportName,
    startedAt: new Date().toISOString(),
    steps: [],
  };

  try {
    for (const step of spec.steps || []) {
      const res = await runStep(page, step, stepDir, baseUrl);
      pageResult.steps.push(res);
    }
  } catch (e) {
    pageResult.fatal = e?.message || String(e);
  } finally {
    pageResult.completedAt = new Date().toISOString();
    detach();
    await page.close().catch(() => {});
  }

  return pageResult;
}

/* ─────────────────────────────── manifest ───────────────────────────────── */

export async function writeManifest(runDir, manifest) {
  await writeJson(path.join(runDir, "manifest.json"), manifest);
}

/* ───────────────────────────── summary table ────────────────────────────── */

export function summarize(results) {
  const rows = [];
  let totalSteps = 0;
  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;
  let totalSnaps = 0;

  for (const r of results) {
    const pass = r.steps.filter((s) => s.status === "pass").length;
    const fail = r.steps.filter((s) => s.status === "fail").length;
    const skip = r.steps.filter((s) => s.status === "skipped").length;
    const snaps = r.steps.filter(
      (s) => s.kind === "snapshot" || (s.artifacts && s.artifacts.png),
    ).length;
    rows.push({
      page: `${r.name} (${r.viewport})`,
      route: r.route,
      steps: r.steps.length,
      pass,
      fail,
      skip,
      snaps,
    });
    totalSteps += r.steps.length;
    totalPass += pass;
    totalFail += fail;
    totalSkip += skip;
    totalSnaps += snaps;
  }

  // Render ASCII table.
  const pad = (s, n) => String(s).padEnd(n);
  const cols = [
    { k: "page", w: 32 },
    { k: "route", w: 28 },
    { k: "steps", w: 6 },
    { k: "pass", w: 6 },
    { k: "fail", w: 6 },
    { k: "skip", w: 6 },
    { k: "snaps", w: 6 },
  ];
  const header = cols.map((c) => pad(c.k, c.w)).join(" ");
  const sep = cols.map((c) => "-".repeat(c.w)).join(" ");
  const body = rows.map((r) => cols.map((c) => pad(r[c.k], c.w)).join(" ")).join("\n");
  const footer = `TOTAL: ${totalSteps} steps · ${totalPass} pass · ${totalFail} fail · ${totalSkip} skip · ${totalSnaps} snapshots`;
  return `${header}\n${sep}\n${body}\n${sep}\n${footer}`;
}
