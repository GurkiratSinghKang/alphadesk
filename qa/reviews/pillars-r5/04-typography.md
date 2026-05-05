# Pillar 4 — Typography (R5 fresh adversarial hunt)

**Score: 3 / 4 (Good — but one real BLOCKER, several systemic WARNINGs)**  (R1: 2/4, R2: 2/4, R3: 3/4, R4: 4/4 → now: **3/4 — corrected**)
**Run:** `qa/runs/2026-05-04T20-31-40Z`
**Re-audited:** 2026-05-04
**Stance:** FORCE — assume failure until proven otherwise. R4 was given 4/4; this round the adversarial sweep argues that score was overstated.
**Sources:** `frontend/src/styles/design-tokens.css`, `frontend/src/app/globals.css`, `frontend/eslint.config.mjs`, `frontend/src/**/*.tsx` greps, captured DOMs in `qa/runs/2026-05-04T20-31-40Z/{dashboard,settings,pipeline,strategies-list,strategies-trading-agents-research,strategies-earnings-options-play,strategy-momentum-quality,trade,alerts,login,about,docs,privacy,terms,risk,help-earnings-data,contact}/{desktop-1440,mobile-390}/initial.dom.html`, prior R4 review.

---

## Verdict

**The score drops one notch.** R4 (`4/4`) read the surface — the arbitrary-px greps, the leading-bracket greps, the `text-xs` count — and saw clean numbers. The R5 adversarial sweep looked underneath those greps and found three classes of issue R4 missed:

1. **A real BLOCKER**: the wired Tailwind v4 `@theme` is **incomplete**. `--text-display-sm` and `--text-display-xl` are NOT declared. Four source sites reference `text-display-sm` (including the `DashboardPageLayout` page-header h1 — used on every authenticated dashboard route) and the utility silently no-ops. R4's claim that "page-header h1s render at the intended ~32 px (`text-h1 md:text-display-sm`)" is **factually wrong** — the `md:` modifier doesn't resolve, so those h1s render at `text-h1` (28 px) on every breakpoint. This is invisible to grep because the violation is *what isn't there*, not what is.

2. **A systemic WARNING R4 didn't audit**: the `SectionRule` editorial component renders **all section headings as `<h2 class="t-label">`** (12 px uppercase). On `/docs`, `/about`, `/privacy`, `/terms`, `/risk`, `/contact`, every strategy detail (`/strategies/[id]`), `/login/reset`, `/_design`, and `/help/earnings-data` — that's >40 h2s rendering at the visual size of a tiny eyebrow label. WCAG 1.3.1 expects semantic h2s to be visually parsable as section headings, not labels. On `/help/earnings-data` it's *worse*: each section gets BOTH a `<h2 class="t-label">` (from SectionRule) AND a sibling `<h2 class="text-h2">` — 12 visual h2s where there are 6 logical sections.

3. **Sweeping `text-sm` / `text-base` bypass R4 didn't measure**: 116 unconditional `text-sm` sites + 44 `text-base` sites = **160 off-ladder Tailwind defaults** that are NOT wired in `@theme inline`. They fall back to Tailwind defaults (14 px / 16 px) — sizes that don't match `--fs-body-sm` (13 px), `--fs-body` (15 px), or `--fs-numeric-md` (16 px) cleanly. R4 only counted `text-xs` (which fell to 2). The migration is partial: `text-xs → text-label` was done; `text-sm` and `text-base` were left untouched.

The contract is **not invisible** — it's invisible only along the axis the prior audits chose to grep. The score drops to 3/4: contract holds in practice, but live escapes exist that the previous round missed because they were structural (not surface-level), and the score-locking ESLint guard doesn't catch any of them. Once the wired `@theme` is patched and SectionRule is refactored, the score returns to 4/4 cleanly.

---

## What the prior R4 grep gates still verify

| Verification gate (re-run) | R4 reading | R5 reading | Pass? |
|---|---|---|---|
| `grep -rEn 'leading-\[' frontend/src --include='*.tsx' --include='*.ts' \| wc -l` | 4 | **4** (1 className + 1 doc-comment per intentional escape × 2) | YES (held) |
| `grep -rEn 'text-xs' frontend/src --include='*.tsx' --include='*.ts' \| wc -l` | 2 | **2** (1 real call + 1 comment) | YES (F15 oversight still open) |
| `grep -rEn 'text-\[[0-9]+(px\|rem\|em)\]' frontend/src --include='*.tsx' --include='*.ts' \| wc -l` | 3 | **3** (no new arbitrary px) | YES (held) |
| `grep -rEn 'text-\[(8\|9\|10\|11)px\]' frontend/src --include='*.tsx' --include='*.ts'` | 0 | **0** | YES (held) |
| ESLint guard banned-px count | 19 | **19** | YES (held) |
| `text-label` adopters | 859 | **859** | HOLDS |
| `text-eyebrow` adopters | 57 | **57** | HOLDS |

R4's surface-level metrics held. The fresh adversarial hunt found new classes of issue.

---

## Findings — fresh adversarial sweep

