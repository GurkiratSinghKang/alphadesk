# Pillar 5 — Spacing

**Audited:** 2026-05-04
**Baseline:** `frontend/src/styles/design-tokens.css` (--space-1..24 scale: 4/8/12/16/20/24/32/40/48/64/96)
**Source:** `/Users/GK/Downloads/alphadesk/frontend/src/`
**Screenshots:** `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/<spec>/<viewport>/initial.preview.png`
**Stance:** FORCE — assume spacing fails until proven otherwise.

---

## Score: 2 / 4 (Needs work)

The system has a real token scale (`--space-1..24` declared, well-named) but the Tailwind layer barely uses it. **148 distinct spacing classes** appear in 3,603 instances. The top 10 values cover only **~50%** of usage (1789/3603) — the gsd benchmark for a healthy scale is **>70% in top 10**, and that bar is missed by 20 percentage points. The fragmentation is concentrated in half-step values (`gap-1.5`, `gap-0.5`, `py-1.5`, `py-0.5`, `mt-0.5`, `px-1.5`, `px-2.5`, `py-2.5`, `px-3.5`) and in raw-px arbitrary values (`gap-[2px]`, `gap-[3px]`, `gap-[18px]`, `px-[18px]`, `px-[22px]`, `mt-[1px]`, `py-[1px]`, `py-[3px]`, `px-[7px]`). None of those map to any token in `design-tokens.css`. The intent (a dense terminal aesthetic) is real and visible in the screenshots, but the execution is "every developer picked their own micro-spacing," not "the scale was followed." Cross-page rhythm is therefore inconsistent: marketing/legal pages breathe while the empty-state right pane on `/strategies/earnings-options-play` is a void; same component (PositionsList rows) uses `px-[18px]` while neighbour components use `px-4` or `px-5`.

Score is held at 2 (not 1) because: (a) the dashboard hero, trade page, settings, and pipeline all sit on a believable visual rhythm at 1440 desktop, (b) tap targets generally clear the 40px floor where it matters (focus-skip links pin `min-h-[44px]`, ClaudeThesisCard buttons explicitly note `min-h-[44px]: iPad touch target` at line 208, alerts/settings forms have airy inputs), and (c) `gap-2`/`gap-3`/`px-3`/`px-4`/`py-2` are correctly the dominant primitives where they should be — the rhythm baseline is right. But the empty-state void, the cramped earnings sidebar mobile spacing, and the half-step proliferation are real defects.

---

## Findings

### BLOCKER 1 — `/strategies/earnings-options-play` empty right pane is a void
File: `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx:190–192`
The empty-state for the detail pane is a single line of text inside a `p-4` border, occupying ~70% of the desktop viewport width with no illustration, no CTA, no contextual help, no breakdown of what the panel will show. Screenshot evidence: `qa/runs/.../strategies-earnings-options-play/desktop-1440/initial.preview.png` — the entire right two-thirds of the page is empty grey card with one micro-line "Select a symbol from the sidebar." This is the defect prior UX critique already flagged; spacing-wise, the sin is **whitespace-as-void, not whitespace-as-breathing-room**. Fix: collapse the pane until selection, or fill with a "what you'll see" preview block with three `space-y-4` placeholder rows describing the trade thesis, edge metric, and IV-rank context that loads on selection.

### BLOCKER 2 — Spacing scale fragmentation: 148 distinct values across 3,603 uses
Counted: 148 unique `(p|m|gap|space)-N` classes; top 10 = 1,789 instances ≈ 50% of usage. Healthy is ≥70%. Top consumers of fragmentation:
- `gap-1.5` (127 uses, 6px — off the 4/8 token scale)
- `mt-0.5` (69 uses, 2px — off the scale)
- `py-0.5` (59 uses, 2px — off the scale)
- `px-1.5` (59 uses, 6px — off the scale)
- `px-2.5` (52 uses, 10px — off the scale)
- `py-1.5` (86 uses, 6px — off the scale)
- `gap-0.5` (30 uses, 2px — off the scale)

The token file declares `--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px; --space-6: 24px;` etc. There is **no 2px, 6px, or 10px token**. Every half-step bypasses the system. Fix: add `--space-half: 2px` and `--space-1-5: 6px` to design-tokens.css OR sweep half-step Tailwind classes to nearest scale value (`gap-1.5` → `gap-1` or `gap-2`, `py-0.5` → `py-1`). Given there are 459+ half-step instances, a token addition is more pragmatic than a sweep.

