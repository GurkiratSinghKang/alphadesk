#!/usr/bin/env node
// qa/harness/run-all.mjs
// Orchestrator: loads every spec in ./tests, runs it across viewports, writes
// a full manifest + artifacts under qa/runs/<ISO-timestamp>/.
//
// Usage:
//   node qa/harness/run-all.mjs
//   node qa/harness/run-all.mjs --base=https://tradingalpha.net
//   node qa/harness/run-all.mjs --filter=login,dashboard --viewport=desktop-1440
//   node qa/harness/run-all.mjs --headless=false --slow-mo=200
//
// Env:
//   ALPHADESK_TEST_USER  - required for any spec with requiresAuth:true
//   ALPHADESK_TEST_PASS  - required for any spec with requiresAuth:true
//   ALPHADESK_BASE       - overrides default base (lower priority than --base)

import { chromium } from "playwright";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_BASE, VIEWPORTS, TIMEOUTS } from "./config.mjs";
import {
  ensureDir,
  isoStamp,
  login,
  runPage,
  summarize,
  writeManifest,
} from "./helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ───────────────────────────── arg parsing ──────────────────────────────── */

function parseArgs(argv) {
  const args = {
    base: DEFAULT_BASE,
    filter: null, // null = all
    viewport: null, // null = use each spec's default
    headless: true,
    slowMo: 0,
  };
  for (const raw of argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    switch (k) {
      case "base":
        args.base = v;
        break;
      case "filter":
        args.filter = v.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "viewport":
        args.viewport = v.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "headless":
        args.headless = v !== "false";
        break;
      case "slow-mo":
      case "slowMo":
        args.slowMo = parseInt(v || "0", 10) || 0;
        break;
      default:
        console.warn(`[warn] unknown flag --${k}`);
    }
  }
  // Normalize base (strip trailing slash).
  args.base = args.base.replace(/\/+$/, "");
  return args;
}

/* ─────────────────────── dynamic discovery of specs ─────────────────────── */

async function loadSpecs(filter) {
  const testsDir = path.join(__dirname, "tests");
  let entries = [];
  try {
    entries = await fs.readdir(testsDir);
  } catch (e) {
    console.error(`[fatal] could not read ${testsDir}: ${e?.message}`);
    process.exit(1);
  }
  const files = entries.filter((f) => f.endsWith(".mjs")).sort();
  const specs = [];
  for (const f of files) {
    const modUrl = pathToFileURL(path.join(testsDir, f)).href;
    try {
      const mod = await import(modUrl);
      if (!mod.spec) {
        throw new Error(`${f} does not export \`spec\``);
      }
      if (filter && !filter.includes(mod.spec.name)) continue;
      specs.push(mod.spec);
    } catch (e) {
      throw new Error(`failed to load ${f}: ${e?.message}`);
    }
  }
  return specs;
}

