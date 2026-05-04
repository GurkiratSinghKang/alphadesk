# UI Remediation Sprint — Round 2 Completion Report

**Date:** 2026-05-04 (continuous follow-on from R1)
**Methodology:** Same as R1 — subagent-driven-development with spec + code review per PR
**PRs merged:** 5 (PR #14, #15, #16, #17 — note R2-1 + R2-4 ended up bundled in #14 due to a parallel-agent working-tree collision)

---

## What R2 closed

| ID | Title | Closes | Status |
|---|---|---|---|
| **R2-1** | Typography codemod (987 sites) | BUG-19 bulk | shipped (PR #14) |
| **R2-2** | Spacing codemod (15 token-equivalent migrations) | BUG-20 bulk | shipped (PR #15) |
| **R2-3** | ESLint guards (4 `no-restricted-syntax` rules) | locks BUG-19/20 prevention | shipped (PR #16) |
| **R2-4** | 6 NEW-findings sweep | DestructiveConfirmModal copy, request-access duplicate H2, EmptyState naming, EarningsCalendarSidebar palette leak, WsStatusBanner alignment, Earnings retry CTA | shipped (PR #14, bundled with R2-1) |
| **R2-5** | Visual regression baselines + README | Process safety against future silent visual regressions | shipped (PR #17) |

**Cumulative across R1 + R2:** 14 PRs merged total. Post-R1 BLOCKER count: 3 remaining (BUG-08 deferred per design contract; BUG-12 content work; BUG-19/20 codemod-blocked → now CLOSED in R2).

---

## What didn't go as planned

### Parallel-implementer working-tree collision (process bug)

Dispatched R2-1 (typography codemod) and R2-4 (NEW-findings sweep) as parallel implementer subagents on separate branches. Subagents in the same Claude Code session **share the working tree** — R2-1's commit landed on R2-4's branch when R2-4's `git checkout -b` ran. Untangle effort: bundled both into a single PR (#14) since the changes were independent (sed across 127 files vs surgical edits to 5-6 files).

**Lesson:** parallel implementer subagents need either (a) sequencing, (b) git worktrees, or (c) per-agent shell isolation. Future rounds: sequence implementers strictly OR use `superpowers:using-git-worktrees`.

### R2-2 was smaller than the audit projected

Audit said 21+ arbitrary spacing sites + a long tail of 148 distinct classes. Codemod found that **most arbitrary spacing carries design intent** (`min-h-[44px]` × 26 for tap targets, `h-[260px]`/`h-[280px]`/`h-[320px]` for chart heights, `min-w-[90px]` for radio widths, `max-w-[640px]` for editorial reading column). Only 15 sites had token-equivalent values worth migrating.

**Lesson:** "148 distinct classes" sounds like a fragmentation crisis but is mostly legitimate component-context use. The score-gating issue isn't escape-volume but specifically `gap-[12px]` style escapes when `gap-3` is wired — that's now banned by R2-3's ESLint rule.

---

## Score projection (re-audit pending)

R2 didn't change visual rendering meaningfully (the codemods are pure substitution; the 6 NEW-findings fixes are surgical). Expected pillar score deltas vs R1's 15/24:

| Pillar | R1 → projected R2 | Why |
|---|---|---|
| 1. Copywriting | 2/4 → **3/4** | R2-4 closed 3 NEW findings (Keep/Working…, request-access duplicate H2, EmptyState naming) — Pillar 1's central critique was "uneven enforcement" and these were 3 of the audit's specific NEW findings. The `/docs` rewrite + Settings register-violations remain unaddressed (judgment-required content work). |
| 2. Visuals | 3/4 → 3/4 | R2-4 toned down WsStatusBanner (Pillar 2 NEW finding closed). No score change since pillar already at 3/4. |
| 3. Color | 3/4 → 3/4 | R2-4 closed EarningsCalendarSidebar palette leak (Pillar 3 NEW finding). No score change since pillar already at 3/4; `--amber-500` overload still outstanding. |
| 4. Typography | 2/4 → **3/4** | R2-1 codemod migrated 987 sites to wired tokens (was 4 sites of adoption pre-R2). R2-3 lint guard prevents regression. F1 BLOCKER from re-audit is now closed in spirit. |
| 5. Spacing | 2/4 → **3/4** | R2-2 + R2-3: token-equivalent escapes are now zero AND prevented by lint. Top-10 share 49.8% concern is a design-intent characteristic, not a fragmentation bug. |
| 6. Experience | 3/4 → 3/4 | R2-4 closed API-timeout retry CTA (Pillar 6 NEW finding). No score change. |
| **Overall** | **15/24** → **projected 17–19/24** | |

A re-audit (run 6 parallel pillar agents against the new canonical sweep) would confirm. Worth doing once PR #15, #16, #17 deploys land.

---

## What's still outstanding (cumulative, post-R2)

| BUG | Status |
|---|---|
| **BUG-08** Theme parity on auth/marketing | Deferred per design-system contract — marketing is light-mode-only |
| **BUG-12** `/docs` whole-page voice rewrite | Content work; separate sprint |
| ~~BUG-19/20~~ | **closed** in R2-1 + R2-2 (bulk codemod) + R2-3 (regression prevention) |

Plus several deferred-from-codemod items in R2-1/R2-2:
- 86 deferred typography sites (sub-12px floor + non-token sizes 14/18/24/26/32/etc) — needs scale extension or judgment swap
- ~95 deferred spacing sites (component-intentional `min-h-[44px]`, `h-[260px]`, etc.) — these are NOT bugs

---

## Process improvements landed in R2

1. **R2-3 ESLint guards**: bans `text-[(12|13|15|16|17|20|22|28|48)px]` and the 13 token-equivalent spacing escapes via `no-restricted-syntax`. Applies to both `Literal` and `TemplateElement` AST nodes (covers `cn()` template-literal class construction).
2. **R2-5 visual regression baselines**: 23 PNGs committed at `qa/visual/baseline/`. README documents how to run + when to refresh. Suggested deploy-workflow integration in README (non-blocking until baselines stabilize, then promote to hard gate).
3. **R2-5 visual-regression.mjs tolerant `goto`**: long-poll routes (`/strategies/momentum-quality` SSE) no longer 30s-timeout the script.

---

## Suggested next steps

1. **Wait for PR #15 + #16 deploys** to complete (~15 min), then re-run the 6 pillar agents to confirm the projected 17–19/24 score.
2. **Add visual-regression to deploy workflow** as `continue-on-error: true` for 1-2 weeks; then promote to hard gate. Snippet in `qa/visual/README.md`.
3. **File BUG-12 (`/docs` voice rewrite) as a content sprint** — needs writer, not engineer.
4. **86 deferred typography sites + 95 deferred spacing sites**: these are mostly intentional. A separate semantic-triage pass could either add new tokens to the scale (e.g. `text-[14px]` → new `--text-body-md` token) or accept them as design-intentional component-context arbitrary values.

---

## Cumulative R1 + R2 stats

- **14 PRs merged** (PR #5 through #17)
- **20+ BLOCKERs closed** out of 24 from the original audit
- **Test count grew** 983 → 992 (+9 net new) · **0 unit-test regressions** across 14 deploys
- **One critical real-prod regression caught + fixed** (PR #8's fabricated section-cap fix → caught by post-sprint Pillar 4 re-audit → fixed in PR #13)
- **Visual regression infrastructure** now in place to catch the next "I cleaned up the token!" silently

---

## Artifacts

- Original audit: `qa/reviews/UI-REVIEW.md`
- R1 completion: `qa/reviews/SPRINT-COMPLETE.md`
- R1 pillar reports: `qa/reviews/pillars/01..06-*.md`
- R1 re-audit: `qa/reviews/pillars-r2/01..06-*.md`
- R2 completion (this file): `qa/reviews/SPRINT-R2-COMPLETE.md`
- Visual baselines: `qa/visual/baseline/`
- ESLint guards: `frontend/eslint.config.mjs:18-46`
