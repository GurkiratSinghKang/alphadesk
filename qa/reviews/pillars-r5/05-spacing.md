# Pillar 5 — Spacing (R5 fresh adversarial)

**Score: 3 / 4**  (R1: 2/4, R2: 2/4, R3: 3/4, R4: 4/4 → **regressing to 3/4**)
**Run:** `qa/runs/2026-05-04T20-31-40Z`
**Stance:** FORCE — fresh hunt; assume the R4 4/4 was a peak that did not hold; verify against rendered DOM, not against R4's promises.

---

## Methodology

1. Re-ran R4's verification grep harness against the current source tree to confirm R4 closures are still closed (arbitrary `[Npx]` spacing, hand-applied `min-h-[44px]`, `space-y-[…]` arbitrary, semantic-token presence).
2. Sampled rendered DOMs from the canonical run for **the marketing pages R4 promised would migrate** (`/privacy`, `/terms`, `/risk`, `/contact`, `/docs`, `/help/earnings-data`) and counted rhythm-token render frequency vs the legacy `space-y-3` cadence.
3. Re-counted top-10 spacing share on the broader regex to see whether the R3 → R4 distribution actually consolidated.
4. Hunted for primitive adoption: `<TouchTarget>` JSX vs the `min-h-touch` utility, to determine whether the R4 primitive was load-bearing or dead code.
5. Audited container-padding contracts across `panels/` and `composites/` for consistency at a panel boundary (TradePanel vs OrderBar vs WatchlistPanel vs AnalysisPanel vs OptionsPanel).
6. Spot-checked PR #32 (sector_rotation) for new frontend surfaces — turned out to be backend-only, so no new spacing surface to audit.
7. Visual triangulation: opened mobile-390 PNGs of `/about` (R4 proof-of-concept) vs `/privacy`, `/terms`, `/risk`, `/contact` to confirm the rhythm gap is *visibly* still there, not just regex-still-there.

---

## NEW findings

### NEW BLOCKER (R5-1) — R4's promised marketing-rhythm rollout never shipped; **/about is the only surface using the tokens**

The R4 audit awarded the 4th point on the basis that:

> "The remaining marketing pages (`/privacy`, `/terms`, `/risk`, `/help/*`) inherit the foundation; the `StaticArticle` migration that propagates the gain is a planned follow-up explicitly documented in the `/about` JSDoc, not a missing piece."

That follow-up has **not landed**. Verified against the canonical sweep at `qa/runs/2026-05-04T20-31-40Z/`:

| Surface | DOM `space-y-prose` | DOM `py-section` | DOM `gap-section[-sm]` | DOM `mt-section` | What it actually uses |
|---|---:|---:|---:|---:|---|
| `/about` | **12** | **2** | 2 | 2 | `space-y-prose`, `py-section`, `gap-section-sm`, `mt-section` (proof-of-concept rhythm) |
| `/privacy` | 0 | 0 | 0 | 0 | `space-y-3` × 8, `mt-5` × 26, `gap-3` × 29, `gap-14` × 2, `py-16` × 3 (legacy) |
| `/terms` | 0 | 0 | 0 | 0 | `space-y-3` × 8, `mt-5` × 24, `gap-3` × 27, `gap-14` × 2, `py-16` × 3 (legacy) |
| `/risk` | 0 | 0 | 0 | 0 | `space-y-3` × 8, `mt-5` × 26, `gap-3` × 29, `gap-14` × 2, `py-16` × 3 (legacy) |
| `/contact` | 0 | 0 | 0 | 0 | `space-y-1` × 6 only (legacy) |
| `/docs` | 0 | 0 | 0 | 0 | `space-y-1` × 6 only (legacy) |
| `/help/earnings-data` | 0 | 0 | 0 | 0 | `space-y-1` × 6 only (legacy) |

Source-side confirmation at `frontend/src/components/layouts/StaticArticle.tsx:43–66`: the shared layout still hardcodes `py-16` (line 45), `mt-4` (50), `mt-10` (56), `mt-16 flex flex-col gap-14` (58), `mt-5` (62). It is structurally unchanged from R3. None of `--space-section` / `--space-section-sm` / `--space-prose` are referenced.

The R4 about-page JSDoc (`frontend/src/app/about/page.tsx:25–28`) says explicitly:

> *"This page deliberately does NOT use ``StaticArticle`` so that the rhythm tokens are visible in the source. /privacy, /terms, /risk continue to use ``StaticArticle`` until a follow-up PR migrates the shared layout."*

That follow-up PR is the *content* of the score promotion — without it, the 4th point was awarded on the strength of a single proof-of-concept page (1 file, 1 surface) representing 1/7 of the long-form marketing footprint while declaring the system "complete." That's a system pledge that didn't ship.

**Visual confirmation:** mobile-390 PNGs side-by-side (`qa/runs/2026-05-04T20-31-40Z/about/mobile-390/initial.png` vs `…/privacy/mobile-390/initial.png` vs `…/risk/mobile-390/initial.png` vs `…/contact/mobile-390/initial.png` vs `…/docs/mobile-390/initial.png`) show the same R3 cadence gap that R4-4 set out to fix: chapter breaks read as compressed paragraph breaks, the §-rule sits flush against the body copy, no breathing room between clauses. `/about` reads as discrete sections with rhythm. Everything else is unchanged from R3.

This is the precise gap R3 withheld the 4th point for. R4 awarded the point on the foundation work; R5 reverses that — **the foundation alone is not the system**. The system requires the foundation *and* the rollout, and the rollout is one file (`StaticArticle.tsx`) that re-binds five hardcoded classes to four token utilities, propagating to 4 routes (`/privacy`, `/terms`, `/risk`, plus future `StaticArticle` consumers). It is not a multi-day migration; it is a 5-line edit that R4 explicitly deferred.

**Files to fix:**
- `frontend/src/components/layouts/StaticArticle.tsx:45,50,56,58,62` — swap `py-16`→`py-section`, `mt-4`→`mt-prose` (or just replace the inline `<p className="mt-4 …">` pattern with a wrapping `<header className="space-y-prose">`), `mt-16`→`mt-section`, `gap-14`→`gap-section-sm`.
- `frontend/src/app/contact/page.tsx`, `frontend/src/app/docs/page.tsx`, `frontend/src/app/help/[slug]/page.tsx` — these use ad-hoc layouts not on `StaticArticle`; they need the same `py-section` / `space-y-prose` treatment.

### NEW WARNING (R5-2) — `<TouchTarget>` primitive is dead code

Grep across `frontend/src` for `<TouchTarget`:
- 2 hits in `frontend/src/components/primitives/TouchTarget.tsx` (the JSDoc usage example, lines 24, 30)
- 5 hits in `frontend/src/__tests__/primitives/touchtarget.test.tsx` (test surface only)
- **0 hits in any consumer surface**

R4 explicitly noted: "33 `min-h-touch` instances now exist across the codebase." The R4 audit framed this as the primitive being "primitive-backed (where a pattern repeats at scale — tap floor — it's promoted to `<TouchTarget>` with a test suite)." That framing is wrong: every consumer reaches for `min-h-touch` *as a utility class* on existing elements. Nobody mounts the `<TouchTarget>` component, nobody uses `asChild` to clone-and-merge floor classes. The primitive's only `asChild` test passes because the test is the only call site.

This isn't necessarily a defect — Tailwind utilities *are* the primitive in a token-driven system, and if `min-h-touch` is the right shape there's no need for the wrapping component. But then the `<TouchTarget>` component, its JSDoc, its `forwardRef`/`asChild`/`React.Children.only` complexity, and its 5-test suite are dead weight. R4 cited the primitive's existence as part of the system being "primitive-backed" and "complete." It is neither — it is a piece of unused scaffolding around a working utility class. Either:

1. **Delete the component** (and its tests) and let `min-h-touch` be the primitive — clean, defensible, removes a maintenance attractor that doesn't carry weight.
2. **Make it load-bearing** by migrating at least the long-running interactive sites (e.g., `<TouchTarget asChild><Link …/></TouchTarget>` where the floor would otherwise be lost on the inner DOM).

Either resolution is fine. Leaving it as decorative scaffolding presented as a primitive is what is not fine — it inflates the perceived completeness of the system.

**Score impact:** small. This is a layering hygiene issue, not a render defect; the floors render correctly via the utility. But the R4 score justification leaned heavily on the primitive being a load-bearing artefact ("primitive-backed where a pattern repeats at scale"), and that's not what's actually shipped.

