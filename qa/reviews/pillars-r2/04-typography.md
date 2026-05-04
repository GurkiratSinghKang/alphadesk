# Pillar 4 — Typography (Re-audit r2)

**Re-audited:** 2026-05-04
**Stance:** FORCE — assume failure until proven otherwise
**Score:** 2 / 4 (Needs work — unchanged)
**Sources:** `frontend/src/styles/design-tokens.css`, `frontend/src/app/globals.css`, `frontend/src/components/typography/*`, `frontend/src/**/*.tsx` greps, screenshots in `qa/runs/2026-05-04T13-45-11Z/`, `qa/visual/manifest.json`.

---

## Verdict

The remediation sprint landed three real wins: SectionRule now emits real `<h2>` (B1), `alerts:213` "Create Alert" is a real `<h2>` (BUG-06), and the contradictory `--fs-display-section: 22px` token was deleted (replaced by `--fs-section-cap: 13px`). PR-6a also wired a `@theme inline` namespace exposing `text-h1 / text-h2 / text-h3 / text-numeric-hero / text-body / text-label`, so tokens are now first-class Tailwind utilities. Heading hierarchy on the three originally-flagged routes (`/alerts`, `/strategies`, `/strategies/earnings-options-play`) is verifiably clean in the captured DOMs.

But the **scale-sprawl BLOCKER (F1) is unchanged**: still 23 distinct arbitrary `text-[NNpx]` values across **1,051** sites, plus the full Tailwind preset ladder (`text-xs` × 225, `text-sm` × 122, `text-base` × 44, …`text-6xl`) — the same effective ~30+ font sizes the original audit measured. The PR-6a `text-h1/h2/body` tokens have **4 total adopters in the entire codebase** (3× `text-label`, 1× `text-body`); the foundation laid in PR-6a was never followed by a codemod.

Worse, the **PR-4 `t-section-display` migration described in the brief never landed**: `grep -rn 't-section-display'` returns **zero matches in source and zero in CSS** — the class doesn't exist. The 21 page-header sites the brief claims were migrated still use ad-hoc `text-[26px] md:text-[32px]` inline. So the original F2 contradiction was *replaced* with a different one: a documented migration that's a phantom. `t-section-cap` has **35 source sites**, not the 11 the brief claimed.

Score holds at 2/4: heading-hierarchy + dead-token wins are real progress; scale-sprawl BLOCKER and the half-finished page-header migration keep this below 3.

---

## Findings

### F1 — Scale sprawl BLOCKER unchanged: 23 arbitrary px + full Tailwind ladder [BLOCKER, carry-over]

```bash
grep -rohE 'text-\[\d+px\]' frontend/src --include='*.tsx' | sort -u | wc -l   # 23
grep -rnE  'text-\[\d+px\]' frontend/src --include='*.tsx' | wc -l             # 1051
```
Distinct values (identical to r1): `text-[10|11|12|13|14|15|16|17|18|19|20|22|24|26|28|30|32|34|36|40|42|48|54px]`. Top offenders: `text-[12px]` × 651, `text-[13px]` × 218, `text-[15px]` × 79, `text-[11px]` × 29, `text-[14px]` × 14.

PR-6a wired `text-h1/h2/h3/numeric-hero/body/label`, but adoption is 4 sites total. The state is arguably *worse* than r1: a third parallel scale (`text-h*`) with no consumers.

**Fix:** codemod every `text-[NNpx]` to `text-h*/text-body*/text-numeric*` or the closest preset; add ESLint `no-restricted-syntax` on `text-\[\d+px\]`. The brief calls this "BUG-19 not done in this sprint" — accurate.

---

### F2 — `--fs-display-section` 22-vs-13 contradiction GONE [RESOLVED]

`grep -rn 'fs-display-section\|t-display-section'` → **0 hits**. Dead 22 px token and class deleted. `--fs-section-cap: 13px` now lives at `design-tokens.css:191` with a clear comment. `t-section-cap` (CSS L432) is the only consumer, used by 35 sources, all rendering at the documented 13 px. Closes original F2.

---

### F3 — `!text-[#12281f]` `!important` overrides DROPPED from heading classes [PARTIAL FIX → MINOR]

`grep -rohE 'text-\[#12281f\]'` → 22 sites total (113 hardcoded hex texts overall — same as r1). But the `!important` form is gone from `t-h2` headings: `strategies/page.tsx:528` is now plain `<h2 className="t-h2">`, and `pipeline/page.tsx`'s prior `t-display-section !text-[#12281f]` sites disappeared with the deleted class. Light-mode parity for the heading cascade is restored. Surviving 22 hex uses are body/inline contexts (color-pillar concern).

Downgrade: WARNING → MINOR.

---

### F4 — Heading hierarchy on the 3 flagged routes FIXED [RESOLVED]

DOM evidence from `qa/runs/2026-05-04T13-45-11Z/{alerts,strategies-list,strategies-earnings-options-play}/desktop-1440/initial.dom.html`:

| Route | h1 | h2 | h3 | Status |
|-------|----|----|----|--------|
| `/alerts` | "Alerts & triggers" | "Create Alert" (page.tsx:214 — was `<h3>` in r1) | — | OK |
| `/strategies` | "Strategies" | 5 × `t-h2` | 2 × `t-section-cap italic` | OK |
| `/strategies/earnings-options-play` | "This + next week's earnings" | (in detail panel) | — | OK |
| `/docs`, `/about`, `/contact`, `/privacy` | h1 (`t-display-lg`) | `<h2 class="t-label">§ N · …` × 5-10 each | — | OK — B1 SectionRule fix verified |
| `/dashboard` | sr-only h1 + visible "Control room" h2 | 4 × h3 | — | OK |
| `/settings` | h1 | 7 × `t-section-cap` h2 + 1 dev "Performance Monitor" `<h2 class="text-sm…">` | 2 dev `<h3 class="text-[12px]…">` | OK in user surface; debug panel uses arbitrary px (symptomatic, not blocking) |
| `/pipeline` | h1 | 5 × `t-section-cap` h2 | — | OK |

WCAG 1.3.1 hierarchy intact across the captured suite. Real win. Closes original F4.

---

### F5 — Mono numbers without `tabular-nums` [WARNING, unchanged]

```bash
grep -rEn 'font-mono' --include='*.tsx' | wc -l                        # 216
grep -rEn 'font-mono' --include='*.tsx' | grep -v tabular-nums | wc -l # 178
```
**178 / 216 = 82.4%** of `font-mono` sites still lack `tabular-nums` (r1: 82%). No movement. Trading numbers in Book / Day-P&L / chart-meta clusters can still jitter sub-pixel on tick updates.

---

### F6 — Sub-12 px text in source, slightly worse [WARNING, regression]

```bash
grep -rohE 'text-\[1[01]px\]' --include='*.tsx' | wc -l  # 36 (was 30 in r1)
```
36 source sites below the 12 px floor `design-tokens.css:184-186` documents. Visual manifest still reports `fontSizeFailureCount: 0` (browser defaults rescue most), but source-vs-doc gap widened. Net regression of +6 sites.

---

### F7 — Tracking sprawl PARTIAL FIX [WARNING → MINOR]

```bash
grep -rohE 'tracking-\[[^\]]+\]' --include='*.tsx' | sort -u | wc -l  # 10 distinct (was 10)
```
Distinct count identical, but spot-checks on previously-flagged eyebrows (EARNINGS · OPTIONS PLAY) now route through `t-label` (which encodes `--tracking-label 0.12em`). Most surviving `tracking-[…]` are on numeric/Hero displays (`tracking-numeric-hi -0.02em` is documented). Most-visible offenders moved to tokens.

Downgrade: WARNING → MINOR.

---

### F8 — `leading-[NN]` arbitrary line-heights [WARNING, unchanged]

```bash
grep -rohE 'leading-\[[^\]]+\]' --include='*.tsx' | sort -u | wc -l  # 13 distinct (unchanged)
```
None match the four `--lh-*` tokens. Stale.

---

### F9 — Editorial column 780 px / ~98 ch [MINOR, unchanged]

`StaticArticle.tsx:45` still `max-w-[780px]`. No change.

---

### F10 — Two h2s on `/strategies` with mismatched typography [WARNING, unchanged]

`strategies/page.tsx:455` still: `<h2 className="mt-2 text-[18px] font-semibold leading-tight text-ink-1000">Scan what can trade…</h2>`. Sibling `<h2 className="t-h2">` (Active/Paused/Research) at L528, L944 — `--fs-h2 = 22 px`, weight 500. Two visually-different h2s. Verified in DOM:
```
<h2 class="mt-2 text-[18px] font-semibold ...">Scan what can trade…
<h2 class="t-h2">Active
<h2 class="t-h2">Paused
```
Trivial fix (demote subhead to `<h3 className="t-h3">`). Not done.

---

### F11 — NEW BLOCKER: `t-section-display` migration claimed but absent [BLOCKER]

The brief asserts BUG-10's PR-4 migrated 21 page-header sites to a new `t-section-display` class. Reality:
```bash
grep -rn 't-section-display'   frontend/src   # 0 hits
grep -rn '\--fs-section-display' frontend/src # 0 hits
```
Neither class nor token exists. The 21 page headers (DashboardPageLayout L78, dashboard control room, alerts/settings/pipeline/strategies/earnings) all still render with hand-rolled inline `text-[26px] font-semibold leading-[1.04] tracking-tight text-ink-1000 md:text-[32px]` — the same r1 pattern. Verified DOM:
```
<h1 ...class="mt-2 max-w-[18ch] break-words text-[26px] font-semibold leading-[1.04]
   tracking-tight text-ink-1000 md:max-w-none md:text-[32px]"...>Alerts &amp; triggers
```
identical signature on `/dashboard`, `/alerts`, `/settings`, `/pipeline`, `/strategies`, `/strategies/earnings-options-play`. The page-header redesign in the brief either rolled back or was never written. No consolidation; six identical `text-[26px] md:text-[32px]` strings to maintain.

