# AlphaDesk Visual Bug Audit - Round 4
## Comprehensive Code-Level Analysis
Date: 2026-04-12

---

## BUG 1: Sparklines in Dashboard Market Context are flat lines (useless)
- **What**: The `Sparkline` component in the Market Context section receives data from `sparkData`, which is generated as `Array(20).fill(100)` -- a flat array of identical values. This means every sparkline in the market indices section renders as a perfectly horizontal line, providing zero useful information.
- **Where**: Dashboard page (`/`), Market Context section > Market Indices column, sparklines next to SPY/QQQ/IWM
- **File**: `/frontend/src/app/(dashboard)/page.tsx` lines 247-254 and `/frontend/src/components/dashboard/Sparkline.tsx` lines 56-59
- **Severity**: P1 (confusing) -- sparklines are a prominent UI element that visually imply they show real data, but they show nothing

---

## BUG 2: Strategy Grid sparklines use fake deterministic data (misleading)
- **What**: The `StrategyGrid` component calls `generateSparkData(strategy.id.length * 31 + strategy.id.charCodeAt(0), 30)` which returns `Array(30).fill(100)` (flat line). This makes every strategy card's sparkline a flat horizontal line, providing no useful visual signal.
- **Where**: Dashboard page (`/`), Strategy Grid (right side), every strategy card
- **File**: `/frontend/src/components/dashboard/StrategyGrid.tsx` lines 106-109, `/frontend/src/components/dashboard/Sparkline.tsx` lines 56-59
- **Severity**: P1 (confusing) -- sparklines suggest performance trends but show nothing

---

## BUG 3: Keyboard shortcut "5" maps to "D" (Daily) instead of "4H"
- **What**: In `useKeyboardShortcuts.ts`, key "5" maps to action `chart:timeframe:D` (Daily). But in the TradePage's own keydown handler, key "5" maps to `"4H"`. The same key triggers different timeframes depending on which handler fires. Additionally, `SHORTCUT_GROUPS` shows key "5" = "Daily" and key "6" = "Weekly", but the trade page maps "5"="4H", "6"="D", "7"="W", "8"="M". These are inconsistent and the keyboard shortcuts overlay will mislead users.
- **Where**: Trade page (`/trade`), Keyboard shortcuts dialog
- **File**: `/frontend/src/hooks/useKeyboardShortcuts.ts` lines 14-19 vs `/frontend/src/app/(dashboard)/trade/page.tsx` lines 31-35
- **Severity**: P0 (broken/misleading) -- users pressing number keys get unpredictable timeframe changes

---

## BUG 4: Fundamental analysis text is hardcoded and wrong for every symbol
- **What**: The FundamentalTab displays the text `"{symbol} has strong fundamentals with high profitability and improving financial health."` for EVERY symbol, regardless of actual fundamentals. This is misleading -- a company with weak fundamentals would still show this positive statement.
- **Where**: Trade page (`/trade`), right panel > Fundamentals tab
- **File**: `/frontend/src/components/panels/AnalysisPanel.tsx` line 406
- **Severity**: P0 (broken/misleading) -- displays factually incorrect fundamental assessment for stocks that may have weak fundamentals

---

## BUG 5: Sentiment tab shows hardcoded/static data, no "sample" label
- **What**: The Sentiment tab displays hardcoded options flow items (e.g. "Large call sweep SPY 600C Jan 2027", "Put buying in XLF sector ETF") and hardcoded news items that never change regardless of selected symbol. Unlike the Signals tab which has a "Sample signals" disclaimer, the Sentiment tab has no disclaimer, making users think this is real data.
- **Where**: Trade page (`/trade`), right panel > Sentiment tab
- **File**: `/frontend/src/components/panels/AnalysisPanel.tsx` lines 453-462
- **Severity**: P0 (broken/misleading) -- presents fabricated market data as real

---

