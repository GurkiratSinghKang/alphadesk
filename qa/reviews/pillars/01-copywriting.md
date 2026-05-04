# Pillar 1: Copywriting — Score: 2/4

## Summary

The editorial voice — declarative, slightly clinical, no-hype — is genuinely good in `/login/reset`, `/contact`, `/help/earnings-data`, the global error boundary, and a handful of dashboard empty states. Outside those, the product runs three writers in parallel: an editorial voice, a generic-product voice ("Submitting…", "Save", "Cancel", "Got it", "Try Again"), and a vendor-marketing voice that survives on `/docs`. The prior `qa/reviews/copy.md` flagged the worst offenders; this audit extends with finer-grained findings — Title Case violations leaking into Settings/TradePanel/Alerts headings, lazy `(s)` plural shortcuts in destructive toasts, three-dot ASCII ellipses in placeholders, OrderBar Show/Hide and Confirm Order register breaks, AICopilot stock "Please try again", marketing footer fluff ("made with discipline"), three different titles for the same Live-mode dialog. Voice is aspired-to but inconsistently enforced — score 2/4 reflects that ~30% of user-facing strings drop register at the moment they matter most (errors, destructive confirms, primary CTAs).

## BLOCKER findings (breaks user understanding / brand voice)

1. **`/docs` whole-page voice break** — Current: vendor-doc tone (`"AlphaDesk leverages Anthropic's Claude AI to analyze market opportunities across all 12 strategies"`, `"AlphaDesk strategies are grounded in academic research and well-established market phenomena"`) → Rewrite in the `/help/earnings-data` register (concrete operational sentences, no "leverages/powerful/sophisticated"). Already flagged in `copy.md` Top-5 #1; still unchanged. `frontend/src/app/docs/_docs/content.ts:14, 49, 83, 94, 118-122`

2. **`Submit LIVE Order` / `Paper Trade` / `Confirm Order` shouting** — TradePanel ships a destructive primary in ALL-CAPS Title-Case (`"Submit LIVE Order"`) and a confirm dialog titled `"Confirm Order"` with body button `"Confirm Order"`. The actual OrderBar uses sentence-case `"Place order"` / `"Submitting…"`. Two ticket flows, two registers. Adopt OrderBar's case; rename dialog title `"Confirm order"`, button `"Confirm and place"`. `frontend/src/components/panels/TradePanel.tsx:541, 545, 555, 607`

3. **Generic primary error fallback in DashboardError** — Current: `"Something went wrong"` (h2) + `"An unexpected error occurred."` + `"Try again"`. The voice elsewhere is `"The desk failed to mount"` (global-error.tsx:101) and `"Something broke on the desk"` (app/error.tsx:28). Replace with `"The desk hit an exception"` (h2) and `"This view stalled mid-render. Refresh or return to the desk."` `frontend/src/app/(dashboard)/error.tsx:21-23`, `frontend/src/components/error/DashboardError.tsx:41-42`

4. **AICopilot generic "Please try again" cliché × 2** — Current: `"AI assistant is currently unavailable. Please try again."` and `"I'm having trouble connecting. Please try again in a moment."` Replace with `"Claude didn't reply this turn. Retry, or check the runtime status in /pipeline."` and `"Couldn't reach Claude. Network or backend may be degraded — retry shortly."` Naming Claude (which the dashboard otherwise abstracts) reinforces provenance. `frontend/src/components/layout/AICopilot.tsx:313, 345`

5. **Lazy `(s)` plural construction in destructive toasts** — Three sites: `"Failed to delete ${failed} alert(s)"` and `"Cleared ${triggered.length} triggered alert(s)"`; TradePanel `"Close ALL ${positions.length} position(s)? This will sell all holdings."` On a serious surface this reads as a stub. The codebase already pluralizes properly in NotificationCenter and the alerts delete-all dialog — extend that pattern. `frontend/src/app/(dashboard)/alerts/page.tsx:787, 789, 806`, `frontend/src/components/panels/TradePanel.tsx:699, 725, 734`

6. **Login error messages still generic** — Current: `"Invalid username or password"` and `"Failed to connect to server"`. Both flagged in `copy.md` Top-5 #2; unfixed. Suggested: `"Those credentials didn't match. Reset the password if you've lost it."` and `"Couldn't reach AlphaDesk. Check your connection and try again."` `frontend/src/app/login/_login/LoginForm.tsx:164, 207`

7. **Request-access success H2 voice break** — Current: `"The desk has your details"`. The personification is one-off in this flow — eyebrow above already says `"Request received"` and the page is otherwise sentence-clinical. Compounding: when `requestId` is empty the literal `"queued"` falls into the body (`"Reference queued"`) reading as a typo. Suggested: drop H2 to `"Request received."`; replace `"queued"` fallback with `"Reference pending"` or omit. `frontend/src/app/request-access/_request/RequestAccessForm.tsx:154-158`

