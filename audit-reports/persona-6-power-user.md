# Persona 6 — Keyboard-First Power User Audit

Scope: `useKeyboardShortcuts.ts`, `CommandPalette.tsx`, `shortcut-overlay.tsx`, `OrderBar.tsx`,
`TopBar.tsx` (layout + composite), `OnboardingTour.tsx`, `ProfileMenu.tsx`, dashboard `layout.tsx`,
`/trade` and `/` desk pages, `TradePanel.tsx`. Login round-trip verified live (HTTP 200 on
`/api/v1/auth/login`).

## Top 10 findings (summary, ~400 words)

### 1. Number-key timeframes (1-8) are dead on every page
`DEFAULT_BINDINGS` maps `1`..`8` to `chart:timeframe:1m..M` and the default branch of
`handleAction` dispatches `alphadesk:shortcut`. Nothing listens. `PriceChartPanel` (the only
chart mounted on `/` and `/trade`) is driven by `ChartRange = "1D"|"5D"|"1M"|"3M"|"6M"|"YTD"|"1Y"|"ALL"`
and has no event listener. Pressing `1` on the desk visibly does nothing. Intraday timeframes
(1m/5m/15m/1H/4H) don't even exist in the chart component. Shortcuts are listed in the overlay
under "Chart" — so the overlay lies to the user.

### 2. `Shift+C` / `Shift+F` / `Shift+S` handlers live in a component that isn't mounted
`TradePanel.tsx` is the only `window.addEventListener("alphadesk:shortcut", ...)` consumer
(lines 593-655) and is only referenced by tests. Grep for `<TradePanel` in `src/` outside
`__tests__` returns zero. Close-all / flatten / stop-loss shortcuts dispatch but no-op. All
three are flagged "New" in the overlay — they never worked in production.

### 3. `Ctrl+J` / `Cmd+J` copilot toggle fires an event no one listens for
`AICopilot.tsx` is rendered by the dashboard layout but has no handler for
`alphadesk:shortcut` with `copilot:toggle`. The overlay advertises it as a new shortcut.

### 4. Escape does not close the shortcut overlay when its filter input is focused
`shortcut-overlay.tsx` auto-focuses its filter input on mount (line 99). The global
keydown listener in `useKeyboardShortcuts.ts:260` early-returns on `INPUT` targets, so Esc
is swallowed. Overlay has no local Esc handler. Click-outside works; keyboard-only users
are trapped until they tab out of the input first.

### 5. OnboardingTour has no Escape handler at all
`OnboardingTour.tsx` registers no `keydown` listener. Tour dismisses only on backdrop click
or Skip/Done button click. A keyboard-only first-time user who tabs into the tooltip can
hit Enter on "Skip", but Esc is inert.

### 6. Published `g X` shortcuts only cover 3 of 7 nav targets
Only `g d`, `g t`, `g p` are wired. No `g s` (strategies), `g a` (analytics), `g l` (alerts),
`g r` (reports). TopBar exposes all seven. Persona-3 audit explicitly called out the
missing analytics shortcut — still not added.

### 7. `n`/`p` tab-cycle skips `/strategies` and `/reports`
`TAB_ORDER = ["/", "/trade", "/analytics", "/alerts", "/pipeline"]` (line 129). TopBar
navigation has 7 items; the cycle ignores 2 of them. Power user expecting `n` to round-trip
all primary tabs lands on the wrong page.

### 8. Command palette "Analyze current symbol" still toasts "coming soon"
`CommandPalette.tsx:182-186`. Persona-1 flagged this as dead weight. It's still listed
with shortcut hint `A` — the shortcut hint is decorative, no `A` binding exists. Keyboard
user who reads the hint assumes the feature is wired.

### 9. `b`/`s` quick-buy/sell dispatches a click event, not a real order staging
`useKeyboardShortcuts.ts:231-247` runs `btn.click()` on the Buy/Sell chip, then focuses the
qty field. This only selects the side; no order is staged. If the user expected the
documented behavior ("Quick buy at market"), they now have to tab to Submit. Misaligned with
the shortcut description.

### 10. `f` and `/` both focus the command palette — `/` is documented, `f` hijacks typeahead
`f` is listed as `focus:search`. It opens the palette. But `f` is also a normal letter
keystroke users expect when typing; outside inputs it triggers navigation. Power users used
to Gmail/GitHub `f` filter conventions, plus adjacent muscle-memory collision with the
single-letter `b`/`s` order chords, makes this footgun-prone. No conflict detection if a
user rebinds.

