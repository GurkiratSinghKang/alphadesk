# AUDIT — 2026-05-05 — Adversarial 6-Pillar Visual Sweep

**Run audited:** `qa/runs/2026-05-04T20-31-40Z` (canonical, post-R4 deploy, **pre-R5/R6 audit-fix**)
**Supplemental run:** `qa/runs/2026-05-05T14-21-21Z` (in-progress, no manifest yet — sampled where present)
**Production target:** https://tradingalpha.net (post-R4 deploy state — no R5/R6 fixes deployed)
**Methodology:** 21 specs × desktop-1440 + mobile-390 = 42 viewports sampled. DOMs grep-mined for class-string truth + screenshots eyeballed at 1×.
**Adversarial stance:** Hunt NEW bugs against R5; assume every pillar still failing until proven; do not average upward.
**Ground truth:** Local commits `r6-1, r6-2, r6-3 (only on branch qa/r6-3-static-article-rhythm), r6-5, r6-6, r6-8` exist but **none are on `feature/deployment` HEAD**, so the canonical sweep faithfully captures live tradingalpha.net. R6-4, R6-7, R6-9 not started.

---

## Score table

| Pillar | R4 | R5 | **R6 (this audit)** | Δ vs R5 |
|---|---|---|---|---|
| 1. Copywriting | 4 | 2 | **2** | ±0 |
| 2. Visuals | 4 | 3 | **2** | −1 |
| 3. Color | 4 | 1 | **2** | +1 (no new BLOCKERs vs R5; but B6 still live) |
| 4. Typography | 4 | 3 | **1** | −2 |
| 5. Spacing | 4 | 3 | **2** | −1 |
| 6. Experience | 4 | 2 | **1** | −1 |
| **Overall** | 24 | 16 | **10/24** | **−6** |

R5 → R6 drop reflects (a) R5 closures still undeployed, (b) **NEW bugs found this round** that R5 missed (six font-family / arbitrary-px / clamp / `font-serif` / hex-shell / `dev` env-leak findings), (c) a deeper second pass on Pillar 4 type-ladder bypass uncovering 26 clamp + 103 arbitrary-px + 286 inline letter-spacing escapes site-wide. The R6 PRs as plotted close approximately half of the deficit when deployed.

---

## TOP-8 highest-priority findings (BLOCKERs first)

