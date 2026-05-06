# Oncall Alerting Runbook

Audit P0-5 (STRATEGY-HARDENING-AUDIT, 2026-05-05) introduced a generic
webhook-based alert dispatcher at `backend/services/alerts.py`. This
document covers operator setup, severity meanings & SLAs, dedup
behaviour, and how to add a new alert hook.

## Configuration (env-only)

All values live in `Settings` (`backend/core/config.py`). When a
destination URL or key is empty, that destination is silently skipped
— operators can leave PagerDuty unset on dev/staging and only the
configured destinations will fire.

| Env var                            | Purpose                                   | Default |
| ---------------------------------- | ----------------------------------------- | ------- |
| `ALERT_PAGERDUTY_INTEGRATION_KEY`  | PagerDuty Events API v2 integration key   | empty   |
| `ALERT_DISCORD_WEBHOOK_URL`        | Discord incoming webhook (overrides legacy `DISCORD_WEBHOOK_URL` when set) | empty |
| `ALERT_SLACK_WEBHOOK_URL`          | Slack incoming webhook                    | empty   |
| `ALERT_GENERIC_WEBHOOK_URL`        | Custom HTTP endpoint receiving every alert | empty   |
| `ALERT_DEDUP_WINDOW_SECONDS`       | Seconds to suppress repeat alerts on the same dedup key | 900 (15 min) |

### Setting `ALERT_PAGERDUTY_INTEGRATION_KEY` in production

1. In the PagerDuty UI, create a new service (or pick an existing
   AlphaDesk service) and add an "Events API v2" integration. Copy the
   integration key.
2. Add the key to the production environment file. On the Hetzner
   server (`ssh -i ~/.ssh/alphadesk root@178.156.145.213`):

   ```bash
   echo 'ALERT_PAGERDUTY_INTEGRATION_KEY=<your-key>' \
     | sudo tee -a /opt/alphadesk/.env
   sudo systemctl restart alphadesk-backend
   ```
3. Verify by running the test event:

   ```python
   from services.alerts import Alert, AlertSeverity, fire_alert
   from datetime import datetime, timezone

   await fire_alert(Alert(
       severity=AlertSeverity.P0,
       title="Test page from runbook",
       description="If you got paged, the integration is wired.",
       source="runbook.test",
       deduplication_key="runbook.test",
       occurred_at=datetime.now(timezone.utc),
   ))
   ```

   You should see a triggered incident in PagerDuty within ~30s.
   Resolve it manually after verification.

## Severity meanings & SLAs

| Severity | Routes to            | Meaning                              | SLA                                        |
| -------- | -------------------- | ------------------------------------ | ------------------------------------------ |
| P0       | PagerDuty + Discord  | Page oncall NOW                      | First responder ack within 15 min          |
| P1       | Slack + Discord      | Notify; response within ~2 hours     | Investigated and resolved/escalated by EOD |
| P2       | Discord only         | Log-grade; review weekly             | Reviewed in the Friday operations sync     |

The `ALERT_GENERIC_WEBHOOK_URL` (if configured) **always** receives the
full structured alert regardless of severity — it's the "send
everything" hook for self-hosted routers (Alertmanager, custom on-call
bots).

PagerDuty severity mapping:

* P0 → `critical`
* P1 → `error`
* P2 → `warning`

## Dedup behaviour

Each alert can carry a `deduplication_key`. While that key has fired
within the last `ALERT_DEDUP_WINDOW_SECONDS` (default 15 min), repeat
alerts with the same key are silently suppressed. This protects against
flapping checks and runaway error loops creating an oncall page storm.

PagerDuty's Events API v2 also de-duplicates server-side on `dedup_key`
so even if the local cache is bypassed (multi-worker deployment), open
incidents merge instead of paging again.

When designing a new dedup key, scope it to "the smallest unit you'd
want to be paged about once":

* `daily_pipeline.run` — one page per session, regardless of which
  stage failed
* `kill_switch.layer3.<strategy>` — one page per strategy disable
* `trades.daily_loss_limit.<date>` — one page per session
* `trades.order_rate_limit.<username>` — one page per user per window
* `realtime_scanner.loop.<date>` — one page per day even if the loop
  flaps every minute

Set `deduplication_key=None` (default) to fire every event — typically
only desirable for tests.

## Wired hooks (as of audit P0-5)

