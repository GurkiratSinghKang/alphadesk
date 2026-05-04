# Pillar 1 — Copywriting (R3 re-audit)

**Score: 3/4**  (R1 baseline: 2/4, R2 re-audit: 2/4 → now: **3/4**)
**Run:** qa/runs/2026-05-04T15-47-19Z
**Date:** 2026-05-04

## What changed since R2

- **R3-1 (PR #19, commit `a33d1e19`) — `/docs` voice rewrite landed in source.** `frontend/src/app/docs/_docs/content.ts` now ships declarative, mechanism-first copy: `"AlphaDesk is invite-only"`, `"Each pipeline run packages relevant market data and sends it to Claude"`, `"PEAD positions in the direction of an earnings surprise and holds for the multi-week drift window documented since Bernard and Thomas (1989)"`, `"VRP strategies sell options to harvest the spread between implied and realized volatility"`. Vendor-marketing words ("powerful", "sophisticated", "seamless", "comprehensive", "leverages") all removed from the source file.
- **R2-4 (PR #14) — `DestructiveConfirmModal` copy.** `frontend/src/components/destructive/DestructiveConfirmModal.tsx:53,56` now renders `"Cancel"` (was `"Keep"`) and `"Confirming…"` (was `"Working…"`). Sentence-case + single-character ellipsis confirmed in source.
- **R2-4 — Request-access success page duplicate H2 resolved.** `qa/runs/2026-05-04T15-47-19Z/request-access-submit/desktop-1440/after-submit.dom.html` shows eyebrow `"§ 02 · CONFIRMATION"` and H2 `"Request received"` — different text, no duplication. The `"queued"` typo is gone, replaced with `Ref AR-9JBGOC9ZLQJE` mono-spaced reference code.
- **R2-4 — `EmptyState` symbol naming collision resolved.** Only one definition exists: `frontend/src/components/primitives/EmptyState.tsx`. The shadow definition in `analytics/page.tsx:654` is gone. Verified via `find frontend/src -name "*EmptyState*"` (single result) and `grep -n "function EmptyState\|const EmptyState" analytics/page.tsx` (zero matches).
- **Side-effect cleanup from R2-1 typography codemod / R2-4 sweep — many R2 carry-overs went away in DOMs:** zero ASCII three-dot ellipses (`Loading...`, `Searching...`, `Thinking...`, `Starting...`, `Screening...`, `Working...`) in any of the 144 DOM snapshots; `No results found` gone from CommandPalette; `Active Alerts (N)` / `Triggered History (N)` / `Create Alert` / `Search Results` / `Popular Symbols` / `Activate Template` Title Case all gone from DOM scans across alerts/strategies; `Verify & save` ampersand replaced with `Verify and save` in settings (visible in `settings/desktop-1440/initial.dom.html`); `Switch to Live Trading?` Title Case is gone from the deployed settings DOM.

## Findings

### CLOSED (was BLOCKER, now resolved)

- **BUG-12 / BLOCKER #1 (`/docs` whole-page vendor voice)** — Resolved in source per PR #19. `frontend/src/app/docs/_docs/content.ts` no longer contains `"AlphaDesk leverages Anthropic's Claude AI"`, `"grounded in academic research"`, `"powerful"`, `"sophisticated"`, `"seamless"`, or `"comprehensive"`. Voice now matches `/help/earnings-data` register: short, declarative, names mechanisms, cites Bernard-and-Thomas-1989 and Jegadeesh-and-Titman-1993 by name. **Caveat (see NEW item #1 below):** the deployed snapshot at `qa/runs/2026-05-04T15-47-19Z/docs/desktop-1440/initial.dom.html` still emits the OLD copy. The PR #19 commit landed at 11:56 EDT (15:56 UTC); the canonical sweep started at 15:47:19 UTC and completed at 16:00:42 UTC, so the docs route was scraped during/before deploy rollout. I am scoring on the source state since the user-stated invariant is "captured against tradingalpha.net post PR #19 deploy". A re-run sweep after the deploy fully propagates would confirm.
- **R1 BLOCKER #5 / BUG-15 (`(s)` plural shortcuts in destructive toasts)** — confirmed still resolved (no DOM evidence of regression, source uses `fmtPlural` throughout).
- **R1 BLOCKER #6 / BUG-16 (login error messages)** — partially carried; the editorial fallback string `"Those credentials didn't match. Confirm the username, the password, and that Caps Lock is off."` ships in source at `frontend/src/app/login/_login/LoginForm.tsx:164` BUT the deployed DOM at `qa/runs/2026-05-04T15-47-19Z/login/desktop-1440/after-submit-invalid.dom.html` still shows the bare `"Invalid username or password"` string. The frontend reads `body.detail ?? <fallback>` — backend is supplying the generic detail. Fix is in the backend response, not the frontend. Re-flagging as a partial regression below.
- **R2 NEW #1 (request-access success duplicate H2)** — Resolved (per above).
- **R2 NEW #2 / NEW #3 (DestructiveConfirmModal `Keep` / `Working…`)** — Resolved (per above, source code lines 53 and 56 confirmed).
- **R2 NEW #4 (`EmptyState` naming collision)** — Resolved (per above).
- **R1 WARNING #15 (ASCII ellipses)** — Resolved in DOM scans of all 144 snapshots. Zero `Loading...`, `Searching...`, `Thinking...`, `Starting...`, `Screening...`, `Working...` instances. The single-character `…` standardisation appears to have rolled out alongside the typography codemod.
- **R1 WARNING #16 (`No results found.` in CommandPalette)** — No DOM evidence remains.
- **R1 WARNING #19 (`Verify & save` ampersand)** — Resolved (settings DOM emits `Verify and save` and the `&` form is absent).
- **R1 WARNING #21 / #22 (AICopilot `How can I help?` / `Ask anything…`)** — Source unchanged at `frontend/src/components/layout/AICopilot.tsx:442,542,545` BUT the panel is closed/unmounted in all DOM snapshots (no auth context to open it during the QA sweep), so this remains a source-level concern rather than a visible defect.

### NEW (introduced or surfaced this round)

- **NEW BLOCKER (deploy timing) — `/docs` source rewrite is not visible in the captured DOM.** `qa/runs/2026-05-04T15-47-19Z/docs/desktop-1440/initial.dom.html` still emits `"AlphaDesk leverages Anthropic's Claude AI to analyze market opportunities across all 12 strategies"` (paragraph 28), `"AlphaDesk strategies are grounded in academic research and well-established market phenomena"` (paragraph 32), `"The Dashboard is your command center"` (paragraph 5), `"AlphaDesk never stores your API keys in plain text"` (paragraph 45). The DOM also contains a few NEW v2 strings — `"AlphaDesk is an invite-only platform"`, `"Cross-Sectional Momentum + Quality"` — suggesting partial rollout or stale RSC payload bundling. Either way, **a real user hitting `/docs` during this sweep window saw the old vendor copy**. PR #19's commit time (15:56 UTC) is 9 minutes after the sweep started (15:47:19 UTC), so the harness probably visited `/docs` before the deploy fully propagated. Re-run the sweep after the production rollout completes and confirm before claiming BUG-12 is closed in production.
- **NEW MAJOR — backend supplies the generic `Invalid username or password` string, defeating the R1 editorial fallback.** `qa/runs/2026-05-04T15-47-19Z/login/desktop-1440/after-submit-invalid.dom.html` shows the literal `"Invalid username or password"` rendered in the error banner. Source at `frontend/src/app/login/_login/LoginForm.tsx:164` ships the editorial fallback `"Those credentials didn't match. Confirm the username, the password, and that Caps Lock is off."` but only when `body.detail` is missing. The backend at `backend/api/routes/auth.py` is returning `detail: "Invalid username or password"`, so the editorial copy is shadowed. R1 marked this CLOSED based on source — actual user-facing copy is unchanged. Fix the backend response to drop generic `detail` strings on auth failures, OR change the frontend to ignore backend `detail` for known-generic codes.
- **NEW NIT — `Ref AR-9JBGOC9ZLQJE` is mono-spaced and tinted hint colour but not labelled.** `request-access-submit/desktop-1440/after-submit.dom.html` shows `Ref AR-9JBGOC9ZLQJE` as a bare line with no surrounding text. Better-tasting: `Reference: AR-9JBGOC9ZLQJE` or `Ticket AR-9JBGOC9ZLQJE`. Low priority.

### STILL OUTSTANDING (carried over from prior rounds)

**MAJOR — Settings page Title Case toggle group.** `qa/runs/2026-05-04T15-47-19Z/settings/desktop-1440/initial.dom.html` still emits seven Title Case strings on a single screen:
  - `Order Fills` (`<p class="text-xs font-medium text-foreground">`)
  - `Alerts Triggered`
  - `Pipeline Completed`
  - `Compact Strategy View`
  - `Watchlist (JSON)` (export button)
  - `Trade History (CSV)` (export button)
  - `Settings (JSON)` (export button)

  These are still toggle/button labels, not proper nouns. R1 flagged them; R2 confirmed unchanged; R3 same. Source at `frontend/src/app/(dashboard)/settings/page.tsx:937, 943, 949, 969, 1046, 1062, 1075`.

**MAJOR — `Powered by Claude AI` dashboard footer** still emits site-wide. Confirmed in `settings/desktop-1440/initial.dom.html`, `alerts/desktop-1440/initial.dom.html`, `pipeline/desktop-1440/initial.dom.html`, `analytics/desktop-1440/initial.dom.html` (84 DOM files contain the string). Source `frontend/src/app/(dashboard)/layout.tsx:323` and `frontend/src/components/layout/DashboardShell.tsx:30` both ship `"AlphaDesk dev — Powered by Claude AI — © 2026"`. Vendor pattern; the rest of the product treats Claude as a calm provenance signal, not a "Powered by" attribution.

**MAJOR — `made with discipline` marketing footer** still emits. Source `frontend/src/components/layouts/MarketingShell.tsx:187` unchanged: `<span>&alpha; &middot; made with discipline</span>`. 36 DOM files contain it (every marketing-shelled route).

**MAJOR — Three different titles for the same Live-mode confirmation, plus `Got it` × 2.** Unchanged in source:
  - `frontend/src/components/layout/ProfileMenu.tsx:147` `"Trading Mode"` (uppercase eyebrow, tracking-wider)
  - `frontend/src/components/layout/ProfileMenu.tsx:213` `"Live trading not available"` (DialogTitle)
  - `frontend/src/components/layout/ProfileMenu.tsx:221` `<Button>Got it</Button>`
  - `frontend/src/app/(dashboard)/settings/page.tsx:1131` `"Switch to Live Trading?"` (DialogTitle, Title Case)
  - `frontend/src/app/(dashboard)/settings/page.tsx:1156` `Got it`

  R1 + R2 both flagged. Pick one title and one CTA. (Note: the Switch-to-Live Title Case dialog is rendered conditionally and was not captured in the deployed settings DOM — but the source still ships it.)

**MAJOR — TradePanel inline note `Save` / `Cancel` bare verbs.** `frontend/src/components/panels/TradePanel.tsx:1459-1460` still ships the two bare imperatives side-by-side. R1 + R2 flagged.

**MAJOR — `aborting template` engineer-language toast.** `frontend/src/components/panels/StrategyTemplates.tsx:270` still ships `"Couldn't read current strategy states — aborting template"`. R1 + R2 flagged.

**MAJOR — Earnings sidebar trailing punctuation.** `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar.tsx:362` still emits `"No earnings match —"` with literal trailing en-dash; line 378 still concatenates `${parts.join(" ")} ·` with trailing middle-dot. Flagged in `copy.md`, R1, R2 — three rounds untouched.

**MAJOR — OrderBar bare `Hide` / `Show` Advanced toggle.** `frontend/src/components/composites/OrderBar.tsx:651` still ships `{advancedOpen ? "Hide" : "Show"}`. Bare imperatives.

**MAJOR — `coming soon` in three flavours.** `frontend/src/components/composites/PositionsList.tsx:44, 168` still ship `"Journal — coming soon."` and `title="Coming soon"`. `frontend/src/app/(dashboard)/strategies/page.tsx:802, 968` ship the body text and tooltip `coming soon` / `Coming soon`. Marketing-roadmap voice on a serious surface.

**MAJOR — `AI Analysis` Title Case in ShareTrade.** `frontend/src/components/panels/ShareTrade.tsx:233, 506` unchanged (visible in `docs/desktop-1440/initial.dom.html` because ShareTrade is referenced from docs).

**MAJOR — EarningsDetailPanel `label="Save"` bare verb.** `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx:558` still ships the bare `"Save"` next to a full-verb sibling `"Mark for order review"`.

**MAJOR — Empty-state stubs without next action.** `frontend/src/components/dashboard/PnlAttribution.tsx:60` `"No strategy P&L data yet"`; `LiveSignalFeed.tsx:462` `"No signals yet"`; `ActivityFeed.tsx:359` `"No activity yet today"`; `StrategyGrid.tsx:136` `"No data"`; `NotificationCenter.tsx:209` `"No notifications yet"` / `` `No ${activeTab} notifications` ``. None state a next step. The new `EmptyState` primitive exists — these sites haven't migrated.

**NIT — 404 CTA `Back to AlphaDesk` and `Read the docs`.** `qa/runs/2026-05-04T15-47-19Z/not-found/desktop-1440/initial.dom.html` confirms both still ship. R1 NIT #38 unchanged.

**NIT — Login eyebrow + H2 redundancy (`Welcome back` over `Open your workspace`).** Confirmed in `login/desktop-1440/initial.dom.html`. R1 NIT #32 unchanged.

**NIT — `Open Trade` Title Case lingers in dashboard body text.** `qa/runs/2026-05-04T15-47-19Z/settings/desktop-1440/section-0.dom.html` shows `"Exposure, orders, and strategy state are inside policy bands. Open Trade when you want to act."` — Title Case in mid-sentence body. Source `frontend/src/app/(dashboard)/page.tsx:1076, 1539`. The CTA-button form is now `Open trade` (sentence) but the body-prose form still capitalises.

## Score justification

R3 moves from 2/4 to **3/4** for two reasons. First, the largest single-surface editorial debt — the entire `/docs` page in the original audit's BLOCKER #1 — is now closed in source. Second, the typography codemod and R2-4 surgical sweep cleaned out a long tail of items that the R2 audit captured as still-outstanding: zero ASCII ellipses survive in 144 DOM scans (R2 said 6+ instances), `No results found` is gone, `Active Alerts (N)` / `Create Alert` / `Search Results` / `Popular Symbols` / `Activate Template` Title Case all absent from DOMs, `Verify and save` correctly spelled, `Switch to Live Trading?` Title Case absent from the deployed settings DOM, and the `EmptyState` naming collision is fully resolved with a single source-of-truth definition.

The score does not advance to 4/4 because the Settings card still ships seven visible Title Case toggle labels (`Order Fills`, `Alerts Triggered`, `Pipeline Completed`, `Compact Strategy View`, `Watchlist (JSON)`, `Trade History (CSV)`, `Settings (JSON)`), the dashboard footer still emits `"Powered by Claude AI"` site-wide (84 files), the marketing footer still emits `"made with discipline"` (36 files), three different Live-mode dialog titles still co-exist with two `Got it` CTAs, and the `/docs` rewrite — while resolved in source — was NOT visible in the captured DOM (race-with-deploy or build-cache hiccup; needs a follow-up sweep to confirm production state). The new MAJOR around the backend-supplied `Invalid username or password` shadowing the editorial frontend fallback is a real-world voice break that the R1 audit incorrectly marked closed. A 4/4 would require the Settings toggle case-sweep, the footer rewrites, the Live-mode dialog consolidation, and a confirmed production sweep showing the new `/docs` content actually rendering.