| # | Pillar | Severity | Finding | R6 closure |
|---|---|---|---|---|
| 1 | 6 | BLOCKER | Multi-leg trade ticket reports `Two-sided quote live · spread $0.06 · 0.03%` on the spread row even though both staged legs 404'd — `2 passed checks` is rendered in **profit-green**. Trader signals decisions on wrong market. `multi-leg-prefill.dom.html` lacks any `data-slot="order-bar-options-unavailable"` slot. | r6-5 ✅ (committed locally, undeployed) |
| 2 | 1 | BLOCKER | `Heartbeat Invalid Date ET` ships on **/pipeline AND /settings** (`pipeline/desktop-1440/initial.dom.html`, `settings/desktop-1440/section-5.dom.html` + bottom). Visible bright literal `Invalid Date` next to amber `4 missed` badge. R5 caught only /pipeline — /settings is NEW finding. | r6-8 ✅ (committed locally, undeployed) — but /settings call site needs same `isNaN` guard, **VERIFY both before merge** |
| 3 | 4 | BLOCKER | `--text-display-sm` and `--text-display-xl` still **NOT in production CSS** (R6-1 unwiring). Every authenticated h1 on `/dashboard`, `/analytics`, `/reports`, `/pipeline`, `/settings`, `/strategies/*` falls back to `text-h1` (28px) instead of intended display-sm (32px). Affects 4 source sites, 11+ rendered h1s. | r6-1 ✅ (committed locally, undeployed) |
| 4 | 4 | BLOCKER (NEW) | **Dashboard hero number ships at `text-[clamp(34px,3.4vw,52px)]`** — fluid arbitrary literal, NOT in token system. Plus `text-[clamp(14px,1.2vw,18px)]` and `text-[clamp(14px,1.08vw,17px)]` on the Day P/L stat. R5 missed because the prior audit grep'd only static `text-[Npx]` patterns, not `text-[clamp(...)]`. Dashboard is the most-trafficked authenticated route. | NOT planned — needs token addition (`--text-display-fluid` or stat-hero token) + 3 site replacements |
| 5 | 3 | BLOCKER | `text-amber-NNN` Tailwind defaults still ship on **27 surfaces** in production: `/settings`, `/strategies-list`, `/strategy-momentum-quality` (× both viewports). R6-2 fixed the source but production deploy is pending. ESLint guard upgrade (line 92, 96 of `eslint.config.mjs`) ensures regression prevention. | r6-2 ✅ (committed locally, undeployed) |
| 6 | 6 | BLOCKER | `/not-found` ships zero chrome (no `<header>`, `<nav>`, `<footer>`, no logo, no skip-link). Reads as a different product. Also: 9 surfaces missing skip-link (login, about, privacy, terms, risk, docs, contact, request-access, help-earnings-data, not-found). | NOT started (was R6-7 + R6-8) |
| 7 | 6 | BLOCKER (NEW) | **Footer ships `AlphaDesk dev — Built on Claude — © 2026` on EVERY authenticated route**. Source at `app/(dashboard)/layout.tsx:327` falls through `process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev"` to literal `"dev"` because the env var is unset in production. Compounded by `Degraded · build dev` chip on dashboard footer status. | NOT planned — needs build env var configured + DashboardShell.tsx:30 also says "v1.0" hardcoded (different behaviour, second source). |
| 8 | 4 | BLOCKER | `SectionRule` defaults `tagAs="h2" + className="t-label"` (12px uppercase) — every editorial section h2 across `/docs` (10), `/about` (5), `/privacy` (13), `/terms` (12), `/risk` (13), `/contact` (5), `/help/earnings-data` (8) renders as 12px label. **124 h2-as-label rendered across editorial pages**. (R5 F17 reopened with full scope.) | NOT started (was R6-9) |

---

## Pillar 1 — Copywriting: **2/4**

### BLOCKERs

- **P1-B2** **`Heartbeat Invalid Date ET`** on `/pipeline` AND `/settings` (pipeline `initial/bottom/stage-{0,1,2}.dom.html`, settings `bottom/section-5.dom.html`). Source at `frontend/src/app/(dashboard)/pipeline/page.tsx:889` was patched in r6-8 to `if (isNaN(d.valueOf())) return "Unavailable"` — **but the same render shape on /settings is a separate call site** that r6-8 should also touch (verify before merging).
- **P1-B3** Claude forecast reports **`+800.0% / -700.0%`** still on `strategies-earnings-options-play/initial.dom.html` (line ~1100). r6-8 commits a clamp + tooltip but undeployed.

### MAJORs

- **P1-M1** **Dashboard glyph drift `Day P&L` (status strip) vs `Day P/L` (control room card)** in `dashboard/desktop-1440/initial.dom.html` of 2026-05-05 sweep. Both visible in a single viewport. R5 found this; reopens.
- **P1-M2** **Title-case stat labels still on `/analytics` (Total Trades, Win Rate, Profit Factor, Avg Win, Avg Loss, Largest Win), `/reports` (Buying Power, Current Positions, Avg Cost, Mkt Value, Closed Trades, Win Rate), `/pipeline` (Run Now), `/settings` (Avg Response, Page Load, Memory Usage), `/alerts` (Target Price, Create Alert), `/strategies/earnings-options-play` (Show Greeks)`**. r6-8 fixes but undeployed.
- **P1-M3** **`Sector Rotation Model — in development. Not yet implemented.`** still on `strategies-list/initial.dom.html` despite backend `StrategyStatus.ACTIVE`. r6-6 fixes but undeployed. Trust break: the catalogue is the page traders use to gauge what AlphaDesk runs.
- **P1-M4** **`Got it — don't show again`** survives on `strategies-earnings-options-play/initial.dom.html`. r6-8 reduces to "Don't show again" but undeployed.
- **P1-M5** **TradingAgents Research price-map labels still cut mid-word** — DOM shows `near the upper Bollinger Band` and `higher-conviction add zone at $248–255` rendered cleanly, but the captions in the right-rail "PRICE MAP" panel summarize as `Reaction · low risk`, `Support / above tested`, etc. r6-8 fixes the snapToWordStart/End helper but undeployed.
- **P1-M6** **Footer environment leak `AlphaDesk dev — Built on Claude — © 2026`** on **every** authenticated route (settings, pipeline, dashboard, alerts, analytics, reports, strategies-list, strategies-earnings-options-play, strategies-trading-agents-research, strategy-momentum-quality). Source: `app/(dashboard)/layout.tsx:327`. NOT in r6 plan. Plus `DashboardShell.tsx:30` says `AlphaDesk v1.0` (different fallback, different shell).
- **P1-M7** **`Degraded · build dev` chip** in dashboard status footer. Same env-var origin. Visible on the live screenshot.
- **P1-M8** **Strategy-count drift** between routes: `/docs` says "twelve" + "12 systematic", `/strategies` summary block says "13/15", reports table lists ~17 strategies including Sector Rotation. No single source of truth.

