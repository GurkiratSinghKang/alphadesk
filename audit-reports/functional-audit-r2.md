# AlphaDesk Functional / Interaction Audit — R2

Date: 2026-04-18
Scope: Next.js 16 frontend at `/Users/GK/Downloads/alphadesk/frontend`.
Focus: Dead buttons, broken flows, missing error handling, state / contract bugs.

Legend:
- **P0** — visibly broken / data-loss / dead primary flow / silent failure on a prominent button.
- **P1** — functional but flawed UX (wrong type, missed handler path, contract drift).
- **P2** — polish, minor defects, hidden nits.

---

## Top-of-mind summary

The flagship desk (`/`) was refactored into a composite shell (`DeskLayout`) but a swath of legacy infrastructure (CommandPalette commands, keyboard shortcuts, ProfileMenu, OrderBar "stage") still targets the older panel-tab model (`useUIStore.activePanels`) or the removed `TradePanel`. As a result ~15 prominent UI affordances look live but produce no visible effect on the route where they appear.

The Order Bar on the desk page is a **reviewer-only stub** — it routes to `/trade`, which itself is a stub that redirects back to `/`. There is **no way to actually submit an order from the flagship page**.

---

## Findings

### [P0] OrderBar "Stage order →" does not submit an order
**File:** `frontend/src/app/(dashboard)/page.tsx:196-202`
**Symptom:** User fills the order bar (strategy, side, qty, type, price, stop) and clicks "Stage order →". Nothing is submitted, no toast, no API call, no error. The page navigates to `/trade`.
**Cause:** Handler ignores its argument and only does `router.push("/trade")`:
```
function handleStageOrder(_order: StagedOrder) {
  router.push("/trade");
}
```
Combined with the next finding this is a dead end.
**Fix:** Call `placeOrder()` (from `@/lib/api`) with the staged payload inside a try/catch that surfaces errors via `useToast`; push the resulting order into `usePortfolioStore` via `addOrder`. Consider a confirmation dialog like the legacy `TradePanel.confirmSubmit`.

---

### [P0] `/trade` is a redirect-only stub
**File:** `frontend/src/app/(dashboard)/trade/page.tsx:15-21`
**Symptom:** Clicking "Trade" in TopBar, or being routed by OrderBar, both land the user right back at `/`. The URL briefly flickers to `/trade`, then returns. `CommandPalette` actions that fall back to `window.location.href = "/trade"` (e.g. "Focus options chain") create the same loop.
**Cause:**
```
export default function TradeRedirect() {
  useEffect(() => { router.replace("/"); }, [router]);
  return null;
}
```
The nav item is still shown as a first-class route in the TopBar (`/trade`, `isTrade`, etc.) and in keyboard shortcuts (`g t`, `navigate:next-tab`).
**Fix:** Either remove the `/trade` route (and update TopBar + `KNOWN_DASHBOARD_ROUTES` + `TAB_ORDER` + CommandPalette) or mount a real workspace at `/trade` again. Don't leave it as a redirect.

---

### [P0] CommandPalette commands silently do nothing on the main desk page
**File:** `frontend/src/components/layout/CommandPalette.tsx:171-213`
**Symptom:** "Analyze current symbol", "Screen momentum stocks", "Show portfolio", "Focus chart panel" all close the palette and visibly do nothing on `/` (the flagship page the palette is most often opened on).
**Cause:** The handlers drive `useUIStore.setActiveTab("left", "screener")`, `setActiveTab("right", "technical")`, `setActiveTab("bottom", "positions")`, etc. But the flagship `DeskLayout` never reads `activePanels` — only the legacy `TradePanel` / `WatchlistPanel` / `AnalysisPanel` do, and those are not mounted on `/`. `handleFocusOptions` also looks for `[data-slot='options-panel']`, which is not present on `/` either.
**Fix:** Either (a) route these commands to concrete URLs (`/analytics`, `/pipeline`) or dispatch `alphadesk:shortcut` events that the desk page listens for; or (b) mark them `disabled` and hide on `/`. At minimum `handleAnalyze` should dispatch a custom event the desk can react to rather than flipping a state nothing reads.

---

### [P0] Global keyboard shortcuts (j/k/b/s/1–8/Shift+C/F/S) have no listener on `/`
**File:** `frontend/src/hooks/useKeyboardShortcuts.ts:139-183` (dispatcher); `frontend/src/components/panels/TradePanel.tsx:592-652` (only listener).
**Symptom:** On the flagship desk page, pressing `b`, `s`, `1`, `2`, `j`, `k`, `Shift+C`, `Shift+F`, `Shift+S` does nothing. The shortcut dialog (pressing `?`) claims these all work.
**Cause:** `handleAction` dispatches `window.dispatchEvent(new CustomEvent("alphadesk:shortcut", { detail: actionId }))` for everything but the hardcoded cases. The only listener is in `TradePanel.tsx:650`, which is not mounted on `/`.
**Fix:** Add listeners in the desk `page.tsx` (or a dedicated `DeskShortcuts` component) that handle the actions meaningful on `/` — quick-buy/sell (open OrderBar pre-filled), chart timeframe switch, watchlist j/k through `StrategyRail` or a dedicated watchlist. Remove listings for actions that don't map to the desk.