8. **Lockout `"Reset lockout"` button contradicts message above it** — Current: `"Too many attempts. Try again in 9m 12s."` immediately followed by underlined `"Reset lockout"` that wipes only the client timer (server limit still applies). Looks like an escape hatch but isn't. Suggested: rename `"Clear local timer"` with helper `"The server lockout may still apply."` Already in `copy.md`; unfixed. `frontend/src/app/login/_login/LoginForm.tsx:372-380`

## WARNING findings (degrades quality, fix recommended)

9. **TradePanel inline note buttons `Save` / `Cancel`** — Bare verbs on a serious surface, side-by-side with the Title-Case `"Confirm Order"` and ALL-CAPS `"Submit LIVE Order"`. Suggested: `"Save note"` / `"Discard"`. `frontend/src/components/panels/TradePanel.tsx:1490-1491`

10. **EarningsDetailPanel candidate decision `label="Save"`** — Siblings are `"Discard"` and `"Mark for order review"` (full-verb). Suggested: `"Save for later"` or `"Pin candidate"`. `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx:531`

11. **ProfileMenu `"Got it"` confirm** — Dialog title `"Live trading not available"` + Got it button. (a) "Got it" is the canonical generic CTA the brief says to avoid; (b) the same dialog at settings/page.tsx:1131 (`"Switch to Live Trading?"` Title Case) re-uses `"Got it"`. Suggested: `"Acknowledge"` or `"Close"`. `frontend/src/components/layout/ProfileMenu.tsx:205`, `frontend/src/app/(dashboard)/settings/page.tsx:1131, 1156`

12. **Three different titles for the same Live-mode confirmation** — `"Live trading not available"` (ProfileMenu.tsx:197), `"Switch to Live Trading?"` (settings/page.tsx:1131), `"Trading Mode"` (ProfileMenu.tsx:131 caps eyebrow). Pick one. Recommend `"Live mode unavailable"` (sentence case).

13. **Title Case leaks into dashboard sections and toggles** — Confirmed instances: `"Active Alerts (N)"`, `"Triggered History (N)"` (alerts/page.tsx:1000, 1048); `"Order Fills"`, `"Alerts Triggered"`, `"Pipeline Completed"`, `"Compact Strategy View"` (settings/page.tsx:937, 943, 949, 969); `"Watchlist (JSON)"`, `"Trade History (CSV)"`, `"Settings (JSON)"` (settings/page.tsx:1046, 1062, 1075); `"Activate Template"` / `"Deactivate"` (StrategyTemplates.tsx:223); `"Search Results"` / `"Popular Symbols"` (CommandPalette.tsx:478); `"Create Alert"` (alerts/page.tsx:215, 297); `"Download Portfolio Statement (CSV)"` (reports/page.tsx:387). Brief says sentence case across the app.

14. **OrderBar `"Hide"` / `"Show"` on Advanced toggle** — Bare imperatives. Adjacent block titles use full sentences. Suggested: `"Hide advanced"` / `"Show advanced"`. `frontend/src/components/composites/OrderBar.tsx:642`

15. **Three-dot ASCII ellipses everywhere** — Found in `pipeline/loading.tsx:4` (`"Loading..."`), `trade/loading.tsx:4`, `MarketMovers.tsx:145`, `WatchlistPanel.tsx:720` (`"Screening..."`), `CommandPalette.tsx:474` (`"Searching..."`), `AICopilot.tsx:520` (`"Thinking..."`), `pipeline/page.tsx:1486` (`"Starting..."`). Brief says single-character `…`. Brief is honoured by `OrderBar.tsx:782` (`"Submitting…"`). Standardize. Also: `"Loading..."` / `"Loading positions..."` are exactly the lazy state labels `skeleton.tsx:15` explicitly forbids ("Empty states should write a *next step*, not 'loading…'").

16. **`No results found.` in CommandPalette** — Stock empty state. Already shows `"No symbols found for {query}"` two lines below; pick the latter pattern. Suggested: `"No matches for &ldquo;{query}&rdquo;."` `frontend/src/components/layout/CommandPalette.tsx:474`

17. **Marketing footer tagline `"made with discipline"`** — Trying for editorial swagger but reads hype-adjacent on a serious surface. Either drop entirely or replace with something operational like `"α · Eastern time, paper-first"`. `frontend/src/components/layouts/MarketingShell.tsx:187`

18. **`Powered by Claude AI` in dashboard footer** — Vendor pattern. The product otherwise surfaces Claude as a calm provenance signal. Suggested: `"AlphaDesk v1.0 · Claude inside · © 2026"` or just version + copyright. `frontend/src/app/(dashboard)/layout.tsx:326`, `frontend/src/components/layout/DashboardShell.tsx:32`

