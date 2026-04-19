# persona-56: Regulator audit (SEC / FINRA-adjacent)

Scope: record retention (SEC Rule 17a-4), CAT-style order audit trail, Reg BI
disclosure, suitability / Form CRS, clock synchronization (FINRA Rule 4590 /
CAT §6.6), customer-communications archiving (FINRA 2210). Intentionally
DIFFERENT angles from `persona-17-compliance.md` (consent capture, PII
inventory, auth-logger coverage). AlphaDesk positions itself as "not a
broker-dealer" (`MarketingShell.tsx:186`), which reduces — but does not
eliminate — regulatory surface where the platform makes recommendations,
holds records, and routes orders to Alpaca. Cross-refs: `infrastructure/backup.sh`,
`backend/data/storage/models.py`, `backend/data/ingestion/trade_ledger.py`,
`backend/api/routes/trades.py`, `backend/api/routes/webhooks.py`,
`backend/api/routes/agents.py`, `backend/api/routes/pipeline.py`.

Not a legal opinion — each finding is an engineering-actionable gap with a
regulatory frame.

---

## Top 10 regulatory gaps (new angles)

1. **No broker order-ID is persisted — CAT-style linkage is broken at the DB
   layer.** `POST /trades/orders` (`trades.py:376`) gets `order_id` back from
   Alpaca and returns it to the caller, but the `Trade` ORM row
   (`data/storage/models.py:88-125`) has NO `broker_order_id` / `client_order_id`
   column. The SQL mirror (`trade_ledger.py:166-190`) likewise has none. A
   regulator asking "tie AlphaDesk submission at 14:02:05 to Alpaca fill
   cat-reportable-ID XYZ" cannot be answered from our DB — the only link is a
   single log line (`trades.py:379`) that rotates out with Docker logs. For
   Consolidated Audit Trail (CAT) reporting posture, an originating-broker
   ID, client order ID, and representative ID are Must-Have-Three; we have
   zero.

2. **Order timestamps at whole-second resolution — fails FINRA 4590 / CAT
   millisecond precision.** Every `datetime.now(timezone.utc)` in
   `trades.py` (9 call sites) and the `submitted_at` column
   (`models.py:97`, server default `func.now()`) is whole-second Python
   wallclock. CAT Rule 6.6(a)(2) requires millisecond granularity for order
   events; FINRA Rule 4590 requires 50 ms for clock sync. Python
   `datetime.now(timezone.utc)` returns microseconds, but the JSON response
   strips them in many paths (e.g. `webhooks.py:120-121` uses `.isoformat()`
   with seconds precision in some formatters, and the Trade row's
   server-default is Postgres `NOW()` which rounds to the configured
   timestamp precision). There is no evidence of NTP discipline on the
   Hetzner VPS nor a startup probe asserting `timedatectl` sync status.

