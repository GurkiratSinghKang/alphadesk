# Persona 30 — Multi-Account Support

**Scenario:** User manages 3 accounts — personal paper, personal live, spouse's account — and wants to keep them separate in AlphaDesk.

**Verdict:** AlphaDesk is a **single-tenant, single-admin, single-broker-account** system. There is no multi-account support of any kind. The user needing 3 accounts cannot use AlphaDesk for that purpose without running three separate backend deployments.

---

## Findings

### F1 — Auth is hard-coded to ONE admin account (P0 blocker)
`backend/core/config.py:80-81` defines `ADMIN_USERNAME` (default `"admin"`) and `ADMIN_PASSWORD_HASH` as singleton env-var settings. `backend/api/routes/auth.py:312-316` checks login against exactly those two values — there is no user table, no signup, no second user. The `require_admin` dependency at `auth.py:92-105` comments this explicitly: *"admin identity == 'the singleton admin account'"*. Three users cannot log in.

### F2 — No users/accounts/org tables in the schema
`backend/data/storage/models.py` defines only data tables (`ohlcv_bars`, `options_snapshots`, `trades`, `positions`, `watchlists`, `screener_presets`, `agent_analyses`, `strategy_signals`, `alerts`). **Zero** `user_id`, `owner_id`, `account_id`, or `tenant_id` columns exist anywhere. All data is global.

### F3 — One Alpaca broker account, server-wide
`backend/core/config.py:52-54` holds exactly ONE `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` / `ALPACA_BASE_URL` in env. `backend/api/routes/portfolio.py:449-455, 884, 1177-1189`, `options.py:348-355`, and `risk.py:108-138` all read the same global credentials. There is no per-user keyring, no account-selector query param, no way to route requests to the spouse's Alpaca account.

### F4 — No sub-account / linked-account concept in UI
`frontend/src/components/layout/ProfileMenu.tsx` is the only profile surface. It shows the JWT `sub` claim as `displayName` (single user), an equity number, a paper/live toggle, Reports, Settings, Logout. **No account switcher, no "add account," no org/team dropdown.**

### F5 — `WorkspaceSelector` is layout presets, not accounts
`frontend/src/components/layout/WorkspaceSelector.tsx` exposes `default / research / trading / risk / eod` and persists to `localStorage["alphadesk-workspace"]`. It toggles which dashboard sections are expanded — pure UI state, never scopes data or identity.

### F6 — Paper vs Live toggle is cosmetic
`frontend/src/stores/ui.ts:18-94` keeps `tradingMode: "paper" | "live"` in Zustand + cross-tab `storage` sync. `ProfileMenu.tsx:66-104` and `app/(dashboard)/settings/page.tsx:577-609` confirm that clicking "Live" only opens an education dialog: *"Live trading requires broker API keys configured on the server. Contact your admin."* There is no `/auth/switch-mode` endpoint — backend always uses the single `ALPACA_BASE_URL` (paper by default). So "switching to Live" in the UI does nothing real.

### F7 — Access is explicitly invite-only, not self-service
Live page `https://tradingalpha.net/login` shows only username+password, with "No account? Request access" linking to `/request-access`. `frontend/src/app/request-access/page.tsx:9-80` tells visitors to email `legal@tradingalpha.net`; approval yields a single credential pair. A spouse who wants their own login cannot self-register.

### F8 — Settings page has no account-management section
`frontend/src/app/(dashboard)/settings/page.tsx` covers trading mode, API keys (read-only placeholder saying *"Contact admin to update brokerage credentials"* at L386-389), notifications, display, data refresh, export, security, reset. **No "Accounts," "Linked brokers," "Sub-accounts," or "Team."**

### F9 — JWT carries only `sub`, no account/tenant claims
`backend/core/auth.py:43-58` mints tokens with only `{sub, exp, type, jti}`. There is no `account_id` or `tenant_id` claim to key data off. Any future multi-account work would require a schema migration + JWT payload change + every query to add a scope filter. This is a deep architectural gap, not a config toggle.

### F10 — Admin comments acknowledge the limitation
`backend/api/routes/auth.py:86-99` and `:333` explicitly tag this as "singleton admin account" and mention *"a multi-user future this should resolve against a proper role/permission record on the user row."* The engineers know this; it just has not been built.

---

## Summary (≈250 words)

AlphaDesk today is a **single-user, single-broker-account trading terminal** — it cannot support the persona's three accounts (personal paper, personal live, spouse's). Every layer of the system confirms this.

At the auth layer, `backend/core/config.py` ships with exactly one `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`, and `backend/api/routes/auth.py` checks the login form against those env vars. There is no users table, no signup route, no invite flow — the `/request-access` page is a static email-us form, and a `require_admin` dependency hard-codes `username == settings.ADMIN_USERNAME`. A spouse who wants their own login cannot get one without also becoming the admin.

At the data layer, `backend/data/storage/models.py` contains nine tables (trades, positions, watchlists, alerts, etc.), and none of them carry a `user_id`, `owner_id`, or `account_id` column. All rows are globally visible. JWTs encode only `sub/exp/type/jti` — no tenant claim.

At the broker layer, a single `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` / `ALPACA_BASE_URL` lives in env and is read identically across `portfolio.py`, `options.py`, and `risk.py`. The UI's "Paper/Live" toggle in `ProfileMenu` and `/settings` is cosmetic — there is no `/auth/switch-mode` endpoint, and clicking "Live" merely opens a *"contact admin"* dialog.

The `WorkspaceSelector` looks promising but is just a localStorage-backed UI layout preset (which dashboard sections are expanded). There is no account switcher, no ProfileMenu sub-account list, and no settings section for linked brokers.

To support three accounts the persona needs either three separate backend deployments or a substantial rebuild: users/accounts schema, per-user broker keyring, row-scoping on every query, and JWT tenant claims.