### NEW WARNING (R5-3) — Container-padding contract drift across panels

Inspected the root `<div className="flex h-full flex-col …">` at every entry point in `components/panels/`:

| Panel | Root padding | Background | Border |
|---|---|---|---|
| `TradePanel` (legacy `<div p-3>` inner card at line 382) | `p-3` | (none on inner) | (none on inner) |
| `TradePanel` (main TabsPanel root at line 1501) | (none) | `bg-[var(--panel)]` | `border-t border-l border-[#2a2a3e]` ⚠ hardcoded hex |
| `WatchlistPanel:889` | (none) | `bg-[var(--panel)]` | `border-r border-border` |
| `AnalysisPanel:983` | (none) | `bg-[var(--panel)]` | `border-l border-border` |
| `OptionsPanel:248` | (none) | `bg-[var(--panel)]` | `border-t border-border` |
| `OrderBar:451` | `px-4 py-4` (mobile), `@[720px]:px-7` (desktop) | (none) | `border-t border-border bg-ink-050` |

Two consistency problems:

1. **TradePanel inner card uses `p-3` (12px); OrderBar uses `px-4 py-4` (16px) which jumps to `px-7` (28px) above 720px.** No other panel applies a root padding — they let children own it. Three different conventions across what are conceptually peer surfaces (panels mounted in the same workspace shell). There is no `<Panel>` primitive to anchor the contract.
2. **TradePanel uses literal hex `#2a2a3e` and `#12121a` for borders/backgrounds** (`TradePanel.tsx:1501,1508`) where every other panel uses `border-border` and `bg-[var(--panel)]`. This is a token-defended system; that's a token escape on a major panel surface. It's a color/spacing-adjacent issue (border resolves a chrome-layer decision that affects perceived padding), and it shows the same panel that owns the inconsistent inner padding has *also* drifted off the color tokens — same drift signal.

R4 reported the spacing system as "tokenized, wired, defended, primitive-backed, deduped, proven." On panels, defended is the only one that holds (ESLint allowed the choices because each one is internally legal). What's missing is a `<Panel>` primitive (or a shared `panel-root` class) that bakes in `bg-[var(--panel)]` + `border` + `p-3` once. The pattern repeats at *least* 5 times across the panels surface; that's exactly the threshold R4 articulated for primitive promotion. R4 promoted `<TouchTarget>` (zero consumer adoption) and not `<Panel>` (5+ open-coded duplications).

**Score impact:** medium-small. The variance is small and visually defensible per panel, but the pattern is exactly the inverse of what the R4 narrative claimed: the system promoted a primitive nobody uses, and didn't promote the primitive that's open-coded everywhere.

### NEW WARNING (R5-4) — Top-10 share unmoved at 47.8% (target ≥70%)

Re-ran the head-of-distribution count on the broader regex (`gap|p|px|py|pl|pr|pt|pb|m|mx|my|mt|mb|ml|mr|space-x|space-y` × {`[0-9.]+`, `touch`, `prose`, `section[-sm]?`}):

```
325 gap-2     |   88 mt-2*    |  ... tail of 155 distinct values ...
278 px-3      |   72 mt-3
195 py-2
188 gap-3
177 px-4
173 px-2
143 mt-1
131 gap-1.5
109 py-3
109 gap-1
```

Total: **3,824 uses across 165 distinct classes** (R4: 3,831 / 170 distinct — essentially flat).
Top-10 share: **47.8%** (R3: 49.7%, R4: 47.7%).

This was R3's W4 ("two-stop flex gap presets") and R4's "STILL OUTSTANDING — taste-only." It is *still* taste-only by the lint contract, but the pillar contract for a 4/4 score requires top-10 share ≥70%. Two consecutive rounds with no movement on this metric is structurally honest: R4 added 4 new tokens (`-touch`, `-section`, `-section-sm`, `-prose`) and zero of them broke into the top-10. That's because:

- The tokens that landed are *editorial* (long-form rhythm, tap floor) and the codebase is mostly *card UI* (gap-2/3, px-3, py-2 — micro-card density).
- The card-UI density top-10 is dominated by `gap-1` + `gap-1.5` + `gap-2` (565 uses across 3 adjacent values that should arguably be 2). R4 ack'd this and called it "future-codemod target if anyone wants top-10 share to crack 60%." That codemod did not run between R4 and R5.

