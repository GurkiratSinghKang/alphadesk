# UI Review — R5 Adversarial Sweep (post-R4 regression check)

**Date:** 2026-05-04
**Methodology:** Fresh canonical sweep + 6 adversarial pillar agents instructed to HUNT for new bugs, not verify R4 closures
**Canonical run:** `qa/runs/2026-05-04T20-31-40Z` (378 steps, 372 pass, 0 fail, 6 skip)
**Inputs sampled:** 25-30 DOMs per pillar, 4-10 PNGs per pillar (one at a time, mobile-390 preferred)

---

## Score table — R4 promise vs R5 reality

| Pillar | R4 (verified) | **R5 (adversarial)** | Δ |
|---|---|---|---|
| 1. Copywriting | 4/4 | **2/4** | **−2** |
| 2. Visuals | 4/4 | **3/4** | **−1** |
| 3. Color | 4/4 | **3/4** | **−1** |
| 4. Typography | 4/4 | **3/4** | **−1** |
| 5. Spacing | 4/4 | **3/4** | **−1** |
| 6. Experience | 4/4 | **2/4** | **−2** |
| **Overall** | **24/24** | **16/24** | **−8** |

R4's 24/24 was earned against the carry-over list from R3. The R5 audits sampled FRESH surfaces and found bugs the prior 4 rounds missed because:

1. **Token wiring not verified at the rendered DOM level** (R4 grep'd source classes but didn't confirm Tailwind v4 actually generated the utilities)
2. **ESLint guards only ban CSS-variable form, not Tailwind-utility form** (R4-2 banned `var(--amber-500)` but not `text-amber-100`)
3. **"Single mental model" claims weren't generalized** (R4-5's `aria-live` only landed at 1 composite; the other 3 hero composites never got the edit)
4. **Audits scoped to single specs** (R5-NEW-M1 found two TopBar components forked because no single audit ran across all routes)
5. **Closures only validated for the singular shape** (R4-W-3 closed silent OCC-fallback for `activeContract` but the same file's `activeLegs[]` path was untouched)
6. **Promised follow-ups never scheduled** (R4-4 marketing rhythm proof on `/about` only — `/privacy /terms /risk /contact /docs /help/*` never migrated; R4 NEW-N1 PositionsList aria-live follow-up never created)
7. **New code between R3 and R5 not audited** (PR #32 `sector_rotation` shipped backend ACTIVE but frontend still says "in development")

---

## Consolidated BLOCKER list (ranked by user-facing impact)

### 🚨 R5-B1 — Multi-leg ticket silent OCC-fallback shows wrong market (Pillar 6)
**File:** `frontend/src/app/(dashboard)/trade/page.tsx:386-416`
**Impact:** TRADER MAKING DECISIONS ON WRONG MARKET. R4-W-3 closed the silent-degradation bug for `activeContract` only. The catch/then branches never inspect `activeLegs[]`. E2E-confirmed in run sweep: both staged strangle legs 404'd, multi-leg DOM has zero `data-slot="order-bar-options-unavailable"`, ticket renders underlying NVDA quote dressed as the leg spread (`Two-sided quote live · spread $0.06 · 0.03%`). Compounds with R5-M3 (execution-readiness pill goes green even when legs failed). **Fix:** mirror the singular OCC-404 detection pattern across the array path.

### 🚨 R5-B2 — `Heartbeat Invalid Date ET` rendered on /pipeline (Pillar 1)
**File:** `frontend/src/app/(dashboard)/pipeline/page.tsx:889`
**Impact:** Visible literal `Invalid Date` in user-facing copy. `new Date(...)` called on malformed-but-truthy string returns `"Invalid Date"`, page glues ` ET` after it. Visible on both desktop AND mobile pipeline PNGs in the sweep. Sits next to a `4 missed` amber badge. **Fix:** validate the date upstream or check `isNaN(d.valueOf())`.

### 🚨 R5-B3 — Corrupted Claude forecast `+800.0% / -700.0%` on PLTR earnings card (Pillar 1)
**Impact:** Defaults rendered on the most-promoted research surface look fake. Probably a backend data issue but presents as broken UI. **Fix:** clamp display to ±100% and surface a "data unreliable" affordance.

### 🚨 R5-B4 — `sector_rotation` backend ACTIVE, frontend says "not yet implemented" (Pillar 6)
**Files:** `frontend/src/lib/strategies.ts:135-142` (still `stage:"planned"`); `lib/strategy-content.ts:399-435` (thesis literally says "no backend package … emits orders")
**Impact:** Trust-break. PR #32 shipped backend `StrategyStatus.ACTIVE` but didn't update the frontend stage map. Catalog page bucketing short-circuits on stale stage before consulting API status. **Fix:** 3-line edit in strategies.ts + thesis copy update.

### 🚨 R5-B5 — `--text-display-sm` and `--text-display-xl` NOT wired in `globals.css @theme inline` (Pillar 4)
**Files:** `frontend/src/app/globals.css` (only `display-lg` + `display-md` are wired); affected sites: `DashboardPageLayout.tsx:78`, `dashboard/page.tsx:938`, `PriceChartPanel.tsx:195`, `EditorialNameplate.tsx:41`
**Impact:** Every authenticated page-header h1 silently renders at 28px instead of intended 32px. Tailwind v4 silently no-ops the unwired utility. R4 audited the source classNames but didn't verify the CSS actually generated. **Fix:** ~5-line addition to globals.css `@theme` block.

### 🚨 R5-B6 — `text-amber-100` (Tailwind stock) renders on 27 surfaces (Pillar 3)
**Files:** `StrategyDisclosure.tsx:87` + 6 other sites; affects `/strategies` catalogue cards + every `/strategy/{id}` disclosure banner
**Impact:** Won't follow theme switches; light-mode mirror missing. R4's ESLint guard only catches `var(--amber-500)` literals, not Tailwind utility shades. **Fix:** swap `text-amber-100` → `text-state-warning-fg` (7 source sites) + extend ESLint guard to also ban `bg-amber-*`/`text-amber-*` Tailwind defaults.

### 🚨 R5-B7 — Marketing rhythm rollout never shipped (Pillar 5)
**Files:** `StaticArticle.tsx` and `/privacy /terms /risk /contact /docs /help/earnings-data` continue to render at R3-flagged `space-y-3 mt-5 gap-3` cadence
**Impact:** R3-W2 was withheld for this exact reason; R4 awarded 4/4 on `/about` proof-of-concept alone. The promised follow-up PR migrating `StaticArticle.tsx` (~5 line edit, propagates to 4 routes) never landed. **Fix:** propagate `space-y-prose`/`py-section`/`gap-section-sm`/`mt-section` through `StaticArticle`.

---

## Pillar 1 Copywriting — additional findings beyond BLOCKERs

**MAJORs (11 — selected):**
- **Title Case stat labels site-wide on /analytics, /reports, /pipeline, /settings** (~14 labels across `analytics/page.tsx:761-768`, `reports/page.tsx:830,860`, `pipeline/page.tsx:680`). R4 only fixed the seven settings toggles.
- **`Got it — don't show again`** survives in `earnings-options-play/page.tsx:569` — R4 only swept the two Live-mode dialogs, missed this banner on the most-promoted research surface
- **Split product name**: marketing reads `AI Trading Terminal`; dashboard `<title>` tag reads `AI-Powered Trading Terminal`
- **Corrupted price-map labels** in TradingAgents Research (`"d levels"`, `"ion add zone"`)
- **JSX text-node space bug** in `IVTermSkew.tsx:120-121`: renders `front-month 110.9%to back-month` (missing space before "to")
- **`Day P&L` vs `Day P/L`** glyph inconsistency on the SAME dashboard
- **Title Case `/docs` Contents and § headings** (R4 declared this clean — actually still present in deployed DOM)
- **Strategy-count drift** between `/docs` (twelve) and `/strategies` (12 active / 19 total)
- **Bare em-dash data placeholders** on `/strategies/{id}` (`Last trade —`)
- **Mixed Title Case / sentence-case** on `/help/earnings-data`
- **Extra space before semicolon** in `Naked short calls have unlimited risk ;`

**NITs (14):** R4 carry-overs (404 CTAs, login eyebrow redundancy, bare reference code on request-access submit), leftover `▸` glyphs, ASCII `->` arrows in trade-ticket chips, mobile dashboard copy clipping (`Working orders need r…`, `POSITIONS · OPEN OR`), uncapped `+13,282.4%` AVG R in earnings setup-comparison, dev-language leak `(admin/debug)` in settings Performance Monitor, kill-switch panel double-button labelling.

## Pillar 2 Visuals — additional findings

**MAJORs (3):**
- **R5-NEW-M1 TopBar forked into 2 components**: `composites/TopBar.tsx` used by dashboard only, `layout/TopBar.tsx` used by every other authed route. Different chrome on every nav transition.
- **R5-NEW-M2 Primary `<Button>` loses `text-primary-foreground` via twMerge**: `cn = twMerge(clsx(...))` treats `text-label` (size token) as same group as `text-primary-foreground` (color), DROPPING the latter. Visible on `/alerts` "Create Alert" + `/settings`. The 404's gold "Back to AlphaDesk" button (no className override) is the visual control proving how it should look.
- **R5-NEW-M3 `/not-found` ships with no shared chrome** — no logo, no nav, no MarketingShell wrapper. Reads as a different product.

**MINORs (5):** N1 login-reset shell parity, N2 dashboard mobile statusstrip truncation no fade, N3 carry-over TopBar wrap, N4 marketing pages have 2× `text-[36px]` arbitrary literals (R4 claimed zero), N5 trading-agents-research still ~90 arbitrary px literals.

## Pillar 3 Color — additional findings beyond BLOCKER

**MAJOR (R5-2):** R4 ESLint guard at `eslint.config.mjs:67-74` only catches `var(--amber-500)` literals — does NOT catch `text-amber-500`, `bg-amber-500/40`, or stock shades like `text-amber-100/200/400`. 9 source sites already use the un-caught form.

**MINOR (R5-3):** `ChartPane.tsx:311-322` defines 6 raw `rgba()` constants (`STRUCTURE_COLORS` for support/resistance/demand/supply/POC + `BOOK_COLORS` for bid/ask). Render on `/trade` as a SECOND greens-and-reds pair distinct from chartreuse/coral P&L semantic.

## Pillar 4 Typography — additional findings beyond BLOCKER

**WARNING F17:** `SectionRule.tsx:34` defaults `tagAs="h2"` + `className="t-label"` — every editorial section heading on `/docs`, `/about`, `/privacy`, `/terms`, `/risk`, `/contact`, `/help/earnings-data`, every strategy detail page, `/login/reset`, and `/_design` renders as `<h2 class="t-label">` (12px uppercase). >40 h2s as 12px labels. On `/help/earnings-data` it gets duplicate h2s per section (12 h2s for 6 logical sections).

**WARNING F18:** R4 only audited `text-xs` (down to 2). R5 found 116 unconditional `text-sm` + 44 `text-base` sites = **160 off-ladder bypasses**. Neither is wired in `@theme`; they fall back to Tailwind defaults (14px / 16px) which don't match any `--fs-*` token. Cluster of 8 sites in `KillSwitchStatusPanel.tsx` — new code shipped after R3-2 typography migration.

**WARNING F19 (reopens R4 F4):** 8 distinct visual treatments for h2 in production source (`text-h3`, `text-h2`, `text-h1`, `text-display-md`, `text-body`, `text-sm`, `t-label`, `t-section-display`). `/strategies/trading-agents-research` alone uses 3 different h2 sizes; `/trade` and `/alerts` show inverted hierarchy (h2 ≤ h3 visual size).

**WARNING F21:** `global-error.tsx` has hardcoded inline `fontSize: 9.5` and `fontSize: 10.5` — below the 12px floor.

**INFO F20:** 72 inline `style={{ letterSpacing: ... }}` props bypass the `tracking-*` scale, including `style={{ letterSpacing: 0 }}` h1 overrides that fight the tokenized default.

## Pillar 5 Spacing — additional findings beyond BLOCKER

**WARNING R5-2:** `<TouchTarget>` primitive is **dead code**. Zero consumer JSX adoption. All 33 tap-floor sites use the `min-h-touch` utility class directly. R4 cited the primitive as evidence of "primitive-backed where a pattern repeats at scale" — only call site is its own test file.

**WARNING R5-3:** Container-padding contract drift. `TradePanel` uses `p-3`, `OrderBar` uses `px-4 py-4`/`@[720px]:px-7`, `WatchlistPanel`/`AnalysisPanel`/`OptionsPanel` use no root padding. No shared `<Panel>` primitive exists. **Bonus:** `TradePanel.tsx:1501,1508` uses literal hex `#2a2a3e`/`#12121a` (color escape on the same panel).

**WARNING R5-4 (re-surfaced):** Top-10 spacing share at 47.8%, unmoved across 3 rounds (R3: 49.7%, R4: 47.7%, R5: 47.8%). Pillar contract target is ≥70%. R4 added 4 new tokens, none broke into the head; the `gap-1`/`gap-1.5`/`gap-2` codemod was deferred.

## Pillar 6 Experience — additional findings beyond BLOCKERs

**MAJORs (3):**
- **R5-3 Skip-to-content link absent on 7/12 surfaces** (login, about, privacy, terms, risk, docs, contact, request-access). `MarketingShell` and `AuthProductFrame` shells never adopted the WCAG 2.4.1 commitment. Login is keyboard users' first authenticated touchpoint.
- **R5-4 `aria-live` pattern didn't generalize**: R4 promised "single mental model" extends to all live-numeric composites. ContextBar hero P&L (0), PriceChartPanel last price (0), PositionsList rows (0). Three of four hero composites silent.
- **R5-5 Execution-readiness pill goes green even when both staged legs failed to fetch quotes.** `2 passed checks` displayed in DOM despite leg 404s. Compounds with R5-B1.

**WARNING R5-6:** OnboardingTour 3× `setTimeout(1500)` still has no `prefers-reduced-motion` short-circuit.

**NITs (2):** R5-7 DestructiveConfirmModal "Confirming…" text-only mirrors OrderBar N-3; R5-8 `/help/earnings-data` no peer `error.tsx`.

---

## What R1-R4 closures HELD across R5

- **B-1** SW `/trade*` short-circuit unchanged; 8 trade DOMs full Next.js shells (~97KB), zero offline markers
- **B-2** Calendar 200 in 3.1s, `detail-header-title` rendered, auto-select works
- **B-3** Destructive consistency: 19 `useDestructiveAction` adopters, 0 `window.confirm`
- **B-4** 12 `error.tsx` files (held from R3)
- **W-3 single-leg branch** + W-6 broker-disable + N-5 TradePanel aria-live all stand
- **R3-1 /docs voice rewrite**: vendor-marketing slop ("leverages", "powerful") gone in deployed DOM
- **R4-1 settings sentence case**: 7 toggle labels confirmed
- **R4-1 backend `auth.py`** editorial fallback confirmed in deployed DOM
- **R4-1 marketing footer** `α · Operator-grade execution` confirmed
- **R4-2 ApiDegradedBanner** state-warning tokens render correctly
- **R4-2 SectorTreemap** chartreuse/coral migration verified at source
- **R4-3 leading consolidation** holds (4 escapes, all documented)
- **R4-3 strategies h2 fix** holds (5 sibling h2s match)
- **R4-4 `/about` rhythm tokens** render in DOM (12× space-y-prose, 2× each section/section-sm/mt-section/py-section)
- **R4-5 OCC 404 affordance** on single-leg confirmed in `single-leg-prefill.dom.html`
- **R4-5 TradePanel PositionsTab `aria-live`** verified in 8 trade DOMs

---

## Methodological lessons (why R4's 24/24 didn't hold)

| Lesson | Symptom | Mitigation for R6 |
|---|---|---|
| Verify at the **rendered DOM** level, not just source classnames | R5-B5 `text-display-sm` silently no-ops; R4 grep'd it as adopted | Audits must read `.dom.html` and parse-and-measure utilities, not just trust source greps |
| ESLint guards must ban **all forms** of an anti-pattern, not just one | R5-B6 `text-amber-100` un-caught despite R4-2 amber decomposition | Guards on token misuse should match `/^(text\|bg\|border)-amber-/` AST patterns, not just `var(--amber-500)` literals |
| Closures must **generalize** to all instances of a pattern | R5-B1 multi-leg path untouched; R5-4 aria-live only at 1 site | "Single mental model" claims need a verification grep that proves the pattern is at *every* instance |
| Audits must run **across ALL routes**, not single-spec | R5-NEW-M1 TopBar fork; R5-B7 marketing rhythm only on /about | Cross-route grep for any structural decision (chrome components, shell wrappers, rhythm tokens) |
| **New code shipped between rounds must be audited** | R5-B4 sector_rotation, R5 KillSwitchStatusPanel | Diff `git log R(N-1)..R(N) --name-only` and audit each touched file independently |
| Promised follow-ups must be **scheduled, not flagged** | R5-B7 marketing rhythm; PositionsList aria-live; sector_rotation frontend update | Every "follow-up" in a PR description becomes a tracked task (TodoWrite or issue), not a hope |
| Score boundaries should require **all instances clean**, not just the audited slice | R4 awarded 4/4 to Spacing on `/about` POC; R5 found 6 routes still violating | "4/4 = perfect across all instances of the pattern, not perfect at one well-chosen example" |

---

## Suggested R6 sprint plan

To re-secure 24/24, ship **8 contained PRs** addressing the BLOCKERs + their MAJOR companions:

| PR | Closes | Scope |
|---|---|---|
| **R6-1** | R5-B5 (Pillar 4) | Wire `--text-display-sm` + `--text-display-xl` in globals.css `@theme inline`. ~5 line edit. Visual sanity check on 4 affected sites. |
| **R6-2** | R5-B6 + R5-3-color (Pillar 3) | Swap `text-amber-100` → `text-state-warning-fg` at 7 sites. Extend ESLint guard to ban Tailwind utility form across `text-`/`bg-`/`border-` for amber/emerald/red/etc. defaults. |
| **R6-3** | R5-B7 (Pillar 5) | Migrate `StaticArticle.tsx` to use rhythm tokens. Propagates to /privacy, /terms, /risk, /contact, /help/earnings-data. |
| **R6-4** | R5-B1 + R5-M5 (Pillar 6) | Mirror OCC-404 detection across `activeLegs[]` in trade/page.tsx. Block execution-readiness pill from going green when any leg failed to fetch. |
| **R6-5** | R5-B4 (Pillar 6) | Update `frontend/src/lib/strategies.ts` sector_rotation `stage:"planned"` → `"active"`; rewrite thesis copy. |
| **R6-6** | R5-B2 + R5-B3 + 4 P1 majors (Pillar 1) | Date-validation fix for pipeline; Claude forecast clamp + data-unreliable affordance; remaining `Got it — don't show again`; Title Case sweep on /analytics /reports /pipeline; product name unification; IVTermSkew text-node space bug. |
| **R6-7** | R5-NEW-M1 + M2 + M3 (Pillar 2) | Consolidate TopBar to single component; fix twMerge color-class collision in primary Button; add MarketingShell wrapper to /not-found. |
| **R6-8** | Pillar 6 majors | Add skip-to-content to MarketingShell + AuthProductFrame; generalize aria-live to ContextBar/PriceChartPanel/PositionsList; OnboardingTour prefers-reduced-motion. |

Plus token-system sweep:
| | | |
| **R6-9** (typography polish) | F17 SectionRule + F18 text-sm/text-base ladder | Token-ize the 160 off-ladder Tailwind size bypasses; fix SectionRule h2-as-label default. |

Estimated 6-8 hours of implementer work + 1 round of R6-0 verification.

---

## Artifacts

- This report: `qa/reviews/UI-REVIEW-R5.md`
- R5 per-pillar reports: `qa/reviews/pillars-r5/01..06-*.md`
- Canonical sweep: `qa/runs/2026-05-04T20-31-40Z/manifest.json`
- Prior sprint reports: `qa/reviews/SPRINT-{,R2-,R3-,R4-}COMPLETE.md`
- Prior pillar reports: `qa/reviews/pillars/`, `pillars-r2/`, `pillars-r3/`, `pillars-r4/`