## Additional concrete breakages

- **OnboardingTour tooltip is not focus-trapped.** `role="dialog" aria-modal="true"` is set
  on the outer div, but nothing intercepts Tab — user tabs out of the spotlight and lands
  on whatever is beneath.
- **Command palette opens `/strategies/momentum-quality`.** The dynamic route `[id]` exists;
  `STRATEGY_META["momentum-quality"]` exists — so this works. Verified.
- **`useShortcutHandler` is exported and never imported.** The "page-scoped handler registry"
  in `useKeyboardShortcuts.ts:149-160` is dead code. The explicit opt-out path intended for
  the desk page to hook `chart:quick-buy` is unused.
- **OrderBar tab order is correct** but disabled (`priceRequired=false`) Price/Stop fields
  are still in tab sequence — tabbing hits `disabled` inputs. Chrome skips them, but screen
  readers may still announce. Visual order: Strategy, Side chips (Buy then Sell), Symbol,
  Qty, Type, Price, Stop, Stage. Matches the expected flow except the review copy sits
  between Stop and the Stage button.
- **Login form focus rings present**, username `autoFocus` on mount, show-password toggle
  now in tab order (Wave a11y r3). Enter submits correctly. This path is solid.
- **TopBar search button** (`data-tour="search-bar"`) is keyboard-reachable and has a
  visible kbd hint. Enter opens the palette. Working.
- **`j`/`k` watchlist cycling** — works via `useMarketStore.getState()` but the watchlist
  panel is not present on every page; on `/trade` there is no watchlist, so `j`/`k` silently
  mutate the selected symbol with no visible feedback in the UI.
- **Esc inside CommandPalette** — closes (Base UI Dialog handles Esc internally). Verified.
- **ProfileMenu dropdown** — Base UI Menu primitives handle arrow-nav and Enter correctly.
  Keyboard Shortcuts menu item dispatches a synthetic `?` keydown (line 131) which does
  NOT propagate through the global listener because `document.dispatchEvent` targets
  `document` — the listener checks `e.target.tagName` on the event target, not the key.
  Untested but likely works because dispatchEvent sets target to `document`, not an input.

## Files touched / key line references

- `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useKeyboardShortcuts.ts`
  - L8-35 `DEFAULT_BINDINGS` — advertises unwired `1`-`8`, `Ctrl+j`, `Shift+{C,F,S}`
  - L129 `TAB_ORDER` — missing `/strategies`, `/reports`
  - L149-160 `useShortcutHandler` — exported, zero call sites
  - L231-247 `chart:quick-buy`/`chart:quick-sell` — `.click()` side chip only
  - L258-263 input-guard early return — breaks Esc inside overlay filter
- `/Users/GK/Downloads/alphadesk/frontend/src/components/ui/shortcut-overlay.tsx`
  - L97-100 auto-focus filter input
  - No local Esc handler
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/OnboardingTour.tsx`
  - L67-323 zero `keydown` listeners
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/TradePanel.tsx`
  - L594-655 positions shortcut handler in an unmounted component
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PriceChartPanel.tsx`
  - L33 `RANGES` uses `"1D".."ALL"` — mismatched with shortcut timeframes
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/CommandPalette.tsx`
  - L176-186 "Analyze current symbol" toasts "coming soon"
  - L311-321 shortcut hints (`A`, `S`, `1`) are decorative, not bound
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/OrderBar.tsx`
  - L189-201 symbol field focus ring inherited from `Input`; OK
  - L237-265 disabled Price/Stop remain in DOM tab order

## Recommended priorities (rough)

P0 — Wire `1-8` to `PriceChartPanel.onRangeChange` (or redefine the binding to match the
existing ranges), mount the positions shortcut handler on `/` (move it out of TradePanel),
add Esc handler to ShortcutOverlay and OnboardingTour.

P1 — Add `g s`, `g a`, `g l`, `g r`. Extend `TAB_ORDER` to 7. Toggle copilot on `Cmd+J`.
Remove `f` as a palette binding or gate it behind a modifier.

P2 — Either wire `useShortcutHandler` via the desk page (real quick-buy order stage) or
delete the dead export. Remove decorative shortcut hints in CommandPalette until real
bindings exist.