## BUG 6: Options flow shows "SPY 600C Jan 2027" -- stale/implausible strike
- **What**: The hardcoded options flow item references "SPY 600C Jan 2027". Since today is April 2026, Jan 2027 is still in the future, but "600C" as a strike is misleading because SPY's price may be significantly different. More importantly, this data never updates.
- **Where**: Trade page (`/trade`), right panel > Sentiment tab > Options Flow section
- **File**: `/frontend/src/components/panels/AnalysisPanel.tsx` line 454
- **Severity**: P1 (confusing) -- stale hardcoded data presented as live

---

## BUG 7: Sentiment Score gauge calculation produces incorrect values
- **What**: The Sentiment Score gauge displays `Math.max(0, Math.min(100, (analysis?.sentimentScore ?? 0) + 50))`. When analysis is null (no API data), sentimentScore defaults to 0, so the gauge shows 50. This is arbitrary and misleading -- a score of "50" implies neutral sentiment when no data is available.
- **Where**: Trade page (`/trade`), right panel > Sentiment tab > Score gauge
- **File**: `/frontend/src/components/panels/AnalysisPanel.tsx` line 480
- **Severity**: P1 (confusing) -- fabricated score value

---

## BUG 8: Chat fallback response is hardcoded and symbol-agnostic
- **What**: When the chat API fails, the fallback response is always `"Based on my analysis of {symbol}, the technical setup looks constructive. The MACD just crossed bullish, RSI is at 58..."`. This is the same "analysis" regardless of the actual stock, and could be completely wrong for a stock in a downtrend.
- **Where**: Trade page (`/trade`), right panel > Chat tab
- **File**: `/frontend/src/components/panels/AnalysisPanel.tsx` lines 590-594
- **Severity**: P0 (broken/misleading) -- AI chat gives false bullish analysis for any stock when API is down

---

## BUG 9: Economic Calendar shows hardcoded sample events with no dynamic dates
- **What**: The Economic Calendar generates "upcoming" events using `generateUpcomingEvents()` which creates events from templates with hardcoded times and data (e.g. "FOMC Meeting Minutes", "Non-Farm Payrolls"). While it does have a "Sample Events" disclaimer badge, the events show relative dates that look real but aren't tied to actual economic calendar data.
- **Where**: Dashboard page (`/`), Economic Calendar section below Positions Summary
- **File**: `/frontend/src/components/dashboard/EconomicCalendar.tsx` lines 18-54
- **Severity**: P2 (polish) -- has disclaimer but could mislead users scanning quickly

---

## BUG 10: Signals tab shows hardcoded signals with no "demo" indicator
- **What**: The Signals tab in the Watchlist panel shows hardcoded signals: "NVDA Golden Cross", "AAPL RSI Oversold", "TSLA Death Cross", etc. While it does have a "Sample signals" disclaimer, these specific signals could be wrong -- TSLA might not actually have a death cross pattern.
- **Where**: Trade page (`/trade`), left panel > Signals tab
- **File**: `/frontend/src/components/panels/WatchlistPanel.tsx` lines 270-277
- **Severity**: P2 (polish) -- has disclaimer but uses specific stock symbols that may mislead

---

## BUG 11: Watchlist change % is fabricated from symbol hash, not real data
- **What**: When a quote has no `changePct` data from the WebSocket, the WatchlistRow component generates a fake deterministic change percentage based on the symbol's character codes: `seed = (seed * 16807) % 2147483647; raw = ((seed % 800) - 300) / 100`. This produces seemingly-real percentage changes that are pure fiction.
- **Where**: Trade page (`/trade`), left panel > Watchlist tab > change % column
- **File**: `/frontend/src/components/panels/WatchlistPanel.tsx` lines 80-96
- **Severity**: P1 (confusing) -- shows made-up numbers without any indicator they're fake

---

## BUG 12: MiniSparkline in watchlist uses generic hardcoded SVG paths
- **What**: The MiniSparkline component renders one of three hardcoded SVG polyline paths regardless of actual price history. All up-trending stocks get the exact same shape, all down-trending get the same shape. This looks fake on close inspection.
- **Where**: Trade page (`/trade`), left panel > Watchlist tab > sparkline column
- **File**: `/frontend/src/components/panels/WatchlistPanel.tsx` lines 23-44
- **Severity**: P2 (polish) -- small visual element but contributes to "fake data" impression

