# R6 UI Remediation Plan — Re-secure 24/24

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 7 BLOCKERs + 17 MAJORs surfaced by the R5 adversarial sweep, restoring AlphaDesk's UI score from 16/24 back to 24/24.

**Architecture:** 9 contained PRs, all parallel-safe via worktree isolation. Each PR is self-contained, independently deployable, and ends with verification gates that match the failure mode that R4 missed (rendered DOM checks, not just source greps).

**Tech Stack:** Next.js 16 + React 19 + Tailwind v4 + FastAPI Python backend. AlphaDesk lives at https://tradingalpha.net. Branch base: `feature/deployment`.

**Verification standard (NEW for R6):** Every PR must verify at the rendered DOM level (read `.dom.html`, parse computed styles, confirm utility actually generated the expected CSS). Source-class greps are not enough — that's the lesson R5 surfaced.

---

## Sprint sequencing

| Day | PRs to ship in parallel (worktree-isolated) |
|---|---|
| **Day 1** | R6-1 (typography wiring), R6-2 (color guards), R6-7 (twMerge config) — small, independent foundations |
| **Day 2** | R6-3 (StaticArticle rhythm), R6-4 (TopBar consolidation), R6-9 (typography polish) — single-component refactors |
| **Day 3** | R6-5 (multi-leg ticket safety), R6-6 (sector_rotation stage), R6-8 (copy sweep) — surgical bug fixes |
| **Day 4** | R6-0 — fresh canonical sweep + 6 adversarial pillar audits to confirm 24/24 |

All 9 implementer PRs can technically run in parallel. Day groupings reflect natural review cadence.

---

## File structure (R6 changes)

**design-tokens.css**: add chart-structure + chart-book scale (R6-2 / B.2)
**globals.css**: wire 4 missing typography tokens (display-sm/xl + text-sm/text-base) — R6-1
**eslint.config.mjs**: extend palette + amber utility guards — R6-2
**lib/utils.ts**: configure tailwind-merge typography group — R6-7
**components/composites/TopBar.tsx**: DELETE — R6-4
**components/layout/TopBar.tsx**: keep as canonical — R6-4
**components/StaticArticle.tsx**: rhythm token migration — R6-3
**components/SectionRule.tsx**: change default tagAs — R6-9
**app/(dashboard)/trade/page.tsx**: mirror OCC-404 across activeLegs[] — R6-5
**components/.../OrderBar.tsx**: extend optionsUnavailable for legs — R6-5
**lib/strategies.ts** + **lib/strategy-content.ts**: sector_rotation stage update — R6-6
**app/(dashboard)/{analytics,reports,pipeline}/page.tsx**: Title Case → Sentence case — R6-8
**app/(dashboard)/pipeline/page.tsx:889**: Heartbeat date validation — R6-8
**components/charts/ChartPane.tsx**: STRUCTURE_COLORS / BOOK_COLORS token-ize — R6-2
**app/not-found.tsx**: wrap in MarketingShell — R6-4
**components/.../earnings/.../page.tsx**: clamp Claude forecast — R6-8
**components/composites/StatusStrip.tsx**: mobile horizontal scroll — R6-9 (visual)

---

## R6-1: Wire missing typography tokens (closes R5-B5)

**Files:**
- Modify: `frontend/src/app/globals.css` (add 2 lines to `@theme inline` block)
- Verify: `frontend/src/app/(dashboard)/page.tsx`, `frontend/src/components/layouts/DashboardPageLayout.tsx`, `frontend/src/components/composites/PriceChartPanel.tsx`, `frontend/src/components/...EditorialNameplate.tsx`

**Branch:** `qa/r6-1-typography-wiring`

- [ ] **Step 1:** Read `frontend/src/app/globals.css` `@theme inline` block (around lines 144-154). Confirm `--text-display-md`, `--text-display-lg` are present but `--text-display-sm`, `--text-display-xl` are missing.

- [ ] **Step 2:** Add the missing wires after `--text-display-md`:

```css
--text-display-sm: var(--fs-display-sm);
--text-display-xl: var(--fs-display-xl);
```

