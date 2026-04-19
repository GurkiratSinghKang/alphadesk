# Persona 44 — Feature Flag / Rollout Infrastructure Audit

**Question.** As a PM wanting to roll out a feature to 10% of users, does AlphaDesk have feature-flag infrastructure, a graceful rollout path, or A/B capability?

**Short answer.** No. Zero of the three exist. A 10% rollout is not implementable today without building the bucketing primitive first — AlphaDesk cannot identify "users" at all.

## Findings (max 10)

1. **No feature-flag SDK.** `backend/requirements.txt` and `frontend/package.json` contain no LaunchDarkly, Unleash, Flagsmith, Split.io, Optimizely, PostHog, GrowthBook, or equivalent. Grep for `feature_flag|FeatureFlag|LaunchDarkly|Unleash|Flagsmith|Split\.io|PostHog|GrowthBook` returns zero hits repo-wide (excluding `node_modules`).

2. **No rollout / canary / experiment / A-B vocabulary.** Grep for `rollout|canary|gradual.?release|ab_test|experiment|variant|cohort|segment` yields only domain-unrelated hits: strategy conviction *buckets* (`backend/api/routes/strategies.py:119 ConvictionBucket`, `:1771-1783` 0-20/20-40/…), surprise/fscore *cache* buckets (`backend/strategies/pead/helpers.py:208`, `backend/strategies/momentum_quality/helpers.py:146 fscore_bucket`), and the word "experiment" in a strategy spec comment.

3. **No users table — single admin only.** `backend/data/storage/models.py` defines 9 ORM models (OHLCVBar, OptionsSnapshot, Trade, Position, Watchlist, ScreenerPreset, AgentAnalysis, StrategySignal, Alert) and **no User/UserSettings/UserPreference/Tenant**. `backend/core/config.py:80-81` hard-codes one admin (`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`). `user_id|tenant|org_id` grep over `backend/` returns no files. Without a stable per-user identifier there is no key to hash-bucket for a percentage rollout.

4. **`backend/core/config.py` is env-only, no flags.** All 30-ish settings are infra credentials and limits (API keys, DB URL, JWT secret, token TTLs, `PRODUCTION_ORIGIN`, `SKIP_DB_INIT`). No `FEATURE_*`, no `ENABLE_*`/`DISABLE_*`, no percentage/rollout field. Grep for `enabled|disabled|toggle` inside that file: zero matches.

5. **Only env-gated toggle in the app is `RISK_MONITOR_ENABLED`** — and it's class-level state, not config. `backend/data/ingestion/master_agent.py:129` sets `RISK_MONITOR_ENABLED: bool = True`; `backend/api/routes/strategies.py:1573-1608` flips it globally via `POST /toggle-risk-monitor`. No user scoping, no percentage, and `audit-reports/02-backend.md:679` already flags it as broken across multi-worker deploys.

6. **Frontend env vars are URL/version only.** `frontend/src/env.ts:2-3` exposes `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`; `frontend/src/app/(dashboard)/page.tsx:75` reads `NEXT_PUBLIC_BUILD_VERSION`. No `NEXT_PUBLIC_FEATURE_*` or `NEXT_PUBLIC_ENABLE_*` exists anywhere.

7. **Preferences store is client-side localStorage only.** `frontend/src/stores/preferences.ts` (zustand + `persist`, key `alphadesk-preferences`, v1) holds `NotificationPrefs`, `DisplayPrefs`, `DataPrefs.refreshInterval`. It never round-trips to the backend and has no feature-enablement field. Not a flag system — user-visible toggles only, and only for that browser.

8. **Per-strategy on/off toggle is the closest primitive.** `backend/api/routes/strategies.py:1439-1555 toggle_strategy` persists per-strategy status in Redis with WATCH-based optimistic locking and an asyncio per-strategy lock (`_get_toggle_lock`). It's binary (on/off), global (not per-user), and scoped to strategy activation — not reusable for rolling out a UI feature.

9. **No middleware/decorator for conditional feature exposure.** No `@feature(...)`, no `if flag_enabled(...)`, no middleware that varies response shape. Routes are statically mounted in `backend/main.py`; frontend routes are statically defined under `frontend/src/app/`.

10. **No analytics/experiment pipeline.** No event-tracking library, no assignment logger, no variance-test harness. The `audit-reports/` tree (100+ files) contains no prior feature-flag or experiment work — confirming this is greenfield.

## Rollout path today

Three crude options, in order of effort:

- **Big-bang deploy behind the existing auth wall.** Ship to 100% of the one admin user. Revert via git + redeploy if broken. This is what the codebase assumes.
- **Hard-coded env gate.** Add a `FEATURE_X_ENABLED: bool = False` in `backend/core/config.py` and a `NEXT_PUBLIC_FEATURE_X` in `frontend/src/env.ts`. Binary, not 10%.
- **Build the primitive.** Add a `users` table + stable `user_id`, then a `feature_flags` table (flag name, rollout %, allowlist/denylist) keyed by `hash(user_id + flag_name) % 100 < rollout_pct`. This is multi-sprint work and touches auth, models, migrations, and every gated call site.

## Summary (≈250 words)

AlphaDesk has **no feature-flag infrastructure, no rollout mechanism, and no A/B capability.** A product manager asking "ship this to 10%" cannot be served today, because the more fundamental primitive — the ability to identify "a user" — is also missing. The backend authenticates a single hard-coded admin (`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` in `backend/core/config.py`), there is no `users` table in `backend/data/storage/models.py` (only nine domain tables: OHLCV, trades, positions, watchlists, screener presets, agent analyses, signals, alerts, options snapshots), and grep for `user_id|tenant|org_id` returns nothing across the backend. Without a stable per-user key there is no input to hash-bucket for a percentage rollout.

No third-party SDK is installed (`requirements.txt`, `package.json` clean of LaunchDarkly/Unleash/Flagsmith/Split/PostHog/GrowthBook). `config.py` is infrastructure-only: API keys, DB/Redis URLs, JWT secret, token TTLs — zero `FEATURE_*` or `ENABLE_*` fields. The only runtime on/off switch (`RISK_MONITOR_ENABLED` in `backend/data/ingestion/master_agent.py:129`) is global class-level state that `audit-reports/02-backend.md:679` already flags as broken across multiple uvicorn workers. The per-strategy `POST /strategies/{id}/toggle` endpoint (`backend/api/routes/strategies.py:1439`) has the nicest machinery — Redis-backed with WATCH and per-strategy asyncio locks — but it's binary and scoped to strategy activation, not feature exposure. Frontend `preferences.ts` lives in browser localStorage and never round-trips to the server.

**Path forward:** a percentage rollout requires (1) introducing `users`, (2) a `feature_flags` config table, and (3) a consistent `hash(user_id + flag) % 100 < pct` check helper wired into both FastAPI dependencies and a React hook. Estimate: multi-sprint, touching auth, models, Alembic, and every gated call site. Until then, releases are big-bang behind the single admin account.