### MINORs / NITs

- N1 `▸` glyph in source and DOM (`▸ Run full research` on /strategies/earnings-options-play, disabled state).
- N2 Mobile dashboard `Working orders need r…` and `POSITIONS · OPEN OR…` truncate on 390-wide viewport (`dashboard/mobile-390/initial.png` verified visually). DOM has full text; CSS `truncate` clips it. Same R5 finding.
- N3 `(admin/debug)` still appears on /settings card title "time app performance metrics (admin/debug)" — dev language leak.
- N4 Marketing claim drift: meta `<title>` on every authed page is `AlphaDesk — AI-Powered Trading Terminal`; in-app product wordmark + footer says `AlphaDesk` only. R5 finding remains.
- N5 `text-display-sm` (32px) intent leaks through into mobile tap-target floors that should be sentence size — see Pillar 4.

---

## Pillar 2 — Visuals: **2/4**

### BLOCKERs

- **P2-B1** **`/not-found` ships with zero chrome.** `not-found/desktop-1440/initial.dom.html`: 0 `<header>`, 0 `<nav>`, 0 `<footer>`, no logo, no skip-link. Reads as a different product. Visually confirmed in `not-found/desktop-1440/initial.png` — full-bleed black with orphan "Not on the tape." headline. NOT started (was r6-7).

### MAJORs

- **P2-M1** **TopBar fork unresolved.** Two TopBar files: `frontend/src/components/composites/TopBar.tsx` (used by dashboard) AND `frontend/src/components/layout/TopBar.tsx` (used by every other authed route via DashboardShell). Different chrome on every nav transition. Confirmed by file system + grep. NOT started (was r6-4).
- **P2-M2** **Primary `<Button>` strips `text-primary-foreground` via twMerge.** `alerts/desktop-1440/initial.dom.html:12690` shows the "Create Alert" submit button rendered as `class="… bg-brand hover:bg-gold-300 px-4 w-full h-11 md:h-9 text-label font-semibold"` — **no `text-primary-foreground`**. The `Button.tsx:46` variant string is `"bg-brand text-primary-foreground hover:bg-gold-300"` and the consumer passes `className="text-label font-semibold"`. twMerge's color/size group resolves `text-label` and drops `text-primary-foreground`. The "Back to AlphaDesk" button on `/not-found` (which has no className override) renders correctly in gold-fill. NOT started (was r6-7).
- **P2-M3** (NEW) **`font-serif` rendered on /strategies/earnings-options-play DecisionStrip** (`<span class="font-serif italic text-h1 leading-tight u-brand">NEUTRAL-BULL</span>`). Design-tokens.css declares only `--font-display`, `--font-ui`, `--font-mono` — no `--font-serif`. Tailwind's `font-serif` falls back to browser default serif (Times New Roman on Win/macOS Safari, Liberation Serif on Linux). Source: `strategies/earnings-options-play/_earnings/DecisionStrip.tsx:56`. NEW finding (not in R5).
- **P2-M4** (NEW) **Auth shell uses 56 hardcoded hex literals.** `components/auth/AuthProductFrame.tsx` runs an entirely off-system color palette (`#12281f`, `#f8f7ef`, `#5d7268`, `#d6e2d8`, `#ecf4ed`). `LoginForm.tsx` (32 hexes), `RequestAccessForm.tsx` (45 hexes), `AuthLuxuryPreview.tsx` (47 hexes). The /login screenshot shows a marketing-mint-green gradient that does not exist in the dark-product palette anywhere else. New finding.