**This is the same item R3 and R4 flagged.** R4 explicitly said it was "not score-gating." That stance is internally consistent within R4's logic, but combined with R5-1 (the rhythm rollout that didn't ship) it forms a pattern: the 4/4 in R4 was awarded based on potential (tokens exist, lint is intact, primitive exists, codemod is future) rather than realized adoption. The realized adoption is the criteria.

**Re-surfacing it explicitly here, not because it's a regression but because it's the only direct numeric measure of system consolidation, and after a full sprint round it didn't move.**

### NEW INFORMATIONAL (R5-5) — Arbitrary-px floor is intact and clean

Fresh `[Npx]` grep returned **14 hits** (R3: 14, R4: 15 — flat to slightly improved). All 14 are non-token nudges for legitimate reasons: 1px hairline-baseline (`mt-[1px]` × 5), 3px micro-density (`gap-[3px]`, `py-[3px]` × 2, `mt-[3px]`), 7px chip pill (`px-[7px]`), 18px tabular column gutter (`px-[18px]` × 4, `py-[18px]`), 22px ContextBar md-breakpoint padding (`md:px-[22px]`). ESLint guard at `eslint.config.mjs:22–45` continues to ban token-equivalent escapes. **No regression. R4 closure holds.**

`min-h-[44px]` grep returns 3 hits, all in JSDoc/test commentary (R4: same). **R4 closure holds.**

`space-y-[…]` grep returns 0 hits. **R4 closure holds.**

### NEW INFORMATIONAL (R5-6) — Rendered tap-floor counts at parity

Sampled DOMs to verify the migration shipped at runtime (not just at source):

```
dashboard/desktop-1440        9 min-h-touch  +  1 min-w-touch
dashboard/mobile-390          9 min-h-touch  +  1 min-w-touch
strategies-earnings-options-play/desktop-1440   31 min-h-touch
trade/desktop-1440            0 min-h-touch       <-- worth a quick check
strategies-list/desktop-1440   3 min-h-touch
pipeline/desktop-1440          3 min-h-touch
```

The trade page rendering 0 `min-h-touch` is interesting — it's the most touch-heavy surface in the app (order-row click targets, tab triggers, qty steppers). Ask: does the trade-page interactive surface rely on rendered `min-h-11` (44px) some other way (e.g., button defaults), or did the trade surface just not get migrated? Looking at `/trade` source (`page.tsx`), the interactive elements are mounted via `<TradePanel>` and `<OptionsPanel>` which use `min-h-11` directly (e.g., `OrderBar.tsx:684,740,752`) — that's 44px, equivalent to `min-h-touch`. So *value* parity holds; *token* parity does not. Same drift signal as R5-3: the tap-floor token isn't reaching every surface uniformly.

Not score-gating on its own, but combined with R5-2 (primitive at zero adoption) and R5-3 (panel-padding inconsistency), it's a third indicator that the R4 token system shipped without consistent adoption discipline.

---

## Sites verified clean (no regression)