---

### [P0] StrategyTemplates "Activate Template" fires random toggles instead of setting state
**File:** `frontend/src/components/panels/StrategyTemplates.tsx:241-273`
**Symptom:** Clicking "Activate Template" on any template flips every strategy's active/paused state once, regardless of whether the strategy should become active or inactive. Results in a half-random portfolio configuration and the "active state" shown is purely local.
**Cause:**
```
const togglePromises = ALL_STRATEGY_IDS.map((sid) => {
  const shouldBeActive = template.strategies.includes(sid);  // computed, never used
  return toggleStrategy(sid).catch(() => {});
});
```
`toggleStrategy` is an unconditional flip — no "set to" API exists. `shouldBeActive` is discarded.
**Fix:** Either add a `PUT /api/v1/strategies/{id}/status {status}` endpoint, or first `GET /api/v1/strategies/` to read current state and only call `toggleStrategy` on strategies whose current state differs from the desired state. Until that lands, the button should be disabled or surface a warning.

---

### [P0] ProfileMenu logout uses relative URL — breaks when API is cross-origin
**File:** `frontend/src/components/layout/ProfileMenu.tsx:61`
**Symptom:** If `NEXT_PUBLIC_API_URL` points to a different origin than the frontend (common in split deployments), clicking "Logout" hits `/api/v1/auth/logout` on the *frontend* origin — a 404 or misroute. The session cookie on the backend is never revoked. The `document.cookie = ...` line that follows cannot clear an HttpOnly cookie anyway.
**Cause:** Hardcoded relative URL:
```
await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
```
Compare `api.ts:102` which uses `${base}/api/v1/auth/logout`.
**Fix:** Use the existing `env.API_URL` base (or factor the `apiFetch` path out). Cross-origin cookies require `credentials: "include"` AND the backend CORS/Set-Cookie domain must allow it.

---

### [P0] ProfileMenu "Confirm Live Mode" flips state AND shows "can't switch" toast
**File:** `frontend/src/components/layout/ProfileMenu.tsx:106`
**Symptom:** Clicking "Confirm Live Mode" in the dialog sets `tradingMode=live` (the badge turns red, the OrderBar tint changes) AND pops a toast saying *"Trading mode is configured server-side. Contact admin to switch between paper and live."* The two messages contradict each other; the user is left unsure which is real.
**Cause:**
```
onClick={() => {
  setTradingMode("live");          // flips local state
  setModeConfirmOpen(false);
  toast({ type: "warning", message: "Trading mode is configured server-side..." });
}}
```
**Fix:** If the mode really is server-side, don't flip the local state — just toast. If the local flag is honoured (it changes `TradePanel`/OrderBar styling and decides `placeOrder` endpoint selection client-side), delete the misleading toast.

---

### [P0] `StrategyBuilder` "Backtest" button has no onClick
**File:** `frontend/src/components/panels/StrategyBuilder.tsx:205-207`
**Symptom:** Clicking the "Backtest" button next to "Refine with AI" in the Strategy Builder produces nothing.
**Cause:**
```
<Button size="sm" className="text-xs gap-1.5">
  <Play className="h-3 w-3" /> Backtest
</Button>
```
No handler.
**Fix:** Wire it to `BacktestPanel` (lift state up or route to `/pipeline#backtest`) or remove the button until the feature lands.

---

### [P0] `cancelOrder` API return type mismatches backend (204 No Content)
**File:** `frontend/src/lib/api.ts:485-489` and `backend/api/routes/trades.py:361-384`.
**Symptom:** Cancelling an order throws a JSON parse error on success. The order is cancelled on the broker, but the UI shows a generic failure toast, the order is not marked `cancelled` locally, and `updateOrderStatus(id, "cancelled")` (TradePanel.tsx:847) never runs.
**Cause:** Frontend:
```
return apiFetch<{ success: boolean }>(`/api/v1/trades/orders/${orderId}`, { method: "DELETE" });
```
`apiFetch` always calls `res.json()` on a 2xx response. Backend returns `status_code=204, response_model=None` — empty body — and `res.json()` rejects.
**Fix:** Either accept 204 in `apiFetch` (branch on `res.status === 204 || !res.headers.get("content-length")` and return `undefined as T`) or change the backend to return `{ ok: true }` with 200.

---