### F16 — NEW BLOCKER: `text-display-sm` / `text-display-xl` are referenced but not wired in Tailwind v4 `@theme`

```bash
# Source references vs theme wiring
grep -nE '--text-display-(sm|xl)' frontend/src/app/globals.css
# (empty — neither is declared)

grep -rEn 'text-display-(sm|xl)' frontend/src --include='*.tsx' --include='*.ts'
frontend/src/app/(dashboard)/page.tsx:938:  className="mt-3 text-h1 font-semibold ... md:text-display-sm"
frontend/src/components/composites/PriceChartPanel.tsx:195:  className="font-mono tabular-nums text-h2 md:text-display-sm font-light text-ink-1000"
frontend/src/components/composites/EditorialNameplate.tsx:41:  className="flex items-baseline gap-1.5 font-display italic text-display-sm text-ink-1000"
frontend/src/components/layouts/DashboardPageLayout.tsx:78:  className="mt-2 max-w-[18ch] break-words text-h1 font-semibold ... md:max-w-none md:text-display-sm"
```

`globals.css:156-168` wires only `--text-display-lg`, `--text-display-md`, `--text-h1/h2/h3`, `--text-numeric-hero/lg/md`, `--text-body`, `--text-body-sm`, `--text-label`, `--text-eyebrow`. The `--text-display-sm` and `--text-display-xl` are MISSING from `@theme inline`. In Tailwind v4, that means the `text-display-sm` utility class **does not generate a CSS rule** — it's a dead className.

Captured DOM proves the visible regression: every page using `DashboardPageLayout` (settings, pipeline, strategies-list, analytics, reports, alerts, etc.) renders:

```html
<h1 class="mt-2 max-w-[18ch] break-words text-h1 font-semibold leading-tight tracking-tight text-ink-1000 md:max-w-none md:text-display-sm" style="letter-spacing: 0px;">
```

`text-h1` resolves (28 px). `md:text-display-sm` does not — so the desktop breakpoint stays at 28 px instead of stepping up to 32 px. R4's bullet under F4 — "page-header h1s render at the intended ~32 px" — is wrong; they render at 28 px on all breakpoints.

The exact same pattern appears on `/` (dashboard, line 938: visible h2 styled as h1), `PriceChartPanel.tsx:195` (price hero), and `EditorialNameplate.tsx:41` (editorial nameplate caption). Four production-critical surfaces, all of them silently missing their intended display step-up.

**Fix (one-line):** add to `globals.css:158`:
```css
--text-display-sm: var(--fs-display-sm);
--text-display-xl: var(--fs-display-xl);
```

The `--fs-*` source-of-truth tokens already exist (`design-tokens.css:208,211`); they're just not bridged into Tailwind. After the patch, the four sites resolve correctly with no source changes.

**Severity:** BLOCKER — the design contract claims a 4-step display ladder (`xl/lg/md/sm`); the implementation delivers only 2 steps (`lg/md`). This is what 4 prior rounds called "contract is invisible" — but the contract is *broken*, not invisible.

---

### F17 — NEW WARNING: `SectionRule` renders semantic h2 as 12 px label across all editorial pages

`SectionRule.tsx:34` is the editorial section-rule component used on `/docs`, `/about`, `/privacy`, `/terms`, `/risk`, `/contact`, `/help/earnings-data`, `/login/reset`, every strategy detail (`/strategies/[id]`), and `/_design`:

```tsx
{tag ? <TagEl className="t-label">{tag}</TagEl> : null}
```

Default `tagAs="h2"` + `className="t-label"` means every consumer renders `<h2 class="t-label">` — visually 12 px uppercase, semantically a top-level section heading. R4-3 PR #31's commit message said "leading consolidation + strategies h2 fix" — but the strategies fix was on the `/strategies` LIST page (the F10 `:455` site). The much-more-pervasive `SectionRule` h2s on every long-form page were never touched.

Captured DOMs (R5 sweep):

| Route | h2 count | h2 class on every section | Visual size |
|---|---|---|---|
| `/docs` | 10 | `t-label` | 12 px uppercase |
| `/privacy` | 9 | `t-label` | 12 px uppercase |
| `/terms` | 9 | `t-label` | 12 px uppercase |
| `/risk` | 9 | `t-label` | 12 px uppercase |
| `/about` | 5 | `t-label` | 12 px uppercase |
| `/contact` | 5 | `t-label` | 12 px uppercase |
| `/strategies/momentum-quality` | 6 | `t-label` (interleaved with `t-display-md` and `text-h3`) | 12 px |
| `/help/earnings-data` | 12 (6 sections × 2 sibling h2s) | half `t-label`, half `text-h2 italic` | 12 px AND 22 px |

The `/help/earnings-data` case is the worst: each section emits both `<SectionRule tag={tag} />` (which produces `<h2 class="t-label">`) AND `<h2 class="mt-5 font-display text-h2 italic text-fg">{title}</h2>` (literal h2 in the source). Result: 6 logical sections produce 12 h2s in the DOM — 6 visually-tiny labels and 6 visually-correct italic-display headings. Screen readers will announce each section as having two equal-level headings; sighted users get a 12 px throat-clearing eyebrow before the real heading.