**Fix:** create `t-section-display` against `--fs-section-display: clamp(26px, 2.4vw, 32px)` and migrate the 6+ page headers, or remove the claim from PR-4's description.

---

### F12 — NEW: PR-6a `text-h*` tokens shipped with no consumers [WARNING]

`globals.css:144-154` declares the `@theme inline` ladder (`--text-display-lg/md`, `--text-h1/h2/h3`, `--text-numeric-hero/lg/md`, `--text-body/body-sm`, `--text-label`). Adoption:
```bash
grep -rohE 'text-(display-lg|display-md|h1|h2|h3|numeric-hero|numeric-lg|numeric-md|body|body-sm|label)\b' --include='*.tsx' | sort | uniq -c
   3 text-label
   1 text-body
```
4 / 11 tokens have any consumer; 4 sites total. PR-6a foundation is dead-on-arrival without the codemod. An engineer reading `globals.css` sees a token; an engineer reading any page sees `text-[15px]`. Both can't be the source of truth.

**Fix:** ship the codemod that PR-6a was supposed to enable (BUG-19), or document `text-h*` as scheduled-for-later in `globals.css` so it doesn't read as the live API.

---

## Mono-vs-sans audit

Unchanged from r1. 178 of 216 raw `font-mono` sites lack `tabular-nums`. `.t-mono` correctly bakes in tabular figures; almost no site uses it.

## Long-form readability

Unchanged. 15 px / 1.65 in `EditorialP` is good; 780 px column still ~98 ch.

## Visual-regression manifest

`qa/visual/manifest.json` reports `fontSizeFailureCount: 0` across all sampled pages — 12 px runtime floor holds. Sub-12 px source values (F6) are getting clamped by cascade, not by token contract. Rescue-by-accident.

---

## What r1 → r2 changed (scoreboard)

| ID | r1 | r2 | Status |
|----|----|----|--------|
| F1 scale sprawl | BLOCKER | BLOCKER | unchanged — codemod deferred |
| F2 `--fs-display-section` 22-vs-13 | BLOCKER | RESOLVED | fixed (token deleted) |
| F3 `!text-[#hex]` on headings | WARNING | MINOR | partial (off heading classes) |
| F4 hierarchy on 3 routes | BLOCKER | RESOLVED | fixed; B1 + BUG-06 verified in DOM |
| F5 mono w/o tabular-nums | WARNING | WARNING | unchanged (82% still lack) |
| F6 sub-12 px source | WARNING | WARNING | regressed +6 sites |
| F7 tracking sprawl | WARNING | MINOR | improved (eyebrows on `t-label`) |
| F8 leading sprawl | WARNING | WARNING | unchanged |
| F9 780 px column | MINOR | MINOR | unchanged |
| F10 two h2s on `/strategies` | WARNING | WARNING | unchanged |
| F11 `t-section-display` phantom | NEW | BLOCKER | migration is a phantom |
| F12 `text-h*` tokens unused | NEW | WARNING | foundation w/o codemod |

Net: 4 BLOCKERS r1 → 2 BLOCKERS r2 (one real fix, one new finding).

## Top priority fixes (r2)

1. **Run BUG-19 codemod.** Replace every `text-[NNpx]` with `text-h*/text-body*/text-numeric*` or closest preset. Add the ESLint guard. This is the single change that flips 2 → 3.
2. **Either land or retract `t-section-display`.** 6+ page headers ship with duplicate inline strings; pick a class name, define it, migrate, delete the brief's stale claim.
3. **Make `tabular-nums` non-optional for live numbers.** Codemod `font-mono text-[NNpx]` on dollar/percent cells to `t-num-md/lg/xl`. 178 sites at risk.
4. **Lift sub-12 px source to floor.** 36 sites; mechanical change. Lock with the same ESLint guard.
5. **Resolve F10 + F8.** Demote `strategies:455` to `t-h3`; consolidate 13 arbitrary leadings to four `--lh-*` tokens.

## Files re-audited

- `frontend/src/styles/design-tokens.css` (L180-220, 357-440)
- `frontend/src/app/globals.css` (L22-175 `@theme inline`)
- `frontend/src/components/typography/{Display,Eyebrow,Mono,SectionRule,SerifEyebrow}.tsx`
- `frontend/src/components/layouts/DashboardPageLayout.tsx` (L77-78)
- `frontend/src/app/(dashboard)/{page,alerts/page,strategies/page,strategies/earnings-options-play/page,settings/page,pipeline/page,analytics/page,reports/page}.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/{HistoricalMoves,IVTermSkew,NewsFeed,HistoricalSetupReplay,EarningsCalendarSidebar,StrikeLadder,DetailHeader}.tsx`
- `qa/visual/manifest.json`
- `qa/runs/2026-05-04T13-45-11Z/{dashboard,alerts,strategies-list,strategies-earnings-options-play,settings,pipeline,docs,about,privacy,contact}/desktop-1440/{initial,bottom}.{dom.html,preview.png}`