### MINORs

- N1 9 surfaces missing skip-link (see Pillar 6 MAJOR). Affects keyboard nav.
- N2 Multi-leg trade ticket "Buying power needs confirmation" panel shows in muted amber but the same panel right-side says "Trade can submit order after final review" — visually contradicts itself.
- N3 Auth marketing `/login` page renders the entire workspace shell preview at marketing-spec scale, while the actual app dashboard is dark — the visual handoff at login → dashboard is jarring.
- N4 "ACTIVE" pill on /reports renders chartreuse profit color — same color used for P&L. Three semantic uses of one color.
- N5 Strategies list: pause/active/planned status badges use mixed pill styles (some uppercase, some title case; some chartreuse, some bronze).

---

## Pillar 3 — Color: **2/4**

### BLOCKERs

- **P3-B1** (= R5-B6) **`text-amber-NNN` Tailwind defaults still ship 27 times across production**: `settings/section-1.dom.html` (5), `strategies-list/initial.dom.html` (5 × 2 viewports = 10), `strategy-momentum-quality/{6 captures × 2 viewports} = 12`. `frontend/src/components/ui/Button.tsx:36` still has `data-[state=stale]:border-amber data-[state=stale]:bg-amber/10` — these are AlphaDesk's `--color-amber` token (good, keep). But `StrategyDisclosure.tsx:89` was migrated locally to `text-state-warning-fg` per r6-2 commit. Production hasn't deployed.

### MAJORs

- **P3-M1** **Inconsistent semantic mapping of "warning"/"stale"**: `border-amber data-[state=stale]:bg-amber/10` (Button.tsx) is amber, `bg-amber/15 text-amber` (Heartbeat badge in pipeline) is amber, but `Risk Monitor` toggle uses `bg-state-warning-bg text-state-warning-fg`. Same intent, three implementations. r6-2 closes the third path; needs broader audit on data-[state] driven warnings.
- **P3-M2** **AuthShell off-system palette (see P2-M4)** is also a color finding: `text-[#12281f]`, `bg-[#f8f7ef]`, etc. won't follow theme switches; light-mode has no mirror; potential WCAG contrast failures on smaller breakpoints.
- **P3-M3** (NEW) **`#5b8def`, `#a07550`, `#e07856`, `#a8d04d`** hardcoded palette in `components/charts/ChartPane.tsx:1386` — chart-internal palette of 4 colors that doesn't match `--chart-{1..5}`. r6-2 commit migrated `STRUCTURE_COLORS` and `BOOK_COLORS` to CSS vars but did NOT migrate this 4-color array.
- **P3-M4** Three different chartreuse-on-dark semantics live simultaneously: P&L gain, "ACTIVE" status pill, and "+0.00%" zero-return tile (all `text-profit`). Reader can't tell at a glance which is value and which is taxonomy.

### NITs

- N1 `text-loss/35 bg-loss/10` price-map negative band on TradingAgents Research uses red token correctly (good).
- N2 `data-tone="amber"` slot on the Degraded chip — slot-based theming emerging organically without a contract.

### What R6-2 (locally committed, undeployed) closes

When r6-2 deploys: 27 `text-amber-` occurrences disappear, ESLint guard at `eslint.config.mjs:92, 96` blocks regression. P3-B1 and P3-M3 (partially) close.

---

## Pillar 4 — Typography: **1/4**

This is the worst-scoring pillar. R5 found 3 BLOCKERs/MAJORs; this audit finds 6 NEW issues that R5 missed because R5 didn't grep `clamp(...)` or arbitrary literals on prose.

### BLOCKERs