**Why this is a typography problem (not just a11y):** the audit pillar is "Typography hierarchy" not "screen-reader semantics." When the visible text size for an h2 is 12 px and the visible text size for body is 15 px, the heading reads as *smaller than the prose it leads*. That's an **inverted hierarchy** — a typographic anti-pattern.

**Fix options:**
- **Option A (lowest churn):** change `SectionRule.tsx:22-27` default to `tagAs="div"` (the prop already exists per JSDoc — "Pass `tagAs='div'` for non-section uses where a heading would create a skipped level."). Each consumer page would then need to explicitly pass `tagAs="h2"` + a separate visible heading, OR pass a different visual class.
- **Option B (better):** change `SectionRule` to render two layers — a real `<h2 class="t-section-display">` for the section heading, plus a `<span class="t-label">` for the tag/index. Use the `tag` prop for the tag and add a `title` prop for the heading. Migrate consumers (~10 pages).
- **Option C (cheapest fix):** keep the `<h2>` semantics, change the default class to `t-h2` or `t-section-display` for visual consistency. Loses the editorial tag styling.

**Severity:** WARNING — affects every long-form page, but it's a single component refactor.

---

### F18 — NEW WARNING: 116 × `text-sm` + 44 × `text-base` off-ladder bypasses

R4 audited `text-xs` (found 2). It did not audit `text-sm` or `text-base`.

```bash
grep -rEn '\btext-sm\b' frontend/src --include='*.tsx' --include='*.ts' | wc -l
# 130 (with 14 mobile-input `md:text-sm` sites accounted; 116 unconditional)

grep -rEn '\btext-base\b' frontend/src --include='*.tsx' --include='*.ts' | wc -l
# 44

grep -nE '\-\-text\-(sm|base)' frontend/src/app/globals.css
# (empty — neither wired in @theme)
```

`text-sm` resolves to Tailwind v4's default 14 px (well-defined Tailwind semantic), but the design system's body-sm token is `--fs-body-sm: 13px` and body is `--fs-body: 15px`. **14 px is between these two** and matches neither. Same for `text-base = 16px` vs `--fs-numeric-md: 16px` (correct only when used on numerics — but most uses are body text).

Sample of unconditional `text-sm` sites:
- `pipeline/page.tsx:164` chevron decoration
- `trade/loading.tsx:4` and `pipeline/loading.tsx:4` loading copy
- `strategies/[id]/_strategy/KillSwitchStatusPanel.tsx:96, 155, 161, 178, 189, 192, 203, 211` (8 sites in one component)
- `alerts/page.tsx:214` h2 ("Active alerts")
- shadcn primitives kept the Tailwind defaults (`shortcut-overlay`, etc.)

The KillSwitchStatusPanel case is meaningful: this is **new code** added in PR #22 (kill-switch observability, 6e5fbf36), shipped after R3-2's typography migration. The rest of the dashboard was migrated to `text-body-sm` / `text-body`; this new panel ignored the convention.

The mobile-input case (`text-base md:text-sm`) is intentional — iOS Safari auto-zooms when a focused input is < 16 px, so bumping mobile to `text-base` is correct. ~14 sites are this pattern; they're defensible.

**Fix:** migrate `text-sm` → `text-body-sm` (where 13 px reads correctly) or `text-body` (where 15 px reads correctly). Drop unconditional `text-base` to `text-body`. Add `text-sm`/`text-base` to the `Literal[value=...]` ESLint guard once they're not in mobile-input pattern.

**Severity:** WARNING — invisible to the user (14 px vs 13 px / 15 px is below the JND threshold), but it's a measurable contract leak that prior rounds didn't grep for.

---

### F19 — NEW WARNING: Inconsistent h2 visual treatments on the same page

Beyond the SectionRule pattern, several pages emit h2s with multiple distinct visual treatments — i.e. the same semantic element has different typographic identity within one logical section.

| Route | h2 visual treatments rendered | Issue |
|---|---|---|
| `/strategies/trading-agents-research` | `text-h3` (17 px), `text-display-md` (clamp 22-30), `text-h2` (22 px) — at sites `:602, :774, :1167, :1192, :1260` | 3 sizes for h2 within a single page |
| `/login` | `text-h2` (22 px) at one site, `text-h1` (28 px) at another sibling site | h2 styled as h1 next to h2-as-h2 |
| `/trade` | h2 styled as `text-h3` (17 px) at top section heading, `text-body` (15 px) on 4 panel headings | h2 ≤ body size — inverted hierarchy |
| `/alerts` | h2 styled as `text-sm` (14 px Tailwind default — already off-ladder per F18) at section heading, h3 styled as `font-display italic text-h3` (17 px) | h2 < h3 visual size — inverted hierarchy |
| `/strategies/momentum-quality` | `t-label` (12 px from SectionRule), `t-display-md` (clamp 22-30) — different visual treatments for sibling sections | mixed paradigm within one page |
| `/help/earnings-data` | `t-label` AND `text-h2 italic` per section (both rendered as h2) | duplicate h2s per logical section |

