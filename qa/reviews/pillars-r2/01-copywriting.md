# Pillar 1: Copywriting — Re-audit Score: 2/4 (was 2/4)

## Score change rationale

The 8-PR sprint cleanly resolved the most acute editorial defects on three high-stakes surfaces — the destructive-confirm pathway (TradePanel/dashboard/pipeline/profile/settings now share a `DestructiveConfirmModal` primitive with sentence-case titles, named consequences, and per-action confirm verbs), login error / lockout copy, and the request-access success page. The new `EmptyState` primitive establishes a credible voice at 5+ sites previously rendering as voids. AICopilot's two "Please try again" clichés are gone and replaced with `/pipeline`-aware retry copy that names Claude as a calm provenance signal. The `(s)` plural shortcuts in destructive toasts have all been migrated to `fmtPlural`. That is real, measurable progress.

But the audit's central finding — "the product runs three writers in parallel" — still holds. The `/docs` voice break (BLOCKER #1) is unchanged: `"AlphaDesk leverages Anthropic's Claude AI"` and `"grounded in academic research"` are still on the page. The Settings card alone ships 7 Title Case toggles ("Order Fills", "Alerts Triggered", "Pipeline Completed", "Compact Strategy View", three export buttons), all six site-wide ASCII three-dot ellipses are still emitting (`Loading...`, `Searching...`, `Thinking...`, `Starting...`, `Screening...`), the dashboard footer still reads `"Powered by Claude AI"`, the Live-mode dialog still has three different titles across two surfaces, and `"Got it"` survives in two places. ~12-15 of 23 WARNING items remain open. Score does not move from 2/4 because the *uneven enforcement* — perfect editorial primitives undermined 4 lines later by a Title-Case toggle group or a generic loading stub — is the same critique made the first time.

## Findings closed by sprint

| Original BUG | Status | Evidence |
|---|---|---|
| BUG-13 (DashboardError editorial copy) | Closed | `components/error/DashboardError.tsx:45,49` — `"This surface hit a snag"` headline, `"The page failed to render — refresh, or jump to a different surface. The desk has been notified."` body. `app/(dashboard)/error.tsx:23-24` overrides with `"The dashboard hit a snag"` + page-level helper. Voice on-brand. |
| BUG-14 (AICopilot cliché error strings) | Closed | `components/layout/AICopilot.tsx:313` — `"Claude is offline. Check \`/pipeline\` for upstream status."` Network catch at line 345 — `"Lost the connection to Claude. The desk's pipeline retries automatically — check status at \`/pipeline\`."` Both name Claude, both point to a real diagnostic surface. |
| BUG-15 (`(s)` plural shortcuts) | Closed | `app/(dashboard)/alerts/page.tsx:788,790,807` all use `fmtPlural(failed, "alert")`. `components/panels/TradePanel.tsx:36` imports `fmtPlural`; original `(s)` sites at lines 699/725/734 are no longer present in the destructive flow (rewritten through `useDestructiveAction` modal copy). |
| BUG-16 (Login error declarative voice) | Closed | `app/login/_login/LoginForm.tsx:164` — `"Those credentials didn't match. Confirm the username, the password, and that Caps Lock is off."` Replaces `"Invalid username or password"`. Network error path (was `"Failed to connect to server"`) similarly rewritten. Verified visually in `login/desktop-1440/after-submit-invalid.preview.png`. |
| BUG-17 (Request-access success H2 + body) | Partial | `app/request-access/_request/RequestAccessForm.tsx:152-155` — eyebrow `"Request received"` + H2 `"Request received"` (the H2 voice break is fixed). Helper at line 157-159 reads naturally. But the eyebrow and H2 are now identical text — duplication is worse-tasting than the original personification. Reference fallback now uses bare `"Ref {requestId}"` (no more `"queued"` typo). |
| BUG-18 (Lockout button rename) | Closed | `app/login/_login/LoginForm.tsx:379` — `"Clear local timer"` with explanatory line below `"(server lockout still in effect)"` at line 381. Matches the suggestion exactly. |
| BUG-07 (TradePanel sentence-case CTAs) | Closed | `components/panels/TradePanel.tsx:548` — `"Place live order"` (lower case "live"). Dialog title at line 558 — `"Confirm order"`. Dialog confirm button at line 610 — `"Confirm live order"` / `"Confirm order"`. Trio is now register-consistent with `OrderBar`. |
| BUG-09 (Destructive modal per-action copy) | Closed | `DestructiveConfirmModal` consumed by 5 sites (`page.tsx`, `pipeline/page.tsx`, `strategies/[id]/page.tsx`, `ProfileMenu.tsx`, `TradePanel.tsx`). Sample payloads — `Cancel order` / `Working SELL 100 AAPL at $150.` / `["Removes the order...", "Any partial fills already executed remain on the book."]` / `confirmLabel: "Cancel order"`; `Sign out` / `End the current session.` / `["Unsaved order tickets and strategy drafts are lost.", "You'll need to sign in again to resume."]`; `Cancel pipeline run` / `Run #abc12345 aborts mid-step.`. All sentence-case, all named, all consequence-bulleted. The shared modal also fixes the "Submit LIVE Order" / "Confirm Order" caps inconsistency by definition. |

