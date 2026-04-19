# Persona 8 — The Methodical Settings User

**Date:** 2026-04-18
**Route:** `/settings`
**Environment:** tradingalpha.net (production, live APIs)
**Persona:** methodical user who configures every toggle before trusting the tool

A user who lives in Settings expects every control to have a clear cause-and-effect and to survive a page reload. What I found is that AlphaDesk's settings page is overwhelmingly a state-collection UI: toggles flip nicely, values persist to localStorage, and then the rest of the app just doesn't read them. Notifications are the one audited, honest surface (Wave 8 `shouldNotify()` is real and gated correctly). Everything else ranges from purely cosmetic to outright deceptive.

---

## Top 10 findings (≈400 words)

1. **Three of the five display/data preferences are write-only.** `compactStrategyView`, `animationSpeed`, and `refreshInterval` are persisted to `alphadesk-preferences` in localStorage, but a repo-wide grep for each key only matches the settings page itself and the store definition. Nothing consumes them. Changing "Animation Speed" to "None", reloading, flipping "Compact Strategy View" — none of it alters a single pixel anywhere else. This is the single biggest trust problem on the page.

2. **Notification gating works; it's the one thing that does.** `hooks/useNotifications.ts` calls `shouldNotify(prefKey)` via `lib/notificationPrefs.ts` before pushing each category (orderFills / alertsTriggered / pipelineCompleted). Verified in code. System/error toasts always bypass the gate, which is correct.

3. **No Account section exists at all.** No email/username display, no change-password form, no sessions list, no 2FA, no logout-everywhere. Backend confirms the gap: `backend/api/routes/auth.py` only exposes `/login`, `/refresh`, `/logout`. Calls to `/auth/me`, `/auth/change-password`, `/auth/sessions`, `/user/preferences`, `/auth/switch-mode` all return 404 on prod.

4. **Live-mode toggle is honest but still flips local state.** Wave 29 fix adds a confirmation dialog whose "Got it" button toasts "contact support" instead of enabling live trading. But `setTradingMode("live")` is never blocked — a user can still flip the underlying `useUIStore.tradingMode` via the ProfileMenu buttons and stale UI components (StatusStrip, TradePanel) may render a coral "LIVE" indicator against a paper account.

5. **Zero cross-tab sync.** No `storage`-event listener, no `BroadcastChannel` anywhere under `frontend/src/`. Open Settings in tab A, change "Order Fills" off; tab B keeps sending order-fill toasts until you reload it.

6. **No reset-to-defaults affordance despite `resetAll` existing.** `preferences.ts` already exports `resetAll()`, and it's never wired into the UI. A one-line button would close a known loop.

7. **No keyboard-shortcut UI in Settings.** Shortcuts are defined in `hooks/useKeyboardShortcuts.ts`, load user overrides from `alphadesk:keybindings`, and render in a "?" overlay — but Settings offers no way to view or remap. Persisting custom bindings only via a localStorage key a user can't see is a discoverability dead end.

8. **No default-order preferences.** Prior audits wanted default order type / qty / TIF / symbol — still missing. `TradePanel` hardcodes its defaults. The "methodical" persona has nothing to persist here.

9. **API keys panel is read-only but mislabels reality.** Copy says "Alpaca API keys are configured on the server." No visibility into Polygon/FMP — the other two critical providers — and no `/auth/me` to tell the user whose keys they are. It's a static paragraph masquerading as a panel.

10. **Hydration guard leaks a flash.** `preferences` and `ui` stores both set `skipHydration: true`, but the settings page doesn't wait for hydration before rendering the toggles. On first paint every toggle briefly renders in its default state before snapping to the persisted value. Minor, but a methodical user will notice.

---

## Detailed walk-through

### 1. Sections present
From `frontend/src/app/(dashboard)/settings/page.tsx`:
1. Trading Mode
2. API Keys (static paragraph only)
3. Notifications (4 toggles)
4. Display (2 toggles + animation segment picker)
5. Data Refresh (interval slider)
6. Export Data (3 buttons)
7. Security (static paragraph only)
8. PerformanceMetrics (telemetry widget, not a setting)

No Appearance/theme, no Account, no Shortcuts customization, no Defaults, no Risk, no Chart defaults, no Integrations, no Cross-device sync.

### 2. Per-control persistence and effect