This is the *opposite* of what R4 graded "F4 hierarchy holds." The page-header h1 is consistent across audited routes (it's all `text-h1 md:text-display-sm` — except that as F16 shows, the `md:` doesn't resolve, so h1 is uniformly 28 px). But h2s are everywhere — `text-h3`, `text-h2`, `text-h1`, `text-display-md`, `text-body`, `text-sm`, `t-label`, `t-section-display`. **Eight distinct visual treatments for h2** in production source.

**Fix:** define the h2 contract in one place. Two h2 styles is reasonable (one section-display italic for editorial, one `t-h2` sans-serif for ops surfaces). Eight is sprawl. Pick a primary, lift sites to use it, document the exemptions.

**Severity:** WARNING — typographic hierarchy is the load-bearing axis of this pillar.

---

### F20 — NEW INFO: 72 inline `letterSpacing` style props bypass the tracking-* scale

```bash
grep -rEn 'letterSpacing' frontend/src --include='*.tsx' --include='*.ts' | wc -l
# 72
```

R4 grepped `tracking-[]` arbitrary-bracket sites and reported 10 distinct values × ~55 occurrences. R4 did NOT audit inline `style={{ letterSpacing: ... }}` props. Fresh count:

| Inline `letterSpacing` value | Sites | Notes |
|---|---|---|
| `0` (or `"0px"`) | ~14 | h1 inline overrides on `dashboard/page.tsx:939`, `trade/page.tsx:991`, `strategies/page.tsx:250,372`, etc. |
| `"0.18em"` | ~6 | `about/page.tsx:43`, `docs/page.tsx:32`, others — duplicates `tracking-[0.18em]` (also in arbitrary-bracket use) |
| `"0.16em"` | ~3 | duplicates `tracking-[0.16em]` |
| `"0.08em"` | ~5 | duplicates `tracking-[0.08em]` |
| `"0.02em"` | ~3 | non-standard; not in design-tokens |
| `"-0.005em"`, `"-0.025em"`, `"0.01em"` | ~3 | one-offs in `global-error.tsx` |
| Various other `0.1em`, `0.04em`, etc. | ~38 | duplicates of existing `tracking-[]` arbitrary values |

Many of these are inside `style={{ letterSpacing: 0 }}` — applied as inline overrides on h1s to defeat the design-tokens-default `tracking-tight`. So the design system says "h1s have negative tracking" but on the page-header itself, every consumer writes `style={{ letterSpacing: 0 }}` to undo the tracking. That's a contract fight: the token says one thing, the production usage says the opposite.

**Severity:** INFO — visually invisible but a load-bearing token-discipline leak. Either change `--tracking-ui` and `.t-h1`'s default tracking to 0 (matching what the call sites want), or stop overriding it inline.

---

### F21 — NEW WARNING: Sub-12 px floor violated by `global-error.tsx` inline styles

R4-F6 reported "sub-12 floor enforced" because the ESLint AST guard catches `text-[10px]` and `text-[11px]`. But `global-error.tsx` is a Next.js root error boundary that uses inline `style` (CSS does not yet apply because the layout chain may have failed) — and uses **`fontSize: 10.5`** at `:78` and **`fontSize: 9.5`** at `:119`. These are below the 12 px floor that the design tokens explicitly raised in the Wave 29 redesign:

```css
/* design-tokens.css:200-207 */
/* New floor is 12px (label) with a 13px meta and 15px body. The prior names
   are kept as aliases for backward compat during the token migration,
   but they now all resolve to the new floor. */
```

Sites:
- `global-error.tsx:78` — `fontSize: 10.5` on the `§ · Global error` eyebrow chip
- `global-error.tsx:119` — `fontSize: 9.5` on the `Ref: {error.digest}` mono identifier
- `global-error.tsx:146, 163` — `fontSize: 12.5` on action buttons (non-standard, between 12 and 13)

The 9.5 and 10.5 fail the readability floor on iOS / mac at normal trading-desk viewing distance — the same finding the design-tokens comment cites as the *reason* for the 12 px raise. The 12.5 is on-ladder neither 12 nor 13.

**Fix:** raise to 12 px / 12 px / 12 px (or 13 px / 13 px) per the floor. The values are inline because next/css may not be live during the error boundary; that's defensible. The values being below the floor is not.