- ESLint guard against token-equivalent arbitrary px (`eslint.config.mjs:22–45`) — intact.
- `@theme inline` namespace exposing `--spacing-touch`, `--spacing-section`, `--spacing-section-sm`, `--spacing-prose` (`globals.css:185–195`) — intact.
- `--touch-target-floor`, `--space-section`, `--space-section-sm`, `--space-prose` token declarations (`design-tokens.css:264, 272–274`) — intact.
- `min-h-[44px]` source-code escapes — 0 in real source code (3 in JSDoc/test comments). R4 closure holds.
- Arbitrary `space-y-[…]` — 0 hits. R4 closure holds.
- Arbitrary `[Npx]` spacing — 14 hits, all legitimate sub-token nudges. R4 floor holds (slightly improved from R4's 15).
- `EmptyState` + `AnalyticsEmptyPanel` two-tier system — distinct, intentional, verified again.
- BUG-04 (earnings empty-pane void) — still resolved via `CalendarWeekHeatmap` mount.
- TouchTarget primitive correctness — the component itself is well-formed; the issue is adoption (R5-2), not implementation.

---

## Score justification

R4 awarded **4/4** on the strength of:
1. Tap-floor migrated to token + primitive (R3 W3).
2. Marketing rhythm tokenized + a single proof-of-concept page (R3 W2).

R5 confirms #1 holds at the source level (0 escapes, ESLint defending) and is rendered correctly on every captured DOM. **#2 does not hold:** the migration that propagates the rhythm gain to the rest of the marketing footprint (`StaticArticle` → 4 routes, plus `/contact` / `/docs` / `/help/*`) was explicitly deferred to a follow-up PR in R4's own JSDoc, and that follow-up did not ship between R4 and R5. **/about is the only surface using the rhythm tokens.** Six of seven long-form marketing surfaces still render at the under-cadenced `space-y-3` / `mt-5` / `gap-3` cadence that was the original R3 finding.

Beyond #2, three new findings confirm the R4 system has measurable adoption gaps:
- **R5-2:** the `<TouchTarget>` primitive R4 cited as evidence of "primitive-backed where a pattern repeats at scale" has **zero consumer adoption**. The 33 tap-floor sites all reach for the utility class directly. The primitive is dead scaffolding.
- **R5-3:** five panel surfaces apply three different root-padding conventions (`p-3`, `px-4 py-4`/`px-7`, none) with no shared primitive — the R4 narrative said the system was "primitive-backed where a pattern repeats at scale," but the *panel* surface (5+ duplications) was not promoted.
- **R5-4:** top-10 spacing share at 47.8%, unmoved across two rounds (target per pillar contract: ≥70%). R4 added 4 new tokens, none broke into the head; the head is dominated by 3 adjacent gap values (`gap-1`/`gap-1.5`/`gap-2`, 565 uses) that an R4 codemod was supposed to consolidate but did not.

The system has a complete, defended, well-tokenized **foundation**. The system does **not** have complete adoption of that foundation. R3 awarded 3/4 because the foundation was load-bearing and defended but the rollout was incomplete. R4 awarded the 4th point on the foundation alone, anticipating the rollout. The rollout did not happen. R5 returns the score to 3/4: the system is genuinely well-tokenized and well-defended, but the gap between "tokens exist" and "tokens are uniformly adopted" is exactly what separates 3 and 4 in this rubric.

This is **not** a regression of R4's deliverables — every R4 closure holds at the source and rendered DOM levels. It is a re-classification of those deliverables: foundation is 3/4 work; foundation + adoption is 4/4 work; the R4 sprint shipped foundation only and was scored as both.

**Score: 3/4. Foundation excellent; adoption incomplete.**

To reach 4/4 next round:
1. **Migrate `StaticArticle.tsx`** to use `py-section` / `space-y-prose` / `gap-section-sm` / `mt-section`. ~5-line file edit; propagates to 4 routes.
2. **Migrate `/contact`, `/docs`, `/help/*`** (the non-StaticArticle long-form surfaces) to the same rhythm tokens.
3. **Resolve `<TouchTarget>` ambiguity** — either delete it as dead scaffolding, or migrate at least 3–5 marquee interactive surfaces to use it as `asChild` and exercise its actual contract.
4. **Promote a `<Panel>` primitive** (or a shared `panel-root` Tailwind component class) that owns `bg-[var(--panel)]` + `border` + a single padding decision, and migrate the 5 open-coded panel roots to it. Same time delete the literal hex `#2a2a3e` / `#12121a` escapes in `TradePanel.tsx:1501,1508`.
5. **Run the gap-1/gap-1.5/gap-2 codemod** R4 deferred. Even just consolidating `gap-1.5` (131 uses, the awkward middle) into either `gap-1` or `gap-2` would crack the top-10 share past 55% in a single edit.

---

## Verification checklist (R5)

```
arbitrary [Npx] spacing sites                    14 hits  (R3: 14, R4: 15 — clean)
hand-applied min-h-[44px]                         3 hits  (all JSDoc/comment, 0 source — clean)
arbitrary space-y-[…]                             0 hits  (clean)
<TouchTarget> consumer JSX adoption               0 hits  (DEAD CODE)
min-h-touch utility-class adoption               33 hits  (load-bearing — utility is the primitive)
about/desktop-1440 rhythm token render          12 space-y-prose, 2 py-section, 2 gap-section-sm, 2 mt-section
privacy/desktop-1440 rhythm token render         0 / 0 / 0 / 0   <-- still legacy
terms/desktop-1440 rhythm token render           0 / 0 / 0 / 0   <-- still legacy
risk/desktop-1440 rhythm token render            0 / 0 / 0 / 0   <-- still legacy
contact/desktop-1440 rhythm token render         0 / 0 / 0 / 0   <-- still legacy
docs/desktop-1440 rhythm token render            0 / 0 / 0 / 0   <-- still legacy
help-earnings-data/desktop-1440 rhythm token     0 / 0 / 0 / 0   <-- still legacy
StaticArticle.tsx token-utility usage            0 (still py-16/mt-4/mt-10/mt-16/gap-14/mt-5)
top-10 spacing share                            47.8%  (R3: 49.7%, R4: 47.7% — flat-to-down across 2 rounds, target ≥70%)
distinct spacing classes                          165   (R4: 170 — minor drop)
total spacing uses                              3,824   (R4: 3,831 — flat)
panel root padding distinct conventions             3   (p-3 / px-4 py-4 + px-7 / none)
TradePanel literal hex escapes                      2   (#2a2a3e × 1, #12121a × 1 — adjacent issue)
ESLint no-restricted-syntax × 4                  intact (eslint.config.mjs:22–45)
@theme inline --spacing-* wiring                 intact (globals.css:185–195)
```

---

## Files re-audited (paths, all absolute)

- `/Users/GK/Downloads/alphadesk/frontend/src/styles/design-tokens.css` (264, 272–274 — token declarations)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/globals.css` (185–195 — @theme wiring)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/primitives/TouchTarget.tsx` (whole file — primitive itself fine; consumer adoption 0)
- `/Users/GK/Downloads/alphadesk/frontend/src/__tests__/primitives/touchtarget.test.tsx` (only call site)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layouts/StaticArticle.tsx` (43–66 — STILL hardcoded; R4 promised migration not shipped)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/about/page.tsx` (14–30 — JSDoc still says "until a follow-up PR"; that PR didn't land)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/privacy/page.tsx` (consumer of unchanged StaticArticle)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/terms/page.tsx` (consumer of unchanged StaticArticle)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/risk/page.tsx` (consumer of unchanged StaticArticle)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/contact/page.tsx` (ad-hoc legacy cadence, no rhythm tokens)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/docs/page.tsx` (ad-hoc legacy cadence, no rhythm tokens)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/TradePanel.tsx` (382 — `p-3`; 1501 — literal hex `#2a2a3e`; 1508 — literal hex `#12121a`)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/WatchlistPanel.tsx` (889 — root, no padding)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/AnalysisPanel.tsx` (675, 983 — two roots, no padding)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/OptionsPanel.tsx` (248 — root, no padding)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/OrderBar.tsx` (451, 458 — `px-4 py-4` / `@[720px]:px-7`)
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/about/desktop-1440/initial.dom.html` (rhythm-token render counts confirmed)
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/about/mobile-390/initial.png` (POC rhythm visible)
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/privacy/desktop-1440/initial.dom.html` (zero rhythm tokens; legacy `space-y-3` × 8)
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/privacy/mobile-390/initial.png` (legacy cadence visibly compressed vs /about)
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/terms/desktop-1440/initial.dom.html`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/risk/desktop-1440/initial.dom.html`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/risk/mobile-390/initial.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/contact/desktop-1440/initial.dom.html`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/contact/mobile-390/initial.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/docs/desktop-1440/initial.dom.html`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/docs/mobile-390/initial.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/help-earnings-data/desktop-1440/initial.dom.html`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/dashboard/desktop-1440/initial.dom.html` (`min-h-touch` × 9 confirmed)
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/dashboard/mobile-390/initial.dom.html` (`min-h-touch` × 9 confirmed)
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/strategies-earnings-options-play/desktop-1440/initial.dom.html` (`min-h-touch` × 31 confirmed)
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/initial.dom.html` (0 `min-h-touch` — uses raw `min-h-11` instead)
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/strategies-list/mobile-390/initial.png` (cramped cards under mobile breakpoint)