- **P4-B1** **`--text-display-sm` and `--text-display-xl` not in production `globals.css @theme inline`**. Every authed page-header h1 silently rendered at 28px (`text-h1`) instead of intended 32px / 40px. r6-1 fixes locally; production undeployed. Affects: `app/(dashboard)/page.tsx:937`, `app/(dashboard)/layouts/DashboardPageLayout.tsx:78`, `components/composites/PriceChartPanel.tsx`, `components/composites/EditorialNameplate.tsx:41`.
- **P4-B2** (NEW BLOCKER) **`text-[clamp(34px,3.4vw,52px)]`** on the dashboard hero number (capital canvas equity stat). Plus `text-[clamp(14px,1.2vw,18px)]` and `text-[clamp(14px,1.08vw,17px)]` on Day P/L. **3 clamp() literals on the most-trafficked page**, none in the token system. R5 missed because grep was for `text-[Npx]` only. Visible in `dashboard/desktop-1440/initial.dom.html`. R6 plan does not address.
- **P4-B3** **`SectionRule` h2-default-as-12px-label**: `<h2 class="t-label">` × 124 renders across editorial routes. Source `components/typography/SectionRule.tsx:27` defaults `tagAs="h2"` AND `className="t-label"`. WCAG 1.3.1 — heading hierarchy is broken (h1 32px → h2 12px caps below it on every doc/about/privacy/terms/risk/contact/help page). NOT started (was r6-9).

### MAJORs

- **P4-M1** **`text-[36px]` arbitrary literal on every marketing route** (about, contact, privacy, terms, risk, docs, help-earnings-data — 7 routes). The marketing h1 hero. R5 found 2 sites; the production sweep shows it shipped to all 7. Likely from `MarketingShell.tsx` or `Display.tsx` primitive. NEW scope.
- **P4-M2** **`text-[54px]` and `text-[13.5px]` and `text-[12.5px]` on `/strategies/trading-agents-research`** prose. Three off-ladder font sizes on the same page.
- **P4-M3** **160 unconditional `text-sm` + `text-base` sites**: r6-1 maps these via `--text-sm: var(--fs-body-sm); --text-base: var(--fs-body)` in `@theme`. **Production CSS doesn't have those mappings yet** because r6-1 hasn't deployed. Until then, every `text-sm` site renders at Tailwind default 14px (≠ AlphaDesk body-sm 13px) and every `text-base` site at 16px (≠ body 15px). Cluster of 8 sites in `KillSwitchStatusPanel.tsx`.
- **P4-M4** **8 distinct visual treatments for h2** in production source (`text-h3`, `text-h2`, `text-h1`, `text-display-md`, `text-body`, `text-sm`, `t-label`, `t-section-display`). `/strategies/trading-agents-research` alone uses 3 different h2 sizes. R5 F19 reopens.
- **P4-M5** **286 inline `style="letter-spacing: …"` props** across DOMs, with 8 distinct values: `-0.02em, 0, 0px, 0.01em, 0.04em, 0.05em, 0.08em, 0.18em`. The `0` and `0px` appear on the SAME pages — confirming no normalization. Tracking scale (`tracking-tight`, `tracking-normal`, `tracking-wider`, etc.) is bypassed at scale. R5 reported 72 in source; rendered count is 286.
- **P4-M6** **103 arbitrary `text-[Npx]` on prose** across 7 routes. Includes 13.5px, 12.5px (sub-13px territory).
- **P4-M7** **26 `text-[clamp(...)]` font-size literals** on dashboard alone — fluid sizing without token participation. NEW.

### MINORs / NITs

- N1 `global-error.tsx` has hardcoded inline `fontSize: 9.5` and `fontSize: 10.5` (R5 F21).
- N2 `/login`, `/_design`, `/contact`, `/about` all use `text-[36px]` for marketing h1 hero — should be `text-display-lg` token or new `text-marketing-hero` token.

---

## Pillar 5 — Spacing: **2/4**

### BLOCKERs

