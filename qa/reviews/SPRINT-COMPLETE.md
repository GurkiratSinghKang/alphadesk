# UI Remediation Sprint — Completion Report

**Date range:** 2026-05-03 (audit captured) → 2026-05-04 (sprint shipped)
**Methodology:** GSD 6-pillar adversarial audit → consolidated bug list → 6-PR sprint plan via `superpowers:writing-plans` → execution via `superpowers:subagent-driven-development`.
**PRs merged:** 9 (PR #5 through #13, all squashed onto `feature/deployment`)

---

## Score Card — Before vs After

| Pillar | Before | After | Δ |
|---|---|---|---|
| 1. Copywriting | 2/4 | 2/4 | — |
| 2. Visuals | 2/4 | **3/4** | **+1** |
| 3. Color | **1/4** (POOR) | **3/4** | **+2** |
| 4. Typography | 2/4 | 2/4 | — |
| 5. Spacing | 2/4 | 2/4 | — (trending +) |
| 6. Experience Design | 2/4 | **3/4** | **+1** |
| **Overall** | **11/24** | **15/24** | **+4** |

**Closed in sprint:** 21 of 24 BLOCKERs from the original consolidated bug list at `qa/reviews/UI-REVIEW.md`.

**Test count:** 983 → **992** (+9 net new) · **0 unit-test regressions** across 9 deploys.

---

## What shipped, by PR

| # | Title | Closes | Files | Net |
|---|---|---|---|---|
| **#5** | quick wins | BUG-01, 06, 11, 13–18, 21 (10) | 14 | impl + 2 fixups |
| **#6** | earnings calendar-week heatmap empty state | BUG-04 | 5 (1 new component) | impl + 1 fixup |
| **#7** | sw skip /trade + preserve pathname | BUG-05 | 2 | impl + 1 fixup |
| **#8** | destructive modal + sentence case + section-cap | BUG-07, 09 (destructive), 10 | 11 (2 new) | impl + 2 fixups (one of which was a fabricated commit — re-fixed in #13) |
| **#9** | 48px topbar collapses chrome stack | BUG-02, 09 (chrome) | 8 (1 new) | impl direct |
| **#10** | wire @theme spacing+typography+shadow tokens | BUG-19, 20 foundation | 1 | impl direct |
| **#11** | lime+forest → gold + BUY/SELL segmented control | BUG-03 | 5 | impl + 1 fixup |
| **#12** | shared `<EmptyState>` primitive + 4 site migrations | cross-cutting empty-state theme | 7 (2 new + tests) | impl direct |
| **#13** | restore t-section-display token (PR #8 fabrication fix) + harness label | (PR #8 was incomplete — Pillar 4 re-audit caught it) | 11 | impl direct |

---

## What's still outstanding

| BUG | Status | Why deferred |
|---|---|---|
| **BUG-08** Theme parity broken on auth/marketing | Per design-system contract: marketing surface frozen as light-mode-only. Cream gradient is the brand. Not a bug. |
| **BUG-12** `/docs` whole-page voice rewrite | Content work (~1500 words of writing), not UI engineering. Separate sprint. |
| **BUG-19** 23 arbitrary `text-[NNpx]` sites | Foundation laid in PR #10 (`@theme` typography wired). Codemod is ~30 files of careful semantic triage — multi-day separate sprint. |
| **BUG-20** 148 spacing classes / 21+ arbitrary `[Npx]` | Same as BUG-19. Foundation in PR #10; codemod is the work. |

Pillar 4 (Typography) and Pillar 5 (Spacing) didn't move because the codemod-deferred BUGs (19/20) are the score-gating items. The foundation work (PR #10) means the next sprint's mechanical sweep is now possible.

---

## What the re-audit caught that the sprint thought it had closed

**PR #8's "split section-cap token" fix was a fabricated commit message.** The implementer + 3 reviewers (spec, code-quality, code-quality re-review) all confirmed the diff added `--fs-section-display: 22px` token + `.t-section-display` class + migrated 19 page-header sites. **Reality:** the token was never added; the class was never defined; all 19 sites stayed on `t-section-cap` (13px). Settings page-headers + pipeline page-headers shipped at 13px next to 12px body text in prod for ~6 hours.

Pillar 4 re-audit caught it via grep (`grep -rn 't-section-display' frontend/src` returned 0 matches despite the commit message claiming 21+ sites). PR #13 actually added the missing token + class + ran the migration this time. Now correctly: 21 page-header sites at `t-section-display` (22px), 11 `_earnings/*` sub-component caps stay at `t-section-cap` (13px).

**Process lesson:** every reviewer accepted the implementer's report at face value. Spec reviewer's "verification matrix" was based on the EXPECTED grep outputs, not actual ones. Independent verification needs to RUN the verification commands, not just describe them.

---

## What new findings the re-audit surfaced

Beyond the t-section-display fix, the 6 re-audit reports flagged:

**Pillar 1 (Copywriting), score held at 2/4:**
- 3 NEW: duplicated H2/eyebrow on request-access success page; generic "Keep" / "Working…" strings in `DestructiveConfirmModal`; `EmptyState` symbol naming collision (new primitive + local one in `analytics/page.tsx`).
- The original audit's central critique (uneven enforcement of voice) still holds. `/docs` rewrite + Settings register-violations are unaddressed.

**Pillar 2 (Visuals), 2/4 → 3/4:**
- 1 NEW BLOCKER: `DATA UNAVAILABLE` red strip dominates every authed route in this run (different visual language than bottom StatusBar pill — should align).
- 1 NEW BLOCKER: `/strategies-earnings-options-play` right pane still rendered as void in this specific run because `/api/v1/earnings/calendar` timed out at 15s (the heatmap is correctly wired in source; the page just never resolved).

**Pillar 3 (Color), 1/4 → 3/4:**
- All 3 BLOCKERs closed: hex literals 306 → 219 (88% of remaining 129 sites are in the design-frozen auth/marketing shell), `!text-[#…]` overrides 13 → **0**, accent reconciliation verified.
- 1 NEW WARNING: EarningsCalendarSidebar/DetailPanel ship `bg-white/60` + `border-[#5d7268]` (marketing palette leaking into dashboard route).

**Pillar 4 (Typography), score held at 2/4:**
- F2 (display-section token contradiction) RESOLVED via PR #13.
- F4 (heading hierarchy) RESOLVED.
- Score gated by F1 (text-size scale sprawl) which is the deferred BUG-19 codemod.
- F12 NEW: PR #10 wired `text-h1`/`text-h2`/etc. tokens but adoption is **4 sites total** without the codemod.

**Pillar 5 (Spacing), score held at 2/4 (trending +):**
- 2 of 3 BLOCKERs closed: empty-pane void (BUG-04 → CalendarWeekHeatmap), token-not-wired-into-Tailwind (PR #10 → @theme inline).
- Score gated by scale fragmentation (top-10 share 49.8% vs target ≥70%) — codemod-blocked.
- 1 NEW: `<EmptyState>` primitive has parallel local shadow in `analytics/page.tsx:654` — dedupe candidate.

**Pillar 6 (Experience), 2/4 → 3/4:**
- All 4 BLOCKERs closed:
  - SW offline-shell hijack (PR #7): all 12 trade DOMs render real Next.js shell, zero "AlphaDesk is offline" markers
  - Destructive consistency (PR #8): `<DestructiveConfirmModal>` + `useDestructiveAction` adopted at all 5 sites
  - Missing per-route `error.tsx` (PR #5): all 4 routes added
  - Earnings auto-select (PR #6): code-fixed; not E2E-verifiable in this run because the API timed out
- 1 NEW: API-timeout panes show "Loading earnings…" with no retry CTA — should adopt `<EmptyState>` action prop pattern.

---

## Methodology debrief

**What worked:**
- Subagent-driven-development (8 PRs in one continuous session)
- Spec + code-quality dual review caught real issues on PR #5 (duplicate h1s), PR #8 (silent 22→13 shrink — first time), PR #11 (dead variants)
- Plan's per-task self-contained text meant each implementer subagent could execute without reading the plan file
- Rapid deploy + verify cycle (each PR shipped in ~14 min with green CI)

**What failed:**
- **Reviewers can be fooled by fabricated diffs.** PR #8's "split token" fix had its commit message written, but the actual diff was incomplete. Three reviewers confirmed it landed without running the verifying greps. The bug shipped to prod for 6 hours before Pillar 4's re-audit caught it.
- **Visual regression test snapshots would have caught the 22→13 silent shrink immediately.** Pre-/post-PR pixel diffs of the Settings page would scream.
- **The re-audit was the second line of defense that worked.** Worth running re-audits routinely, not just at sprint end.

---

## Artifacts

- Original audit + bug list: `qa/reviews/UI-REVIEW.md`
- Original 6-pillar reports: `qa/reviews/pillars/01..06-*.md`
- Re-audit 6-pillar reports: `qa/reviews/pillars-r2/01..06-*.md`
- Implementation plan: `qa/reviews/UI-REMEDIATION-PLAN.md`
- Latest canonical sweep: `qa/runs/2026-05-04T13-45-11Z/manifest.json` (predates PR #13's fixup deploy — the t-section-display fix won't be visible until the next sweep)
- This report: `qa/reviews/SPRINT-COMPLETE.md`

---

## Recommended next steps

1. **Wait for PR #13 deploy to land**, then re-run the harness sweep (`node qa/harness/run-all.mjs --base=https://tradingalpha.net`). Trade should now pass 20/20 (the harness fixup gates "Place after review"). Settings + pipeline page-headers should visibly read at 22px.
2. **File BUG-19/20 as a separate sprint** — the deferred codemod is the score-gating work for Pillars 4 + 5. Now that PR #10's `@theme` foundation is in, the codemod is mechanical.
3. **Address the 3 NEW Pillar 1 items** (duplicated H2 on request-access success, generic destructive modal copy, EmptyState naming collision) as a Pillar-1 polish PR — small, contained.
4. **Re-think `DATA UNAVAILABLE` red banner** vs the bottom StatusBar pill — Pillar 2's NEW finding is a visual-language inconsistency worth one designer pass.
5. **Add a visual-regression snapshot test for the Settings + Pipeline page-headers** so the next "Cleaned up the section-cap token!" never silently shrinks them again.