| Hook                                      | File                                              | Severity | Dedup key                                |
| ----------------------------------------- | ------------------------------------------------- | -------- | ---------------------------------------- |
| Daily pipeline failure (uncaught)         | `backend/data/ingestion/daily_pipeline.py`        | P0       | `daily_pipeline.run`                     |
| Circuit breaker — daily PnL ≥ -2%         | `backend/data/ingestion/daily_pipeline.py`        | P0       | `daily_pipeline.circuit_breaker`         |
| Daily loss limit — order block            | `backend/api/routes/trades.py`                    | P0       | `trades.daily_loss_limit.<date>`         |
| Order rate-limit tripped                  | `backend/api/routes/trades.py`                    | P1       | `trades.order_rate_limit.<username>`     |
| Kill-switch Layer-3 manual disable        | `backend/strategies/_core/kill_switch.py`         | P0       | `kill_switch.layer3.<strategy>`          |
| Realtime scanner loop died                | `backend/data/ingestion/realtime_scanner.py`      | P0       | `realtime_scanner.loop.<date>`           |

### Circuit breaker

P0. The daily pipeline aborts when intraday P&L drops below -2% of
equity. Investigation:

1. Check `backend/data/pipeline_logs/<date>.json` for the latest run's
   `errors[]` and `portfolio_snapshot`.
2. Decide whether to re-enable the pipeline (P&L recovered) or leave
   it halted to the next session.
3. Use the `/admin/strategy-disabled` admin pages to thaw individual
   strategies if needed.

### Daily pipeline failure

P0. The pipeline raised an uncaught exception. Investigation:

1. Check the structured logs for the run; look for the exception type
   and the stage it died in.
2. If the error is a transient broker outage, manually re-trigger via
   `POST /api/v1/pipeline/run`.
3. If the error is a code regression, page the owning team.

### Daily loss limit

P0. New orders are now blocked. The session is over for trading until
tomorrow. Investigation:

1. Confirm the realised + unrealised loss in `/portfolio`.
2. Verify no position is unintentionally over-leveraged.
3. The block lifts at 00:00 UTC.

### Broker rate limit / order rate limit

P1. A user hit the per-user order submission cap (60 / 60s by default).
This typically signals a runaway script or a compromised session.
Investigation:

1. Identify the user from the alert metadata.
2. Check `/auth/sessions` for unexpected device/IP.
3. If suspicious, force-revoke their session via the admin tool.
4. If a script went wild, ack with the user and rate-limit / pause it.

### Kill-switch Layer-3 manual disable

P0. An operator manually pulled the red handle on a strategy. By
definition someone is responding, but the page wakes a co-oncall to
double-cover and writes the incident to durable history.

### Realtime scanner died

P0. The realtime scanner-loop's outer `try/except` surfaced a non-
cancellation error and the loop has stopped. Realtime signal evaluation
is HALTED until restart.

1. Check logs for the underlying exception.
2. Restart the backend (`systemctl restart alphadesk-backend`) to
   re-spawn the supervised task.
3. Open an incident if the cause isn't an obvious transient (Redis
   blip, DNS hiccup).

## Exit-rule engine — wing_capture

Defined-risk credit structures (iron condors, iron butterflies,
vertical credit spreads) reach near-max-loss when the underlying
breaks through one wing. Holding to expiration locks in max loss, but
the protective long wing still has residual time value that can be
captured by closing early. The `wing_capture` rule (in
`backend/services/exit_rules.py`, seeded by alembic
`0018_exit_rule_wing_capture`) auto-closes when unrealized loss is
≥ 80% of max loss AND DTE > 1, harvesting that residual value.
Disable per-trade by setting the `structure_type` filter or adjusting
`threshold` on the row in the `exit_rules` table — or flip
`enabled=false` for a strategy-wide pause. The rule fires at priority
15, between the take-profit close (10) and the time-based close (20),
and AFTER the priority-5 `loss_pct` alert so the operator is paged
before the auto-close runs.

## Exit-rule engine — adverse_momentum_close

`wing_capture` only catches a position once it has bled to 80% of max
loss. Momentum-aware traders cut losers earlier — when the underlying
gaps strongly INTO a wing, the trade is functionally dead well before
the 80% threshold. The `adverse_momentum_close` rule (seeded by
alembic `0019_exit_rule_adverse_momentum`, priority 12 — between
`profit_pct` at 10 and `wing_capture` at 15) fires when ALL THREE
conditions hold:

1. The underlying has moved at least `threshold` σ adverse to the
   structure (default 1.5σ). σ is set per-trade from
   `Trade.expected_move_pct`, the implied 1-σ move snapshotted at trade
   entry from the recommender's ATM-straddle. The intraday change
   itself rides into the rule engine via the
   `<underlying>:change_pct` sidechannel key on the marks dict — same
   convention as `<symbol>:delta` for `delta_breach`.
2. The move's direction is "adverse" for the structure. Short-vol
   structures (`iron_condor`, `iron_butterfly`, `short_strangle`,
   `short_straddle`) treat any large move as adverse. Bear-side
   spreads (`bear_call_spread`, `bear_put_spread`) gate on +moves;
   bull-side spreads (`bull_put_spread`, `bull_call_spread`) gate on
   -moves. Long-vol structures (`long_call`, `long_put`,
   `long_straddle`, `long_strangle`) NEVER fire — any large move
   benefits them.
3. Loss is already ≥ 30% of max_loss. Don't cut at break-even or in
   profit; momentum-and-loss together is the signal.

AMD postmortem 2026-05: spot ran +21% overnight on an iron condor
whose entry-time `expected_move_pct` was 8.55%, σ_move ≈ 2.46. With
30%+ realised loss at the open, this rule would have fired at 09:30 ET
and closed the position before the day's open hammered it deeper into
the wing. `wing_capture` would still have caught it later (and did, in
backtest), but at the cost of an extra ~$50–$100 per contract.

Failure modes — the rule abstains (returns `None`) on:

* `Trade.expected_move_pct` NULL or ≤ 0 (legacy rows that pre-date
  the 0019 migration, or trades opened before the recommender stamped
  the snapshot). The σ scale is undefined → engine skips. Always
  paired with `wing_capture` so the position still has a safety net at
  80% loss.
* No `<underlying>:change_pct` in the marks dict. The pipeline must
  populate this from the quote stream's regular-session change pct;
  if the quote feed is degraded the rule abstains rather than treating
  "no data" as a zero move.
* `structure_type` not in the direction map (e.g. equity, futures,
  exotic combos). Logged as `structure_not_classified:<type>` in the
  decision metadata so an operator can extend the map intentionally.

Tunable: `UPDATE exit_rules SET threshold=1.0 WHERE
rule_type='adverse_momentum_close'` to fire at 1σ (more aggressive,
more whipsaws); `2.0` for the conservative side. The 30% loss floor
is hard-coded in the rule body — change it there if you want a
different cut-in level (raising it to 50% effectively turns the rule
into a "early wing_capture at lower σ").

## How to add a new alert hook

The dispatcher is `services.alerts.fire_alert`. Keep alerts wrapped in
`try/except` so a misconfigured destination can never break the calling
critical path.

```python
from services.alerts import Alert, AlertSeverity, fire_alert
from datetime import datetime, timezone

# Inside whatever critical-path handler detected the issue:
try:
    await fire_alert(Alert(
        severity=AlertSeverity.P0,  # P0 / P1 / P2 — see severity table
        title="Margin utilisation > 80%",  # ≤ 80 chars, specific
        description=(
            "Account margin utilisation is X% (limit 80%). "
            "See docs/RUNBOOK-alerts.md#margin"
        ),
        source="risk.margin_check",  # short dotted path
        deduplication_key="risk.margin.gt80",  # collapses repeats in window
        occurred_at=datetime.now(timezone.utc),
        metadata={
            "utilisation_pct": util,
            "buying_power": bp,
        },
    ))
except Exception:
    logger.error("alert dispatch failed", exc_info=True)
```

Guidance:

* Pick the **lowest severity that gets the right person to act**.
  P0 wakes someone; P1 reaches them in working hours; P2 is for
  weekly review.
* Set a `deduplication_key` whenever a flapping check could fire
  twice within 15 minutes. Without it, every event fires.
* Put the runbook anchor in the description so the recipient lands
  on the right section directly.
* Keep `metadata` flat and JSON-serialisable — it shows up in the
  PagerDuty incident's `custom_details` AND in the Discord/Slack
  rendering.
* Don't await on the dispatcher's success: it's fail-open, and a
  blocked alert is strictly better than a blocked critical path.