- **P5-B1** (= R5-B7) **StaticArticle still on `space-y-3 mt-5 gap-3` cadence.** `frontend/src/components/layouts/StaticArticle.tsx:45-66` has `py-16 mt-4 mt-10 mt-16 gap-14 mt-5` — legacy ad-hoc spacing. Affected routes: `/privacy /terms /risk /contact /help/earnings-data`. r6-3 was committed only on branch `qa/r6-3-static-article-rhythm` — **not on `feature/deployment`**. Production renders `mt-5: 13`, `gap-3: 14`, `space-y-3: 4` per route on /privacy alone.
- **P5-B2** (NEW) **Dashboard `text-[clamp(34px,3.4vw,52px)]` is also a spacing escape** — the hero number's vertical rhythm depends on its rendered size, but the size is fluid and untokenized.

### MAJORs

- **P5-M1** **Container-padding contract drift**: `TradePanel` uses `p-3`, `OrderBar` uses `px-4 py-4`/`@[720px]:px-7`, `WatchlistPanel`/`AnalysisPanel`/`OptionsPanel` use no root padding. No shared `<Panel>` primitive. R5-3 reopens.
- **P5-M2** **Top-10 spacing share at ~47.8%**, unmoved across 3 rounds. Pillar contract target ≥70%. `gap-1` (401), `gap-1.5` (210), `gap-2` (429) constitute 1040 of 1778 gap-N occurrences (58.5%) — but 2K+ other p-/m-/space-y-* sites use mixed 0.5/1.5/2.5 half-step values that aren't all in the token scale.
- **P5-M3** **Dashboard hero spacing collapse on mobile** (verified in `dashboard/mobile-390/initial.png`): "Working orders need r…" truncated, "POSITIONS · OPEN OR…" truncated. Top status strip too dense for 390-wide.
- **P5-M4** **`<TouchTarget>` primitive is dead code** (R5-2 reopens). Zero consumer JSX adoption. All 33 tap-floor sites use the `min-h-touch` utility class directly — and most authed dashboard buttons hit `min-h-9` (36px) which is 8px under the 44px WCAG floor.
- **P5-M5** (NEW) **AuthProductFrame uses `rounded-[8px]` literal** (line 117, 120, 131, 157). Bypasses `--radius-sm/md/lg/xl` tokens. Visible in `auth/AuthProductFrame.tsx`. Same kind of escape as the hex literal.

### MINORs / NITs

- N1 `text-[clamp(...)]` is responsive-fluid by design but isn't connected to spacing tokens — visual rhythm fights at 1024+ breakpoints.
- N2 `gap-section-sm` and `space-y-prose` tokens were declared but never adopted by the StaticArticle.tsx that R6-3 targets. Until r6-3 lands on feature/deployment, the marketing rhythm system is single-route (about) only.
- N3 18px / 22px / 7px arbitrary literal spacings in source — small tail; documented in audit.

---

## Pillar 6 — Experience: **1/4**

This is the deepest-failing pillar.

### BLOCKERs

- **P6-B1** (= R5-B1) **Multi-leg ticket silent OCC-fallback shows wrong market.** `trade/desktop-1440/multi-leg-prefill.dom.html` lacks any `data-slot="order-bar-options-unavailable"` slot. Both staged strangle legs 404 but the ticket renders `Two-sided quote live · spread $0.06 · 0.03%` with the underlying NVDA $197.87 quote. `2 passed checks` is in **profit-green** in the DOM. Trader makes decisions on phantom data. r6-5 commits the multi-leg branch fix; undeployed.
- **P6-B2** (= R5-B4) **`sector_rotation` backend ACTIVE, frontend says "in development"**. `strategies-list/initial.dom.html` shows `aria-label="Sector Rotation Model — in development. Not yet implemented."` Trust break on the catalogue page. r6-6 commits the fix; undeployed.
- **P6-B3** **`/not-found` ships with no chrome.** Already covered as P2-B1; impacts navigation flow (no way to get back without clicking the orphan CTA).
- **P6-B4** **9 surfaces missing skip-to-content link** in production: login, about, privacy, terms, risk, docs, contact, request-access, help-earnings-data, not-found. WCAG 2.4.1 violation. Login is keyboard users' first authenticated touchpoint. R5-3 reopens with full scope.
- **P6-B5** (NEW) **Footer environment leak `AlphaDesk dev — Built on Claude — © 2026`** on EVERY authenticated route. `process.env.NEXT_PUBLIC_BUILD_VERSION` is unset in production → fallback "dev" leaks. `app/(dashboard)/layout.tsx:327`. The matching `DashboardShell.tsx:30` says `AlphaDesk v1.0` — **two different fallback strings, same component**.