### BLOCKER 3 — Arbitrary-pixel gaps and paddings on production-shipping components
`grep` for `gap-\[\d+px\]` and `(p|m)[xtylbr]?-\[\d+px\]` returns 21+ hits including:
- `frontend/src/components/composites/ContextBar.tsx:47` — `gap-[2px] … md:px-[22px]` (mixes raw px with token classes in same className string)
- `frontend/src/components/composites/StatusBar.tsx:58,95,101` — `h-[22px] px-5 gap-[18px]`, `gap-[18px]`, `py-[1px]`
- `frontend/src/components/composites/PositionsList.tsx:123,246,254,294,300,332,340,362` — `px-[18px]` and `mt-[1px]` repeated 8× across one component
- `frontend/src/components/composites/AIMemoPanel.tsx:53,80` — `sm:px-[18px] sm:py-[18px]`, `px-[7px] py-[3px]`
- `frontend/src/components/composites/StrategyCard.tsx:110` — `mt-[3px]`
- `frontend/src/app/(dashboard)/pipeline/page.tsx:1533` — `gap-[3px]`
- `frontend/src/components/layout/TickerTape.tsx:51` — `py-[3px]`

`18px` is between `--space-4 (16px)` and `--space-5 (20px)`. Why neither? `7px`/`3px`/`1px`/`2px` simply don't exist as design tokens. These are author-by-author micro-tunings. PositionsList alone uses `px-[18px]` 4 times when `px-4` (16px) or `px-5` (20px) would map to the scale. Fix: snap each arbitrary value to the nearest token; if 18px is genuinely needed for a numeric column, add `--space-4-5: 18px` and a corresponding utility — don't leave raw px in className.

### WARNING 4 — Cross-page rhythm: marketing/legal vs terminal mismatch
Sampled rhythm at 1440 desktop:
- `/about` (marketing): hero pad `py-16` (64px) feels right, but body sections collapse to `text-` paragraphs with no `space-y-` rhythm between sections — lists of numbered items render flat (qa/runs/.../about/desktop-1440/initial.preview.png shows § 01..§ 05 as a wall of text with no airy hierarchy between them)
- `/contact` (qa/runs/.../contact/desktop-1440/initial.preview.png): same pattern — § 01..§ 05 are stacked too tightly relative to the airy hero
- `/help-earnings-data` (qa/runs/.../help-earnings-data/desktop-1440/initial.preview.png): same again — long-form copy is uniformly sized, no `space-y-8` between major sections
- `/dashboard` (qa/runs/.../dashboard/desktop-1440/initial.preview.png): tight cards with `gap-3`/`gap-4` — appropriate for trading-terminal density
- `/trade` (no preview at this run, but page.tsx:925 uses `px-3 py-3 md:px-5 md:py-5`, intentionally tight) — appropriate
- `/pipeline` (qa/runs/.../pipeline/desktop-1440/initial.preview.png): the "Pipeline has not yet run today" empty state at center is squished into ~40px vertical space; same screen has lots of horizontal padding around it. Asymmetric.

`space-y-` distribution: only **123 total uses** vs 3,480 horizontal-spacing uses. Vertical rhythm is undermanaged. Most-used `space-y-3` and `space-y-1` (33 + 31) suggest the engine is laying things out tight by default; sections needing visual chapters (`space-y-8`, `space-y-12`) are essentially absent (`space-y-10` = 1 use, `space-y-6` = 2). Marketing/legal pages should use a heavier `space-y` cadence; they don't.

Fix: introduce a marketing-rhythm class set (`.t-section-stack { @apply space-y-12; }` for marketing; `.t-card-stack { @apply space-y-6; }` for cards) and require legal/marketing pages to use it.

### WARNING 5 — Hit-target floor: half-step paddings produce sub-40px desktop buttons
`py-0.5` (2px) at 59 uses + `py-1` (89 uses) on inline elements that render as buttons risks producing controls below the 40px mobile / 24px desktop floor when paired with `text-[11px]` or `text-[12px]`. Specific examples to verify in regression sweep:
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx:469` — chip with `py-1` + `text-[11px]` ≈ 22px height (below mobile 40px floor; close to 24px desktop floor)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx:269,283` — banner buttons with `py-2` + `text-[12px]` ≈ 32px (under mobile 40px)
- `frontend/src/components/composites/StatusBar.tsx:101` — pill with `py-[1px]` is intentionally cosmetic but defeats anyone trying to tap it on mobile; status bar is currently desktop-only by design but the styles travel

The component-level fix is to replace ad-hoc `py-N` on tappable affordances with a shared `--btn-h-sm: 40px` / `--btn-h-md: 44px` token and a `min-h-` enforcement. Several places already do this manually (ClaudeThesisCard.tsx:208, dashboard/layout.tsx:265,302 use `min-h-[44px]`) — promote the pattern into a primitive.