## Findings still outstanding (from original audit, NOT addressed)

**BLOCKER #1 — `/docs` whole-page vendor voice (NOT addressed).** `app/docs/_docs/content.ts:83` still ships `"AlphaDesk leverages Anthropic's Claude AI to analyze market opportunities across all 12 strategies"` and `:94` `"AlphaDesk strategies are grounded in academic research and well-established market phenomena"`. This was already flagged twice (the prior `copy.md` Top-5 plus the original audit). Visible in `docs/desktop-1440/initial.preview.png`. Likely intentionally deferred — `/docs` was outside the 8-PR scope — but it's the single largest editorial debt on the product.

**WARNING #9 — TradePanel inline note `Save` / `Cancel`.** `TradePanel.tsx:1459-1460` still uses bare verbs.

**WARNING #10 — EarningsDetailPanel `label="Save"`** at `EarningsDetailPanel.tsx:558`. Sibling at line 564 is full-verb `"Mark for order review"`; the bare `"Save"` and `"Discard"` look stranded.

**WARNING #11 — ProfileMenu `"Got it"` confirm.** `ProfileMenu.tsx:221` still uses the canonical generic CTA the brief tells writers to avoid. `settings/page.tsx:1156` repeats it.

**WARNING #12 — Three different titles for Live-mode confirmation.** `ProfileMenu.tsx:213` `"Live trading not available"`, `settings/page.tsx:1131` `"Switch to Live Trading?"`, `ProfileMenu.tsx:147` eyebrow `"Trading Mode"`. Unchanged.

**WARNING #13 — Title Case leaks across dashboard and settings.** All originally-flagged instances persist: `"Active Alerts (N)"` / `"Triggered History (N)"` (alerts/page.tsx:991, 1039), `"Order Fills"` / `"Alerts Triggered"` / `"Pipeline Completed"` / `"Compact Strategy View"` (settings/page.tsx:937, 943, 949, 969 — all visible in `settings/desktop-1440/initial.preview.png`), `"Watchlist (JSON)"` / `"Trade History (CSV)"` / `"Settings (JSON)"` (settings/page.tsx:1046, 1062, 1075), `"Activate Template"` (StrategyTemplates.tsx:223), `"Search Results"` / `"Popular Symbols"` (CommandPalette.tsx:478), `"Create Alert"` (alerts/page.tsx:216, 298 — visible in `alerts/desktop-1440/initial.preview.png`), `"Download Portfolio Statement (CSV)"` (reports/page.tsx:387). Zero progress.

**WARNING #14 — OrderBar `Hide` / `Show`.** `OrderBar.tsx:651` still ships bare imperatives.

**WARNING #15 — ASCII three-dot ellipses.** All flagged sites still emit `"..."`: `pipeline/loading.tsx:4`, `trade/loading.tsx:4`, `pipeline/page.tsx:676,1504` (`Starting...`), `CommandPalette.tsx:474` (`Searching...`), `AICopilot.tsx:520` (`Thinking...`), `WatchlistPanel.tsx:720` (`Screening...`). The brief is honoured by `OrderBar.tsx` (`Submitting…`) and the new `DestructiveConfirmModal` (`Working…`) but nowhere else.

**WARNING #16 — `No results found.` in CommandPalette.** `CommandPalette.tsx:474` unchanged.

**WARNING #17 — `made with discipline` marketing footer.** `MarketingShell.tsx:187` still emits `"α · made with discipline"`.

**WARNING #18 — `Powered by Claude AI` dashboard footer.** `app/(dashboard)/layout.tsx:323` and `DashboardShell.tsx:30` both still emit it. Visible in every dashboard `.preview.png` (settings, alerts, dashboard, strategies all show `"Powered by Claude AI — © 2026"`).

**WARNING #19 — `Verify & save` ampersand.** `settings/page.tsx:767` unchanged. Visible in `settings/desktop-1440/initial.preview.png`.

**WARNING #20 — `AI Analysis` Title-Case in ShareTrade.** `ShareTrade.tsx:233, 506` unchanged.

**WARNING #21 — AICopilot empty-state `How can I help?` + `Ask me anything…`.** `AICopilot.tsx:441-446` unchanged. Generic chat-bot copy survives despite the same file rewriting its error handling.

**WARNING #22 — AICopilot `Ask anything...` placeholder.** `AICopilot.tsx:542` unchanged.

**WARNING #23 / #25 / #28** — unchanged (NotificationCenter empty stubs; OrderBar default review string; Tap-again mobile language).