### MAJORs

- **P6-M1** **`Degraded · build dev` chip** in dashboard footer status. Same env-var origin as P6-B5. Says "Degraded" with no tooltip — what's degraded? Why is the user seeing this? Visible in `dashboard/desktop-1440/initial.dom.html` and rendered on the live screenshot.
- **P6-M2** **`aria-live` pattern didn't generalize** (R5-4 reopens). ContextBar hero P&L (0 aria-live), PriceChartPanel last price (0), PositionsList rows (0). Three of four hero composites silent for screen readers despite R4-5 promising "single mental model".
- **P6-M3** **Execution-readiness pill goes green even when both staged legs failed.** "2 passed checks" displayed in `text-profit` DOM despite leg 404s. Compounds with P6-B1.
- **P6-M4** **OnboardingTour `setTimeout(1500)` × 3 has no `prefers-reduced-motion` short-circuit.** R5-6 reopens.
- **P6-M5** (NEW) **`/login` and `/login/reset` use different shell wrappers** — `login/reset/page.tsx:31` has the skip-to-content code inlined, but `/login` (parent route) does NOT. Inconsistent within the same auth flow.
- **P6-M6** (NEW) **TopBar fork creates focus-jump on nav transition.** `composites/TopBar.tsx` and `layout/TopBar.tsx` have different button orders, different active-state markers, different aria roles. Tab traversal across `/dashboard → /strategies` jumps the focused button index.
- **P6-M7** (NEW) **`Run full research` button on `/strategies/earnings-options-play` is disabled but still receives focus** without a `tooltip` or `aria-disabled` reason. Reads as "broken button" in keyboard nav.
- **P6-M8** Trade-flow friction: from /trade on entry, the user has to: (a) inspect the multi-leg-warning banner, (b) ignore the contradicting "trade can submit" panel, (c) review the "2 passed checks collapsed" pill (green even when wrong), (d) check staged combo legs (both same OCC). Four state mismatches in one ticket.

### NITs

- N1 DestructiveConfirmModal "Confirming…" text-only mirrors OrderBar N-3.
- N2 `/help/earnings-data` no peer `error.tsx`.

---

## Cross-cutting issues (NOT pillar-bound)