---

## BUG 13: PnL Calendar (full version) uses demo data without clear label
- **What**: The PnlCalendar component generates random P&L data: `pnl = Math.round((rng() - 0.42) * 2000)` for each trading day. While it falls back to this when API returns nothing, there's no visual indicator that this is demo/generated data (unlike the Economic Calendar which has a badge).
- **Where**: Trade page (`/trade`), right panel > Calendar tab
- **File**: `/frontend/src/components/panels/PnlCalendar.tsx` lines 53-90
- **Severity**: P1 (confusing) -- shows randomly generated P&L as if it were real trading history

---

## BUG 14: Profile menu avatar is hardcoded "A" regardless of username
- **What**: The profile menu trigger always shows "A" as the avatar letter. If the username changes from "admin" to something else (e.g. "bob"), the avatar would still show "A".
- **Where**: Top bar, rightmost element (profile avatar circle)
- **File**: `/frontend/src/components/layout/ProfileMenu.tsx` line 35
- **Severity**: P2 (polish) -- works for "admin" but would be wrong for other users

---

## BUG 15: Profile menu shows hardcoded "admin" username
- **What**: The username displayed in the profile dropdown is hardcoded as `"admin"`. There's no fetch of the actual authenticated user's info.
- **Where**: Top bar > Profile dropdown > username label
- **File**: `/frontend/src/components/layout/ProfileMenu.tsx` line 39
- **Severity**: P2 (polish) -- works for single-user setup but incorrect if usernames vary

---

## BUG 16: Settings panel is empty placeholder
- **What**: The Settings sheet opened from the profile menu contains only `"Settings panel -- broker API keys, preferences, and configuration."` as placeholder text. No actual settings controls exist.
- **Where**: Top bar > Profile dropdown > Settings
- **File**: `/frontend/src/components/layout/ProfileMenu.tsx` line 64
- **Severity**: P1 (confusing) -- clicking Settings leads to an empty panel with no functionality

---

## BUG 17: Logout doesn't use correct API URL
- **What**: The logout handler calls `fetch("/api/v1/auth/logout", ...)` without using the `NEXT_PUBLIC_API_URL` environment variable. In production where the API is on a different host/port, this would fail silently and never actually log the user out server-side.
- **Where**: Top bar > Profile dropdown > Logout
- **File**: `/frontend/src/components/layout/ProfileMenu.tsx` line 57
- **Severity**: P0 (broken) -- logout may not work in production deployment

---

## BUG 18: Keyboard shortcuts "?" opens overlay via key event dispatch, fragile
- **What**: The "Keyboard Shortcuts" menu item dispatches `window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))`. This works because useKeyboardShortcuts listens for "?" key. However, if the dropdown menu is focused (which it is when clicking), the keyboard event handler checks `tag === "INPUT"` but not for other interactive elements. The mechanism is fragile and could break if the shortcut handler is updated.
- **Where**: Top bar > Profile dropdown > "Keyboard Shortcuts" menu item
- **File**: `/frontend/src/components/layout/ProfileMenu.tsx` line 55
- **Severity**: P2 (polish) -- works but is a fragile pattern

---

## BUG 19: Command palette shortcut shows "Ctrl+K" on macOS (should be Cmd+K)
- **What**: The search bar in the top bar displays `Ctrl+K` as the keyboard shortcut hint. On macOS, the convention is `Cmd+K` (rendered as a cloverleaf symbol). The actual handler accepts both metaKey and ctrlKey, but the visual label is platform-incorrect on Mac.
- **Where**: Top bar > Search bar > keyboard shortcut hint
- **File**: `/frontend/src/components/layout/TopBar.tsx` line 48
- **Severity**: P2 (polish) -- works but shows wrong platform convention

---

