# Pillar 4 — Typography

**Audited:** 2026-05-03
**Stance:** FORCE — assume failure until proven otherwise
**Score:** 2 / 4 (Needs work)
**Sources:** `frontend/src/styles/design-tokens.css`, `frontend/src/components/typography/*`, full `frontend/src/**/*.tsx` grep, screenshots in `qa/runs/2026-05-04T02-58-02Z/`, `qa/visual/manifest.json`.

---

## Verdict

The token system is well-thought-out — `design-tokens.css` declares a five-step numeric ladder (`--fs-numeric-hero/xl/lg/md`), three UI heading sizes (`--fs-h1/h2/h3`), and explicit `.t-*` semantic classes (`t-h1`, `t-h2`, `t-h3`, `t-display-section`, `t-label`, `t-num-md`, `t-meta`). The 12 px readable floor is enforced at runtime: `qa/visual/manifest.json` shows `fontSizeFailureCount: 0` across every audited page (95 sampled text runs on `dashboard-desktop` alone).

But the implementation routinely **bypasses the very tokens it ships**. Source greps return **23 distinct arbitrary `text-[NNpx]` values** sitting alongside the full Tailwind `text-xs/sm/base/lg/xl/2xl/3xl/4xl/5xl/6xl` ladder — the app is using two parallel scales, the editorial token scale and a mostly-redundant px scale, and arbitrary values dominate (`text-[12px]` × 649, `text-[13px]` × 223, `text-[15px]` × 82). Several `t-*` semantic classes are then re-overridden inline (`t-display-section text-[13px]`, `t-h2 !text-[#12281f]`), which defeats the point of a token system. Heading hierarchy is broken on the two pages flagged by a11y (`/alerts`, `/strategies/earnings-options-play`) and a third (`/strategies`). Mono numbers without `tabular-nums` show up in 28% of mono usages where digit alignment matters.

Score is 2/4: tokens exist and the readable floor holds, so this is not a 1; but the scale is sprawled, semantic classes are subverted, and hierarchy is broken on multiple shipping pages, so it is well below 3.

---

## Findings

### F1 — Scale sprawl: 23 distinct arbitrary `text-[NNpx]` sizes app-wide [BLOCKER]

```
text-[10px] text-[11px] text-[12px] text-[13px] text-[14px] text-[15px]
text-[16px] text-[17px] text-[18px] text-[19px] text-[20px] text-[22px]
text-[24px] text-[26px] text-[28px] text-[30px] text-[32px] text-[34px]
text-[36px] text-[40px] text-[42px] text-[48px] text-[54px]
```
Source: `grep -rEn 'text-\[[0-9]+px\]' frontend/src --include="*.tsx" | grep -oE 'text-\[[0-9]+px\]' | sort -u` → 23 uniques.

The Tailwind ladder (`text-xs … text-6xl`) is also in use (227× `text-xs`, 123× `text-sm`, 44× `text-base`, plus `lg/xl/2xl/3xl/4xl/5xl/6xl`). So there are effectively **>30 distinct font sizes** in regular use.

The token contract (`design-tokens.css` L187-210) declares 13 sizes total, organized as a coherent display + heading + numeric + body ladder. The implementation bypasses this with arbitrary px values that don't map to any token. Examples that should be `--fs-h3 (17px)` but are written as `text-[17px]`, etc., produce a maintenance hazard: bumping a token will not propagate.

**Fix:** delete every `text-[NNpx]` arbitrary value where a `--fs-*` token or `t-*` class exists; codify a lint rule (Tailwind safelist + ESLint `no-restricted-syntax` on `text-[`) so new occurrences fail CI.

---

### F2 — Tokens ship a 22 px section header, every consumer overrides it to 13 px [BLOCKER]

`design-tokens.css` L191:
```
--fs-display-section: 22px;
```
`.t-display-section` (L432) renders the 22 px italic serif used for "Book / Strategies / memo body" headers.

Actual usage (every consumer):
- `_earnings/HistoricalMoves.tsx:12,22` — `<h3 className="t-display-section italic text-[13px]">…`
- `_earnings/IVTermSkew.tsx:13,22,31` — same pattern
- `_earnings/NewsFeed.tsx:34,55` — same
- `_earnings/HistoricalSetupReplay.tsx:216` — same
- `_earnings/EarningsCalendarSidebar.tsx:150` — same (`text-[13px]` + `pb-1 border-b`)
- `_earnings/StrikeLadder.tsx:17,32` — same

15 sites, all override 22 px → 13 px. The token is effectively dead. Visible in the earnings-options-play screenshot: section headings ("CALENDAR · MAY 1-15, 2026", "REPORTS") are tiny tracked-caps mono, indistinguishable from body labels.