### WARNING 6 — `gap-1` as default flex gap discourages density discipline
`gap-1` (4px) appears 106 times. At 4px it's too tight for most flex rows of mixed-size elements (icon 16px next to text-[13px] + meta-13). It often pairs with `text-[12px]` text whose visual weight needs `gap-1.5` (6px) or `gap-2` (8px) breathing — and this is exactly why developers reached for `gap-1.5` instead of standardizing on `gap-2`. Net result: 106 + 127 = 233 instances of "my gap looks tight, let me half-step." Fix: codify two flex-gap presets (`gap-tight` = 6px, `gap-row` = 8px) and migrate. Choose ONE between 4 and 8 — either drop 4px from inline rows or formalize 6px in tokens.

### WARNING 7 — Empty/sparse outliers across non-terminal routes
Beyond the earnings detail void:
- `/pipeline` (qa/runs/.../pipeline/desktop-1440/initial.preview.png): the "Build or backtest" callout is centered in a sea of black with `+ Add Strategy` floating; the ASCII-style empty bar feels orphaned, not framed.
- `/alerts` (qa/runs/.../alerts/desktop-1440/initial.preview.png): the "you haven't set up any alerts yet" panel is correctly framed, but the form above it has too much horizontal whitespace relative to the empty state below — the `Create Alert` button is far-right at high desktop widths while form labels cluster left.
- `/about` mobile (qa/runs/.../about/mobile-390/initial.preview.png): `py-16` hero pad eats screen real estate; body sections use the same pad → mobile reads as 80% header / 20% content per scroll.

These are mixed sparse + cramped on the same routes, which is the spacing-pillar definition of "rhythm broken."

### WARNING 8 — Token file declares spacing scale, Tailwind config does not consume it
`design-tokens.css` declares `--space-1..--space-24`. `postcss.config.mjs` is the only Tailwind/PostCSS config in the repo and it loads `@tailwindcss/postcss` but **does not extend or override the default Tailwind spacing scale to use the `--space-*` tokens**. Result: developers writing `p-4` get Tailwind's default 16px (which happens to match `--space-4`), but writing `p-[18px]` is the only way to escape Tailwind's defaults and there's no on-ramp from Tailwind utility back to the design token. The token file is decorative, not enforced.

Fix: in the Tailwind v4 `@theme` block (likely in `globals.css` since there's no tailwind.config), declare `--spacing-1: var(--space-1)` etc. so `p-N` resolves through the design tokens and a future scale change ripples. Also lints/ESLint plugin to flag arbitrary `(p|m|gap)[xtylbr]?-\[` outside an allow-list of tokenized exceptions.

---

## Top 3 Priority Fixes

1. **Eliminate the earnings-options-play empty pane void.** EarningsDetailPanel.tsx:190 — replace the single-line empty state with a structured preview of what the pane will render once a symbol is selected (3-row `space-y-4` placeholder describing thesis/edge/IV context). User impact: half the screen on the headline strategy page currently signals "empty product"; this is the first impression of the strategy. Concrete fix: write a `<DetailPanePreview/>` component with skeleton cards for the three sections.

2. **Snap arbitrary-pixel spacing to the token scale OR add the missing tokens.** 21+ files use `gap-[Npx]` / `px-[Npx]` for values 1–22px that don't map to `--space-*`. Either sweep them to the nearest token (`px-[18px]` → `px-5` / 20px) or add `--space-half (2px)`, `--space-1-5 (6px)`, `--space-4-5 (18px)` tokens and corresponding Tailwind utilities, then sweep raw px → utility class. User impact: any future redesign or theme cannot ship a single coherent rescale because the spacing layer is unscaled.

3. **Wire `--space-*` tokens into Tailwind's spacing scale via `@theme` in globals.css.** Today the token file is informational only; Tailwind's defaults shadow it. After wiring, add an ESLint rule `no-arbitrary-spacing` to fail any new `(p|m|gap|space)[xtylbr]?-\[` usage outside an allow-list. User impact: prevents the next 21 arbitrary values from ever being committed and makes the design system actually load-bearing.

---

## Files Audited

- `/Users/GK/Downloads/alphadesk/frontend/src/styles/design-tokens.css`
- `/Users/GK/Downloads/alphadesk/frontend/postcss.config.mjs`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/layout.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/loading.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/trade/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/settings/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/alerts/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/HistoricalMoves.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/ClaudeThesisCard.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/[id]/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/not-found.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/docs/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/ContextBar.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/StatusBar.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PositionsList.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/AIMemoPanel.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/StrategyCard.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/StrategyRail.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/WatchlistPanel.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/primitives/RegimePill.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TickerTape.tsx`
- Screenshots reviewed (`initial.preview.png` only): dashboard desktop+mobile, strategies-earnings-options-play desktop+mobile, about desktop+mobile, login desktop, pipeline desktop, settings desktop, strategies-list desktop, privacy desktop, alerts desktop, strategies-trading-agents-research desktop, strategy-momentum-quality desktop, help-earnings-data desktop, contact desktop.