3. **SEC Rule 17a-4 retention is 30 days — short by 2.5 orders of magnitude.**
   `infrastructure/backup.sh:8,28,117` retains local DB dumps 30 days,
   remote 30 days. Rule 17a-4(b)(4) requires electronic records of
   communications relating to "the business as such" to be retained for 3
   years, the first 2 years in "an easily accessible place". Order tickets
   (17a-4(b)(1)) require 6 years. Even if AlphaDesk is "not a broker-dealer"
   the Trade journal, pipeline logs, and agent chat transcripts are
   operative business records. Today a 35-day-old order is un-recoverable
   once Postgres itself rotates the row off (there's no WAL archive). The
   data retention Privacy §07 claim — "30 days after account deletion" —
   actually undershoots the retention floor a broker audit would expect.

4. **No WORM / tamper-evident storage for order records.** Rule 17a-4(f)
   requires electronic records to be preserved "exclusively in a non-rewriteable,
   non-erasable format" (WORM) with time-stamped records, serialized
   indexes, and a duplicate copy. `trade_ledger` is a normal Postgres
   table — the app has `UPDATE` / `DELETE` privilege on its own rows
   (`trade_ledger.py:606,723`). `pipeline_logs/YYYY-MM-DD.json` is a regular
   file that anyone with `root` on the VPS (`ssh -i ~/.ssh/alphadesk root@87.99.143.65`)
   can edit or delete. S3 backups use rclone without Object Lock. A
   regulator's immutable-evidence bar is not met.

5. **AI chat transcripts are a 1-hour Redis blob — customer-comms archiving
   fail.** `agent_chat` (`agents.py:130-153`) stores conversation history at
   Redis key `conversation:{id}` with `ttl_seconds=3600`. FINRA 2210 /
   SEC 17a-4(b)(4) treat communications with the public — including written
   AI-generated responses that respond to investor queries with "buy /
   sell / hold / target price" language (strategy.py:48-50) — as records of
   the business. An investor complaint 48 hours later cannot be investigated
   because Redis has evicted the transcript. There is no archive to disk,
   no WORM mirror, no principal review queue.

6. **Reg BI-style "recommendation" language with no recommendation-suitability
   evidence and no Form CRS delivery.** `AgentChat` / `AnalysisPanel`
   (`frontend/src/components/panels/AnalysisPanel.tsx:971,1013`) advertise
   "AI-powered analysis … Technical, fundamental, and sentiment scores",
   and `StrategyAgent.system_prompt` (`agents/strategy.py:46-71`) directs
   the model to output concrete structures ("long calls", "bull call spread")
   with "position size as % of portfolio" and "max loss per trade 1-2% of
   portfolio". To any retail user those are recommendations. The Risk
   Disclosure §05/§06 (`risk/_risk/content.tsx:114-168`) says "not investment
   advice" — but the disclaimer lives on a separate `/risk` page, is not
   shown inline on the analysis or chat tab (no caption under the score,
   no modal before first chat message), and there is no Form CRS
   (Relationship Summary) delivery. Reg BI's Disclosure Obligation and
   Care Obligation cannot be met with a footer link.

7. **Suitability profile is never captured — no investor questionnaire.**
   FINRA Rule 2111 (suitability) and Reg BI Care Obligation require a
   reasonable basis for recommendations considering the investor's
   "investment profile" (age, net worth, tax status, liquidity needs,
   risk tolerance, experience). Login (`LoginForm.tsx`), `/request-access`
   (`request-access/page.tsx`), settings (`settings/page.tsx`), and onboarding
   show no KYC / suitability form. The platform will happily tell a
   retiree to sell naked calls (`risk/_risk/content.tsx:50-52` acknowledges
   unlimited-loss risk exists) without ever having asked them a question.
   The Pattern Day Trader reminder in §08 (`risk/_risk/content.tsx:186-193`)
   is disclosure-only — the app does not check `pattern_day_trader` flag
   (`mcp_servers/broker/server.py:37` fetches it but no gate consumes it)
   nor the $25K equity minimum before accepting a fourth day trade.

8. **Emergency halt auto-expires after 24 hours, silently.** `halt_trading`
   (`trades.py:938-953`) calls `_set_trading_halted(True)` which stores
   the halt flag in Redis with `ttl_seconds=86400` (`trades.py:44`). No
   admin action is required for trading to resume — it just happens. No
   audit event fires on the auto-expire path. For a regulator this is the
   reverse of fail-safe: a kill switch that un-kills itself silently after
   a day is worse than one that persists. Compare to FINRA Rule 3110
   (supervision) — a halt decision by an operator should require an
   affirmative re-enable.

9. **Trade rejections by our risk layer are not recorded in the ledger.**
   `_risk_check` (`trades.py:917-935`) returns `(False, msg)` for orders
   exceeding $50K notional and the handler raises HTTP 422 — nothing
   persists. Master-agent rejections in the pipeline are logged into
   `pipeline_logs/{date}.json` (`pipeline.py:391-394`, accessible via
   `pipeline_summary`), but the UI-initiated reject path is fire-and-forget.
   Rule 17a-3(a)(6) requires "memorandum of each brokerage order" including
   orders that were not executed. Our post-hoc story to a regulator — "the
   user tried a $60K order, we blocked it" — has no evidentiary
   backing beyond raw stderr logs that rolled off.

10. **TradingView webhook can trigger live broker orders with no venue
    disclosure, no route-reason record, and no user-approval handshake.**
    `POST /webhooks/tradingview` (`webhooks.py:47-128`) accepts a signed
    payload and calls `execution_agent.run(...)` which can submit orders to
    Alpaca (`_submit_to_broker` in `trades.py:1174`). The webhook endpoint
    (a) has NO authenticated principal — HMAC-secret-only, so the "user who
    placed this order" is `-`; (b) does not log the routing decision
    (symbol → venue → why Alpaca and not another MM) for best-execution
    review under Rule 606 / Reg NMS Rule 605 posture; (c) does not capture
    the user's intent artefact ("did you mean to route this to a paper
    account?"). Webhooks like this are exactly where FINRA 3110.09
    scrutinises algorithm-driven order generation — any automated order
    originator needs a documented review by a principal.

---

### Summary

AlphaDesk is in a hybrid grey zone: it disclaims broker-dealer and
investment-adviser status (Risk §07) while operating machinery that looks
and quacks like both — it originates recommendations, routes orders to
a clearing broker, keeps a trade journal, runs kill switches, produces
AI communications, and accepts automated external triggers. Persona-17
covered inward-facing compliance posture (audit logger coverage, consent
capture, PII governance, admin kill-switch logging). This pass focused
on outward-facing regulator angles and found ten additional gaps: no
broker-order ID linkage for CAT-style tracing, whole-second timestamps
well below FINRA 4590 precision, a 30-day retention floor that
undershoots SEC 17a-4(b)(1)'s 6-year requirement by two orders of
magnitude, no WORM / Object-Lock posture, ephemeral 1-hour AI chat
transcripts that are customer communications by any plain reading of
FINRA 2210, no inline "not advice" captions where recommendations are
rendered, no suitability / KYC capture despite unlimited-loss option
structures, no PDT enforcement, a kill-switch that auto-expires, lost
evidence of app-side order rejections, and an unauthenticated webhook
path to live order submission with no best-execution rationale record.
Before widening the audience beyond "single admin on a paper account",
items 1 (CAT linkage), 3 (retention floor), 5 (transcript archiving),
6 (Reg BI captions + Form CRS), and 7 (suitability) are load-bearing.
Item 8 (auto-expiring halt) is the single most dangerous operational
misbehaviour — a kill switch that un-kills itself should be a P0
regardless of regulatory framing.
