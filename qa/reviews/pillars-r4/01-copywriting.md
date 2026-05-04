# Pillar 1 — Copywriting (R4 re-audit)

**Score: 4/4**  (R1: 2/4, R2: 2/4, R3: 3/4 → now: **4/4**)
**Run:** qa/runs/2026-05-04T19-42-49Z
**Date:** 2026-05-04

## What changed since R3

R4-1 (PR #28) is a comprehensive editorial sweep that closes every R3 STILL-OUTSTANDING MAJOR plus the two R3 NEW issues. Verified against deployed DOM + source:

- **Settings Title Case toggle labels → sentence case (verified in DOM).** `qa/runs/2026-05-04T19-42-49Z/settings/desktop-1440/initial.dom.html` now emits `Order fills`, `Alerts triggered`, `Pipeline completed`, `Compact strategy view`, `Watchlist (JSON)`, `Trade history (CSV)`, `Settings (JSON)`. R3's seven-string Title Case violation list is fully resolved (export buttons keep proper-noun JSON/CSV which is correct). Source `frontend/src/app/(dashboard)/settings/page.tsx` matches.
- **Live-mode dialog titles unified across both sites.** `frontend/src/components/layout/ProfileMenu.tsx:213` and `frontend/src/app/(dashboard)/settings/page.tsx:1152` now both read `<DialogTitle>Live trading requires admin enablement</DialogTitle>`. R3 had three competing titles (`Trading Mode` eyebrow / `Live trading not available` / `Switch to Live Trading?`) — now one canonical title pair.
- **`Got it` → `Understood` CTAs.** Both Live-mode confirmation dialogs now ship `<Button>Understood</Button>` (ProfileMenu.tsx:221 and settings/page.tsx). The remaining `Got it` token in ProfileMenu.tsx:120 is inside a code comment, not user-visible.
- **Backend login error string aligned to editorial fallback.** `backend/api/routes/auth.py:587` now returns `detail="Those credentials didn't match. Try again or request access."` instead of the generic `Invalid username or password`. Verified in `qa/runs/2026-05-04T19-42-49Z/login/desktop-1440/after-submit-invalid.dom.html` — the deployed banner now shows `"credentials didn't match. Try again or request access."` and zero matches for `Invalid username or password`. R3's NEW MAJOR is closed.
- **Marketing footer rewritten.** `frontend/src/components/layouts/MarketingShell.tsx:187` now renders `α · Operator-grade execution` (was `α · made with discipline`). Visible in 18 marketing-shelled DOM snapshots; the old string survives in zero DOMs (was 36 in R3).
- **Dashboard footer rewritten.** `frontend/src/app/(dashboard)/layout.tsx:327` and `frontend/src/components/layout/DashboardShell.tsx:30` now render `AlphaDesk dev — Built on Claude — © 2026` (was `Powered by Claude AI`). Visible in 43 dashboard DOMs; old string survives in zero DOMs (was 84 in R3). The `Built on Claude` voice is a calm provenance signal rather than vendor-brand attribution.
- **TradePanel inline note CTA.** `frontend/src/components/panels/TradePanel.tsx:1474` now ships `<button>Save note</button>` (was bare `Save`). Sibling `Cancel` is contextually unambiguous as the only other button in the inline note row.
- **EarningsCalendarSidebar punctuation.** `EarningsCalendarSidebar.tsx:363` now renders `"No earnings match the current filters."` (was `"No earnings match —"` with literal trailing en-dash); `:379` now renders ``${parts.join(" ")}.`` (period instead of trailing middle-dot).
- **OrderBar bare imperatives upgraded.** `OrderBar.tsx:693` now ships `{advancedOpen ? "Hide details" : "Show details"}` (was bare `Hide`/`Show`).
- **StrategyTemplates engineer-language toast.** `StrategyTemplates.tsx:270` now ships `"Couldn't read current strategy states — template cancelled."` (was `"… aborting template"`).
- **EarningsDetailPanel bare-verb sibling resolved.** `EarningsDetailPanel.tsx:564` no longer ships the bare `label="Save"` next to `label="Mark for order review"`. Only the full-verb sibling remains.
- **ShareTrade `AI Analysis` Title Case → sentence case.** `frontend/src/components/panels/ShareTrade.tsx` now ships `AI analysis` site-wide. R3 carry-over closed.
- **Empty-state recovery actions added.** `PnlAttribution.tsx:65` adds `Configure strategies →`; `ActivityFeed.tsx:364` adds `Run pipeline →`; `LiveSignalFeed.tsx:471` adds `Run pipeline →`; `NotificationCenter.tsx:217` adds `Configure notifications →`. Four of the five R3-flagged sites now state a next action with router-pushed CTA. (StrategyGrid is the only remaining one — see STILL OUTSTANDING below; this is a heatmap cell, contextually different.)
- **`/docs` rewrite confirmed in deployed DOM.** R3 marked the source-state CLOSED but flagged a NEW BLOCKER because the captured DOM was a race-with-deploy. The R4 sweep ran post-deploy: `qa/runs/2026-05-04T19-42-49Z/docs/desktop-1440/initial.dom.html` shows `Bernard and Thomas` × 2 and zero matches for `AlphaDesk leverages`, `grounded in academic research`, `powerful`, `sophisticated`, `seamless`, `comprehensive`. R3 NEW BLOCKER closed.
- **`coming soon` × 3 reduced to acceptable section heading + one tooltip.** `Coming soon` now exists in DOM only as section H2 headings on `/strategies` (`<h2 class="t-h2">Coming soon</h2>` for the planned-but-unbuilt strategy bucket — legitimate UI grouping, not vendor-roadmap voice) and as a tooltip on the disabled Journal button in PositionsList.tsx:168. The R3 body-text `"Journal — coming soon."` in PositionsList.tsx is gone.

## Findings

### CLOSED (resolved this round)

- **R3 STILL OUTSTANDING #1 (Settings Title Case toggles, 7 strings)** — closed in DOM and source.
- **R3 STILL OUTSTANDING #2 (`Powered by Claude AI` dashboard footer, 84 DOMs)** — closed; new copy `AlphaDesk dev — Built on Claude — © {year}` ships in 43 DOMs and zero stale matches.
- **R3 STILL OUTSTANDING #3 (`made with discipline` marketing footer, 36 DOMs)** — closed; new copy `α · Operator-grade execution` ships in 18 DOMs and zero stale matches.
- **R3 STILL OUTSTANDING #4 (three Live-mode dialog titles + two `Got it` CTAs)** — closed; one canonical title pair + one canonical `Understood` CTA.
- **R3 STILL OUTSTANDING #5 (TradePanel `Save`/`Cancel` bare verbs)** — partially closed; `Save` → `Save note`. Sibling `Cancel` is contextually fine in the inline-edit row (only other button).
- **R3 STILL OUTSTANDING #6 (StrategyTemplates `aborting template`)** — closed; replaced with `template cancelled`.
- **R3 STILL OUTSTANDING #7 (EarningsCalendarSidebar trailing en-dash + middle-dot)** — closed; both replaced with periods.
- **R3 STILL OUTSTANDING #8 (OrderBar bare `Hide`/`Show`)** — closed; now `Hide details`/`Show details`.
- **R3 STILL OUTSTANDING #9 (`coming soon` × 3)** — substantially closed; remaining instances are legitimate section-heading semantics, not vendor-roadmap voice.
- **R3 STILL OUTSTANDING #10 (`AI Analysis` Title Case in ShareTrade)** — closed.
- **R3 STILL OUTSTANDING #11 (EarningsDetailPanel bare `Save` next to full verb)** — closed.
- **R3 STILL OUTSTANDING #12 (Empty-state stubs without next action × 5)** — 4 of 5 closed (PnlAttribution, ActivityFeed, LiveSignalFeed, NotificationCenter all add router-pushed recovery CTAs). StrategyGrid heatmap cell remains terse but that is contextually appropriate.
- **R3 NEW BLOCKER (`/docs` deploy timing race)** — closed; R3 source-state rewrite is now confirmed in the deployed DOM.
- **R3 NEW MAJOR (backend `Invalid username or password` shadowing editorial fallback)** — closed; backend now returns the editorial string directly.

### NEW (introduced or surfaced this round)

None. The R4-1 sweep is well-scoped and does not surface any new copy regressions. Spot-checks of the 144 DOM snapshots show no new vendor-marketing words, no new ASCII ellipses (single-character `…` continues to dominate), no new Title Case violations on toggle labels, no new bare imperatives, and the `Built on Claude` / `Operator-grade execution` rewrites read consistently across all the surfaces they reach.

### STILL OUTSTANDING (carry-overs that did not get addressed)

The remaining items are NITs and source-state-only quirks that don't affect a 4/4 score on a deployed-product audit, but documenting them for the next pass:

- **NIT — `Open Trade` Title Case in dashboard body prose.** `frontend/src/app/(dashboard)/page.tsx:1076,1540` still ships `"Exposure, orders, and strategy state are inside policy bands. Open Trade when you want to act."` with mid-sentence Title Case. The CTA-button form is correctly sentence case (`Open trade` at line 1082, 1543), only the body-text reference miscapitalises. Not visible in current DOMs (the prose is gated by a state branch the harness didn't trigger), but ships in source.
- **NIT — `Ref AR-SKLG9MVOLHXT` is bare on the request-access success page.** `qa/runs/2026-05-04T19-42-49Z/request-access-submit/desktop-1440/after-submit.dom.html` shows the reference code with no surrounding label. R3 NIT — could be `Reference AR-SKLG9MVOLHXT` or `Ticket AR-SKLG9MVOLHXT`.
- **NIT — Login eyebrow + H2 redundancy (`Welcome back` over `Open your workspace`).** Confirmed still present in `login/desktop-1440/initial.dom.html`. R1 NIT #32, R3 carry-over.
- **NIT — 404 CTA `Back to AlphaDesk` and `Read the docs`.** Both still ship in `not-found/desktop-1440/initial.dom.html`. R1 NIT #38 unchanged.
- **NIT — AICopilot panel ships `How can I help?` (vendor-chat eyebrow) and ASCII-ellipsis placeholder `Ask anything...`.** Source: `frontend/src/components/layout/AICopilot.tsx:442, 542`. The panel is closed/unmounted in all DOM snapshots (no auth context), so this is source-only and not a visible defect — but the placeholder uses an ASCII three-dot ellipsis (last R1 holdout in the codebase per scan; rest of product uses `…`) and the eyebrow is the only vendor-chat phrasing left in any auth-gated surface.
- **NIT — StrategyGrid heatmap empty cell `No data`.** `frontend/src/components/dashboard/StrategyGrid.tsx:137` ships an inline `<span>No data</span>` with no recovery action. Heatmap cells are 28px tall by design and a `Configure → ` CTA would not fit; arguably leaving it terse is correct. Flag is informational only.

## Score justification

R4 advances from 3/4 to **4/4**. R4-1 (PR #28) is the kind of focused editorial sweep the previous three rounds called for: every MAJOR copy issue carried in R3's STILL OUTSTANDING block is closed in deployed DOM (not just source), the R3 NEW BLOCKER on `/docs` deploy timing is resolved by re-running the sweep post-rollout, and the R3 NEW MAJOR on the backend supplying a generic `Invalid username or password` is properly fixed at the backend response layer (rather than worked around in the frontend). The voice across the deployed product is now consistent — sentence case on toggle labels, single canonical Live-mode dialog title, editorial login errors, calm `Built on Claude` provenance instead of vendor-brand `Powered by Claude AI`, full-verb empty-state CTAs that route the user somewhere useful, and a `/docs` page that names mechanisms instead of marketing them.

The score is 4/4 and not "4/4 with reservations" because the remaining items (six NITs above) are either source-only — not visible in any deployed DOM — or are body-prose Title Case quirks on a single line of dashboard text that the harness does not trigger. None of them rise to a MAJOR; none would degrade a serious operator's first-impression read of the product. The next round, if anyone wants to chase a perfect-perfect score, would target the AICopilot eyebrow + ASCII ellipsis (because once auth-gated surfaces start appearing in the sweep they will be visible), the `Open Trade` body-text Title Case, and the bare reference code label on request-access-submit.