**Fix:** either (a) reduce `--fs-display-section` to ~13–14 px and drop italic if the screenshots are the intended look, or (b) remove `text-[13px]` from every consumer. Pick one source of truth.

---

### F3 — Forced `!text-[#hex]` overrides on heading-system classes [WARNING]

`pipeline/page.tsx` L897, L1013, L1078, L1104, L1315 — `<h2 className="t-display-section !text-[#12281f]">`
`strategies/page.tsx` L528, L944 — `<h2 className="t-h2 !text-[#12281f]">`

`!text-[#12281f]` uses Tailwind `!important` to ram a hex colour past the token system's `color: var(--fg)` declaration on `.t-h2` and `.t-display-section`. This:
1. Hardcodes a near-black colour that ignores light-mode token swaps (the `.light` block in `design-tokens.css` L265-341 is bypassed).
2. Uses `!important`, which is a code smell — the token cascade is fighting itself.

13 such `!text-[#…]` overrides exist. Counted via `grep -rEn 'text-\[#[0-9a-fA-F]+\]'` = **113 hardcoded text colours** (color pillar territory but typography-relevant because they neutralize the typography token contract).

**Fix:** add `--fg-on-cream` or similar token; replace `!text-[#12281f]` with `text-[color:var(--fg-on-cream)]` (no `!`). Light-mode parity then comes for free.

---

### F4 — Heading hierarchy broken on 3 pages [BLOCKER]

a11y already flagged `/alerts` and `/strategies/earnings-options-play`. Source confirms a third (`/strategies`):

| Route | h1 | h2 | h3 | Issue |
|-------|----|----|----|-------|
| `/` (dashboard) | `<h1 className="sr-only">` (page.tsx:650) | `page.tsx:884` | `page.tsx:1641, 1766` | OK — h1 → h2 → h3 |
| `/alerts` | none | none | `alerts/page.tsx:213` (`<h3 className="text-sm font-semibold…">`) | h3 with no h1/h2 ancestor |
| `/strategies/earnings-options-play` | none in `page.tsx`; `DetailHeader.tsx:75` renders an `<h2>` for the focused symbol; sub-panels jump to `<h3>` | — | many `<h3>` in `_earnings/*.tsx` | No page-level h1; outline starts at h2. (Sidebar `<h3 className="t-display-section…">` in `EarningsCalendarSidebar.tsx:150` lives outside any h2, breaking hierarchy.) |
| `/strategies` | none (no `<h1>` found) | `strategies/page.tsx:455, 528, 944` | — | Multiple h2s, no h1 |
| `/trade` | `trade/page.tsx:957` | — | — | h1 only — OK so far |

`alerts/page.tsx:213` literally renders a heading as `<h3 className="text-sm font-semibold…">` — the `<h3>` tag was chosen for outline depth but the visual size is 14 px (`text-sm`), so screen-reader users hear "heading level 3" while sighted users see body text. That's a hierarchy *and* a visual-vs-semantic mismatch.

**Fix:** every route page must render exactly one `<h1>` (sr-only acceptable), and section headings must descend without skips. `/strategies` and `/strategies/earnings-options-play` need h1s; `/alerts` needs an h1 plus an h2 above its h3.

---

### F5 — Mono numbers without `tabular-nums` [WARNING]

Trading data must use tabular figures so digits don't jitter on tick updates. `.t-mono` (L417) bakes in `font-variant-numeric: tabular-nums`. **But raw `font-mono` Tailwind class (211 occurrences) does not** — only 38 of those raw uses pair with `tabular-nums`, leaving ~173 sites where mono numbers can shift sub-pixel as values change.

Confirmed examples:
- `app/(dashboard)/page.tsx:1144` — `font-mono text-[15px] leading-tight text-ink-1000` (Book equity / Day P&L cluster, no `tabular-nums`)
- `app/(dashboard)/page.tsx:1209, 1213, 1400` — three more dollar/percent values, no `tabular-nums`
- `composites/PriceChartPanel.tsx:211, 256` — chart meta values, no `tabular-nums`

Of 60 `text-[15px] font-mono` combinations, only 14 include `tabular-nums` — the canonical mid-size numeric and the most likely to be a live-updating dollar amount.

**Fix:** create a `<Mono>`-style helper for live numbers that always emits `font-variant-numeric: tabular-nums`, or codemod every dashboard `font-mono text-[NNpx]` site to add `tabular-nums`. Better still: use the `.t-num-md / .t-num-lg / .t-num-xl` ladder that already exists (L426-429) — currently almost nothing reaches for it.