### [P0] `toggleStrategy` typed as `{ strategy_id, new_status }` but server returns `{ id, name, previous_status, new_status }`
**File:** `frontend/src/lib/api.ts:181-183`; `backend/api/routes/strategies.py:1295-1300`.
**Symptom:** Not crashing today because only `new_status` is read. But any caller that reads `res.strategy_id` (legacy code paths / future) gets `undefined`. StrategyTemplates uses `strategy_id` through `toggleStrategy`'s compatible shape.
**Fix:** Align the TS type with the Pydantic model (`{ id: string; name: string; previous_status: string; new_status: string }`).

---

### [P0] `getPortfolioPerformance` contract drift — frontend expects `equity_curve`, backend returns `PerformanceMetrics`
**File:** `frontend/src/lib/api.ts:672-674`; `backend/api/routes/portfolio.py:461`.
**Symptom:** `/analytics` page reads `perfRes.value.equity_curve` — if the backend returns `PerformanceMetrics` (an object with `returns`, `sharpe`, etc.) the `equity_curve` check silently fails and the page shows empty drawdown / Sharpe / distribution charts with "No data" states even when data exists.
**Cause:**
```
export function getPortfolioPerformance() {
  return apiFetch<{ equity_curve: { date: string; cumulative_pnl: number }[] }>(`/api/v1/portfolio/performance`);
}
```
But the backend model is `PerformanceMetrics` which does not structurally contain `equity_curve`.
**Fix:** Read the backend model and either add `equity_curve` to it or change the frontend type + usage. Verify against backend `portfolio.py:461` response shape.

---

### [P1] Login form — failing attempts persist across refresh but success clears them only client-side
**File:** `frontend/src/app/login/_login/LoginForm.tsx:128-136`
**Symptom:** With 4 failures logged in localStorage, a successful login clears the list — but the server-side rate-limit in `auth.py:129-142` is independent. If the user was already over the server limit, they get a 429 but the UI shows "Invalid username or password" instead of the lockout message.
**Cause:** `res.json().catch(() => ({}))` then `body.detail ?? "Invalid..."`. The backend does set `detail` for 429, so it *would* surface — but only if the request actually reached the server. Once the client-side lockout engages (5 failures), the backend counter keeps ticking only on actual requests, so there's a subtle double-counter / desync.
**Fix:** Surface server status code explicitly: if `res.status === 429` display a distinct "Rate-limited by server, retry later" message and seed the client lockout with the `Retry-After` header so the two counters stay aligned.

---

### [P1] Login — "Forgot password" is documentation-only, not a real reset flow
**File:** `frontend/src/app/login/reset/page.tsx:23-83`
**Symptom:** "Forgot password?" links to a page that says "Email support@tradingalpha.net". Users with no email access (e.g. their account is tied to a shared inbox) are stuck.
**Cause:** No token-signed email flow, no reset endpoint in `auth.py` (only `/login`, `/refresh`, `/logout`).
**Fix:** Either implement `/auth/request-reset` + `/auth/reset` with a TOTP/token email or remove the "Forgot password?" link (and the whole `/login/reset` surface) and inline the contact address on the login form. Document copy currently claims "automated reset is not wired yet" — decide which side of the promise to deliver.

---

### [P1] `getAccessToken` reads `document.cookie` but backend sets HttpOnly — dead path
**File:** `frontend/src/lib/api.ts:17-21`, `48-50`.
**Symptom:** Every API request tries to attach a `Authorization: Bearer <token>` header but always fails to, because `document.cookie` cannot read HttpOnly cookies. Backend falls back to cookie auth in `core/auth.py:159` — so everything works, but the auth header code is misleading dead weight. If a user-side script (e.g. a browser extension) sets a plaintext `access_token` cookie, it'd be injected as Authorization unfiltered.
**Fix:** Delete the `getAccessToken()` / `Authorization` branch. Rely solely on the HttpOnly cookie + `credentials: "include"` (already set).

---

### [P1] `handleStageOrder` on desk page discards the order payload instead of persisting or confirming
**File:** `frontend/src/app/(dashboard)/page.tsx:196-202`, see also P0 entry above.
**Symptom:** If OrderBar is eventually wired to pre-fill a confirmation screen, the staged order will never be forwarded because the handler drops `_order`.
**Cause:** `function handleStageOrder(_order: StagedOrder)` — the underscore prefix marks it intentionally unused.
**Fix:** When the real flow lands, pass it through query params or a store.

---

### [P1] `document.cookie = "access_token=; path=/; max-age=0"` cannot clear HttpOnly cookies
**File:** `frontend/src/lib/api.ts:99-101`, `frontend/src/components/layout/ProfileMenu.tsx:61`.
**Symptom:** On 401 the client attempts to clear `access_token` / `refresh_token` via JS. This always no-ops (HttpOnly flag). The session only clears if the backend `/logout` call succeeds.
**Cause:** HttpOnly cookies are invisible to JS.
**Fix:** Remove the JS cookie writes — they're confusingly unconditional. Rely on server-side `Set-Cookie: ..; Max-Age=0` in the `/logout` response (already done in `auth.py:195`) and on middleware revocation.