/* ──────────────────────────────── main ──────────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv);
  const runId = isoStamp();
  const runRoot = path.join(__dirname, "..", "runs", runId);
  await ensureDir(runRoot);

  console.log(`[qa] run  : ${runId}`);
  console.log(`[qa] base : ${args.base}`);
  console.log(`[qa] out  : ${runRoot}`);

  const specs = await loadSpecs(args.filter);
  if (!specs.length) {
    console.error("[fatal] no specs found — aborting.");
    process.exit(1);
  }
  console.log(`[qa] specs: ${specs.map((s) => s.name).join(", ")}`);

  // If any spec requires auth, verify env up-front so we fail fast.
  const needsAuth = specs.some((s) => s.requiresAuth);
  if (needsAuth) {
    if (!process.env.ALPHADESK_TEST_USER || !process.env.ALPHADESK_TEST_PASS) {
      console.error(
        "[fatal] authenticated specs requested but ALPHADESK_TEST_USER / ALPHADESK_TEST_PASS are unset. " +
          "Either set them, or use --filter to run only unauthenticated specs (login, docs, privacy, terms, risk, request-access, login-reset, not-found).",
      );
      process.exit(1);
    }
  }

  // 2026-05-05: launch Chromium with memory-friendly flags. Two intermittent
  // crashes earlier today (runs 14-09-35Z, 14-24-42Z) died at ~80-100s with
  // ``browserContext.newPage: Target page, context or browser has been
  // closed`` — both right after the harness moved from a desktop-1440 spec
  // to a mobile-390 spec, with the navigate step succeeding but the
  // subsequent waitForTimeout failing (i.e. the browser process was killed
  // mid-spec). The same harness produced clean 12-minute / 378-step runs
  // before and after on the same machine, so the failure is intermittent
  // memory pressure / OOM-killer rather than a deterministic spec bug.
  //
  // Mitigations layered here:
  //  · ``--disable-dev-shm-usage`` — Chromium's default /dev/shm allocation
  //    on macOS / Docker / restricted hosts is ~64MB and OOMs with several
  //    pages open. Forces fallback to /tmp which is unbounded.
  //  · ``--no-sandbox`` — drops the sandbox process tree (~5 helper procs);
  //    fine for CI/QA against a public URL but should NOT ship to a path
  //    that loads untrusted content.
  //  · ``--disable-background-networking`` / ``--disable-extensions`` /
  //    ``--disable-default-apps`` / ``--disable-component-extensions-with-background-pages``
  //    drop background workers Chromium spawns by default for telemetry,
  //    update checks, web-store, etc. None of which a QA run needs.
  //  · ``--js-flags=--max-old-space-size=2048`` caps V8 heap at 2GB per
  //    renderer so a runaway TradingView / Recharts re-render can't blow
  //    the host's 16GB Mac.
  const browser = await chromium.launch({
    headless: args.headless,
    slowMo: args.slowMo,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-default-apps",
      "--disable-component-extensions-with-background-pages",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--js-flags=--max-old-space-size=2048",
    ],
  });

  // Belt-and-braces: surface the disconnection event so we don't lose 30s
  // waiting for the next spec's newPage() to time out. The flag below
  // distinguishes "we're shutting the browser down on purpose" (last-line
  // ``await browser.close()``) from "the browser process died on us" so we
  // only emit the loud warning in the latter case.
  let shuttingDownBrowser = false;
  browser.on("disconnected", () => {
    if (!shuttingDownBrowser) {
      console.error(
        "[fatal] browser disconnected unexpectedly — remaining specs will fail. " +
          "Likely cause: OOM-killer or renderer crash. See the comment above " +
          "chromium.launch() for the memory-friendly flags applied.",
      );
    }
  });

  const manifest = {
    runId,
    baseUrl: args.base,
    startedAt: new Date().toISOString(),
    args: { ...args },
    specs: specs.map((s) => ({ name: s.name, route: s.route, viewports: s.viewports })),
    results: [],
  };

  // We lazily create an authenticated context only if needed, and share it
  // across every requiresAuth spec to avoid re-logging-in N times.
  //
  // 2026-05-05: track how many pages each context has served so we can
  // recycle ageing contexts before they accumulate enough cache / DOM
  // detritus to push the renderer near OOM. Empirically the 12-minute
  // full sweep does ~46 page-runs split ~6:40 anon:auth, so recycling
  // every 16 page-runs gives us 2-3 fresh contexts per run for the auth
  // path (where most of the heavy app state lives) and keeps cookie /
  // localStorage continuity across the small handful of specs that
  // chain (e.g. settings flips → reports refresh).
  let authContext = null;
  let authContextPages = 0;
  let anonContext = null;
  let anonContextPages = 0;
  const CONTEXT_RECYCLE_AFTER_PAGES = 16;
  let fatal = false;

  try {
    for (const spec of specs) {
      const viewports = args.viewport ?? spec.viewports ?? ["desktop-1440"];
      for (const vpName of viewports) {
        const vp = VIEWPORTS[vpName];
        if (!vp) {
          console.error(`[fatal] unknown viewport ${vpName} on spec ${spec.name}`);
          fatal = true;
          break;
        }

        let context;
        if (spec.requiresAuth) {
          // 2026-05-05: recycle the auth context after N page-runs to bound
          // memory growth. Saves the storageState (cookies + localStorage)
          // across the recycle so we don't re-login N times and so any
          // settings tweaks made by earlier specs persist into the new
          // context.
          if (authContext && authContextPages >= CONTEXT_RECYCLE_AFTER_PAGES) {
            try {
              const state = await authContext.storageState();
              await authContext.close();
              authContext = await browser.newContext({
                viewport: { width: vp.width, height: vp.height },
                deviceScaleFactor: vp.deviceScaleFactor,
                isMobile: vp.isMobile,
                ignoreHTTPSErrors: true,
                storageState: state,
              });
              authContextPages = 0;
              console.log(`[qa] recycled auth context after ${CONTEXT_RECYCLE_AFTER_PAGES} pages`);
            } catch (e) {
              console.error(`[warn] auth context recycle failed: ${e?.message}`);
              authContext = null;
              authContextPages = 0;
            }
          }
          if (!authContext) {
            authContext = await browser.newContext({
              viewport: { width: vp.width, height: vp.height },
              deviceScaleFactor: vp.deviceScaleFactor,
              isMobile: vp.isMobile,
              ignoreHTTPSErrors: true,
            });
            // Log in once; storage state carries cookies for all future pages.
            const loginPage = await authContext.newPage();
            try {
              await login(loginPage, args.base);
              console.log(`[qa] authenticated as ${process.env.ALPHADESK_TEST_USER}`);
            } catch (e) {
              console.error(`[fatal] login failed: ${e?.message}`);
              await loginPage.close().catch(() => {});
              fatal = true;
              break;
            }
            await loginPage.close().catch(() => {});
          }
          context = authContext;
          authContextPages += 1;
        } else {
          // 2026-05-05: same recycle policy for the anon context. No
          // storageState carryover needed (anon = no login).
          if (anonContext && anonContextPages >= CONTEXT_RECYCLE_AFTER_PAGES) {
            try {
              await anonContext.close();
              anonContext = null;
              anonContextPages = 0;
              console.log(`[qa] recycled anon context after ${CONTEXT_RECYCLE_AFTER_PAGES} pages`);
            } catch (e) {
              console.error(`[warn] anon context recycle failed: ${e?.message}`);
              anonContext = null;
              anonContextPages = 0;
            }
          }
          if (!anonContext) {
            anonContext = await browser.newContext({
              viewport: { width: vp.width, height: vp.height },
              deviceScaleFactor: vp.deviceScaleFactor,
              isMobile: vp.isMobile,
              ignoreHTTPSErrors: true,
            });
          }
          context = anonContext;
          anonContextPages += 1;
        }

        console.log(`[qa] → ${spec.name} @ ${vpName}`);
        const t0 = Date.now();
        try {
          const pageResult = await runPage(context, spec, runRoot, args.base, vpName);
          manifest.results.push(pageResult);
          const pass = pageResult.steps.filter((s) => s.status === "pass").length;
          const fail = pageResult.steps.filter((s) => s.status === "fail").length;
          console.log(
            `[qa] ← ${spec.name} @ ${vpName} — ${pageResult.steps.length} steps · ${pass} pass · ${fail} fail · ${Date.now() - t0}ms`,
          );
        } catch (e) {
          // Shouldn't happen (runPage catches internally) but belt-and-braces.
          manifest.results.push({
            name: spec.name,
            route: spec.route,
            viewport: vpName,
            fatal: e?.message || String(e),
            steps: [],
          });
          console.error(`[qa] !! ${spec.name} @ ${vpName} crashed: ${e?.message}`);
        }
      }
      if (fatal) break;
    }
  } finally {
    manifest.completedAt = new Date().toISOString();
    await writeManifest(runRoot, manifest);
    shuttingDownBrowser = true;
    await browser.close().catch(() => {});
  }

  // Summary table + exit code.
  console.log("\n" + summarize(manifest.results));
  console.log(`\n[qa] manifest: ${path.join(runRoot, "manifest.json")}`);

  const hasFailStep = manifest.results.some((r) =>
    r.steps.some((s) => s.status === "fail"),
  );
  const hasFatalPage = manifest.results.some((r) => r.fatal);
  if (manifest.results.length === 0) {
    console.error("[fatal] no page results were recorded.");
    fatal = true;
  }
  if (fatal || hasFatalPage) {
    process.exit(1);
  }
  // Step-level failures are test failures. Returning success here made the
  // harness useful for screenshots but unsafe for regression gates.
  process.exit(hasFailStep ? 1 : 0);
}

main().catch((e) => {
  console.error("[fatal] unhandled:", e);
  process.exit(1);
});