## BUG 20: TOPBAR_H constant (72px) may be wrong
- **What**: The trade page calculates available height using `TOPBAR_H = 72` (comment says "TopBar h-11 (44px) + StatusStrip h-7 (28px)"). The TopBar uses `h-11` which is 44px in Tailwind, and StatusStrip uses `h-7` which is 28px. 44 + 28 = 72px. However, if any border, margin, or padding is added to these elements, the calculation would be off, potentially causing a scrollbar or content cut-off on the trade page.
- **Where**: Trade page (`/trade`), overall layout
- **File**: `/frontend/src/app/(dashboard)/trade/page.tsx` line 12
- **Severity**: P2 (polish) -- likely correct but brittle; a 1px border on the status strip would break it

---

## BUG 21: StatusStrip uses opacity classes for colored backgrounds that may not render
- **What**: The trading mode badge uses `bg-[var(--profit)]/15` and `bg-[var(--loss)]/15`. With Tailwind's arbitrary value syntax for CSS variables combined with opacity modifiers, this may not produce the intended result in all Tailwind versions. The slash opacity modifier works with named Tailwind colors but may fail with CSS custom properties unless configured correctly.
- **Where**: Status strip > trading mode badge
- **File**: `/frontend/src/components/layout/StatusStrip.tsx` line 68
- **Severity**: P1 (confusing) -- badge may appear without background color, making it hard to distinguish paper vs live mode

---

## BUG 22: Demo chart data watermark says "Demo data" but chart looks completely real
- **What**: When the API returns no bar data and the chart falls back to `generateDemoOHLCV()`, a small "Demo data" badge appears in the top-left corner. However, the demo data generates realistic-looking candlesticks with proper OHLCV structures, which could fool users who don't notice the tiny badge. The badge is very small (10px font) with amber color on dark background -- easy to miss.
- **Where**: Trade page (`/trade`), center chart panel
- **File**: `/frontend/src/components/panels/ChartPanel.tsx` lines 441-445
- **Severity**: P1 (confusing) -- demo data label is too subtle for how misleading the chart data is

---