Also add `--text-sm` and `--text-base` mappings for the F18 fix:

```css
--text-sm: var(--fs-body-sm);    /* maps Tailwind text-sm to AlphaDesk 13px */
--text-base: var(--fs-body);     /* maps Tailwind text-base to AlphaDesk 15px */
```

- [ ] **Step 3:** Run `cd frontend && npm run build` to verify Tailwind compiles the new utilities.

- [ ] **Step 4:** Verify utility generation in compiled output. Read the build output: the bundle should now contain `.text-display-sm` and `.text-display-xl` rules. Run:
```bash
cd frontend && npm run build 2>&1 | tail -5
grep -r "text-display-sm" .next/static/css/ 2>/dev/null | head -3
```

- [ ] **Step 5:** Run typecheck + tests + lint:
```bash
cd frontend && npm run typecheck && npm test 2>&1 | tail -5 && npx eslint . 2>&1 | tail -3
```

- [ ] **Step 6:** Commit + push + open PR:
```bash
git add frontend/src/app/globals.css
git commit -m "qa(ui): r6-1 — wire missing --text-display-sm/-xl + Tailwind text-sm/-base in @theme (closes R5-B5)"
git push -u origin qa/r6-1-typography-wiring
gh pr create --base feature/deployment --title "qa(ui): r6-1 — typography token wiring" --body "Closes R5-B5: --text-display-sm and --text-display-xl were declared but not wired in @theme inline, causing every page-header h1 to silently render at 28px instead of 32px. Also wires Tailwind's text-sm/text-base to AlphaDesk's body tokens, eliminating 160 off-ladder bypasses without churning files."
```

---

## R6-2: Color decomposition phase 2 (closes R5-B6, R5-3-color, R5-3-color-MAJOR)

