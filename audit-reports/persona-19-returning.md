# Persona 19 — Returning User (3 months away)

**Persona**: Power user who last logged in 3 months ago. Primary concerns: did my positions survive? what fired while I was gone? is my cost basis intact? did strategies keep running? can I see the gap? where are my tax-year records?

**Probes**: admin login (attempted; password not available locally — reasoning from source), reports/analytics/alerts pages, `/api/v1/trades/history`, `/api/v1/portfolio/performance?period=ytd`.

---

## Top 10 Findings (350 words)

**1. No "welcome back" UX anywhere.** `frontend/src/app/login/_login/LoginForm.tsx` and `frontend/src/app/(dashboard)/page.tsx` have zero recognition of returning users — no "last login 94 days ago," no gap banner, no highlight of trades/alerts fired since. After re-auth you land on today's desk as if you'd never left. (P0 UX gap for the persona.)

**2. No `last_login` column, no session log.** `backend/api/routes/auth.py:299-348` login handler audits to logger only (event=login user=... result=...). There is no `UserSession` model, no `last_seen_at` field on the user record, no DB write on success. Nothing the UI could read to compute "time since last login."

**3. Morning Brief component is dead code.** `frontend/src/components/dashboard/MorningBrief.tsx` + `backend/api/routes/portfolio.py:1161` (`GET /portfolio/morning-brief`) both exist and would be perfect for a returning user (overnight change, top movers, catalysts) — but `grep "MorningBrief" /frontend/src/app` returns zero. It's never mounted. Huge missed re-engagement surface.

**4. Positions ARE preserved — they live on Alpaca.** `backend/api/routes/trades.py:643-688` (`/positions`) and `/portfolio/summary` read live from Alpaca. Your cost basis (`avg_entry_price`) comes straight from the broker. Nothing stale about returning — positions and cost basis survive indefinitely because AlphaDesk is stateless on that axis.

**5. Trade ledger is Postgres-persisted.** `backend/data/ingestion/trade_ledger.py:1-22` migrated off a fragile JSON file to Postgres. Three months of fills will still be queryable. Good.

**6. `GET /trades/history` has NO date filter.** `trades.py:691-736` accepts `symbol`, `strategy`, `limit` (max 10,000), `offset` — but no `start_date`/`end_date`. The frontend (`reports/page.tsx:660`) calls `getTradeHistory(5000)` and filters client-side. A returning user with >5,000 historical trades will silently lose the tail. The underlying `get_closed_trades()` in `trade_ledger.py:796` DOES support `start_date`/`end_date` — the API route just doesn't expose them.

**7. Wave 30 period filter IS present on Reports.** `reports/page.tsx:22-36, 682-693` implements the `1W/1M/3M/YTD/1Y/ALL` range selector and filters by `exit_time`. Tax Report has its own tax-year dropdown (`:761-767`) covering the last 5 years. Confirmed working.

**8. No triggered-alert timeline per-period.** `backend/api/routes/trades.py:1039-1063` (`/alerts`) returns all price alerts. `frontend/src/app/(dashboard)/alerts/page.tsx:478-510` renders "Triggered History" but without date grouping — a returning user can't filter "show alerts that fired in the last 90 days." Alerts also live in a Redis hash (`ALERTS_REDIS_KEY`), so if Redis was restarted during the 3-month absence, the triggered-alert log is gone entirely.

**9. Strategies DO keep running while you're away.** `backend/data/ingestion/daily_pipeline.py` + `pipeline_runner.py` run server-side autonomously. Strategy status overrides persist in Redis (`strategies.py:951-967`). You don't need to be logged in for them to execute.

**10. Tax Report is solid but capped at 5 years and needs browser-side filtering.** `reports/page.tsx:766-768` hard-codes the year dropdown to `new Date().getFullYear() - i, i<5`. A returning user filing late taxes for year N-6 can't reach that year from the UI, even though the ledger would hold the data.

---

## Would I come back? 

Yes — the data is all there. But AlphaDesk treats me like a brand-new user on every login. No recognition, no gap summary, no "here's what fired while you were gone." The infrastructure (Postgres ledger, Alpaca positions, Redis alert history) is solid; the UX layer for returning users is absent.

## Files Cited

- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/reports/page.tsx` (Wave 30 filter confirmed)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/login/_login/LoginForm.tsx` (no last-login surface)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx` (Desk — no returning UX)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/alerts/page.tsx:478-510` (triggered history, undated)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/MorningBrief.tsx` (orphaned component)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/auth.py:299-348` (no last_login write)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:691-736` (history lacks date filters)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/portfolio.py:539-696` (performance period=ytd works)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/portfolio.py:1161-1290` (morning-brief endpoint exists, unused)
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/trade_ledger.py:796-806` (start/end dates supported at data layer only)

## Recommended Fixes

- **P0**: Mount `MorningBrief` on Desk landing — it already computes overnight change, top movers, and catalysts. Zero backend work needed.
- **P0**: Add `last_login_at` to user record; surface on Desk as "Welcome back — 94 days since your last visit. 23 trades closed, 4 alerts triggered."
- **P1**: Add `start_date`/`end_date` query params to `GET /trades/history` and `GET /alerts`.
- **P1**: Uncap the Tax Report year dropdown to include all years present in ledger data.
- **P2**: Persist alert trigger log to Postgres (not Redis) so a 3-month absence survives cache restarts.