## BUG 23: Quick buy/sell buttons on chart use black text, may be invisible
- **What**: The BUY and SELL quick-trade buttons use `text-black` class. These buttons sit on green (`var(--profit)`) and red (`var(--loss)`) backgrounds respectively. On the green background (#22c55e), black text works. But the entire page is dark-themed and these buttons blend poorly with the dark chart background when at 30% opacity (the default state).
- **Where**: Trade page (`/trade`), chart panel > right edge, BUY/SELL buttons
- **File**: `/frontend/src/components/panels/ChartPanel.tsx` lines 483-496
- **Severity**: P2 (polish) -- at 30% opacity the buttons are nearly invisible (intentional for non-hover state, but could be missed entirely)

---

## BUG 24: Trade Builder Net Debit sign is potentially confusing
- **What**: When building a trade, the "Net Debit" row displays `formatCurrency(Math.abs(netDebit))` without indicating whether it's a debit or credit. A bull call spread would show a debit, but the label always says "Net Debit" even when `netDebit > 0` (which represents a credit). The color comes from `getChangeTextClass(netDebit)` which shows green for positive (credit) and red for negative (debit), but the label "Net Debit" is misleading when the position is actually a net credit.
- **Where**: Trade page (`/trade`), right panel > Trade tab > risk summary
- **File**: `/frontend/src/components/panels/TradePanel.tsx` lines 316-320
- **Severity**: P1 (confusing) -- label says "Net Debit" for credit positions

---

## BUG 25: Max Profit/Loss calculations are oversimplified
- **What**: The Max Profit calculation `(maxStrike - minStrike) * 100 + netDebit` only works for vertical spreads. For a long straddle, iron condor, or single-leg option, this formula is wrong. For a naked call, max loss is theoretically unlimited, but the code shows `Math.abs(netDebit)`.
- **Where**: Trade page (`/trade`), right panel > Trade tab > risk summary
- **File**: `/frontend/src/components/panels/TradePanel.tsx` lines 149-155
- **Severity**: P0 (broken/misleading) -- shows incorrect risk metrics for multi-leg strategies

---

## BUG 26: Order placement sends only first leg's data as the main order
- **What**: When submitting a multi-leg trade, the `handleSubmit` function sends `side: legs[0].side, quantity: legs[0].quantity, price: legs[0].price` as the top-level order fields, with the full legs array nested inside. This means for a spread (buy one, sell another), the top-level order side only reflects the first leg, which could confuse the backend or broker API.
- **Where**: Trade page (`/trade`), right panel > Trade tab > submit button
- **File**: `/frontend/src/components/panels/TradePanel.tsx` lines 193-205
- **Severity**: P1 (confusing) -- may cause incorrect order submission for multi-leg trades

---

## BUG 27: Journal tab date shows "---" for orders without createdAt
- **What**: When `order.createdAt` is undefined/null, the journal entry shows `"---"` (em dash) as the date. This is acceptable but inconsistent with other empty states that use `"--"` or `"N/A"`.
- **Where**: Trade page (`/trade`), right panel > Journal tab
- **File**: `/frontend/src/components/panels/TradePanel.tsx` line 613
- **Severity**: P2 (polish) -- minor inconsistency in empty state display

---

## BUG 28: Pipeline page "Worst Trade" always shows loss color even for dash
- **What**: The "Worst Trade" performance card uses `text-[var(--loss)]` (red) for the value even when displaying `"---"` (no data). This makes the dash appear in red, implying something is wrong when there simply isn't data yet.
- **Where**: Pipeline page (`/pipeline`), Performance Summary > Worst Trade card
- **File**: `/frontend/src/app/(dashboard)/pipeline/page.tsx` line 704
- **Severity**: P1 (confusing) -- red dash implies a problem when there's simply no data

---

## BUG 29: Pipeline history table summary uses inline IIFE, hard to read
- **What**: The history table summary cell uses an inline IIFE `(() => { ... })()` for rendering, which while functional, makes the code hard to maintain. More importantly, it accesses `h.summary` which may not exist in the pipeline history response, potentially showing `undefined`.
- **Where**: Pipeline page (`/pipeline`), History section > Summary column
- **File**: `/frontend/src/app/(dashboard)/pipeline/page.tsx` lines 571-579
- **Severity**: P2 (polish) -- code quality issue, minor risk of showing `undefined`

---

## BUG 30: Strategy detail page Calmar Ratio divides by near-zero
- **What**: The Calmar Ratio is calculated as `perf.annualized_return_pct / Math.abs(perf.max_drawdown)`. The guard checks `Math.abs(perf.max_drawdown) >= 0.1`, which means a drawdown of 0.1% would produce a potentially huge Calmar Ratio that's meaningless. For a strategy that returned 10% with 0.1% max drawdown, Calmar would show 100.00 -- misleadingly impressive for what's likely a strategy with very few trades.
- **Where**: Strategy detail page (`/strategies/[id]`), metrics row > Calmar Ratio
- **File**: `/frontend/src/app/(dashboard)/strategies/[id]/page.tsx` lines 362-364
- **Severity**: P1 (confusing) -- can display misleadingly extreme values

---

## BUG 31: Strategy toggle (Pause/Resume) has no error feedback
- **What**: The `handleToggle` function catches errors silently with `catch { /* ignore */ }`. If toggling a strategy fails (network error, auth issue), the user gets no feedback -- the button just stops being disabled and nothing changes.
- **Where**: Strategy detail page (`/strategies/[id]`), Pause/Resume button
- **File**: `/frontend/src/app/(dashboard)/strategies/[id]/page.tsx` lines 266-271
- **Severity**: P1 (confusing) -- silent failure leaves user uncertain whether action succeeded

---

## BUG 32: Dashboard PortfolioHero shows $0.00 with no explanation when equity is 0
- **What**: When `portfolioValue` is 0 (no broker connected), the hero displays `$0.00` in large 36px text with a gradient. While the "Demo" badge appears when `isDemo` is true, if equity is genuinely 0 (not demo), there's no context for why it's zero. The large "$0.00" in premium typography looks like a broken state.
- **Where**: Dashboard page (`/`), Portfolio Hero section
- **File**: `/frontend/src/components/dashboard/PortfolioHero.tsx` lines 138-146
- **Severity**: P1 (confusing) -- large zero with no context looks broken

---

## BUG 33: AllocationDonut center text uses SVG `fill-foreground` class which may not work
- **What**: The SVG `<text>` element uses `className="fill-foreground"` and `className="fill-muted-foreground"`. These Tailwind classes apply `fill:` CSS property, but they reference CSS custom properties via the theme. SVG text fill via Tailwind classes may not work correctly if the CSS variables aren't properly mapped for SVG contexts.
- **Where**: Dashboard page (`/`), Market Context > Allocation donut (shown when no news)
- **File**: `/frontend/src/components/dashboard/AllocationDonut.tsx` lines 68-71
- **Severity**: P2 (polish) -- text in donut center may not render with correct colors

---

## BUG 34: PnlCalendarMini tooltip can overflow container
- **What**: The tooltip positioning uses `Math.max(0, Math.min(hovered.x - 80, containerWidth - 160))` for left positioning and `Math.max(0, hovered.y - 95)` for top. For cells in the first row of the calendar, `hovered.y` could be small (e.g. 20px), making `hovered.y - 95` negative and clamped to 0, causing the tooltip to overlap the calendar header.
- **Where**: Dashboard page (`/`), PnL Calendar Mini > hover tooltip
- **File**: `/frontend/src/components/dashboard/PnlCalendarMini.tsx` lines 116-135
- **Severity**: P2 (polish) -- tooltip may overlap content for top-row cells

---

## BUG 35: TopBar notification bell doesn't use asChild pattern (Radix warning)
- **What**: The `PopoverTrigger` wraps a `<Button>` component directly. In Radix UI, this creates a `<button>` inside a `<button>` (invalid HTML). The pattern should use `asChild` prop on `PopoverTrigger` to avoid nested buttons.
- **Where**: Top bar > Notification bell
- **File**: `/frontend/src/components/layout/TopBar.tsx` lines 53-60
- **Severity**: P2 (polish) -- invalid HTML nesting, may cause accessibility issues

---

## BUG 36: Options panel header shows static IV Rank/Percentile when no real data
- **What**: When the IV data API fails, `ivRank` defaults to 42 and `ivPctl` defaults to 38. These specific numbers are displayed as if they're real market data in prominent badges, with no demo/estimated indicator.
- **Where**: Trade page (`/trade`), bottom panel > Options header
- **File**: `/frontend/src/components/panels/OptionsPanel.tsx` lines 222-223
- **Severity**: P1 (confusing) -- fabricated IV metrics displayed as real data

---

## BUG 37: Options chain "Showing estimated prices" banner appears briefly then real data loads
- **What**: When the options chain query is loading, both the loading spinner AND the generated chain are briefly visible. The `usingGeneratedChain` check is `apiChain === null && !chainLoading`, so during loading the generated chain is suppressed, but after loading completes and API returns empty/error, the banner appears. This creates a flash of different states.
- **Where**: Trade page (`/trade`), bottom panel > Options chain
- **File**: `/frontend/src/components/panels/OptionsPanel.tsx` lines 218, 307-316
- **Severity**: P2 (polish) -- brief visual flash during state transition

---

## BUG 38: SectorTreemap "Information" abbreviation maps wrong
- **What**: The abbreviation map has `"Information": "Info Tech"` but the actual sector name from the API is likely "Information Technology", not just "Information". This means the abbreviation would never match and the full name "Information Technology" would be used, potentially overflowing the treemap cell.
- **Where**: Dashboard page (`/`), Market Context > Sector Performance treemap
- **File**: `/frontend/src/components/dashboard/SectorTreemap.tsx` lines 142-148
- **Severity**: P2 (polish) -- text may overflow in treemap cells for "Information Technology"

---

## BUG 39: Dashboard page has potential race condition in equity curve fetch
- **What**: The `fetchRemaining` function sets a `cancelled` flag on cleanup, but the equity curve fetch (`getPortfolioPerformance()`) runs after all other fetches complete (it's outside the `Promise.allSettled`). If the component unmounts during this sequential fetch, the `cancelled` check prevents state updates, but the request itself still completes unnecessarily.
- **Where**: Dashboard page (`/`), equity curve loading
- **File**: `/frontend/src/app/(dashboard)/page.tsx` lines 202-224
- **Severity**: P2 (polish) -- minor inefficiency, no visible bug

---

## BUG 40: EquityCurveSVG gradient ID may not be unique across instances
- **What**: The `useId()` hook is used to generate gradient IDs in EquityCurveSVG (PortfolioHero) and Sparkline components. While React's `useId()` should generate unique IDs, the `replace(/:/g, "")` transform could theoretically create collisions in edge cases (e.g., `:r1:` and `:r11:` both become `r1` and `r11` which are fine, but the pattern is fragile).
- **Where**: Dashboard page, PortfolioHero equity curve and all sparklines
- **Files**: `/frontend/src/components/dashboard/PortfolioHero.tsx` line 53, `/frontend/src/components/dashboard/Sparkline.tsx` line 33
- **Severity**: P2 (polish) -- unlikely collision but fragile pattern

---

## BUG 41: Backtest panel "MACD" strategy is actually SMA crossover with 12/26
- **What**: When the user selects "MACD Signal" strategy in the backtest panel, it runs `runSmaBacktest(bars, 12, 26, capital)` which is a simple SMA 12/26 crossover, NOT an actual MACD (which uses EMA 12/26 with a signal line of EMA 9). The backtest results are therefore wrong for a MACD strategy.
- **Where**: Pipeline page (`/pipeline`), Backtesting section > MACD strategy
- **File**: `/frontend/src/components/panels/BacktestPanel.tsx` line 181
- **Severity**: P0 (broken/misleading) -- labels it MACD but runs a completely different algorithm

---

## BUG 42: Strategy Builder "AI Refine" and "Backtest" buttons do nothing meaningful
- **What**: The "AI Refine" button runs `setTimeout(r, 1500)` (just waits 1.5 seconds) and then does nothing. The "Backtest" button exists but has no onClick handler besides the default, and doesn't connect to the BacktestPanel. Users clicking these get no result.
- **Where**: Pipeline page (`/pipeline`), Strategy Builder section
- **File**: `/frontend/src/components/panels/StrategyBuilder.tsx` lines 76-81, 169
- **Severity**: P1 (confusing) -- buttons appear functional but do nothing

---

## BUG 43: Options panel Expected Move is hardcoded calculation
- **What**: The Expected Move is calculated as `spotPrice * 0.032` (3.2% of spot price). This is a static approximation that doesn't use the actual ATM straddle price from the options chain. For volatile stocks, the expected move could be much higher; for stable stocks, much lower.
- **Where**: Trade page (`/trade`), bottom panel > Options header
- **File**: `/frontend/src/components/panels/OptionsPanel.tsx` line 224
- **Severity**: P1 (confusing) -- shows a specific dollar value that implies precision but is a rough estimate

---

## BUG 44: PnlCalendarMini uses opacity for intensity, making light-PnL days nearly invisible
- **What**: Days with small P&L values have `opacity: 0.3 + intensity * 0.7` where intensity is `Math.min(|pnl| / 500, 1)`. A day with $10 P&L gets opacity of ~0.31, making the cell nearly invisible. Combined with green/red background colors, these low-opacity cells are hard to distinguish from empty days.
- **Where**: Dashboard page (`/`), PnL Calendar Mini
- **File**: `/frontend/src/components/dashboard/PnlCalendarMini.tsx` lines 81, 93
- **Severity**: P2 (polish) -- small PnL days blend into background

---

## BUG 45: Trade page has fixed panel widths that don't adapt to screen size
- **What**: The trade page uses fixed pixel widths: Watchlist=240px, Analysis=300px, TradePanel=380px. On screens narrower than ~920px (240+300+380), the chart panel gets `width: calc(100vw - 240px - 300px)` which could be 0 or negative, making the chart disappear or overlap panels.
- **Where**: Trade page (`/trade`), overall layout
- **File**: `/frontend/src/app/(dashboard)/trade/page.tsx` lines 13-15
- **Severity**: P0 (broken) -- chart panel may be invisible on smaller screens or laptops with limited width

---

## BUG 46: Strategy detail page uses spinner icon for loading (misleads about type)
- **What**: The loading state shows `<Activity className="h-6 w-6 animate-spin" />`. The Activity icon (a heartbeat/pulse line) spinning looks odd -- it should be a Loader2 or RefreshCw icon for loading states. Activity spinning creates a visual that looks like a medical monitor rather than a loading indicator.
- **Where**: Strategy detail page (`/strategies/[id]`), loading state
- **File**: `/frontend/src/app/(dashboard)/strategies/[id]/page.tsx` line 284
- **Severity**: P2 (polish) -- wrong icon choice for loading state

---

## BUG 47: Keyboard shortcuts overlay shows "Customize bindings in localStorage" -- developer-facing text
- **What**: The shortcuts overlay footer says `'Customize bindings in localStorage key "alphadesk:keybindings"'`. This is developer-facing technical language that end users won't understand. It should either be removed or rephrased as user-friendly instructions.
- **Where**: Keyboard shortcuts overlay (press "?")
- **File**: `/frontend/src/components/ui/shortcut-overlay.tsx` lines 60-62
- **Severity**: P2 (polish) -- exposes implementation detail to end users

---

## SUMMARY

### P0 - Broken/Misleading (6 bugs)
1. BUG 3: Keyboard shortcut key mapping conflicts between trade page and global shortcuts
2. BUG 4: Fundamental analysis text is always positive regardless of stock quality
3. BUG 5: Sentiment tab shows hardcoded data with no disclaimer
4. BUG 8: Chat fallback always gives bullish analysis regardless of actual stock trend
5. BUG 41: Backtest MACD strategy actually runs SMA crossover (wrong algorithm)
6. BUG 45: Trade page layout breaks on screens narrower than ~920px

### P1 - Confusing (15 bugs)
7. BUG 1: Dashboard market sparklines are flat lines (always 100)
8. BUG 2: Strategy grid sparklines are flat lines (always 100)
9. BUG 7: Sentiment score gauge shows arbitrary 50 when no data
10. BUG 11: Watchlist change % is fabricated from symbol hash
11. BUG 13: PnL Calendar (full) uses demo data without label
12. BUG 16: Settings panel is empty placeholder
13. BUG 21: StatusStrip opacity on CSS variables may not render
14. BUG 22: Demo chart data watermark is too subtle
15. BUG 24: Trade builder label says "Net Debit" for credit positions
16. BUG 25: Max Profit/Loss calculations wrong for non-spread strategies
17. BUG 28: Worst Trade card shows red dash even with no data
18. BUG 30: Calmar Ratio can show misleadingly extreme values
19. BUG 31: Strategy toggle has no error feedback
20. BUG 36: Options IV Rank/Percentile are fabricated when API fails
21. BUG 42: Strategy Builder buttons do nothing

### P2 - Polish (12 bugs)
22. BUG 9: Economic Calendar sample events use real-looking dates
23. BUG 10: Signals tab uses specific stock symbols in hardcoded data
24. BUG 12: MiniSparkline in watchlist uses generic paths
25. BUG 14: Profile avatar hardcoded to "A"
26. BUG 15: Profile username hardcoded to "admin"
27. BUG 17: Logout doesn't use API base URL
28. BUG 18: Keyboard shortcuts menu item uses fragile key event dispatch
29. BUG 19: "Ctrl+K" shown on macOS instead of "Cmd+K"
30. BUG 20: TOPBAR_H constant is brittle
31. BUG 23: Quick trade buttons nearly invisible at default opacity
32. BUG 38: SectorTreemap abbreviation for "Information Technology" doesn't match
33. BUG 47: Shortcuts overlay shows developer-facing localStorage text

### Additional Notes (lower severity)
- BUG 6, 27, 29, 33, 34, 35, 37, 39, 40, 43, 44, 46
