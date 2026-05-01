#!/usr/bin/env node
// Read-only guard: compares Next App Router pages with qa/test-plan.md.
//
// Usage:
//   node qa/harness/check-route-spec-drift.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const appRoot = path.join(repoRoot, "frontend", "src", "app");
const planPath = path.join(repoRoot, "qa", "test-plan.md");

const PAGE_FILE = /^page\.(tsx|ts|jsx|js|mdx)$/;
const IGNORED_SOURCE_ROUTES = new Set([
  // App Router special files, not page routes.
]);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walk(full));
    } else if (PAGE_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function sourceRouteForPage(filePath) {
  const relativeDir = path.relative(appRoot, path.dirname(filePath));
  const segments = relativeDir
    .split(path.sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));

  const route = `/${segments.join("/")}`.replace(/\/+/g, "/");
  return route === "/" ? "/" : route.replace(/\/$/, "");
}

function parseInventory(markdown) {
  const rows = [];
  const rowPattern = /^\|\s*`([^`]+)`(?:\s*\([^)]*\))?\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm;
  let match;
  while ((match = rowPattern.exec(markdown)) !== null) {
    const route = match[1].trim();
    if (route === "Route") continue;
    rows.push({
      route,
      access: match[2].trim(),
      file: match[3].trim(),
    });
  }
  return rows;
}

function isQaPageReference(value) {
  return /^`qa\/pages\/[^`]+\.md`$/.test(value);
}

function stripBackticks(value) {
  return value.replace(/^`|`$/g, "");
}

function formatList(items) {
  return items.length ? items.map((item) => `  - ${item}`).join("\n") : "  - none";
}

const sourceRoutes = new Set(
  (await walk(appRoot))
    .map(sourceRouteForPage)
    .filter((route) => !IGNORED_SOURCE_ROUTES.has(route))
    .sort(),
);

const plan = await fs.readFile(planPath, "utf8");
const inventory = parseInventory(plan);
const inventoryRoutes = new Set(
  inventory
    .map((row) => row.route)
    .filter((route) => route !== "*")
    .sort(),
);

const missingFromInventory = [...sourceRoutes].filter((route) => !inventoryRoutes.has(route));
const staleInventoryRoutes = [...inventoryRoutes].filter((route) => !sourceRoutes.has(route));
const missingSpecFiles = [];

for (const row of inventory) {
  if (!isQaPageReference(row.file)) continue;
  const specPath = path.join(repoRoot, stripBackticks(row.file));
  if (!await exists(specPath)) {
    missingSpecFiles.push(`${row.route} -> ${stripBackticks(row.file)}`);
  }
}

const failures = [
  ["Routes missing from qa/test-plan.md inventory", missingFromInventory],
  ["Inventory routes without a matching App Router page", staleInventoryRoutes],
  ["Inventory rows referencing missing qa/page specs", missingSpecFiles],
];

let failed = false;
for (const [title, items] of failures) {
  console.log(`\n${title}:`);
  console.log(formatList(items));
  if (items.length) failed = true;
}

if (failed) {
  console.error("\n[route-spec-drift] failed");
  process.exit(1);
}

console.log("\n[route-spec-drift] ok");
