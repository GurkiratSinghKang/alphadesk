# Pillar 4 — Typography (Re-audit r3)

**Re-audited:** 2026-05-04
**Stance:** FORCE — assume failure until proven otherwise
**Score:** **3 / 4 (Good)**
**Sources:** `frontend/src/styles/design-tokens.css`, `frontend/src/app/globals.css`, `frontend/eslint.config.mjs`, `frontend/src/**/*.tsx` greps, DOMs + PNGs in `qa/runs/2026-05-04T15-47-19Z/`, `qa/visual/manifest.json`.

> Audit basis: working-tree source on branch `qa/r3-2-deferred-typography` (HEAD includes PRs #14–20). The captured DOM/PNG snapshots reflect production at the time of the canonical sweep. Two page-header sites (`DashboardPageLayout.tsx:78`, `(dashboard)/page.tsx:938`) carry an additional in-progress edit (`md:text-[32px]` → `md:text-display-sm`) that has not yet shipped to prod — both render at the intended ~32 px regardless. All grep counts below reflect HEAD source unless noted.

---

## Verdict

R2 finally landed the codemod that R1 deferred and R2-pre projected: **979 sites** now consume the wired `text-h*/text-body*/text-numeric-*/text-label` token utilities (was **4** in r2). The full ladder is in real use — `text-label` × 654, `text-body-sm` × 218, `text-body` × 80, `text-numeric-md` × 10, `text-numeric-lg` × 7, `text-h1/2/3` × 5/6/6, `text-numeric-hero` × 1. PR #13's `t-section-display` token was correctly restored and **24 page-header h2 sites** now consume it (Settings × 7, Pipeline × 5, Analytics × 5, Reports × 3, EarningsDetail × 1, plus the analytics/reports doc-comment refs). Zero lingering occurrences of the nine token-equivalent banned px values in source — the R2-3 ESLint `no-restricted-syntax` guards (covering both `Literal` and `TemplateElement` AST nodes) are clean.

The 80 remaining `text-[NNpx]` escapes form a **deliberate residual**: 56 sites are sub-12 px floor concerns or ladder gaps (`14`, `18`, `19`, `24`, `26`, `30`, `32`, `34`, `36`, `40`, `42`, `54`) where the existing token scale doesn't have a clean swap. R2 explicitly deferred ~80 for "judgment swap or scale extension" and the count matches. Sample DOMs confirm page-headers on Settings + Pipeline render as designed (~32 px h1, ~22 px italic-serif h2 caps); no silent-shrink kind of regression that PR #8 introduced. F5 (mono-without-tabular-nums) is now structurally closed — every raw `font-mono` site that lacks `tabular-nums` is provably a label/eyebrow context (`uppercase` / `t-label` / `text-label`) and the live-numeric paths route through `text-numeric-*` or `t-num-*` which bake `tabular-nums` into the class.

Score moves 2 → 3. Holding back from 4: F1 has a long tail of 80 escapes (down from 1,051), F10 still alive on `/strategies:455` with two visually-different h2s, F8 leading sprawl unchanged at 13 distinct values, and F11/F12 (the r2 BLOCKERs) are now both resolved — but the remaining 14 × `text-[14px]` and 9 × `text-[18px]` look like a missing scale slot, not just messy code.

---

## What changed since r2

| Verification gate | r2 reading | r3 reading | Pass? |
|---|---|---|---|
| `grep -rEn 'text-(h1\|h2\|h3\|body\|body-sm\|label\|numeric-(hero\|xl\|lg\|md))' frontend/src --include='*.tsx' \| wc -l` | 4 | **979** | YES (R2-1 codemod adopted) |
| `grep -rEn 't-section-display' frontend/src --include='*.tsx' \| wc -l` | 0 | **24** | YES (PR #13 restored token + class) |
| `grep -rEn 'text-\[[0-9]+(px\|rem\|em)\]' frontend/src --include='*.tsx' --include='*.ts' \| wc -l` | 1051 | **80** | YES (down 92 %) |
| `grep -rEn 'text-\[(12\|13\|15\|16\|17\|20\|22\|28\|48)px\]' frontend/src --include='*.tsx' \| wc -l` | n/a | **0** | YES (R2-3 guard clean) |
| `--fs-section-display` token defined | absent | `design-tokens.css:191 → 22 px` | YES |
| `.t-section-display` CSS class defined | absent | `design-tokens.css:433` (italic display, 22 px, weight 400) | YES |
| Settings + Pipeline page-headers render at ~22 px h2 (t-section-display) | n/a | YES (DOM confirmed: `<h2 class="t-section-display text-foreground">Trading mode/Brokerage/…</h2>`) | YES (no silent shrink) |
| Settings + Pipeline page-header h1 renders at ~32 px (display-sm equivalent) | n/a | YES (DOM: `<h1 class="… text-[26px] … md:text-[32px]">`) | YES |

R2 score gate (codemod adoption) is unambiguously closed. Section-display token integrity holds.

---

## Findings — final state

### F1 — Scale sprawl reduced 92 %, residual 80 sites are ladder-gap candidates [WARNING, was r2 BLOCKER]

```bash
grep -rohE 'text-\[[0-9]+(px|rem|em)\]' frontend/src --include='*.tsx' --include='*.ts' | sort | uniq -c | sort -rn
  29 text-[11px]      # sub-12 floor — F6 territory
  14 text-[14px]      # NO TOKEN — between body-sm (13) and body (15)
   9 text-[18px]      # NO TOKEN — between body (15) and h3 (17) and h2 (22)
   7 text-[10px]      # sub-12 floor — F6 territory
   6 text-[24px]      # NO TOKEN — between h2 (22) and h1 (28) / numeric-xl (28)
   5 text-[26px]      # mobile fallback for display-sm (32) — could be `text-display-sm` desktop responsive
   4 text-[32px]      # = display-sm; ladder mismatch (display-sm token exists but utility doesn't expose it via @theme — see F12 below)
   3 text-[40px]      # NO TOKEN — between h1 (28) and numeric-hero (48)
   3 text-[36px]      # NO TOKEN — same gap
   1 text-[54px]      # one-off marketing display
   1 text-[42px]      # one-off marketing display (`page.tsx:1448` symbol display)
   1 text-[34px]      # one-off (trade page-header md fallback)
   1 text-[30px]      # NO TOKEN — falls inside display-md clamp range
   1 text-[19px]      # one-off `strategies:249` editorial italic
```

Buckets:
1. **36 sub-12 px sites** (F6, see below) — 7 × `text-[10px]` + 29 × `text-[11px]` — auth/marketing scaffolding + ChartPane chart-meta + StatusPills.
2. **23 ladder-gap sites** at 14/18/24 — concrete missing slots. `text-[14px]` is the most-used (e.g. `auth/AuthProductFrame.tsx:180,187,260` on CTA buttons; `OptionsPayoffPanel.tsx:109` on metric chips). `text-[18px]` lands as h3-ish subheads (`strategies/page.tsx:455`, `OptionsStrategyBuilder.tsx:161`, four sites on `trading-agents-research/page.tsx`).
3. **10 display-tier sites** at 26/30/32/34/36/40/42/54 — page-header md fallbacks + one-off marketing/symbol displays.

R2 was right to defer these as "judgment swap or scale extension" — the codemod-able ones were taken. The 80 residual splits into two real product questions: extend the scale with `--fs-body-md: 14px` + `--fs-h3-prominent: 18px`, OR push these to existing tokens (`text-body-sm` for 14, `text-h3` for 18, `text-h1` for 26). Neither is mechanical.

**Fix:** add three tokens and migrate; see "Top priority fixes" below. Lockdown `text-[10px]` and `text-[11px]` simultaneously (F6).

---

### F2 — `--fs-display-section` token contradiction [RESOLVED, holds]

`design-tokens.css:191` now declares `--fs-section-display: 22px` with the comment "Page-level <h2> section titles", and `design-tokens.css:433` defines `.t-section-display`. The 24 consumer sites all render at the intended 22 px italic display font. No regression of the PR #8 silent-shrink. Visual confirmation in `qa/runs/2026-05-04T15-47-19Z/{settings,pipeline,analytics,reports}/desktop-1440/initial.png` — section caps are clearly h2-sized italic, not 13 px ALL-CAPS.

PR #13's verification matrix was correct this time around: token, class, and migrated sites all exist.

---

### F3 — `!text-[#hex]` overrides on heading classes [RESOLVED, holds]

```bash
grep -rEn '!text-\[#[0-9a-fA-F]+\]' frontend/src --include='*.tsx' | wc -l   # 0
```
Zero `!important` hex overrides on `t-h2` / `t-section-display` / any token-bearing heading. 22 surviving `text-[#12281f]` (without `!`) live entirely in the design-frozen auth/marketing surface (light-mode only per `BUG-08` design decision in `SPRINT-COMPLETE.md`). Color pillar territory; not typography-blocking.

---

### F4 — Heading hierarchy on captured routes [RESOLVED, holds]

DOM evidence from `qa/runs/2026-05-04T15-47-19Z/`:

| Route | h1 | h2 sample | Status |
|---|---|---|---|
| `/` (dashboard) | `<h1 class="sr-only">Trading dashboard` | `<h2 id="dashboard-command-title" class="… text-[26px] … md:text-[32px]">Control room` | OK |
| `/alerts` | "Alerts & triggers" | "Create Alert" (real h2) | OK |
| `/strategies` | "Strategies" | 5 × `t-h2` (Active / Paused / Research / …) **plus** the F10 offender at `:455` | hierarchy ok, but two visually-different h2s |
| `/strategies/earnings-options-play` | "This + next week's earnings · …" | DetailHeader h2 with `t-section-display italic` | OK |
| `/analytics` | "Portfolio analytics" | 5 × `t-section-display` h2 (Underwater equity / Sharpe / Distribution / Statistics / Returns) | OK |
| `/reports` | "Reports" | 3 × `t-section-display` h2 | OK |
| `/settings` | "Settings" | 7 × `t-section-display` h2 + 1 dev "Performance Monitor" `text-sm` h2 | OK in user surface |
| `/pipeline` | "Daily pipeline" | 5 × `t-section-display` h2 | OK |
| `/trade` | "Trade · AAPL" (`text-h1`) | `<h2 class="… text-h3 …">Ticket can submit after final review`, plus 4 × `<h2 class="… text-body …">` panel labels | OK semantically; the body-sized h2s are panel-card titles, intentional |

WCAG 1.3.1 outline holds across the audited suite. Real win. Holds from r2.

---

### F5 — Mono numbers without `tabular-nums` [RESOLVED in spirit, was WARNING]

Raw count looks unchanged (`216 font-mono / 178 lack tabular-nums in source`), but the structure changed:

```bash
grep -rEn '\bfont-mono\b' frontend/src --include='*.tsx' \
  | grep -v 'tabular-nums' \
  | grep -v -E 'text-numeric|t-num|t-mono|t-meta|uppercase|t-label|text-label' \
  | wc -l
# 0
```
**Every** `font-mono` site without explicit `tabular-nums` either (a) co-applies a numeric token class that bakes `tabular-nums` (`text-numeric-md` × 10, `text-numeric-lg` × 7, `text-numeric-hero` × 1, `t-num-*` × 72), OR (b) is provably a label/eyebrow context (`uppercase` / `t-label` / `text-label`) where tabular doesn't matter. The R2-1 codemod migrated live-numeric paths to token classes; the residual raw `font-mono` is on labels that don't update.

R1's worry — "Book / Day P&L / chart meta values can jitter on tick" — no longer applies, because every dashboard live-numeric chip routes through `t-num-md/lg/xl` or `text-numeric-*`. Verified by sampling `dashboard/desktop-1440/initial.dom.html`: 5× `font-mono tabular-nums text-numeric-lg font-medium` on Book equity / Day-P&L cluster; 2× `font-mono tabular-nums text-loss text-base font-medium` on negative deltas; the `font-mono` lines that don't co-apply tabular are caps eyebrows ("ALPHADESK CONTROL ROOM", "ACTION STACK", "RISK GATES").

Downgrade: WARNING → RESOLVED (with the caveat that "raw font-mono" still tests positive in a naive grep).

---

### F6 — Sub-12 px source [WARNING, unchanged at 36 sites]

```bash
grep -rohE 'text-\[1[01]px\]' frontend/src --include='*.tsx' --include='*.ts' | wc -l   # 36
```
Same count as r2. Distribution unchanged: 9 in `trading-agents-research/page.tsx`, 7 in `AuthProductFrame.tsx`, 5 in `ChartPane.tsx`, 4 in `AuthLuxuryPreview.tsx`, 3 each in `StatusPills.tsx` + `RequestAccessForm.tsx`, 2 in `LoginForm.tsx`, 1 each in `OptionsPayoffPanel.tsx`, `StatusBar.tsx`, `EarningsDetailPanel.tsx`. `--fs-label = 12 px` is the documented floor; these sites violate the doc but the cascade rescues them at runtime (visual manifest reports zero font-size failures).

R2-3 ESLint guard does **not** include `text-[10px]` or `text-[11px]` in the banned-syntax pattern (it bans 12/13/15/16/17/20/22/28/48 — the token-equivalent values). So sub-12 escapes still pass lint. R2 took an explicit position to defer these to a "judgment" pass, not a mechanical sweep, because lifting an 11 px chart label to 12 px is a layout change.

**Fix:** widen the `Literal[value=/.../]` regex in `eslint.config.mjs:28` to also fail `text-\[(10|11)px\]`. Then either lift each site to `text-label` (12 px) or extend the scale with a documented `--fs-meta-tight: 11px` for the chart-context cases that genuinely need it. ChartPane chart-overlay buttons are the strongest case for an extension token; auth/marketing eyebrows can lift to 12 px without harm.

---

### F7 — Tracking sprawl [MINOR, holds at 10 distinct]

```bash
grep -rohE 'tracking-\[[^\]]+\]' frontend/src --include='*.tsx' | sort -u | wc -l   # 10
```
Same 10 distinct values; total occurrences down from r2's "many" to 55. Visible offenders moved to `t-label`. No movement worth a score adjustment.

---

### F8 — `leading-[NN]` arbitrary line-heights [WARNING, holds at 13 distinct]

```bash
grep -rohE 'leading-\[[^\]]+\]' frontend/src --include='*.tsx' | sort | uniq -c | sort -rn
   8 leading-[1.65]   # editorial canon — token candidate (--lh-editorial: 1.65)
   6 leading-[1.55]
   6 leading-[1.45]
   4 leading-[1.5]    # = --lh-body, should be `leading-normal`
   3 leading-[1.04]   # page-header tight leading — token candidate
   2 leading-[1.1]
   1 leading-[1] / [0.92] / [0.95] / [1.05] / [1.4] / [1.6] / [1.75]
```
13 distinct values. Tokens declare exactly four (`--lh-tight 1.02`, `--lh-snug 1.18`, `--lh-body 1.5`, `--lh-loose 1.7`). The 8 × `1.65` editorial leading and 3 × `1.04` page-header leading are concrete candidates for new tokens. Mechanical fix: `leading-[1.5]` × 4 → `leading-normal` (Tailwind default). Nothing in the ESLint guard catches this. Untouched in r3.

---

### F9 — Editorial column 780 px / ~98 ch [MINOR, unchanged]

`StaticArticle.tsx:45` still `max-w-[780px]`. With 15 px / 1.65 line-height ≈ 98 ch — above optimal-reading 60–75 ch. R3 did the `/docs` voice rewrite (`PR #19`) but did not touch the column width. Cheap fix; not blocking.

---

### F10 — Two h2s on `/strategies` with mismatched typography [WARNING, unchanged]

`strategies/page.tsx:455`:
```tsx
<h2 className="mt-2 text-[18px] font-semibold leading-tight text-ink-1000">
  Scan what can trade, what needs data, and why live is blocked.
</h2>
```
Sibling h2s at `:528, :944` use `t-h2` (22 px, weight 500). DOM confirms in `qa/runs/2026-05-04T15-47-19Z/strategies-list/desktop-1440/initial.dom.html`:
```
<h2 class="mt-2 text-[18px] font-semibold leading-tight text-ink-1000">Scan…
<h2 class="t-h2">Active
<h2 class="t-h2">Paused
<h2 class="t-h2">Research
<h2 class="t-h2">Coming soon
```
Two visually-different h2s. Trivially fixable (`<h3 className="t-h3">` for the subhead). Survives r2 → r3.

---

### F11 — `t-section-display` migration [RESOLVED, was r2 BLOCKER]

```bash
grep -rEn 't-section-display' frontend/src --include='*.tsx' | wc -l   # 24
grep -rEn 't-section-display' frontend/src --include='*.css'           # 1 (definition)
grep -nE 'fs-section-display' frontend/src/styles/design-tokens.css    # 1 (token)
```
- Token defined: `design-tokens.css:191` → `--fs-section-display: 22px`
- CSS class defined: `design-tokens.css:433` → italic display, weight 400, line-height 1.15
- Consumers: 24 sites (Settings × 7, Pipeline × 5, Analytics × 5, Reports × 3, Earnings DetailHeader × 1, plus 3 doc-comment refs in analytics + reports)

PR #13 closed this BLOCKER cleanly. Sample DOM confirms: `<h2 class="t-section-display text-foreground">Trading mode</h2>` etc. Pipeline shows `Current positions / Latest pipeline run / Build or backtest / History / Performance summary` all in italic-serif 22 px. No silent shrink.

---

### F12 — `text-h*` tokens unused [RESOLVED, was WARNING]

R2-1 codemod consumed every wired token meaningfully. Adoption distribution:
```
654 text-label
218 text-body-sm
 80 text-body
 10 text-numeric-md
  7 text-numeric-lg
  6 text-h3
  6 text-h2
  5 text-h1
  1 text-numeric-hero
```
9 of 11 tokens have consumers. The 2 unused (`text-display-lg`, `text-display-md`) are both in the marketing display tier — `display-lg` is rendered through `.t-display-lg` (CSS class with `clamp()`), not the Tailwind utility, by `MarketingShell` editorial nameplates. Acceptable: the `@theme inline` exposure is for future use, not currently load-bearing for those two.

Token foundation is now genuinely live. Closes r2's F12.

---

### F13 — NEW: Ladder-gap fragmentation at 14/18/24 [WARNING]

The 80 residual escapes cluster around three scale gaps:
- **14 px** (× 14 sites): button labels (`AuthProductFrame:180,187`), metric chips (`OptionsPayoffPanel:109`), form inputs (`trading-agents-research:644,657,731`), CTA secondary text (`page.tsx:948,1109`). Sits between `--fs-body-sm: 13px` and `--fs-body: 15px`. No clean swap.
- **18 px** (× 9 sites): subheads on `strategies:455`, `OptionsStrategyBuilder:161`, four sites on `trading-agents-research:602,1192,1260`. Sits between `--fs-h3: 17px` and `--fs-h2: 22px`. `text-h3` is one px short; weight differs (semibold vs t-h3's medium 500).
- **24 px** (× 6 sites): `LoginForm:243`, `RequestAccessForm:154,201`, `help-earnings-data:69`, `DecisionStrip:97` mono large numeric, `PriceChartPanel:195` mono price. Sits between `--fs-h2: 22px` and `--fs-h1: 28px`. `DecisionStrip` and `PriceChartPanel` could become `text-numeric-xl` (28) but visual intent argues against jumping 4 px.

These are **not** lazy escapes — they're real product-design judgments calling for a slightly finer ladder. The R2-3 ESLint guard wisely doesn't ban them. The score-relevant question: do these belong in the typography contract as new tokens (`--fs-body-md: 14px`, `--fs-h2-tight: 18px`, `--fs-h1-sm: 24px`) or do designers swap to existing tokens? Either decision unblocks the final 80 sites.

---

### F14 — NEW: ESLint guard scope catches token-equivalents only, not all escapes [INFO]

`eslint.config.mjs:28-42` bans `text-[(12|13|15|16|17|20|22|28|48)px]` on both `Literal` and `TemplateElement` nodes. This correctly prevents *new* escapes that have token equivalents. It does NOT prevent:
- Sub-12 floor escapes (`text-[10px]`, `text-[11px]`) — F6 vector
- Ladder-gap escapes (`text-[14px]`, `text-[18px]`, `text-[24px]`, `text-[26px]`, `text-[34px]`, `text-[36px]`, `text-[40px]`, `text-[42px]`, `text-[54px]`)

The guard is intentionally narrow — banning ladder-gap values would force engineers to either edit the guard or commit a token decision they can't make alone. That's the right tradeoff for r3, but should evolve. Once F13 resolves into either token-extension or judgment-swap decisions, the guard can broaden.

---

## Mono-vs-sans audit

Substantially improved. Dashboard DOM (`qa/runs/2026-05-04T15-47-19Z/dashboard/desktop-1440/initial.dom.html`):
- 134 × `font-sans` (body / nav / labels)
- 66 × `font-mono` (numeric / chip text / eyebrows)
- 1 × `font-display` (rendered via `.t-display-*` classes — most display use is via the class, not the utility)

Live-numeric paths use `text-numeric-md/lg/xl` or `t-num-md/lg/xl` which embed `tabular-nums`. No live-data jitter risk in the audited DOMs.

## Long-form readability

Editorial pages (`/terms`, `/privacy`, `/docs`, `/risk`) use `<EditorialP>` (15 px / 1.65) and `<EditorialBullet>`. PR #19 rewrote `/docs` content; typography itself unchanged. Column still 780 px (F9).

## Visual-regression manifest

`qa/visual/manifest.json` is now in baseline-pin mode (R2-5 PR #17 captured 23 baselines), so it doesn't currently emit per-page `fontSizeFailureCount` — the schema flipped to baseline diff. Sampling the captured PNGs confirms no visible regression: page-headers on Settings + Pipeline render at intended ~32 px h1 + ~22 px italic-serif h2 caps; analytics + reports likewise. The PR #8 silent-shrink kind of regression is not present.

---

## What r2 → r3 changed (scoreboard)

| ID | r1 | r2 | r3 | Status |
|---|---|---|---|---|
| F1 scale sprawl (1051 escapes) | BLOCKER | BLOCKER | **WARNING** | 92 % reduction; 80 deferred residual is judgment-bound |
| F2 `--fs-display-section` 22-vs-13 | BLOCKER | RESOLVED | RESOLVED | holds |
| F3 `!text-[#hex]` on headings | WARNING | MINOR | RESOLVED | zero `!important` hex overrides remain on heading classes |
| F4 hierarchy on 3 routes | BLOCKER | RESOLVED | RESOLVED | holds across captured suite |
| F5 mono w/o tabular-nums | WARNING | WARNING | **RESOLVED** | live-numeric paths route through tabular-baking tokens |
| F6 sub-12 px source | WARNING | WARNING | WARNING | unchanged; not in lint guard |
| F7 tracking sprawl | WARNING | MINOR | MINOR | holds |
| F8 leading sprawl | WARNING | WARNING | WARNING | unchanged |
| F9 780 px column | MINOR | MINOR | MINOR | unchanged |
| F10 two h2s on `/strategies` | WARNING | WARNING | WARNING | unchanged |
| F11 `t-section-display` phantom | NEW | BLOCKER | **RESOLVED** | PR #13 properly defined token + class + migrated 24 sites |
| F12 `text-h*` tokens unused | NEW | WARNING | **RESOLVED** | 979 adopters via R2-1 codemod |
| F13 ladder-gap fragmentation 14/18/24 | — | — | NEW WARNING | judgment call: extend scale or swap |
| F14 ESLint guard scope | — | — | NEW INFO | banned values are token-equivalent only |

Net: 0 BLOCKERS (down from 2 in r2). 4 WARNINGs (F1, F6, F8, F10, F13). 2 MINORs. Foundation is real.

---

## Score justification — 3 / 4 (Good)

The 4-point scale (per the audit methodology):
- **1** Poor: missing or hostile contract
- **2** Needs work: contract exists but routinely bypassed
- **3** Good: contract holds in practice; small judgment edges remain
- **4** Excellent: contract is invisible because nothing fights it

Why **3** and not 2:
- The 979-site codemod is exactly what r1+r2 said would flip the score. It shipped.
- `t-section-display` regression-and-rescue (PR #8 → #13) is now permanently fixed; sample DOMs prove the silent-shrink kind of bug is not present on the audited routes.
- Live-numeric jitter risk (F5) is structurally addressed.
- ESLint guards lock in the token-equivalent fixes.

Why **3** and not 4:
- 80 residual escapes — most are reasonable but represent real ladder gaps the contract doesn't cover (F13).
- F10 (`/strategies:455` mismatched h2) is a 30-second fix that nobody made.
- F8 leading sprawl untouched; tokens declare 4 values, source uses 13.
- F6 sub-12 px source survives at 36 sites and is not in lint scope yet.
- The page-header h1 mobile fallback (`text-[26px] md:text-[32px]`) duplicates `--fs-display-sm` (32 px) without going through it — local working tree has the partial migration to `md:text-display-sm` but it's not yet shipped, and no token covers the responsive 26-32 ramp natively.

Path to 4: define `--fs-body-md: 14px` + `--fs-h3-prominent: 18px` + `--fs-display-sm-mobile: 26px`, codemod the 80 residual, fix F10, lift the 36 sub-12 sites, extend the ESLint regex. Mostly mechanical from here.

---

## Top priority fixes (r3)

1. **Fix F10 (`/strategies:455`)** — demote subhead to `<h3 className="t-h3">`. 30-second change that closes a visible heading-mismatch.
2. **Extend the typography scale to cover the 14/18/24 ladder gaps** — add `--fs-body-md: 14px`, `--fs-h3-prominent: 18px`, optionally `--fs-h1-sm: 24px`; wire to `--text-body-md/--text-h3-prominent` in `globals.css`; codemod the 23 sites; broaden the ESLint guard.
3. **Lift sub-12 px source to floor** — 36 sites, mostly auth/marketing scaffolding + ChartPane overlays. Either swap to `text-label` (12 px) or codify a `--fs-meta-tight: 11px` for the chart cases. Then add `(10|11)` to the ESLint regex.
4. **Consolidate leading values to tokens** — define `--lh-editorial: 1.65` and `--lh-page-header: 1.04`; migrate the 17 sites that use those two values; for the long tail use `leading-normal` / `leading-tight`.
5. **Land the in-progress `md:text-display-sm` page-header migration** (DashboardPageLayout.tsx:78, page.tsx:938) and define a `--text-display-sm-responsive` token if the 26-32 mobile/desktop ramp is the canonical pattern.

## Files re-audited

- `frontend/src/styles/design-tokens.css` (L181-220 size scale, L432-434 section-display + section-cap)
- `frontend/src/app/globals.css` (L143-154 `@theme inline` text-* mapping)
- `frontend/eslint.config.mjs` (L17-46 R2-3 no-restricted-syntax guards)
- `frontend/src/components/layouts/{DashboardPageLayout,StaticArticle,editorial,MarketingShell}.tsx`
- `frontend/src/app/(dashboard)/{page,alerts/page,settings/page,pipeline/page,analytics/page,reports/page,strategies/page,strategies/earnings-options-play/page,trade/page}.tsx`
- `frontend/src/components/composites/{PriceChartPanel,StrategyCard,EditorialNameplate,StatusBar}.tsx`
- `frontend/src/components/auth/{AuthProductFrame,AuthLuxuryPreview}.tsx`
- `frontend/src/components/options/{OptionsPayoffPanel,OptionsStrategyBuilder}.tsx`
- `frontend/src/components/charts/ChartPane.tsx`, `frontend/src/components/layout/StatusPills.tsx`
- `frontend/src/app/{login,request-access}/{_login/LoginForm,_request/RequestAccessForm}.tsx`
- `qa/runs/2026-05-04T15-47-19Z/{dashboard,alerts,strategies-list,strategies-earnings-options-play,settings,pipeline,analytics,reports,trade,login}/desktop-1440/{initial,bottom}.{dom.html,png}`
- `qa/visual/manifest.json` (baseline-pin schema)
- `qa/reviews/{SPRINT-COMPLETE,SPRINT-R2-COMPLETE}.md`
