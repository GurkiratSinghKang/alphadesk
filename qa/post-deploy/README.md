# Post-deploy smoke tests

Runnable verification of audit-fix work after a production deploy.
Each script is self-contained, takes the target URL as an arg, and
exits non-zero on regression.

## Available scripts

### `smoke-audit-2026-05-11.sh`

Verifies audit 2026-05-11 fix-loop work is live. Checks each
BUG-NNN's externally-observable contract:

- BUG-058 — bare POST /trades/orders returns 428
- BUG-065 — no DEMO state-picker chips on /login
- BUG-067 (partial) — Content-Security-Policy-Report-Only header set
- BUG-068 — /welcome KPI strip shows em-dashes (no "284 OPERATORS")
- BUG-073 — /api/v1/user/me returns 200 with username field
- BUG-077 — POST with Origin: https://evil.example returns 403
- BUG-079 — / (Desk) renders 200 post-deprecation marker
- BUG-083 — skip-to-content link on /login, /about, /pricing, /welcome
- BUG-088 — POST /api/v1/support/tickets returns 201 with ticket_id

Usage:

```bash
ALPHADESK_TEST_PASS=<admin-bcrypt-hash> ./smoke-audit-2026-05-11.sh
# Or target a different env:
ALPHADESK_TEST_PASS=<...> ./smoke-audit-2026-05-11.sh https://staging.tradingalpha.net
```

Exits 0 on full pass; 1 on any regression. FAIL lines name the
BUG-NNN whose fix needs investigation.

## When to run

- After merging `claude/focused-shirley-206414` into `feature/deployment`.
- After any deploy that touches `backend/api/routes/`, `backend/main.py`,
  `backend/core/auth.py`, or `frontend/src/middleware.ts`.
- Before a release candidate is promoted to live trading.

## Integration ideas

- Add as a manual GitHub Actions workflow step (post-deploy).
- Wire into a Slack `/smoke prod` slash command for on-demand verification.
- Schedule daily as a canary to catch silent regressions.

## Adding a new check

When a future audit lands a new bug fix, add the verification block
to the script with the BUG-NNN comment and update this README's
"Available scripts" section.