**Files:**
- Modify: `frontend/src/app/globals.css` (add chart-structure tokens to `@theme inline`)
- Modify: `frontend/src/styles/design-tokens.css` (add chart-structure CSS vars)
- Modify: `frontend/eslint.config.mjs` (extend palette guards)
- Modify: `frontend/src/components/.../StrategyDisclosure.tsx` and 6 sites using `text-amber-100`
- Modify: `frontend/src/components/charts/ChartPane.tsx:311-322` (STRUCTURE_COLORS + BOOK_COLORS migration)
- Modify: `frontend/src/components/panels/TradePanel.tsx:1501,1508` (replace #2a2a3e + #12121a)

**Branch:** `qa/r6-2-color-decomposition-2`

- [ ] **Step 1:** Add chart-structure + chart-book CSS vars to `frontend/src/styles/design-tokens.css` near the existing `--chart-*` aliases:

```css
/* Market structure chrome — distinct from --up/--down P/L semantic */
--chart-structure-support:    rgba(168, 208, 77, 0.20);
--chart-structure-resistance: rgba(224, 120, 86, 0.20);
--chart-structure-demand:     rgba(141, 179, 196, 0.18);
--chart-structure-supply:     rgba(217, 164, 65, 0.18);
--chart-structure-poc:        rgba(201, 166, 107, 0.30);

/* Order book quote chrome — distinct from P/L */
--chart-book-bid: rgba(168, 208, 77, 0.30);
--chart-book-ask: rgba(224, 120, 86, 0.30);
```

- [ ] **Step 2:** Migrate `frontend/src/components/charts/ChartPane.tsx:311-322` STRUCTURE_COLORS + BOOK_COLORS to read from CSS vars via getComputedStyle or hardcoded references to the var names:

```ts
const STRUCTURE_COLORS = {
  support:    getCSSVar("--chart-structure-support"),
  resistance: getCSSVar("--chart-structure-resistance"),
  demand:     getCSSVar("--chart-structure-demand"),
  supply:     getCSSVar("--chart-structure-supply"),
  poc:        getCSSVar("--chart-structure-poc"),
};
const BOOK_COLORS = {
  bid: getCSSVar("--chart-book-bid"),
  ask: getCSSVar("--chart-book-ask"),
};
```

(Add a small `getCSSVar()` helper that reads `getComputedStyle(document.documentElement).getPropertyValue()`.)

- [ ] **Step 3:** Find all `text-amber-100` consumers:
```bash
grep -rEn 'text-amber-(100|200|300|400|500|600|700)' frontend/src --include='*.tsx' --include='*.ts'
```

For each site, swap to `text-state-warning-fg` (or appropriate semantic). Expected: ~7 files in StrategyDisclosure + adjacent.

- [ ] **Step 4:** Find all `bg-amber-{N}/X` and other off-system Tailwind utility forms:
```bash
grep -rEn 'bg-amber-' frontend/src --include='*.tsx' --include='*.ts'
```

Migrate each to semantic warning tokens. ~9 sites expected.

- [ ] **Step 5:** Replace `TradePanel.tsx:1501` `#2a2a3e` → `var(--bg-elev-2)`; `TradePanel.tsx:1508` `#12121a` → `var(--bg-card)` (or use Tailwind `bg-bg-elev-2`/`bg-bg-card` if those utilities exist).

- [ ] **Step 6:** Extend `frontend/eslint.config.mjs` `no-restricted-syntax` rules:

```js
{
  selector: "Literal[value=/(?:^|[\\s\"'`])(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|placeholder|caret|accent|decoration|shadow)-(?:amber|emerald|red|blue|green|purple|pink|cyan|teal|indigo|violet|orange|fuchsia|rose|lime|sky|yellow)-/]",
  message: "Off-system Tailwind palette banned. Use AlphaDesk semantic tokens: state-warning, state-info-time, profit, loss, brand, ink-*, gold-*, up-*, down-*."
},
{
  selector: "TemplateElement[value.raw=/(?:^|[\\s\"'`])(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|placeholder|caret|accent|decoration|shadow)-(?:amber|emerald|red|blue|green|purple|pink|cyan|teal|indigo|violet|orange|fuchsia|rose|lime|sky|yellow)-/]",
  message: "Off-system Tailwind palette banned. Use AlphaDesk semantic tokens: state-warning, state-info-time, profit, loss, brand, ink-*, gold-*, up-*, down-*."
}
```

(Note: `slate`/`zinc`/`neutral`/`stone` Tailwind grays NOT banned — those are sometimes legitimate for utility chrome.)

- [ ] **Step 7:** Verify zero violations in source after fixes:
```bash
cd frontend && npx eslint . 2>&1 | grep "Off-system Tailwind palette" | wc -l
```
Expected: 0.

- [ ] **Step 8:** Verify on rendered DOM that the alerts/disclosure pages still render correctly. Read snapshot:
```bash
ls qa/runs/2026-05-04T20-31-40Z/strategies-*/desktop-1440/*.dom.html
```

Sample rendered DOM and confirm `text-state-warning-fg` token rendered (not raw amber).

- [ ] **Step 9:** Standard verification:
```bash
cd frontend && npm run typecheck && npm test 2>&1 | tail -5 && npx eslint . 2>&1 | tail -3
```

- [ ] **Step 10:** Commit + push + open PR.

---

## R6-3: StaticArticle rhythm propagation (closes R5-B7)

**Files:**
- Modify: `frontend/src/components/.../StaticArticle.tsx` (find via `grep -rln StaticArticle frontend/src`)

**Branch:** `qa/r6-3-static-article-rhythm`

- [ ] **Step 1:** Locate `StaticArticle.tsx`:
```bash
grep -rln "StaticArticle" frontend/src
```

- [ ] **Step 2:** Audit current spacing classes in StaticArticle. Likely `space-y-3 mt-5 gap-3` per R5 audit findings.

- [ ] **Step 3:** Migrate to rhythm tokens:
- Top-level container: `space-y-prose` (24px between paragraphs)
- Section breaks: `mt-section` (64px) for major chapter dividers, `mt-section-sm` (40px) for sub-sections
- Section padding: `py-section` (64px) for the article frame
- Inline groups: `gap-section-sm` (40px)

Match the pattern that R4-4 proved on `/about`.

- [ ] **Step 4:** Read `app/about/page.tsx` for the canonical pattern (R4-4 wrote it).

- [ ] **Step 5:** Visually diff each consumer route against `/about`. The 6 affected routes:
- `/privacy`, `/terms`, `/risk`, `/contact`, `/docs`, `/help/earnings-data`

Sample DOMs from the latest sweep `qa/runs/2026-05-04T20-31-40Z/<route>/desktop-1440/initial.dom.html` to confirm rhythm tokens render.

- [ ] **Step 6:** Standard verification + commit + PR.

---

## R6-4: TopBar consolidation + /not-found chrome (closes R5-NEW-M1, R5-NEW-M3)

**Files:**
- Delete: `frontend/src/components/composites/TopBar.tsx`
- Modify: `frontend/src/app/(dashboard)/page.tsx` (update import to `layout/TopBar`)
- Modify: `frontend/src/app/not-found.tsx` (wrap in MarketingShell)

**Branch:** `qa/r6-4-chrome-consolidation`

- [ ] **Step 1:** Read both TopBar components to understand their differences:
```bash
diff frontend/src/components/composites/TopBar.tsx frontend/src/components/layout/TopBar.tsx
```

Confirm `layout/TopBar.tsx` is the canonical (used by 11 routes per R5 audit).

- [ ] **Step 2:** Find dashboard's import of composites/TopBar:
```bash
grep -rn "composites/TopBar" frontend/src/app
```

- [ ] **Step 3:** Update `app/(dashboard)/page.tsx` import to use `layout/TopBar` instead.

- [ ] **Step 4:** Delete `composites/TopBar.tsx`.

- [ ] **Step 5:** Read `app/not-found.tsx`. Confirm it does NOT wrap in MarketingShell.

- [ ] **Step 6:** Read `components/.../MarketingShell.tsx` for the wrapper pattern.

- [ ] **Step 7:** Update `app/not-found.tsx` to wrap content in `<MarketingShell>`. Preserve existing 404 messaging.

- [ ] **Step 8:** Verify dashboard renders correctly after TopBar swap:
- Read latest dashboard DOM snapshot and confirm new TopBar's "Search symbols, commands…" placeholder is present (replacing the old "Search").

- [ ] **Step 9:** Standard verification + commit + PR.

---

## R6-5: Multi-leg OCC-404 ticket safety (closes R5-B1, R5-M5)

**Files:**
- Modify: `frontend/src/app/(dashboard)/trade/page.tsx` (extend OCC-404 detection across activeLegs[])
- Modify: `frontend/src/components/.../OrderBar.tsx` (accept legs-aware optionsUnavailable + multi-leg banner)
- Modify: execution-readiness pill component (likely in TradePanel) — pill state machine accepts leg-error inputs

**Branch:** `qa/r6-5-multi-leg-occ-safety`

- [ ] **Step 1:** Read `frontend/src/app/(dashboard)/trade/page.tsx` lines 360-420 (the OCC fetch path R4-W-3 partially fixed).

- [ ] **Step 2:** Read the existing `optionsUnavailable + onRetryOptions` props on OrderBar (added in R4-5).

- [ ] **Step 3:** Mirror the singular OCC-404 detection pattern across `activeLegs[]`. Track per-leg fetch state:

```ts
const [legsUnavailable, setLegsUnavailable] = useState<{
  symbol: string;
  reason: "404" | "timeout" | "generic";
}[]>([]);

// In fetch: catch 404s per-leg, accumulate into legsUnavailable
// Pass to OrderBar via new prop legsUnavailable={legsUnavailable}
```

- [ ] **Step 4:** OrderBar render: if `legsUnavailable.length > 0`, show banner per-leg with Retry button. Pattern matches single-leg banner.

- [ ] **Step 5:** Find the execution-readiness pill component. Update its state machine to consume `legsUnavailable`:
- All legs OK → green "Ready to submit"
- ANY leg error → amber "Quote unavailable for {N} of {total} legs — refresh before submit"
- All legs failing → coral "Cannot submit: no leg quotes available"

- [ ] **Step 6:** Add unit test for the pill state machine logic. Should cover: 0 errors → green; 1 error → amber; all errors → coral.

- [ ] **Step 7:** Verify on the existing trade DOM snapshot — read `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/multi-leg-prefill.dom.html` and confirm the new banner attribute would render with the captured 404s.

- [ ] **Step 8:** Standard verification + commit + PR.

---

## R6-6: sector_rotation strategy stage update (closes R5-B4)

**Files:**
- Modify: `frontend/src/lib/strategies.ts:135-142` (sector_rotation stage)
- Modify: `frontend/src/lib/strategy-content.ts:399-435` (sector_rotation thesis copy)

**Branch:** `qa/r6-6-sector-rotation-stage`

- [ ] **Step 1:** Read `lib/strategies.ts:135-142`. Confirm sector_rotation has `stage:"planned"`.

- [ ] **Step 2:** Update to `stage:"active"`. Match the shape of other ACTIVE strategies (e.g., earnings_options_play, momentum_quality).

- [ ] **Step 3:** Read `lib/strategy-content.ts:399-435`. Note current thesis literally says "no backend package … emits orders".

- [ ] **Step 4:** Rewrite thesis to reflect ACTIVE status. Use declarative-not-hype voice matching other ACTIVE strategies. The strategy DOES rotate sector exposure based on momentum signals; describe what it does, not what it doesn't.

Example style (adapt to the actual strategy's behavior):
> Rotates sector ETF exposure based on 6-month momentum + volatility-adjusted return ranking. Rebalances monthly. Top-3 sectors by composite score get equal weight; bottom rank cleared. Hedges via short SPY when breadth deteriorates.

- [ ] **Step 5:** Verify catalogue page bucketing now picks up sector_rotation as ACTIVE. Read `app/(dashboard)/strategies/page.tsx` to confirm bucketing logic reads from stage.

- [ ] **Step 6:** Visually verify on next deploy that sector_rotation appears in the ACTIVE bucket on `/strategies`.

- [ ] **Step 7:** Standard verification + commit + PR.

---

## R6-7: tailwind-merge typography group config (closes R5-NEW-M2)

**Files:**
- Modify: `frontend/src/lib/utils.ts`

**Branch:** `qa/r6-7-twmerge-typography`

- [ ] **Step 1:** Read `frontend/src/lib/utils.ts`. Confirm `cn = twMerge(clsx(...))` pattern.

- [ ] **Step 2:** Replace with `extendTailwindMerge` config:

```ts
import { extendTailwindMerge } from "tailwind-merge";
import { clsx, type ClassValue } from "clsx";

const ALPHADESK_TYPE_TOKENS = [
  "eyebrow", "label", "body", "body-sm", "h1", "h2", "h3",
  "display-sm", "display-md", "display-lg", "display-xl",
  "numeric-md", "numeric-lg", "numeric-xl", "numeric-hero",
];

const customTwMerge = extendTailwindMerge({
  override: {
    classGroups: {
      "font-size": [{ text: ALPHADESK_TYPE_TOKENS }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs));
}
```

This decouples AlphaDesk's typography size tokens from Tailwind's default `text-*` color group, so `cn("text-label", "text-primary-foreground")` no longer drops the color.

- [ ] **Step 3:** Add a unit test for the new behavior:

```ts
import { cn } from "./utils";

describe("cn — typography size + color collision", () => {
  it("preserves color when typography size is also applied", () => {
    expect(cn("text-label", "text-primary-foreground"))
      .toBe("text-label text-primary-foreground");
  });
  it("preserves color across multiple sizes", () => {
    expect(cn("text-eyebrow", "text-h2", "text-fg"))
      .toBe("text-h2 text-fg"); // last size wins, color persists
  });
});
```

- [ ] **Step 4:** Find the rendered `<Button>` "Create Alert" submit on `/alerts`. Visually verify on the next sweep that the gold-fill button now has its `text-primary-foreground` (light ink-1000) color visible.

- [ ] **Step 5:** Standard verification + commit + PR.

---

## R6-8: Copy sweep — site-wide Title Case + bug fixes (closes R5-B2, R5-B3, R5-1-MAJORs)

**Files:**
- Modify: `frontend/src/app/(dashboard)/analytics/page.tsx:761-768` (Title Case → Sentence case, ~5 labels)
- Modify: `frontend/src/app/(dashboard)/reports/page.tsx:830,860` (Title Case → Sentence case, ~3 labels)
- Modify: `frontend/src/app/(dashboard)/pipeline/page.tsx:680, 889` (Title Case → Sentence case + Heartbeat date validation)
- Modify: `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx:569` (kill `Got it — don't show again`)
- Modify: `frontend/src/components/charts/IVTermSkew.tsx:120-121` (text-node space bug)
- Modify: Claude forecast clamp logic (find via `grep "+800.0%" frontend/src` or similar)
- Modify: Product name unification (find via `grep "AI Trading Terminal\|AI-Powered Trading Terminal" frontend/src`)
- Modify: TradingAgents Research price-map labels (find `"d levels"` and `"ion add zone"` via grep)

**Branch:** `qa/r6-8-copy-sweep`

- [ ] **Step 1:** Title Case → Sentence case sweep:
```bash
# Find all suspect Title Case stat labels
grep -rEn '"[A-Z][a-z]+ [A-Z]' frontend/src/app/\(dashboard\)/{analytics,reports,pipeline,settings} --include='*.tsx'
```
Migrate each per the audit findings (~14 labels). Sentence case rule: only first word + proper nouns/acronyms capitalized.

- [ ] **Step 2:** Pipeline Heartbeat date validation. Read `frontend/src/app/(dashboard)/pipeline/page.tsx:889`:

```tsx
// Replace patterns like:
{`Heartbeat ${new Date(rawDate).toLocaleString()} ET`}
// With:
{(() => {
  const d = new Date(rawDate);
  if (isNaN(d.valueOf())) return "Heartbeat — unavailable";
  return `Heartbeat ${d.toLocaleString()} ET`;
})()}
```

- [ ] **Step 3:** Kill `Got it — don't show again` in `strategies/earnings-options-play/page.tsx:569`. Replace with `Don't show again` (sentence case, no banal "Got it" preamble) or remove entirely if the dismiss is auto-tracked.

- [ ] **Step 4:** Fix IVTermSkew text-node space bug at lines 120-121. JSX text nodes lose whitespace between elements. Add explicit `{" "}`:

```tsx
// Before:
<span>front-month {pct}%</span>to<span> back-month</span>
// After:
<span>front-month {pct}%</span>{" "}to{" "}<span>back-month</span>
```

- [ ] **Step 5:** Claude forecast clamp. Find the rendered `+800.0%`/`-700.0%`:
```bash
grep -rn "forecast\|expected_move\|implied_move" frontend/src/components --include='*.tsx' | head -20
```
Add display clamp: `Math.min(Math.max(value, -100), 100)`. If the raw value exceeds ±100, also surface a `<Tooltip>` with "Source data outside reliable range".

- [ ] **Step 6:** Product name unification. Find both forms:
```bash
grep -rn "AI Trading Terminal\|AI-Powered Trading Terminal" frontend/src
```
Pick one (suggest `AlphaDesk` standalone, since the `AI` qualifier is already implied by the product positioning). Update both. Check `<title>` tags + marketing copy.

- [ ] **Step 7:** TradingAgents price-map label corruption. Find:
```bash
grep -rEn '"d levels"|"ion add zone"' frontend/src
```
These are likely truncated prefixes (e.g., `"Demand levels"`, `"Distribution add zone"`). Restore full labels.

- [ ] **Step 8:** Other quick wins from R5 MAJORs:
- `Day P&L` vs `Day P/L` glyph: standardize on `P&L` (already used at most sites)
- Strategy-count drift between `/docs` (`twelve`) vs `/strategies` (`12 active / 19 total`): make `/docs` say `19 strategies (12 currently active)` or read from a single source
- Remove extra space before semicolon: `risk ;` → `risk;`
- `/help/earnings-data` mixed Title/sentence case: pick one, apply

- [ ] **Step 9:** Standard verification + commit + PR.

---

## R6-9: Typography polish (closes F17 SectionRule + F18 ladder + F19 h2 hierarchy + F21 inline-style escape)

**Files:**
- Modify: `frontend/src/components/.../SectionRule.tsx:34` (default tagAs change)
- Modify: 40+ SectionRule call sites — audit each, choose semantic h2 or visual label
- Modify: `frontend/src/app/global-error.tsx` (replace inline fontSize: 9.5 / 10.5)
- Modify: `frontend/src/app/(dashboard)/strategies/trading-agents-research/page.tsx` (h2 hierarchy fix)
- Modify: `frontend/src/components/.../KillSwitchStatusPanel.tsx` (8 text-sm sites — should auto-resolve via R6-1's text-sm wiring; verify)
- Modify: `frontend/src/components/composites/StatusStrip.tsx` (mobile horizontal scroll for truncation)

**Branch:** `qa/r6-9-typography-polish`

- [ ] **Step 1:** Read `SectionRule.tsx:34`. Change default `tagAs` from `"h2"` to `"div"`:

```tsx
// Before:
function SectionRule({ tagAs = "h2", className = "t-label", ...props }) {
// After:
function SectionRule({ tagAs = "div", className = "t-label", ...props }) {
```

- [ ] **Step 2:** Find all SectionRule call sites:
```bash
grep -rEn '<SectionRule' frontend/src --include='*.tsx'
```

For each, decide: is this section a SEMANTIC h2 (top-level page section)? Or a VISUAL label (eyebrow chip)?
- Semantic h2 → add explicit `tagAs="h2"` AND change className to `t-h2` (22px italic display)
- Visual label → leave as default (now `tagAs="div"` with `t-label`)

- [ ] **Step 3:** Specifically audit `/help/earnings-data` (currently 12 h2s for 6 logical sections per R5 audit). Promote 6 to actual h2 + t-h2; remove 6 duplicate label-h2s.

- [ ] **Step 4:** Fix `global-error.tsx` inline-style escape. Find lines with `fontSize: 9.5` and `fontSize: 10.5`. Replace with class-based equivalents:
```tsx
// Before: <p style={{ fontSize: 9.5 }}>
// After: <p className="text-eyebrow"> // 11px floor enforced
```

- [ ] **Step 5:** Trading-agents-research h2 hierarchy. Read `app/(dashboard)/strategies/trading-agents-research/page.tsx` and find the 3 different h2 sizes. Pick one canonical class (`t-h2` for major sections, `t-h3` for sub-sections, never both at the same logical level).

- [ ] **Step 6:** Verify R6-1's wiring auto-resolved KillSwitchStatusPanel's 8 `text-sm` sites. After R6-1 deploys, `text-sm` maps to `--fs-body-sm` (13px) — same as `text-body-sm`. So those 8 sites are now ladder-compliant without source change. Just confirm no visual regression.

- [ ] **Step 7:** StatusStrip mobile truncation. Read current mobile rendering:
```bash
ls qa/runs/2026-05-04T20-31-40Z/dashboard/mobile-390/*.png
```
Visual inspection: text cuts off without indication. Fix by adding `overflow-x-auto scrollbar-hide snap-x snap-mandatory` to the strip container; each pill gets `snap-start shrink-0`.

- [ ] **Step 8:** Standard verification + commit + PR.

---

## R6-0: Final verification — fresh sweep + 6 adversarial pillar audits

**Branch:** N/A (verification only — no code changes)

After all 9 R6 PRs deploy, run R6-0:

- [ ] **Step 1:** Trigger fresh deploy: `gh workflow run deploy.yml --ref feature/deployment`.

- [ ] **Step 2:** Wait for deploy, run canonical sweep:
```bash
ALPHADESK_TEST_USER=admin ALPHADESK_TEST_PASS=<pass> \
  node qa/harness/run-all.mjs --base=https://tradingalpha.net
```

- [ ] **Step 3:** Update `qa/runs/LATEST.md` with new run ID.

- [ ] **Step 4:** Dispatch 6 ADVERSARIAL pillar agents in parallel. Use the same prompt template as R5 (hunt for NEW bugs, not verify R5 closures). Each agent saves to `qa/reviews/pillars-r6/<NN>-<pillar>.md`.

- [ ] **Step 5:** For EACH pillar agent's prompt, include the R5 BLOCKERs that were supposed to close as a verification checklist:
- Pillar 1: verify `Heartbeat Invalid Date ET` gone, Title Case stat labels in sentence case, `Got it — don't show again` killed, Claude forecast clamped, sector_rotation thesis updated, IVTermSkew space fix, product name unified
- Pillar 2: verify TopBar consolidated, /not-found has chrome, Button text color visible
- Pillar 3: verify text-amber-100 → text-state-warning-fg at all 7 sites, ChartPane STRUCTURE_COLORS tokenized, TradePanel hex literals replaced, ESLint guard catches Tailwind utility form
- Pillar 4: verify --text-display-sm wired (read computed style from rendered DOM!), SectionRule default changed, h2-as-label sites resolved, text-sm now maps to 13px
- Pillar 5: verify StaticArticle rhythm tokens render at /privacy /terms /risk /contact /docs /help/earnings-data
- Pillar 6: verify multi-leg ticket banner appears when legs 404, execution-readiness pill states correct

- [ ] **Step 6:** Synthesize results into `qa/reviews/SPRINT-R6-COMPLETE.md`.

- [ ] **Step 7:** If any pillar < 4/4, create R7 sprint plan for the remainder.

---

## Verification standards (NEW for R6)

Every R6 PR MUST verify at the rendered DOM level, not just source greps. The R5 audit found that R4 awarded 24/24 partly because R4 only verified source classnames, not rendered output. R6 closes that gap:

| Old verification (R4) | New verification (R6) |
|---|---|
| `grep -r "text-display-sm" frontend/src/components` | Read `.dom.html` and confirm utility actually rendered |
| ESLint guard catches `var(--amber-500)` | ESLint guard catches `var(--amber-500)` AND `text-amber-*` AND `bg-amber-*` AND template-literal forms |
| Single-spec audit | Cross-route audit (every authed route + every marketing route) |
| Award score on representative example | Award score only when ALL instances clean |
| "Single mental model" claim on 1 site | Verification grep proves pattern at every instance |

---

## Risk register

| Risk | Mitigation |
|---|---|
| Multi-leg ticket fix (R6-5) is the highest-stakes change — wrong code = wrong-market trading | Add unit tests + manual E2E test by simulating leg 404s in a trade ticket before merge |
| sector_rotation thesis copy (R6-6) requires domain knowledge | Read backend `sector_rotation/strategy.py` to ground the thesis in actual logic |
| ESLint guard expansion (R6-2) might fail on legitimate uses (e.g., chart libraries) | Audit lint output before merge; add scoped exceptions if needed (file-level disable with reason) |
| R6-1 token wiring affects every page-header h1 visually (28→32px) | Compare visual regression baselines before/after; user-facing visual change requires sign-off |
| TopBar consolidation (R6-4) might break dashboard-specific behavior | Read both TopBar implementations carefully; preserve any dashboard-only hooks/state |

---

## Success criteria

R6 is complete when:
1. All 9 R6 PRs merged + deployed
2. R6-0 fresh sweep + 6 adversarial pillar audits returns **24/24** (verified at rendered DOM)
3. Zero console errors / network 4xx-5xx introduced
4. Test count holds or grows (currently 992)
5. Lint problem count holds or decreases (currently 41)
6. Visual regression baselines updated and committed if any intentional visual changes shipped

---

## Artifacts

- This plan: `qa/reviews/UI-REMEDIATION-PLAN-R6.md`
- R5 adversarial review: `qa/reviews/UI-REVIEW-R5.md`
- R5 per-pillar reports: `qa/reviews/pillars-r5/`
- Prior sprint completions: `qa/reviews/SPRINT-{,R2-,R3-,R4-}COMPLETE.md`
- Token system source: `frontend/src/styles/design-tokens.css`, `frontend/src/app/globals.css`
- ESLint guards: `frontend/eslint.config.mjs`