| Control | Persists? | Store key | Actually consumed? |
|---|---|---|---|
| Trading Mode toggle | Yes | `alphadesk-ui.tradingMode` | Yes — StatusStrip/TopBar/ProfileMenu/TradePanel read it; but flipping is guarded by dialog only on the settings page toggle, not ProfileMenu buttons |
| Order Fills | Yes | `alphadesk-preferences.notifications.orderFills` | **Yes** — gated via `shouldNotify("orderFills")` in `useNotifications.ts:108` |
| Alerts Triggered | Yes | `...alertsTriggered` | **Yes** — gated at `useNotifications.ts:136` |
| Pipeline Completed | Yes | `...pipelineCompleted` | **Yes** — gated at `useNotifications.ts:159` |
| Strategy Events | Yes | `...strategyEvents` | **No** — no producer calls `shouldNotify("strategyEvents")` anywhere |
| Ticker Tape | Yes | `...display.tickerTapeOn` | **Yes** — gated in `app/(dashboard)/layout.tsx:145` and `components/layout/DashboardShell.tsx:28` |
| Compact Strategy View | Yes | `...display.compactStrategyView` | **NO** — only reference is the setter in settings page itself |
| Animation Speed | Yes | `...display.animationSpeed` | **NO** — only reference is the setter; reduced-motion elsewhere uses `prefers-reduced-motion` media query, not this store |
| Refresh Interval | Yes | `...data.refreshInterval` | **NO** — `usePortfolioStore` polls on its own interval; nothing reads the pref |

**Verification method:** repo-wide grep for the key name. Matches shown above.

### 3. Notifications end-to-end
Reading `useNotifications.ts:68-78`:
```ts
const maybePush = (category, prefKey, title, detail, icon) => {
  if (prefKey && !shouldNotify(prefKey)) return;
  pushRef.current({ category, title, detail, icon });
};
```
The gate is synchronous and reads `usePreferencesStore.getState()` so a toggle flip takes effect on the next event without re-renders. System/error events (`alphadesk:system-notify`) deliberately bypass the gate — correct. Wave 8 ship is real.

**But "Strategy Events" is a dead toggle:** `useNotifications.ts` has no `strategyEvents` branch. Flipping it writes to localStorage and nothing else.

### 4. Theme
`useUIStore` declares `theme: "dark" | "light"` with a `setTheme` setter. Settings never exposes the toggle. Nothing reads the value; `globals.css` hardcodes dark. Dead field.

### 5. Trading mode (Paper / Live)
- Settings page toggle: Wave 29 dialog verified — clicking "Got it" only toasts a warning, never calls `setTradingMode("live")`. Confirmed in `settings/page.tsx:595-607`.
- ProfileMenu buttons (`components/layout/ProfileMenu.tsx:124-125`): `handleLiveClick` also opens a dialog rather than flipping, comment confirms there's no `/auth/switch-mode`. Also honest.
- Paper-side toggle is always safe: calls `setTradingMode("paper")` directly.
- Backend confirms: `POST /api/v1/auth/switch-mode` → 404.

### 6. Account
Nothing. No display of the logged-in username, no email, no change-password, no sessions list, no device list, no 2FA, no logout-all. All four probes returned 404:
```
POST /api/v1/auth/change-password → 404
GET  /api/v1/auth/sessions        → 404
GET  /api/v1/user/preferences     → 404
POST /api/v1/auth/switch-mode     → 404
GET  /api/v1/auth/me              → 404
```
Spec at `qa/pages/settings.md:90` actually says "No 'Delete account' affordance (intentional)" — but the absence extends to every other account action too.

### 7. API keys
Static copy only: *"Alpaca API keys are configured on the server. Contact admin to update brokerage credentials."* No indication whether Polygon / FMP / news providers are configured, whether they're healthy, or when the last sync happened. A status badge per provider (green/red dot + last-checked timestamp) would make this panel informative instead of decorative.

### 8. Shortcuts
- Declared in `hooks/useKeyboardShortcuts.ts:43-117` with categories (Navigation / Chart / Watchlist / Trading / Copilot).
- Runtime overrides persist via `localStorage["alphadesk:keybindings"]` (`useKeyboardShortcuts.ts:118-127`).
- **No UI to set those overrides.** Users must edit localStorage by hand. A Settings → Shortcuts section would unblock the existing plumbing.
- "?" opens a read-only overlay. That exists; Settings doesn't link to it.