**Severity:** WARNING (limited blast radius — only renders during catastrophic root-layout failure, but that's exactly the moment the user is debugging and needs to read the error reference).

---

### F22 — NEW INFO: `--fs-display-xl`, `--fs-display-sm`, `--fs-numeric-xl` are orphan tokens

```bash
grep -rEn 'fs-display-xl|fs-display-sm|fs-numeric-xl' frontend/src --include='*.css'
# Defined: design-tokens.css:208, 211, 222
# Consumed by: design-tokens.css:411 (.t-display-xl), :468 (.t-num-display), :476 (.t-num-xl)
# NOT exposed as Tailwind utility (per F16): no --text-display-xl, no --text-display-sm, no --text-numeric-xl
```

These are **half-wired tokens**: defined in design-tokens, used by one or two utility classes, but not bridged to Tailwind's `@theme inline`. So a developer wanting "display-xl size" can use `<h1 className="t-display-xl">` (works) but NOT `<h1 className="text-display-xl">` (silently fails). The asymmetry creates the F16 trap.

**Fix:** decide which path is canonical (`t-*` class vs `text-*` utility) and complete the wiring. The wired-utility path (lifting all 6 display + numeric tokens into `@theme`) is cheaper.

**Severity:** INFO (root cause of F16 — fixing here closes F16 as a side effect).

---

### F23 — NEW INFO: Login marketing hero uses Tailwind default text-4xl/5xl/6xl ladder, not design-tokens display ladder

```bash
grep -rEn '\btext-(4xl|5xl|6xl)\b' frontend/src --include='*.tsx' --include='*.ts'
frontend/src/components/auth/AuthProductFrame.tsx:171:
  <h1 className="mt-5 max-w-[12ch] font-sans text-4xl font-semibold leading-[0.95]
                 tracking-tight text-[#12281f] sm:text-5xl lg:text-6xl">
```

This is the marketing-hero h1 on `/login`. It hits Tailwind defaults: `text-4xl = 36 px`, `text-5xl = 48 px`, `text-6xl = 60 px`. The design system's display ladder is `--fs-display-md (clamp 22-30) / --fs-display-lg (clamp 38-64) / --fs-display-xl (clamp 56-104)`. None of the `text-{4,5,6}xl` sizes match the wired display ladder.

The AuthProductFrame is design-frozen per the color-pillar audit (uses `text-[#12281f]` literals). So the typography is plausibly design-frozen too — but the prior rounds didn't surface this as an explicit decision, and the inconsistency is real: the auth marketing surface uses one display ladder, the rest of the app uses another.

**Severity:** INFO — limited to one component, but a documentation gap. Either explicitly grandfather AuthProductFrame in the audit notes or migrate to the tokenized `text-display-*` ladder.

---

### F24 — NEW INFO: `tracking-[0.22em]` introduced, off-ladder

```bash
grep -rEn 'tracking-\[0\.22em\]' frontend/src --include='*.tsx' --include='*.ts'
frontend/src/components/auth/AuthProductFrame.tsx:167:
  className="font-mono text-eyebrow font-semibold uppercase tracking-[0.22em] text-[#0f7a5d]"
```

R4-F7 reported 10 distinct `tracking-[]` values; R5 confirms the count is still 10 distinct. But the *composition* has shifted: `tracking-[0.22em]` is the highest tracking value in the codebase, and it's a single one-off site sitting just above the existing `0.18em` on the same component (line 255: `tracking-[0.18em]`). This is sprawl creep — the sister sites use `0.18em`, this one uses `0.22em` for no documented reason.

**Severity:** INFO — drop to `tracking-[0.18em]` to match the file's existing convention.

---

### F25 — NEW INFO: F15 (StrategyGrid.tsx:263 stray `text-xs`) still open

R4 logged this as a 30-second swap not yet shipped. R5 confirms the site is unchanged:

```bash
grep -rEn '\btext-xs\b' frontend/src --include='*.tsx' --include='*.ts'
frontend/src/app/(dashboard)/analytics/page.tsx:15:    # comment
frontend/src/components/dashboard/StrategyGrid.tsx:263:    <p className="text-xs text-muted-foreground">No strategies enabled.</p>
```

**Severity:** INFO (still). 30-second swap to `text-label`.

---

### F26 — Editorial column 780 px (R4 F9 outstanding)

R4-F9 noted `max-w-[780px]` ≈ 104 ch at 15 px / 1.65 — above the optimal 60-75 ch reading-column width. R5 confirms unchanged across `/about`, `/contact`, `/docs`, `/help/earnings-data`, `/privacy`, `/risk`, `/terms`, `/login/reset` (all use `StaticArticle` or directly emit `mx-auto max-w-[780px] py-16`).

This is a single change at `StaticArticle.tsx:45` and `docs/page.tsx:17` and `help/earnings-data/page.tsx:46` — drop to `max-w-[640px]` (~70 ch at 15 px, optimal). Mobile is fine because viewport caps the width anyway.

**Severity:** MINOR — same as R4. Carry-over.

---

## Mono-vs-sans audit (sample of 10 DOMs)

Sampled `font-{display,sans,mono}` distribution across captured DOMs. Reads as intentional:

| Route | font-display | font-sans | font-mono | Read |
|---|---|---|---|---|
| `/` (dashboard) | 8 | 20 | 72 | mono-heavy: numerics-first ops surface OK |
| `/strategies` | 54 | 43 | 32 | display-heavy: editorial cards feature heavily OK |
| `/login` | 1 | 134 | 66 | sans-heavy: marketing chrome, mono on numeric chips OK |
| `/about` | 7 | 48 | 5 | sans-dominant editorial OK |
| `/settings` | (sample) | (dominant) | (numeric chips) | OK |
| `/pipeline` | (sample) | (chrome) | (numeric chips) | OK |
| `/analytics` | (similar to settings) | OK |
| `/trade` | (mono-heavy) | OK |
| `/alerts` | (sans-dominant) | OK |
| `/help/earnings-data` | (editorial mix) | OK except F17 dup-h2 |

Font-family discipline is sound. The issues are size and hierarchy, not font choice.

---

## Mobile typography reduction strategy

Captured mobile-390 DOMs use the same `text-h1`, `t-display-lg`, `t-section-display` classes as desktop-1440. Reduction comes from the `clamp(min, vw, max)` definitions in `--fs-display-{lg,md,xl}`:

- `--fs-display-xl: clamp(56px, 8vw, 104px)` — at 390 px = 56 px floor (correct)
- `--fs-display-lg: clamp(38px, 5vw, 64px)` — at 390 px = 38 px floor (correct)
- `--fs-display-md: clamp(22px, 2.1vw, 30px)` — at 390 px = 22 px floor (correct)

Body, h1, h2, h3, label, eyebrow, numeric tokens are all fixed-px (no clamp, no responsive). On mobile they render at the same size as desktop. This is **intentional and reasonable** for a trading desk where the numerics need to read legibly even on the small viewport — no reduction needed for h1 (28 px is already moderate). The display sizes that DO scale (the marketing h1s on /login, /about, etc.) scale via clamp to roughly half on mobile.

**Verdict:** mobile reduction strategy is sound. No finding here.

---

## Editorial column width on long-form pages — R4 F9 STILL OPEN

```bash
grep -oE 'max-w-\[780px\]' /Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/{about,contact,docs,help-earnings-data,privacy,risk,terms}/desktop-1440/initial.dom.html | wc -l
# 14 (≈ 2 per route × 7 routes)
```

Every long-form page caps the article column at 780 px. At `--fs-body: 15px` and `--lh-body: 1.5`, that's roughly **104 characters per line — significantly above the 60-75 ch optimal range.** R4 cited it as MINOR / non-blocking. R5 retains the same severity. Surfaced as outstanding for R5 because it remains the only completely-trivial-to-fix typography issue and 4 rounds have skipped it.

---

## Tracking sprawl — R4 F7 readout

```bash
grep -rohE 'tracking-\[[^\]]+\]' frontend/src --include='*.tsx' --include='*.ts' | sort | uniq -c | sort -rn
  13 tracking-[0.12em]
  13 tracking-[0.08em]
   7 tracking-[0.18em]
   7 tracking-[0.14em]
   6 tracking-[0.16em]
   4 tracking-[0.1em]
   2 tracking-[0.04em]
   1 tracking-[0]
   1 tracking-[0.22em]    # F24 — new one-off
   1 tracking-[-0.015em]
```

10 distinct values, 55 sites — held vs R4 (10 distinct). One new `0.22em` (F24) + the existing `0.04em` and `-0.015em` are off the documented `--tracking-label: 0.12em` / `--tracking-tight: -0.04em` / `--tracking-numeric-hi: -0.02em` ladder. Plus 72 inline `letterSpacing` props (F20).

Total tracking surface: 55 (Tailwind arbitrary) + 72 (inline style) + 4 distinct named utility (`tracking-tight`, `tracking-tighter`, `tracking-normal`, `tracking-wide`) = ~130 tracking touchpoints with no centralized contract. R4-F7 graded this MINOR; R5 sees it as a leading indicator that the typography contract is permissive — but visually the renders look fine because the values are clustered around 0.08-0.18em (a small range).

**Severity:** MINOR (held).

---

## R4 → R5 scoreboard

| ID | R1 | R2 | R3 | R4 | R5 | Status |
|---|---|---|---|---|---|---|
| F1 scale sprawl | BLOCKER | BLOCKER | WARNING | CLOSED | HOLDS | unchanged |
| F2 `--fs-display-section` | BLOCKER | RESOLVED | RESOLVED | HOLDS | HOLDS | unchanged |
| F3 `!text-[#hex]` | WARNING | MINOR | RESOLVED | HOLDS | HOLDS | unchanged |
| F4 hierarchy on captured routes | BLOCKER | RESOLVED | RESOLVED | HOLDS | **REOPEN as F19** | h2 sprawl across 8 visual treatments |
| F5 mono w/o tabular-nums | WARNING | WARNING | RESOLVED | HOLDS | HOLDS | unchanged |
| F6 sub-12 px source | WARNING | WARNING | WARNING | CLOSED | **REOPEN as F21** | global-error inline 9.5 / 10.5 px |
| F7 tracking sprawl | WARNING | MINOR | MINOR | MINOR | MINOR + F20/F24 | inline-style angle missed in R4 |
| F8 leading sprawl | WARNING | WARNING | WARNING | CLOSED | HOLDS | unchanged |
| F9 780 px column | MINOR | MINOR | MINOR | MINOR | MINOR | still open after 5 rounds |
| F10 two h2s on `/strategies` list | WARNING | WARNING | WARNING | CLOSED | HOLDS | unchanged |
| F11 `t-section-display` | NEW | BLOCKER | RESOLVED | HOLDS | HOLDS | unchanged |
| F12 `text-h*` unused | NEW | WARNING | RESOLVED | HOLDS | **PARTIAL** | F16 — text-display-sm/xl missing in @theme |
| F13 ladder-gap 14/18/24 | — | — | NEW WARNING | CLOSED | HOLDS | unchanged |
| F14 ESLint guard scope | — | — | NEW INFO | CLOSED | HOLDS | unchanged for what it covers |
| F15 stray `text-xs` × 1 | — | — | — | NEW INFO | INFO (open) | unchanged |
| **F16 NEW** text-display-sm/xl missing in @theme | — | — | — | — | **NEW BLOCKER** | invisible to grep, breaks page-header h1 step-up |
| **F17 NEW** SectionRule renders h2 as t-label | — | — | — | — | **NEW WARNING** | >40 h2s as 12 px labels, inverted hierarchy |
| **F18 NEW** text-sm × 116 + text-base × 44 off-ladder | — | — | — | — | **NEW WARNING** | partial text-xs migration scope |
| **F19 NEW** h2 visual sprawl (8 treatments) | — | — | — | — | **NEW WARNING** | reopens F4 — hierarchy not held |
| **F20 NEW** inline letterSpacing × 72 | — | — | — | — | **NEW INFO** | tracking discipline — bypass via style prop |
| **F21 NEW** global-error.tsx fontSize 9.5/10.5 | — | — | — | — | **NEW WARNING** | reopens F6 — sub-12 floor breached |
| **F22 NEW** orphan --fs-display-xl/sm/numeric-xl | — | — | — | — | **NEW INFO** | root cause of F16 |
| **F23 NEW** AuthProductFrame text-4xl/5xl/6xl | — | — | — | — | **NEW INFO** | off-tokenized display ladder |
| **F24 NEW** tracking-[0.22em] one-off | — | — | — | — | **NEW INFO** | sprawl creep on AuthProductFrame |
| **F25 = F15** still open | — | — | — | — | INFO (held) | StrategyGrid `text-xs` |
| **F26 = F9** still open | — | — | — | — | MINOR (held) | 780 px column |

Net: **1 BLOCKER (F16)**. **4 WARNINGs (F17, F18, F19, F21)**. **5 INFOs (F20, F22, F23, F24, F25)**. **1 MINOR (F26)**. R4's claim of 0 BLOCKER / 0 WARNING does not survive the R5 sweep.

---

## Score justification — 3 / 4 (Good — not Excellent)

The 4-point scale (per the audit methodology):
- **1** Poor: missing or hostile contract
- **2** Needs work: contract exists but routinely bypassed
- **3** Good: contract holds in practice; small judgment edges remain
- **4** Excellent: contract is invisible because nothing fights it

R5 grades **3** because:

- **F16 is a real BLOCKER** that 4 prior rounds missed because no one verified the wired utilities resolve to actual CSS rules. The page-header h1 on every authenticated dashboard route silently degrades to 28 px instead of 32 px on desktop. This is the *contract is broken*, not invisible.
- **F17 is a systemic WARNING** affecting every long-form page. >40 h2s render as 12 px uppercase labels because of one misconfigured component (`SectionRule`). R4 graded F4 as "hierarchy holds" — that was true on the dashboard surface but false on every editorial surface.
- **F18 is a WARNING** showing the migration was scoped to `text-xs` only. 160 sites still use Tailwind defaults that aren't wired in `@theme`.
- **F19 reopens F4**: 8 distinct h2 visual treatments live in production source. R4 saw the page-header h1 was uniform and concluded hierarchy holds — but h2 is a free-for-all.
- **F21 reopens F6**: the sub-12 floor is still violated — the inline-style escape hatch in `global-error.tsx` was never audited.

R5 grades **3 (not 2)** because:

- The token foundation is genuinely solid — `--fs-*`, `--lh-*`, `--tracking-*` are well-defined, and 859 sites consume `text-label` plus 57 `text-eyebrow`. The contract exists.
- The R4 ESLint AST guard works for what it covers (16 banned px values, no false positives on display-intentional sites). New regressions on the audited axes won't slip through.
- The mono / sans / display font-family discipline is sound on every captured DOM (10 routes sampled).
- Most R3-resolved findings (F1, F5, F8, F10, F11, F12, F13) genuinely held.

R5 grades **not 4** because:

- A 4 means "contract is invisible because nothing fights it." F16 alone disproves this — the contract has a hole that 4 rounds of audit didn't catch, and the hole is in production code on the highest-traffic surface.
- The escape vectors that R4 deemed closed (sub-12 px, hierarchy, scale sprawl) reopen along axes R4 didn't measure (inline style, dead utilities, sibling-h2 duplication). The contract is not invisible; it's grep-resistant.
- Once F16 is patched (~5 lines in globals.css), F22 closes by side effect, the page-header step-up actually works, F17 is a single-component refactor, and F18 is a 160-site codemod. The remediation is proportional to the score gap — 3 → 4 is one focused fix.

---

## Path back to 4/4 (in priority order)

1. **F16 fix (BLOCKER, ~5 lines):** add `--text-display-sm: var(--fs-display-sm); --text-display-xl: var(--fs-display-xl); --text-numeric-xl: var(--fs-numeric-xl);` to `globals.css:158-168`. This makes `text-display-sm`, `text-display-xl`, `text-numeric-xl` live utilities; the 4 dead-utility sites fix themselves.

2. **F17 fix (WARNING):** decide on `SectionRule` migration. Either change default `tagAs` to `"div"` (preserves visual, breaks heading nav for current consumers — must opt back in) OR add a `title` prop and split the tag/title into distinct elements (`<h2 class="t-section-display">{title}</h2>` + `<span class="t-label">{tag}</span>`). Prefer the latter; ~10 consumer pages.

3. **F19 fix (WARNING):** define the h2 contract. Pick `t-section-display` (italic display) for editorial, `t-h2` (sans semibold) for ops. Migrate the 8 visual treatments to one of these two. Keep the audit honest by adding "h2 must use one of [t-h2, t-section-display]" to the design-tokens comment.

4. **F21 fix (WARNING):** raise `global-error.tsx:78,119` from 9.5/10.5 to 12 px. Drop 12.5 → 12 or 13.

5. **F18 fix (WARNING, codemod):** lift `text-sm` → `text-body-sm` and `text-base` → `text-body` on non-input sites. Add to ESLint AST guard. ~160 sites; mostly one-line each.

6. **F26 fix (MINOR, 1 line):** drop `max-w-[780px]` to `max-w-[640px]` in `StaticArticle.tsx:45`, `docs/page.tsx:17`, `help/earnings-data/page.tsx:46`.

7. **F25 fix (INFO, 30 sec):** swap `StrategyGrid.tsx:263` `text-xs` → `text-label`.

8. **F20 fix (INFO):** audit the 72 inline `letterSpacing` sites. The `style={{ letterSpacing: 0 }}` h1 overrides probably indicate the design-token tracking is wrong; reconcile.

After items 1-3, the score returns to 4. After items 4-6, it stays there.

---

## Files re-audited

- `frontend/src/styles/design-tokens.css` (L208-237 size scale, L234-244 leading + tracking, L406-486 token classes)
- `frontend/src/app/globals.css` (L156-168 `@theme inline` text scale — **incomplete: missing `--text-display-sm/xl`, `--text-numeric-xl`**)
- `frontend/eslint.config.mjs` (L40-77 — guards held; do not catch the F16 dead-utility class)
- `frontend/src/components/typography/SectionRule.tsx` (L17-37 — F17 root cause)
- `frontend/src/components/layouts/StaticArticle.tsx` (L45 — F26 column width)
- `frontend/src/components/layouts/DashboardPageLayout.tsx` (L78 — uses `md:text-display-sm`, dead utility)
- `frontend/src/app/(dashboard)/page.tsx` (L938 — uses `md:text-display-sm`, dead utility)
- `frontend/src/components/composites/PriceChartPanel.tsx` (L195 — uses `md:text-display-sm`, dead utility)
- `frontend/src/components/composites/EditorialNameplate.tsx` (L41 — uses `text-display-sm`, dead utility)
- `frontend/src/app/global-error.tsx` (L78, 119, 146, 163 — F21 sub-12 inline)
- `frontend/src/app/(dashboard)/strategies/trading-agents-research/page.tsx` (L602, 774, 1167, 1192, 1260 — F19 h2 sprawl)
- `frontend/src/app/(dashboard)/alerts/page.tsx` (L214 — h2 at text-sm; also F18 text-sm sites)
- `frontend/src/app/(dashboard)/strategies/[id]/_strategy/KillSwitchStatusPanel.tsx` (L96, 155, 161, 178, 189, 192, 203, 211 — F18 cluster of `text-sm` in new code shipped after R3-2)
- `frontend/src/app/help/earnings-data/page.tsx` (L65-83 — F17 duplicate h2 per section, plus SectionRule)
- `frontend/src/app/(dashboard)/strategies/[id]/page.tsx` (L760, 771, 790, 799, 809, 826 — 6 SectionRule h2-as-label sites per strategy)
- `frontend/src/app/about/page.tsx` (L43, 56 — SectionRule + inline letterSpacing)
- `frontend/src/app/docs/page.tsx` (L17, 32, 41, 59 — SectionRule + 780 px column + inline letterSpacing)
- `frontend/src/app/login/reset/page.tsx` (L64 — SectionRule)
- `frontend/src/app/_design/page.tsx` (L207-518 — 10 SectionRule sites)
- `frontend/src/components/dashboard/StrategyGrid.tsx` (L263 — F15 / F25 unchanged)
- `frontend/src/components/auth/AuthProductFrame.tsx` (L167 — F24 tracking-[0.22em]; L171 — F23 text-4xl/5xl/6xl)
- `qa/runs/2026-05-04T20-31-40Z/{dashboard,strategies-list,strategies-trading-agents-research,strategies-earnings-options-play,strategy-momentum-quality,settings,pipeline,analytics,reports,trade,alerts,login,login-reset,about,contact,docs,help-earnings-data,privacy,terms,risk,not-found,request-access}/{desktop-1440,mobile-390}/initial.dom.html`
- Git: `df54334d` (R4-3 baseline), `bc37a59b` (current HEAD — no frontend changes since R4)