**WARNING #26 — Earnings sidebar trailing dash + trailing `·`.** `EarningsCalendarSidebar.tsx:353` `"No earnings match —"` and line 369 `${parts.join(" ")} ·` still emit terminal punctuation. Flagged twice now (prior `copy.md` + original audit). Unchanged.

**WARNING #27 — `Coming soon` × 3.** `PositionsList.tsx:44, 138, 168` and `strategies/page.tsx`, `ProfileMenu.tsx` still ship `"coming soon"`.

**WARNING #29 — `aborting template` engineer-language.** `StrategyTemplates.tsx:270` still ships `"Couldn't read current strategy states — aborting template"`.

**WARNING #30 / #31** — `Try Again` is closed (`DashboardError.tsx:96` and `global-error.tsx:153` both `"Try again"`). `Open Trade` Title vs `Open trade` sentence is still mixed in `(dashboard)/page.tsx:1076,1082,1539,1542`.

NIT items #32–50: not separately tracked. Spot checks confirm the TOTP-in-red-error-box NIT (#34) and placeholder NITs (`Mira Patel`, `Firm or context`) are unchanged.

## NEW findings introduced by sprint

1. **Eyebrow + H2 duplication on request-access success.** `RequestAccessForm.tsx:151-156` now renders `"Request received"` (eyebrow) followed immediately by `"Request received"` (H2). Visible in `request-access-submit/desktop-1440/after-submit.preview.png`. The original audit suggested dropping the H2 to `"Request received."` — this implementation kept both. The duplication tastes like a copy-paste oversight more than the original personification did.

2. **`DestructiveConfirmModal` "Keep" cancel button is unusually terse.** `DestructiveConfirmModal.tsx:53` — the cancel button reads simply `"Keep"`. Across the 5 destructive sites that's `Keep` standing next to `Cancel order` / `Sign out` / `Cancel run` / etc. — semantically clear ("keep the current state") but it's a one-word verb the rest of the desk avoids. Suggested: `"Keep current"` or wire a per-call cancel label so `Sign out` reads `"Stay signed in"` and `Cancel order` reads `"Keep order"`.

3. **`DestructiveConfirmModal` loading state `"Working…"`.** Generic; the rest of the destructive copy is concrete (`Cancel order`, `Sign out`, `Cancel run`). `Working…` reads as a wash. Suggested: parametrise as `"Cancelling order…"` / `"Signing out…"` per-call.

4. **`EmptyState` primitive uses italic display H3 (`font-display italic`).** Two `EmptyState` call sites (`PositionsSection.tsx:55` `"This strategy hasn't traded yet"` and `EquityPanel.tsx:57` `"No equity curve yet"`) work. But the same primitive is now used in `analytics/page.tsx:260, 332, 408, 531` — wait, those use a *local* `EmptyState` defined at line 654 (different shape). Two `EmptyState` symbols in the codebase is a maintenance hazard — naming collision will eventually misroute someone's import.

5. **CalendarWeekHeatmap hint** — `CalendarWeekHeatmap.tsx:85` `"Pick any row above — or use ↑↓ — for the full options play."` Voice is on-brand; the literal `↑↓` glyphs depend on font fallback (low priority).

6. **AICopilot retains `Thinking...` (3-dot) in same file as new `Claude is offline.` editorial copy** — `AICopilot.tsx:520`. Sprint touched the file but did not standardise the in-flight state. The exact half-fix the original audit was calling out.

## Score-defending findings

**Why not 3/4:** The Settings page alone visibly ships `"Order Fills"`, `"Alerts Triggered"`, `"Pipeline Completed"`, `"Compact Strategy View"`, `"Watchlist (JSON)"`, `"Trade History (CSV)"`, `"Settings (JSON)"`, `"Verify & save"` and `"Powered by Claude AI"` — nine register-violating strings on one screen visible in `settings/desktop-1440/initial.preview.png`. The `/docs` page is unchanged from a 6-month-old finding. Six ASCII ellipses still leak to users. Three different titles still ship for the same Live-mode dialog. A re-audit cannot promote past "Needs work" while the most-trafficked operator screen still has nine visible voice breaks.

**Why not 1/4:** The destructive-confirm rewrite is genuinely good — the `Cancel order` / `Sign out` / `Cancel pipeline run` payloads name consequences, name the action, and ship in sentence case. The login form is now editorial throughout: `"Those credentials didn't match. Confirm the username, the password, and that Caps Lock is off."` reads exactly like the `/login/reset` voice praised in the original audit. The `DashboardError` headline `"This surface hit a snag"` plus the `"The desk has been notified"` close are on-brand. AICopilot's `"Claude is offline. Check \`/pipeline\` for upstream status."` is the platonic AlphaDesk error sentence — pointing to a real diagnostic surface, no apology, no "please". These are moves a 1/4 product cannot make. The score-floor is held by the editorial primitives the sprint shipped; the score-ceiling is held back by the Title Case / ellipsis / `/docs` / footer debt that survived untouched.