---

### F6 — Sub-12px text in source (visually clamped at runtime, but the source is misleading) [WARNING]

`grep` finds **30 instances** of `text-[10px]` and `text-[11px]` across:
- `auth/AuthLuxuryPreview.tsx:89, 109, 148, 197` (4)
- `auth/AuthProductFrame.tsx:125, 167, 227, 254, 280, 282, 295` (7)
- `request-access/.../RequestAccessForm.tsx:151, 193` (2)
- `login/.../LoginForm.tsx:240` (1)
- `strategies/trading-agents-research/page.tsx:768, 866, 895, 925, 939, 987, 994, 1108, 1222` (9)
- `_earnings/EarningsDetailPanel.tsx:469` (1)
- `components/charts/ChartPane.tsx:1784, 1792, 1802, 1811, 1851` (5)
- `components/options/OptionsPayoffPanel.tsx:175` (1)

The visual manifest reports zero font-size failures, which means the rendering pipeline (browser default + token base) keeps these above 12 px effective — but the tokens explicitly say (L184-186) "former --fs-label (10.5), --fs-hint (11), --fs-micro (9.5)... New floor is 12 px (label) with a 13 px meta." The source contradicts the documented floor. Either the floor moved and the comment is stale, or these will regress the moment a parent stops applying a base font-size override.

**Fix:** lift every `text-[10px]` / `text-[11px]` to `text-[12px]` (or `--fs-label`); lock with an ESLint rule `no-restricted-syntax: text-\[1[01]px\]`. Keep the documented floor intact.

---

### F7 — Tracking-value sprawl: 10 distinct arbitrary letter-spacing values [WARNING]

```
tracking-[-0.015em]  tracking-[0.04em]  tracking-[0.08em]
tracking-[0.1em]     tracking-[0.12em]  tracking-[0.14em]
tracking-[0.16em]    tracking-[0.18em]  tracking-[0.22em]
tracking-[0]
```
51 occurrences in total. `design-tokens.css` declares exactly **four** tracking tokens (`--tracking-tight -0.04em`, `--tracking-ui -0.005em`, `--tracking-label 0.12em`, `--tracking-mono 0`, plus `--tracking-numeric-hi -0.02em`). The token comment even notes "was 0.16em — tiny caps + heavy tracking was illegible." Yet `0.16em`, `0.18em`, and `0.22em` all reappear in source, because nobody pulls the token.

Affected: every "DECISION SIGNAL", "EARNINGS · OPTIONS PLAY", "CALENDAR" eyebrow on the screenshots — visible in the earnings-options-play and trading-agents-research previews as inconsistent caps spacing across visually-similar labels.

**Fix:** map all eyebrows to `.t-label` (which already encodes `--tracking-label`); drop the inline `tracking-[0.NNem]` overrides.

---

### F8 — `leading-[NN]` arbitrary line-heights bypass `--lh-*` tokens [WARNING]

13 distinct arbitrary leading values (`leading-[0.92]`, `leading-[0.95]`, `leading-[1.04]`, `leading-[1.05]`, `leading-[1.1]`, `leading-[1.4]`, `leading-[1.45]`, `leading-[1.5]`, `leading-[1.55]`, `leading-[1.6]`, `leading-[1.65]`, `leading-[1.75]`, `leading-[1]`). Tokens declare exactly four (`--lh-tight 1.02`, `--lh-snug 1.18`, `--lh-body 1.5`, `--lh-loose 1.7`). Editorial body in `editorial.tsx:17,65` uses `leading-[1.65]` rather than `--lh-loose 1.7` — close but not the same. None of the arbitrary values match a token.

**Fix:** consolidate to `--lh-*` tokens; if `1.65` is genuinely the desired editorial rhythm, codify it as `--lh-editorial: 1.65` and use it everywhere.

---

### F9 — Long-form prose: 780 px column at 15 px / 1.65 = ~98 ch (above optimal) [MINOR]

`StaticArticle.tsx:45` → `max-w-[780px]`. With `EditorialP` at 15 px, average glyph width ~7.5 px → ~98 characters per line. Optimal for sustained reading is 60–75 ch; 98 ch is reachable but tiring. Visible on `/terms` screenshot — paragraphs run nearly the full 780 px width with no comfortable resting point.

**Fix:** drop article column to `max-w-[680px]` (~85 ch) or `max-w-[640px]` (~80 ch). Shipped 15 px / 1.65 line-height is otherwise good.

---

### F10 — Two `<h2>`s competing on `/strategies` with mismatched typography [WARNING]