### 9. Defaults
Not present. `TradePanel` hardcodes its initial order type / qty / TIF. `ChartPanel` hardcodes the default timeframe. Watchlist has no "default symbol". A methodical user has no way to say "always start on AAPL at 15m limit order".

### 10. Export / data
All three export buttons work, confirmed by code review:
- **Watchlist JSON** — pulls from `useMarketStore.watchlist` in memory. If the user hasn't visited the dashboard this session, the watchlist may be empty despite being persisted on the server. No hydration guard here.
- **Trade History CSV** — calls `getTradeHistory(1000)` → `GET /api/v1/trades/history?limit=1000`. Confirmed endpoint returns 200 on prod. Empty-state toast via `alphadesk:api-error` event is real.
- **Settings JSON** — snapshots the three prefs slices + watchlist + tradingMode. Useful for backup; there's no corresponding **import**, so round-tripping a backup requires hand-editing localStorage.

Missing exports: open positions, alerts list, completed backtests, strategy configs.

### 11. Persistence across tabs
Grepped `frontend/src/` for `storage` event listener, `BroadcastChannel`, or anything that reacts to `alphadesk-preferences` changing externally. **Zero matches.** Tab A → toggle off "Order Fills"; tab B still fires fill toasts until it reloads. For a trading app where people keep multiple desks open this is a real mis-feature.

### 12. Reset to defaults
`preferences.ts:77-82` already exposes `resetAll()` but settings never wires a button. Low-effort, high-trust addition.

### 13. Accessibility
Good:
- Every `Toggle` renders `<button role="switch" aria-checked aria-label={label}>` with a 44x44 hit target (Wave 29).
- `SegmentPicker` and `IntervalSlider` use `role="radiogroup"` + `role="radio"` with `aria-checked` (Wave fix from spec a11y note at line 98).
- Focus rings present via Tailwind defaults.
- Label text is visible, not placeholder-only.

Gaps:
- The Trading-Mode "Paper / Live" labels are visual-only spans with no `aria-hidden`; screen reader reads them before the switch role. Minor verbosity.
- Export buttons share the same `text-xs` with no `aria-busy` during the trades CSV fetch. While loading, a SR user hears nothing.
- No focus management on the Live-mode confirmation dialog close (Dialog primitive should handle this — verify; the ProfileMenu `handleLiveClick` dialog code at `ProfileMenu.tsx:95-123` doesn't set initial focus explicitly).

### 14. What's missing
- **Appearance / theme switch** (dark exists, light hardcoded off)
- **Account panel** (username, email, change password, sessions)
- **Default order preferences** (type, qty, TIF, symbol)
- **Default chart preferences** (timeframe, indicators, studies)
- **Risk thresholds** (max daily loss, per-trade size)
- **Shortcut rebinding UI**
- **Reset-to-defaults button**
- **Provider status** (Polygon / FMP / Alpaca health + last-sync)
- **Cross-tab sync** (storage event or BroadcastChannel)
- **Import settings** (counterpart to the working export)
- **Notification channel routing** (all go to the bell; no email/push/webhook options)

---

## Files reviewed
- `frontend/src/app/(dashboard)/settings/page.tsx`
- `frontend/src/stores/preferences.ts`
- `frontend/src/stores/ui.ts`
- `frontend/src/hooks/useNotifications.ts`
- `frontend/src/lib/notificationPrefs.ts`
- `frontend/src/hooks/useKeyboardShortcuts.ts`
- `frontend/src/components/layout/ProfileMenu.tsx`
- `frontend/src/app/(dashboard)/layout.tsx`
- `frontend/src/components/layout/DashboardShell.tsx`
- `frontend/src/lib/api.ts` (getTradeHistory)
- `backend/api/routes/auth.py`
- `qa/pages/settings.md`

## Prod probes
- `POST /api/v1/auth/login` → 200 (baseline)
- `GET /api/v1/auth/me` → 404
- `POST /api/v1/auth/change-password` → 404
- `GET /api/v1/auth/sessions` → 404
- `GET /api/v1/user/preferences` → 404
- `POST /api/v1/auth/switch-mode` → 404
- `GET /api/v1/trades/history?limit=3` → 200 (export works)