19. **`"Verify & save"` uses `&` in primary CTA** — Other CTAs spell out the word. Suggested: `"Verify and save"`. `frontend/src/app/(dashboard)/settings/page.tsx:767`

20. **`"AI Analysis"` Title-Case vs `"AI review"` sentence** — `ShareTrade.tsx:233, 506` use Title; login proof-points and EarningsDetailPanel use lowercase. Pick lowercase descriptor everywhere.

21. **AICopilot empty-state `"How can I help?"` + `"Ask me anything about your portfolio, markets, or trading strategies."`** — Stock chat-bot copy. Suggested: `"What do you want to investigate?"` + `"Provenance is shown beneath every reply. Claude can summarize but cannot place orders."` `frontend/src/components/layout/AICopilot.tsx:441-446`

22. **AICopilot `"Ask anything..."` placeholder** — Generic. Try `"Ask Claude about a symbol or position"`. `frontend/src/components/layout/AICopilot.tsx:542`

23. **NotificationCenter empty state `"No notifications yet"` / `"No ${activeTab} notifications"`** — States absence with no next action. Suggested: `"No notifications yet. Order fills and triggered alerts will arrive here."` `frontend/src/components/layout/NotificationCenter.tsx:209`

24. **PnlAttribution / LiveSignalFeed / ActivityFeed terse "No X yet" stubs** — `"No strategy P&L data yet"` (PnlAttribution.tsx:60), `"No signals yet"` (LiveSignalFeed.tsx:462), `"No activity yet today"` (ActivityFeed.tsx:359), `"No data"` (StrategyGrid.tsx:136). No next step. Add a one-line helper each, or inherit the dashboard `"No interventions pending"` full-sentence pattern.

25. **OrderBar review-copy default is meta-instruction** — Default `"Review before submit · regime check · risk policy"` reads as documentation, not as a data line. Other surfaces show actual policy state. Suggested: only render when parent supplies a real one. `frontend/src/components/composites/OrderBar.tsx:81`

26. **Earnings empty-state trailing dash `"No earnings match —"`** — copy.md flagged it; still emits a literal trailing en-dash from `parts.join(" ") + " ·"`. Trim trailing punctuation. `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar.tsx:353, 369`

27. **`"Coming soon"` in two flavours** — `PositionsList.tsx:44` `"Journal — coming soon."`, `strategies/page.tsx:968` `title="Coming soon"`, `ProfileMenu.tsx:187`. The brief audience reads "coming soon" as roadmap-marketing. Suggested: `"Journal · not yet wired"` (matches `/login/reset` voice "Self-serve reset is not yet wired").

28. **`"Tap again to confirm"` Sell arming** — Mobile-only language on a desk product. Suggested: `"Confirm sell"` (after first click). `frontend/src/components/composites/OrderBar.tsx:530`

29. **Couldn't read current strategy states — aborting template** — `"aborting template"` is engineer-language. Suggested: `"Couldn't read current strategy states. Template not applied — try again or refresh."` `frontend/src/components/panels/StrategyTemplates.tsx:270`

30. **`"Try Again"` (Title) in `(dashboard)/error.tsx:27` vs `"Try again"` (sentence) in `DashboardError.tsx:90`** — Same widget family, two cases. Use sentence.

31. **Dashboard `"Open Trade"` (page.tsx:1027, 1490) vs `"Open trade"` (page.tsx:1033, 1493)** — Same component, two cases, four lines apart. `frontend/src/app/(dashboard)/page.tsx:1027, 1033, 1490, 1493`

## NIT findings (polish)

32. **`"Welcome back"` eyebrow over H2 `"Open your workspace"`** is redundant. Drop eyebrow. `LoginForm.tsx:240-244` (in copy.md; unfixed).

33. **Login password placeholder `"your password"`** duplicates the label. Replace with `"at least 12 characters"` or remove. `LoginForm.tsx:304`.

34. **Login TOTP prompt renders in red error box** — TOTP-required is normal flow, not error. Use neutral info box. `LoginForm.tsx:161, 353-363`.

35. **Request-access placeholders `"Mira Patel" / "mira@fund.example" / "Independent PM" / "Portfolio manager" / "United States"`** — fake names fight the invite-only positioning. `RequestAccessForm.tsx:224, 237, 252, 262, 275`.

36. **`"Firm or context"` is odd phrasing** — try `"Affiliation"` or `"Firm"` + helper. `RequestAccessForm.tsx:246`

37. **`"Send request"` vs `"Submit another request"`** — Two verbs in the same flow. `RequestAccessForm.tsx:178, 403`

38. **404 CTA `"Back to AlphaDesk"`** — assumes brand familiarity for misclicked unauthed visitors. Recommend `"Back to sign in"`. `not-found.tsx:42`. Also `"Read the docs"` → `"Open the docs"` to match `"Open trade"`.