`strategies/page.tsx:455` — `<h2 className="mt-2 text-[18px] font-semibold leading-tight text-ink-1000">Scan what can trade…</h2>`
`strategies/page.tsx:528` — `<h2 className="t-h2 !text-[#12281f]">…</h2>` (`--fs-h2 = 22px`, `font-weight: 500`)

Same heading level, two different sizes (18 vs 22), two different weights (semibold 600 vs medium 500), two different colour mechanisms. Either both are h2 and they should look the same, or the visual-weight intent disagrees with the semantic level. This is the symptom that scale sprawl + token-bypass causes — two engineers pick visually-pleasing values from two different ladders.

**Fix:** decide if the "Scan what can trade…" line is a subhead (h3 / `.t-h3`) or a sibling section header (`.t-h2`). Pick one and align typography accordingly.

---

## Mono-vs-sans audit

- Trading numbers: mostly mono (211 `font-mono`, 271 `t-*` semantic classes including `.t-mono`/`.t-num-*`). Good.
- But `tabular-nums` not enforced on raw mono (F5).
- No prose-mono mistakes found in the screenshots; `.t-mono-micro` is used only on metadata as designed.
- `<td>` cells in `trade/page.tsx:2625, 2629` use `font-medium uppercase` and `capitalize` without any mono/tabular treatment — these are categorical (BUY/SELL, "limit"), so this is intentional and fine.

## Long-form readability

Editorial pages (`/terms`, `/privacy`, `/docs`, `/risk`) use a single shared `<EditorialP>` (15 px / 1.65 / `text-fg-dim`) and `<EditorialBullet>` (matching). Consistent. Only complaint is the 780 px column (F9). `/help-earnings-data` screenshot shows clean italic-serif H2 headings with sufficient breathing room above each — this is the part of the system that works.

---

## Top priority fixes

1. **Kill the parallel arbitrary scale.** Codemod every `text-[NNpx]` to the closest `--fs-*` token (or `text-xs/sm/base/lg/xl/2xl`). Add `eslint-disallow: text-\[\d+px\]` to prevent regression. Reduces 30+ sizes → 13.
2. **Resolve the `t-display-section` 22 px-vs-13 px contradiction.** Pick one. If 13 px is correct, drop `--fs-display-section` to 13 px and rename to `--fs-section-cap`. Stop shipping a token nobody respects.
3. **Add an `<h1>` to every route.** `/alerts`, `/strategies`, `/strategies/earnings-options-play` are missing them; `/alerts` additionally renders `<h3>` styled as body text (`text-sm`). Fix WCAG 1.3.1 hierarchy.
4. **Make `tabular-nums` non-optional for live numbers.** Replace raw `font-mono text-[NNpx]` on dollar/percent cells with `.t-num-md/lg/xl` or a `<Mono>` helper. Stops 173+ sites from ever jittering.
5. **Drop `!text-[#12281f]` `!important` overrides** on `t-h2` / `t-display-section`; introduce a `--fg-on-cream` token. Restores light-mode parity.

## Files audited

- `frontend/src/styles/design-tokens.css`
- `frontend/src/app/globals.css`
- `frontend/src/components/typography/{Display,Eyebrow,Mono,SectionRule,SerifEyebrow,index}.tsx`
- `frontend/src/components/layouts/{editorial,StaticArticle,MarketingShell}.tsx`
- `frontend/src/components/composites/{ContextBar,PriceChartPanel}.tsx`
- `frontend/src/components/charts/ChartPane.tsx`
- `frontend/src/components/options/OptionsPayoffPanel.tsx`
- `frontend/src/components/auth/{AuthLuxuryPreview,AuthProductFrame}.tsx`
- `frontend/src/app/(dashboard)/{page,alerts/page,strategies/page,strategies/earnings-options-play/page,strategies/trading-agents-research/page,trade/page,settings/page,pipeline/page}.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/{HistoricalMoves,IVTermSkew,NewsFeed,HistoricalSetupReplay,EarningsCalendarSidebar,StrikeLadder,DetailHeader,EarningsDetailPanel}.tsx`
- `frontend/src/app/{terms,privacy}/_*/content.tsx`
- `frontend/src/app/{login,request-access}/*/{LoginForm,RequestAccessForm}.tsx`
- `frontend/src/app/{not-found,docs/page,_design/page}.tsx`
- `qa/visual/manifest.json` (font-size + readability checks)
- `qa/runs/2026-05-04T02-58-02Z/{dashboard,alerts,strategies-earnings-options-play,strategies-trading-agents-research,terms,help-earnings-data}/{desktop-1440,mobile-390}/initial.preview.png`
