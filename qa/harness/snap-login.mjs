#!/usr/bin/env node
// One-shot screenshot of /login on production for design comparison.
import { chromium } from "playwright";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../visual/snaps");
await fs.mkdir(OUT_DIR, { recursive: true });

const URL = process.argv[2] || "https://tradingalpha.net/login";
const NAME = process.argv[3] || "login-desktop";
const VIEW = process.argv[4] || "1440x960";
const [w, h] = VIEW.split("x").map(Number);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
// Give fonts + animations a beat to settle.
await page.waitForTimeout(800);
const file = path.join(OUT_DIR, `${NAME}.png`);
await page.screenshot({ path: file, fullPage: false });
console.log(`saved: ${file}`);
await browser.close();