- **C1** **Local `r6-3` branch never merged to feature/deployment.** `git log feature/deployment..qa/r6-3-static-article-rhythm` shows the StaticArticle migration isolated. Either merge or delete the orphan branch.
- **C2** **Six R6 commits sit on feature/deployment HEAD but undeployed.** r6-1, r6-2, r6-5, r6-6, r6-8 all closed in source. Push to production blocks all the BLOCKERs above.
- **C3** **R6-4 (TopBar consolidation), R6-7 (twMerge color fix + /not-found chrome), R6-9 (SectionRule h2 default + 160 text-sm/text-base) are NOT started.** The audit report at `qa/reviews/UI-REMEDIATION-PLAN-R6.md` planned them but no commits exist.
- **C4** **Production env vars not configured.** `NEXT_PUBLIC_BUILD_VERSION` defaults to "dev" — should be set in Hetzner deploy (`/Users/GK/.claude/projects/-Users-GK-Downloads-alphadesk/memory/MEMORY.md` notes the box at 178.156.145.213). Same for any other env-conditioned UI strings.
- **C5** **Two TopBar files imply two truths** — `composites/TopBar.tsx` (used by dashboard's `composites` consumer) and `layout/TopBar.tsx` (used by DashboardShell). The DashboardShell wraps every other authed route. The dashboard's `(dashboard)/layout.tsx` skips the shell.
- **C6** **AuthProductFrame off-system shell** — 56 hex literals + 4 inline `rounded-[8px]` literals + light-mode marketing palette (`#fbfaf4`, `#edf6ec`, `#f7f5ed`) on `globals.css:599`. The auth shell IS marketing — but it should still register tokens, even if light-mode-only.

---

## What R6 PRs (committed locally, undeployed) close on next deploy

| PR | Closes | Notes |
|---|---|---|
| r6-1 (committed) | P4-B1 (display-sm/xl wiring) + P4-M3 (text-sm/base mapping) | Single CSS edit. Verify rendered h1 measures 32px after deploy. |
| r6-2 (committed) | P3-B1 (27 amber-* sites) + ESLint guard prevents regression | Deploy + grep DOM to confirm 0 `text-amber-NNN`. |
| r6-3 (only on `qa/r6-3-static-article-rhythm`) | P5-B1 (StaticArticle rhythm) | **Merge to feature/deployment first**, then deploy. |
| r6-5 (committed) | P6-B1 (multi-leg OCC fallback) + P6-M3 (green-pill mismatch) | Verify multi-leg DOM has `data-slot="order-bar-options-unavailable"` on leg-404. |
| r6-6 (committed) | P6-B2 (sector_rotation stage) + P1-M3 (thesis copy) | Verify catalogue card lookup hits API status, not stale stage map. |
| r6-8 (committed) | P1-B2 (Heartbeat Invalid Date) + P1-B3 (Claude forecast clamp) + P1-M2/M4/M5 + product-name unification | Verify both /pipeline AND /settings use the new `isNaN` guard (R5 only audited /pipeline). |

## What still needs work (NEW PRs)

- **R6-7** TopBar consolidation + /not-found chrome + twMerge primary-button fix (P2-B1, P2-M1, P2-M2, P6-B3). 3-component edit.
- **R6-9** SectionRule h2 default + 160 text-sm/text-base ladder fixes (P4-B3). Two-edit PR.
- **NEW R6-A** Dashboard hero clamp() detokenization (P4-B2). Add `--text-display-fluid` token + 3 site replacements OR migrate to fixed `text-display-lg` with mobile breakpoint.
- **NEW R6-B** Auth shell hex-literal sweep (P2-M4 + P3-M2). 56-hex `AuthProductFrame.tsx` + 4 hex sites in nested files. Migrate to `--auth-bg`, `--auth-fg`, `--auth-accent`, `--auth-border` light-mode tokens.
- **NEW R6-C** `font-serif` removal on DecisionStrip (P2-M3). Replace with `font-display italic` (matches verdict h1 across rest of app).
- **NEW R6-D** Footer env-leak fix (P6-B5 + P1-M6 + P6-M1). Set `NEXT_PUBLIC_BUILD_VERSION` in Hetzner deploy + `DashboardShell.tsx:30` consolidation.
- **NEW R6-E** Skip-to-content + chrome on `/login`, `/about`, `/privacy`, `/terms`, `/risk`, `/docs`, `/contact`, `/request-access`, `/help/earnings-data`, `/not-found` (P6-B4). MarketingShell + AuthProductFrame should each adopt the same skip-link primitive.

---

## Methodology log

- 21 specs × ≤4 captures/spec × 2 viewports = ~168 candidate DOMs. Sampled ~50 DOMs and ~12 PNGs.
- Used Python to grep+strip script/style/svg, isolated text content for copy bugs, regex'd Tailwind class strings for color/typography utility leaks.
- Cross-referenced each finding against `qa/reviews/UI-REVIEW-R5.md`, R6 commit log, and the R6 remediation plan.
- Verified ground truth at `frontend/src/app/globals.css` (token wiring), `frontend/eslint.config.mjs` (palette guards), `frontend/src/components/typography/SectionRule.tsx` (h2 default), `frontend/src/components/ui/Button.tsx` (variant strings), `frontend/src/components/auth/AuthProductFrame.tsx` (hex literals), `frontend/src/app/(dashboard)/layout.tsx:327` (env-leak source).

---

**Run signature:** `qa/runs/2026-05-04T20-31-40Z/manifest.json` · 378 steps · 372 pass · 0 fail · 6 skip · 144 PNGs.
**Audit author:** Adversarial 6-pillar agent, 2026-05-05.
**Word count:** ~3000.