---

### [P1] 401 auto-redirect in `apiFetch` fires a logout POST without awaiting
**File:** `frontend/src/lib/api.ts:96-104`
**Symptom:** On 401, `apiFetch` triggers `fetch(.../logout).catch(() => {})` then immediately does `window.location.href = "/login"`. The logout POST is typically cancelled by the navigation; the backend-side token revoke therefore fails for most 401 paths.
**Fix:** Either `await` the logout fetch (with a small timeout) before redirecting, or use `navigator.sendBeacon` for a fire-and-forget logout.

---

### [P1] `WatchlistPanel` rejects ticker inputs >5 chars
**File:** `frontend/src/components/panels/WatchlistPanel.tsx:843`
**Symptom:** Typing `GOOGL` (5) works; typing `BRK.A` / `SHEL.L` / any SPAC ticker >5 is silently rejected (no toast, no error).
**Cause:** `/^[A-Z]{1,5}$/i.test(sym)` — too restrictive; also excludes `.` and digits.
**Fix:** Relax to `/^[A-Z][A-Z0-9.\-]{0,9}$/i` (matches backend's `^[A-Z]{1,10}$` with some room) and show a validation toast on rejection.

---

### [P1] CommandPalette's "last order / last trade / last alert" actions have no data behind them
**File:** `frontend/src/components/layout/CommandPalette.tsx:43-47`, `417-423`.
**Symptom:** Searching "last" in the palette shows three "Recent Actions" entries. Selecting "last alert" navigates to `/alerts` (fine). "last order" and "last trade" route to `setActiveTab("bottom", "orders")` which only affects the legacy panel layout — on the desk, nothing happens.
**Cause:** Placeholder implementation — the `RECENT_ACTIONS` array is static, never sourced from a query, and the handler does not actually surface the last record.
**Fix:** Hide these actions until they have backing data, or make them open a contextual toast / dialog showing the last record fetched from `/trades/orders?limit=1` or `/trades/history?limit=1`.

---

### [P1] `CommandPalette` handleFocusOptions bypasses router for same-app navigation
**File:** `frontend/src/components/layout/CommandPalette.tsx:204-213`
**Symptom:** "Focus options chain" does a full `window.location.href = "/trade"` — a hard navigation (flash of blank, React tree remount) instead of client-side route change. Combined with `/trade` being a redirect to `/`, the user sees 2 flashes.
**Fix:** `router.push("/trade")` or wire to a panel on `/`. Given `/trade` isn't real today, probably just remove this command.

---

### [P1] `Analytics` page silently collapses when server returns `{}` for performance
**File:** `frontend/src/app/(dashboard)/analytics/page.tsx:477-485`
**Symptom:** If `/api/v1/portfolio/performance` returns a payload without `equity_curve`, the page renders "No drawdown data", "Not enough data for rolling Sharpe", "No return data", "No monthly data" — all empty states. There's no indication that the backend returned the wrong shape; looks like the user simply has no trades.
**Fix:** Add an error state branch: if the fetch succeeded but shape is wrong, toast "Performance data unavailable" rather than silently showing empty panels.

---

### [P1] Settings page "Dark theme" marked active, "Light theme" says "Coming soon" — but the real theme setting is in a different section
**File:** `frontend/src/components/layout/ProfileMenu.tsx:69-88`
**Symptom:** The Sheet at right-side of the profile menu shows an "Appearance" section with dark/light tiles neither of which is a toggle, plus a "Configuration" empty state saying "Broker API keys, preferences, and additional configuration coming soon." Meanwhile `/settings` has the real settings. Users looking for settings in the profile menu will be told "coming soon" even though the features exist.
**Fix:** Replace the in-menu Sheet with a link to `/settings` (where real controls live) or finish wiring the sheet.

---

### [P1] Workspace selector dispatches event but DeskLayout / DashboardShell never react
**File:** `frontend/src/components/layout/WorkspaceSelector.tsx:57-62`; no listener found.
**Symptom:** Changing workspace ("Morning Research", "Active Trading", etc.) does nothing visible except re-storing the choice in localStorage.
**Cause:** `window.dispatchEvent(new CustomEvent("alphadesk:workspace-change", ...))` with no receiver.
**Fix:** Either wire `DashboardShell` / dashboard components to listen for the event and collapse/expand sections per the `expanded` array, or remove the selector.

---

### [P1] `rangeToLimit` in desk page returns 2 for "1D" — chart series of 2 bars renders as a flat line
**File:** `frontend/src/app/(dashboard)/page.tsx:279-290`
**Symptom:** Selecting the "1D" chart range draws a straight line (or nothing), because the frontend requests only 2 daily bars. Users trying to see intraday context will see a degenerate chart.
**Cause:** The mapping is pure day counts; "1D" returns 2. On the desk `getBars(symbol, "D", 2)` fetches 2 daily bars, not intraday data.
**Fix:** For "1D" switch the timeframe to `5m` or `15m` and raise the limit; or remove "1D" from the range options.

---

### [P1] `isMarketOpen()` uses UTC heuristic, gets DST wrong for ~7 months/year
**File:** `frontend/src/app/(dashboard)/page.tsx:292-302`
**Symptom:** The StatusBar's "market open" pill is off-by-an-hour during Eastern Daylight Time (Mar–Nov). Appears closed when market is open for the first/last hour of the EDT session.
**Cause:** Hardcoded `13:30 UTC → 20:00 UTC` = 9:30–16:00 EST; wrong during EDT.
**Fix:** Use `Intl.DateTimeFormat` or `zoneinfo` equivalent with `timeZone: "America/New_York"` to compute the ET hours. Better still, render from the backend's `market-status` endpoint (`backend/api/routes/market.py:636`).

---

### [P1] `placeOrder` maps `trailing_stop` but the backend `OrderType` enum lacks it
**File:** `frontend/src/lib/api.ts:453-483` and `backend/api/routes/trades.py:63-67`.
**Symptom:** Users selecting "trailing stop" (not currently in `OrderBar` but typed in `PlaceOrderPayload`) would get a 422 validation error from the backend.
**Cause:** Frontend `"trailing_stop"` → mapped into `order_type: payload.type` which goes into `OrderLeg.order_type: OrderType` — enum only knows `market`/`limit`/`stop`/`stop_limit`.
**Fix:** Either add `TRAILING_STOP` to the backend enum with proper trail_price handling, or drop `trailing_stop` from the TS union.

---

### [P1] `placeOrder` hard-codes `time_in_force: "day"`
**File:** `frontend/src/lib/api.ts:479-482`
**Symptom:** User cannot place GTC / IOC / FOK / OPG / CLS orders — the backend enum supports them.
**Fix:** Thread `time_in_force` through `PlaceOrderPayload` and OrderBar UI.

---

### [P1] WebSocket `auth` message sent with plaintext token, but the token is HttpOnly — always empty
**File:** `frontend/src/hooks/useWebSocket.ts:73-77`
**Symptom:** On every WS connect the code tries to read `document.cookie.match(/(?:^|; )access_token=.../)[1]` — this returns undefined under HttpOnly. So `ws.send(...)` never fires; the WS frame is un-authed.
**Cause:** Same HttpOnly issue as in `api.ts`.
**Fix:** Backend should authenticate via the same cookie the Upgrade request carries (sent automatically by the browser). Remove the `auth` action — or fetch a short-lived WS token via a REST endpoint and send that.

---

### [P1] StatusStrip "LIVE" indicator ties to raw WS `isConnected` regardless of auth state
**File:** `frontend/src/components/layout/StatusStrip.tsx:60-73`
**Symptom:** If WS connects but auth fails (see above), the user sees a green "LIVE" dot while the socket is actually unusable. Quote updates never arrive but the pill stays green.
**Fix:** Only show LIVE after the first message (or explicit "authenticated" ack) on any channel.

---

### [P1] `OrderBar` `symbol` input accepts anything — no validation
**File:** `frontend/src/components/composites/OrderBar.tsx:131-139`
**Symptom:** User can type `GOO...GL@#` and the value is staged as-is. Since `handleStageOrder` doesn't submit, it doesn't matter yet — but once wired the backend will 422.
**Fix:** Match the backend pattern `^[A-Z]{1,10}$`; trim whitespace; use the Input `pattern` attribute + show an inline error.

---

### [P1] `OrderBar` `stop` stored as string not converted to number
**File:** `frontend/src/components/composites/OrderBar.tsx:76-77`
**Symptom:** The `stop` field is emitted as whatever string the user typed (`"150.5"`). Consumers that expect a number will `NaN` or string-compare.
**Cause:** `stop: stop || undefined` — passes the raw string through.
**Fix:** `stop: stop ? Number(stop) : undefined`.

---

### [P1] NotificationCenter has no trigger to add notifications — only demo-wiped
**File:** `frontend/src/components/layout/NotificationCenter.tsx:118-120` and `stores/notifications.ts`.
**Symptom:** The notifications bell is permanently empty — no trade fill, no alert trigger, no pipeline completion ever generates a notification. The design documents say alerts should fire here.
**Cause:** No producer listens for the custom events fired elsewhere (e.g. no one calls `addNotification` on `alphadesk:api-error`, order fill, or alert trigger).
**Fix:** Add a provider hook in `DashboardLayout` that subscribes to `useWebSocket`'s `portfolio` / `alerts` channels and pushes notifications when events arrive. Also listen for `alphadesk:api-error` to surface critical failures.

---

### [P1] `SectionCard` (Reports) collapse state not persisted
**File:** `frontend/src/app/(dashboard)/reports/page.tsx:50-77`
**Symptom:** Collapsing "Tax Report" then navigating away and back re-expands it.
**Fix:** Persist each section's open flag in `localStorage`.

---

### [P1] Alerts page — "Clear Triggered" button does not confirm destructive action
**File:** `frontend/src/app/(dashboard)/alerts/page.tsx:341-347`
**Symptom:** One click permanently deletes every triggered alert, no confirm. The only delete-all button is guarded by a confirm popup — the clear-triggered button is not.
**Fix:** Add the same confirmation popover pattern for "Clear Triggered".

---

### [P1] Alerts "Delete All" confirmation popup — clicks outside don't close it
**File:** `frontend/src/app/(dashboard)/alerts/page.tsx:360-388`
**Symptom:** A user who opens the confirm popup and clicks away has to click "Cancel" explicitly — no click-outside dismiss; no `Esc` handler.
**Fix:** Wrap in a `Popover` or add a document click listener with `ref.current.contains(e.target)` check.

---

### [P1] CSV escaping in `Reports > Portfolio Statement` does not quote header row
**File:** `frontend/src/app/(dashboard)/reports/page.tsx:110-140`
**Symptom:** The `csv += "PORTFOLIO STATEMENT\n"` and similar unquoted lines are fine, but values like `summary.equity` with a comma in the CSV aren't escaped in this path (they are in `arrayToCsv` helper, but the account-summary section does manual concat). A portfolio value of "1,234.56" output in US locale format would break the parser.
**Fix:** Use `arrayToCsv` for all rows, including the summary block, or explicitly format numbers without locale separators.

---

### [P1] Settings — "Notifications" toggles persist but nothing reads the preference
**File:** `frontend/src/app/(dashboard)/settings/page.tsx:398-421`, `frontend/src/stores/preferences.ts`
**Symptom:** User disables "Order Fills"; next fill still triggers a toast / WS push. Store is written, nothing reads it.
**Cause:** No consumer guards its notification dispatch with `preferences.notifications.orderFills`.
**Fix:** Wire NotificationCenter producer (see finding above) to check the preference before pushing.

---

### [P1] `DashboardLayout` listens for `alphadesk:api-error` but error state shape isn't typed
**File:** `frontend/src/app/(dashboard)/layout.tsx:39-48`
**Symptom:** Any event with a missing `detail` object throws — `e.detail.message` would read from `undefined`. The dispatch sites in `api.ts` always set both fields, but a custom consumer could silently crash.
**Fix:** Typeguard `detail` before access.

---

### [P1] PipelineTab "Run Now" button has no disabled state when trading halted
**File:** `frontend/src/app/(dashboard)/pipeline/page.tsx:379-402`
**Symptom:** User clicks "Run Now" while the trading halt flag is set server-side. The pipeline tries to run, the first order creation hits the 503 halt in `trades.py:193-198`, the error is swallowed silently (the catch block on `handleRunNow` is empty), and the user gets no feedback.
**Fix:** On failure surface a toast; also fetch the halt state and disable the button when halted.

---

### [P1] `setActiveTab` passthrough in CommandPalette desynchs when the state exists but the panel doesn't
**File:** `frontend/src/components/layout/CommandPalette.tsx:183, 188`
**Symptom:** On the desk page, calling `setActiveTab("bottom", "positions")` successfully writes `bottom: "positions"` to the persisted store. If the user later navigates to `/analytics` / `/alerts`, nothing consumes the preference. When/if they visit a surface that does read `activePanels`, it will surprise-open the positions tab.
**Fix:** Either fully remove `activePanels` (dead state), or render a legacy-panels layout somewhere that consumes it.

---

### [P2] `InputInput` import duplication risk — `Input` styled in `OrderBar` but `Input` type in `Quantity` field accepts arbitrary strings.
Minor: `name="qty"` with no inputMode=numeric; mobile keyboards show full QWERTY.

---

### [P2] `useRegime()` staleTime is 5 min but `refetchInterval` also 5 min — small effective polling delta
**File:** `frontend/src/hooks/useQueries.ts:6-14`
**Symptom:** After a regime change, user may wait up to 5+ min to see the update. Trading-desk data generally wants faster refresh.
**Fix:** Reduce to 1 min refetchInterval; staleTime 30 s.

---

### [P2] `AICopilot` — relative time stamps are computed client-side, never re-rendered
**File:** `frontend/src/components/layout/AICopilot.tsx` (not shown in excerpt) — message `timestamp: new Date()` is stored but never displayed as relative time.
Minor polish.

---

### [P2] `ProfileMenu` "admin" literal
**File:** `frontend/src/components/layout/ProfileMenu.tsx:42`
**Symptom:** Every user sees their username displayed as "admin" regardless of who is logged in.
**Cause:** Hardcoded `<p className="text-xs font-medium text-foreground">admin</p>`.
**Fix:** Read from `/api/v1/auth/me` (does not yet exist — add) or decode the JWT `sub` claim client-side.

---

### [P2] `NotificationIcon` — `iconHint="check"` also displayed for `filled`. Minor ambiguity.
**File:** `frontend/src/components/layout/NotificationCenter.tsx:39`
Not a functional bug.

---

### [P2] Missing `action` attribute on several forms — if JS fails mid-load, the form submits to the same URL
This is flagged in the `LoginForm` fix; other forms (`CreateAlertForm`, `StrategyBuilder` rule input) may benefit from the same `<noscript>` guard.

---

### [P2] `TopBar` duplicates navigation logic in mobile menu and desktop nav
**File:** `frontend/src/components/layout/TopBar.tsx:33-95`
Not functional but prone to drift (the `active` state is computed on `isHome | isTrade | ...` literals; adding a new route requires changes in three places).

---

### [P2] `AICopilot` quick prompt suggestions never change based on context
**File:** `frontend/src/components/layout/AICopilot.tsx:19-25`
Minor: the prompts are the same regardless of the page the user is on, even though `getPageContext` does set context on the server request.

---

### [P2] `ProfileMenu` keyboard-shortcut dispatch uses `dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))`
**File:** `frontend/src/components/layout/ProfileMenu.tsx:59`
Works, but fragile — the listener in `useKeyboardShortcuts.ts` specifically does `(e.target as HTMLElement)?.tagName` checks; the synthetic keydown has no target and may skip the intended handler if run while an input is focused.
**Fix:** Call `setOverlayOpen(true)` directly via a shared context.

---

### [P2] `OnboardingTour` shows at least one step pointing at `[data-tour='portfolio-hero']` which isn't on the flagship desk
**File:** `frontend/src/components/layout/OnboardingTour.tsx:22-36`
**Symptom:** On first login, tour hunts for `[data-tour='portfolio-hero']` / `[data-tour='strategy-grid']` / `[data-tour='positions-summary']` — these live on the old dashboard panels, not the new `DeskLayout`. Tour flickers, cannot position, either shows no spotlight or a centre-fallback with a wrong arrow.
**Fix:** Update selectors to match composites in `DeskLayout` (e.g. `[data-slot='portfolio-summary']`, `[data-slot='strategy-rail']`).

---

### [P2] LoginForm — `autoFocus` on username steals focus on every page visit
**File:** `frontend/src/app/login/_login/LoginForm.tsx:182-183`
Minor: tab-switchers who return to the page lose the caret back to the username field.

---

### [P2] Desk `page.tsx` polls `getOrders("pending")` + `getOrders("open")` every 30s — double the load vs a single call
**File:** `frontend/src/app/(dashboard)/page.tsx:123-135`
**Symptom:** `Promise.all([getOrders("pending"), getOrders("open")])` is two round trips when backend filter `status` accepts `open` that includes pending; duplicates network every refresh.
**Fix:** Use `getOrders("open")` (backend maps `pending` into `open` in `_alpaca_status_map`) and count.

---

### [P2] `SymbolSearch` (`searchSymbols`) — no abort on query change, returns slow results for stale query
**File:** `frontend/src/components/layout/CommandPalette.tsx:99-124`
**Symptom:** Typing fast, a slow earlier query resolves and overwrites a newer result. Debounce fires ≥300ms but the in-flight fetches aren't cancelled.
**Fix:** Pass a `signal` from an `AbortController` tied to the debounce tick; abort on next tick.

---

### [P2] `CommandPalette` does not clear `query` state on selection — re-opening shows the last typed query
Only partially handled: `useEffect` clears state when `commandPaletteOpen` toggles false, but some selection paths call `setCommandPaletteOpen(false)` before the debounce completes, leaving a stale `hasSearched` briefly.

---

### [P2] `useUIStore.persist({ partialize: tradingMode })` — `commandPaletteOpen` persists *too* (though not in partialize)
Actually fine — partialize limits persist to `tradingMode`. Not a bug.

---

### [P2] Missing `suppressHydrationWarning` on footer year (`©{new Date().getFullYear()}`)
**File:** `frontend/src/app/(dashboard)/layout.tsx:106`, `frontend/src/components/layout/DashboardShell.tsx:34`
**Symptom:** At very end of year Dec 31 → Jan 1, server-rendered year may differ from client, causing a React hydration mismatch warning once in 3 years.
**Fix:** `suppressHydrationWarning` on that span.

---

## Endpoint contract cross-check

| Frontend call | Backend route | Status |
|---|---|---|
| `POST /api/v1/auth/login` | `auth.py:129` | OK |
| `POST /api/v1/auth/logout` | `auth.py:184` | OK |
| `GET /api/v1/strategies/` | `strategies.py:934` | OK |
| `POST /api/v1/strategies/{id}/toggle` | `strategies.py:1278` | Shape mismatch (P0) |
| `GET /api/v1/strategies/{id}/performance` | `strategies.py:1154` | OK |
| `GET /api/v1/strategies/{id}/analytics` | `strategies.py:1404` | OK |
| `GET /api/v1/strategies/{id}/positions` | `strategies.py:1582` | OK |
| `GET /api/v1/market/quotes/{symbol}` | `market.py:306` | OK |
| `GET /api/v1/market/bars/{symbol}` | `market.py:397` | OK |
| `POST /api/v1/screener/screen` | `screener.py:600` | OK |
| `GET /api/v1/screener/presets` | `screener.py:677` | OK |
| `POST /api/v1/analysis/analyze/{symbol}` | `analysis.py:616` | OK |
| `GET /api/v1/analysis/analysis/{symbol}` | `analysis.py:672` | OK |
| `GET /api/v1/options/chain/{symbol}` | `options.py:645` | OK (raw JSON re-mapped) |
| `GET /api/v1/options/iv/{symbol}` | `options.py:672` | OK |
| `POST /api/v1/trades/orders` | `trades.py:184` | OK |
| `GET /api/v1/trades/orders` | `trades.py:286` | OK |
| `DELETE /api/v1/trades/orders/{id}` | `trades.py:361` | **204 vs JSON body mismatch (P0)** |
| `GET /api/v1/trades/positions` | `trades.py:387` | OK |
| `GET /api/v1/trades/history` | `trades.py:432` | OK |
| `GET /api/v1/trades/alerts` | `trades.py:733` | OK |
| `POST /api/v1/trades/alerts` | `trades.py:745` | OK |
| `DELETE /api/v1/trades/alerts/{id}` | `trades.py:766` | OK |
| `GET /api/v1/portfolio/summary` | `portfolio.py:386` | OK |
| `GET /api/v1/portfolio/performance` | `portfolio.py:461` | **`equity_curve` shape mismatch (P0)** |
| `GET /api/v1/portfolio/greeks` | `portfolio.py:605` | OK |
| `GET /api/v1/portfolio/calendar` | `portfolio.py:727` | OK |
| `GET /api/v1/portfolio/morning-brief` | `portfolio.py:1064` | OK |
| `GET /api/v1/market-overview/indices` | `market_overview.py:111` | OK |
| `GET /api/v1/market-overview/sectors` | `market_overview.py:184` | OK |
| `GET /api/v1/market-overview/regime` | `market_overview.py:273` | OK |
| `GET /api/v1/market-overview/indices/sparklines` | `market_overview.py:366` | OK |
| `GET /api/v1/news/market` | `news.py:272` | OK |
| `GET /api/v1/symbols/search` | `symbols.py:1842` | OK |
| `POST /api/v1/agents/chat` | `agents.py:88` | OK |
| `POST /api/v1/agents/refine-strategy` | `agents.py:245` | OK |
| `GET /api/v1/pipeline/status` | `pipeline.py:61` | OK |
| `POST /api/v1/pipeline/run` | `pipeline.py:22` | OK |
| `GET /api/v1/pipeline/history` | `pipeline.py:72` | OK |
| `GET /api/v1/pipeline/history/{date}` | `pipeline.py:214` | OK |
| `GET /api/v1/pipeline/positions` | `pipeline.py:233` | OK |
| `POST /api/v1/strategies/admin/risk-monitor?enabled=<bool>` | `strategies.py:1312` | OK |
| `GET /api/v1/strategies/admin/risk-monitor` | `strategies.py:1335` | OK |

Notably missing: **no `/api/v1/auth/me`** — every UI surface that labels a user as "admin" is hardcoded; no profile / password-change / email endpoints exist either.

---

## Recommended fix order

1. OrderBar `handleStageOrder` → call `placeOrder` + dialog (desk page).
2. Remove `/trade` redirect or wire a real page (TopBar, KNOWN_DASHBOARD_ROUTES, TAB_ORDER, CommandPalette).
3. Fix `cancelOrder` 204 parsing.
4. Fix `StrategyTemplates.handleActivate` — don't flip unconditionally.
5. Wire CommandPalette commands to the desk page (either router pushes or event listeners in `page.tsx`).
6. Wire shortcut handlers into the desk page (quick-buy, chart timeframe, watchlist j/k).
7. Fix ProfileMenu logout URL + remove contradictory live-mode toast.
8. Add Strategy Builder Backtest onClick (or remove button).
9. Fix analytics page empty-state when backend shape drifts.
10. Remove HttpOnly-reading code in `api.ts` + `useWebSocket.ts`.
11. Fix `isMarketOpen` DST.
12. Validate symbol in OrderBar + WatchlistPanel.
13. Notification producer + preference guards.
14. `getPortfolioPerformance` contract.
15. Forgot-password flow (backend + frontend) OR remove the link entirely.