39. **Settings live-trading dialog text duplicated verbatim with wording drift** — `"this toggle does not enable"` (settings) vs `"this toggle cannot enable"` (ProfileMenu). Pick one and import. `ProfileMenu.tsx:198-202`, `settings/page.tsx:1132-1136`.

40. **`"Self-serve reset is not yet wired"`** — copy.md praised this as the platonic AlphaDesk sentence. Codify by extracting a `<NotYetWiredCallout>` component for Journal/Webhook delivery/Animation Speed.

41. **Pipeline run helper duplicated and divergent** — `pipeline/page.tsx:911` `"No active positions — pipeline will open trades during market hours"` vs `PositionsSummary.tsx:64` `"No open positions — the pipeline opens trades during market hours"`. Pick one site-wide.

42. **`"Reset"` (settings dialog button, settings/page.tsx:1194)** — bare. Suggested `"Reset preferences"`. Same for `"Clear"` in alerts triggered confirm (alerts/page.tsx:858) → `"Clear triggered"`.

43. **`global-error.tsx` `"Try again"` button next to `"Back to dashboard"`** — Page above says `"The desk failed to mount"`. Try `"Reload the desk"` to match the metaphor.

44. **Quick prompts in AICopilot are retail-tone** — `"What should I watch today?"`, `"How are my strategies performing?"`, `"What's the market outlook?"`, `"Suggest a hedge for my positions"`. The audience verifies their own setups. Suggested: `"Counter-thesis for current symbol"`, `"Risk decomposition by strategy"`, `"Earnings risk this week"`, `"Pipeline cost vs P&L"`. `AICopilot.tsx:54-60`

45. **Reports empty state `"Nothing to export yet"`** (reports/page.tsx:382) — terse; copy.md suggested `"Trade history will populate after the first closed position."` Unfixed.

46. **Refresh button label `"Refresh"`** in Brokerage card (settings/page.tsx:658) — bare verb. Suggested `"Refresh broker status"`.

47. **`"Configuration"` placeholder card in ProfileMenu** (`"Broker API keys, preferences, and additional configuration coming soon."`) — likely dead UI superseded by /settings. Remove or link out. `ProfileMenu.tsx:184-188`

48. **Toasts mix registers** — `"Cancel requested. Pipeline will stop at next safe checkpoint."` (perfect) vs `"Pause-all already in progress…"` (ellipsis as if system is thinking; this is a bounce, not progress — period, not ellipsis).

49. **OrderBar `"Submits to paper account"` vs `"SMART paper route"`** — Inside the same composite, mixed casing on the same word "paper". Standardize. `OrderBar.tsx:84, 669-671`

50. **`"Notifications"` (sentence) section title vs `"Order Fills"` Title-cased toggles 6 lines below in the same card.** `settings/page.tsx:931, 937, 943, 949`

## Files audited

- `frontend/src/app/login/_login/LoginForm.tsx`, `app/login/page.tsx`, `app/login/reset/page.tsx`
- `app/request-access/_request/RequestAccessForm.tsx`
- `app/about/page.tsx`, `app/contact/_contact/content.tsx`, `app/docs/page.tsx`, `app/docs/_docs/content.ts`
- `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`
- `app/(dashboard)/error.tsx`, `app/(dashboard)/loading.tsx`, `app/(dashboard)/page.tsx`, `app/(dashboard)/layout.tsx`
- `app/(dashboard)/alerts/page.tsx`, `app/(dashboard)/settings/page.tsx`
- `app/(dashboard)/pipeline/page.tsx`, `app/(dashboard)/pipeline/loading.tsx`
- `app/(dashboard)/trade/page.tsx`, `app/(dashboard)/trade/loading.tsx`
- `app/(dashboard)/reports/page.tsx`, `app/(dashboard)/strategies/page.tsx`
- `app/(dashboard)/strategies/trading-agents-research/page.tsx`
- `app/(dashboard)/strategies/earnings-options-play/page.tsx` + `_earnings/EarningsCalendarSidebar.tsx` + `_earnings/EarningsDetailPanel.tsx`
- `components/composites/OrderBar.tsx`, `PositionsList.tsx`, `AIMemoPanel.tsx`
- `components/panels/TradePanel.tsx`, `StrategyTemplates.tsx`, `WatchlistPanel.tsx`, `ShareTrade.tsx`
- `components/layout/AICopilot.tsx`, `CommandPalette.tsx`, `NotificationCenter.tsx`, `ProfileMenu.tsx`, `DashboardShell.tsx`
- `components/layouts/MarketingShell.tsx`, `components/error/DashboardError.tsx`
- `components/dashboard/MarketMovers.tsx`, `PnlAttribution.tsx`, `LiveSignalFeed.tsx`, `ActivityFeed.tsx`, `StrategyGrid.tsx`, `PositionsSummary.tsx`
