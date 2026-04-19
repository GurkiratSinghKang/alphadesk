# persona-17: Compliance Officer audit

Scope: audit-trail completeness, disclosures, PII handling, retail-suitability
warnings, broker-record keeping. Not a legal opinion — findings are
engineering-actionable gaps a compliance officer would flag during a readiness
review. Cross-refs: `observability-audit-r4.md` (logging gaps), `security-audit-r3.md`
(authN/authZ), `backend/core/logging.py` (structured logger), `backend/api/routes/auth.py`
(audit_logger is defined here and ONLY here).

---

## Top 10 compliance gaps

1. **Audit logger is authenticated-only.** `alphadesk.audit` only fires from
   `backend/api/routes/auth.py:14` — login/logout/refresh. Every other mutating
   route — `POST /trades/orders`, `DELETE /orders/{id}`, `POST /trades/halt`,
   `POST /trades/resume`, `POST /trades/alerts`, `DELETE /trades/alerts/{id}`,
   `POST /pipeline/run`, `POST /pipeline/cancel`, `POST /agents/refine-strategy`,
   `POST /strategies/{id}/toggle`, `POST /strategies/admin/risk-monitor`,
   `POST /webhooks/tradingview`, `POST /screener/presets` — emits a plain
   `logger.info` without `extra={"event":...,"user":...,"ip":...}`. A regulator
   asking "who cancelled order X at 14:02:05?" cannot be answered from logs.
   `trades.py:379-386` logs user but no IP/request_id/order_id-from-broker.

2. **Order rejections are not audit-logged.** `_submit_to_broker` (`trades.py:1242-1252`)
   translates Alpaca 4xx into HTTP 422 and surfaces the reject reason to the
   caller, but emits NO server-side log. Rejected orders disappear — SEC Rule
   17a-4 / FINRA 4511 equivalents require brokers to retain records of every
   order including rejects. The app isn't a broker, but it submits on the
   user's behalf and the only record is whatever Alpaca keeps. Add a
   `audit(event="order_rejected", user, symbol, reason)` on every 4xx branch.

3. **Cancellations silently succeed.** `DELETE /orders/{order_id}` (`trades.py:581`)
   returns 204 with no log line. Neither the cancellation nor its target order-id
   is recorded on our side. For regulator-style investigations ("the user claims
   they cancelled at 14:02; Alpaca shows a fill at 14:02:05"), our logs are
   silent. Also `cancel_order` takes no `username` dependency — it will run
   against any authenticated principal without recording who cancelled.

4. **No user consent artefact for ToS / Privacy / Risk.** Login (`LoginForm.tsx`)
   has no "I agree to Terms & Risk Disclosure" checkbox; `/request-access`
   `page.tsx:1-85` is a mailto pitch, not a consent capture. No database row
   records the version of `PRIVACY_CLAUSES`/`TERMS_CLAUSES`/`RISK_CLAUSES` the
   user accepted, when, from what IP. If the Risk Disclosure (`/risk`) is
   revised, nothing forces re-acceptance. Users can trade without ever reading
   the disclosures. The clauses carry a `lastUpdated="2026-04-12"` field that
   is never versioned in a consent table.

5. **PII collected outside the stated privacy policy.** Privacy Policy §01
   (`privacy/_privacy/content.tsx:21-40`) lists username / email / hashed
   password / API keys / usage / IP. But: (a) `User` / `UserProfile` tables
   don't exist in `data/storage/models.py` — there's ONE admin username in env
   (`settings.ADMIN_USERNAME`). Policy claims multi-user features that don't
   exist. (b) No ORM model holds email, so the "account information" clause
   misrepresents reality. (c) IP is logged in audit (`auth.py:_audit(... ip=...)`)
   and `request.client.host` is the trusted-proxy source — IPs are a GDPR
   personal data element and privacy policy says so, but there's no DPIA /
   no retention schedule / no erasure path.

6. **Data retention: no enforced schedule.** Privacy §07 states "personal data
   is removed within 30 days" on account deletion — there's no account deletion
   endpoint. `backup.sh` retains DB dumps 30 days local + 30 days remote
   (`infrastructure/backup.sh:28`). The trade ledger (`trade_ledger` table)
   has no retention policy and includes strategy/notes which may contain
   user-provided free text. `pipeline_logs/YYYY-MM-DD.json` is kept forever on
   the VPS volume (`infrastructure/docker-compose.prod.yml:65`). There is no
   cron / systemd timer to enforce the 30-day erasure claim.

7. **Marketing disclaimer insufficient; risk disclosure not shown inline.**
   Footer shows "Not a broker-dealer" (`MarketingShell.tsx:186`) which is
   correct. But (a) the dashboard (`(dashboard)/*`) has NO "Paper Trading
   Only" banner — `_submit_to_broker` hard-blocks non-paper URLs
   (`trades.py:1180-1185`), yet a user trading through the UI is never told
   trades are paper. (b) `/trade` page shows no inline risk reminder per
   FINRA-style suitability expectations. (c) AI-analysis output in
   `AnalysisPanel` / `AICopilot` is not captioned "not investment advice"
   per-surface despite Risk §06 saying so.

8. **Password reset is a stub.** `frontend/src/app/login/reset/page.tsx`
   exists; there's no corresponding backend endpoint (`auth.py` has login /
   refresh / logout only). A user cannot recover an account. Privacy §06
   claims "you have the right to … request correction or deletion of your
   personal data" — the only mechanism is emailing `legal@tradingalpha.net`.
   No SLA, no queue, no logging of received requests. That fails any meaningful
   GDPR/CCPA posture.

9. **Webhook audit trail too thin.** `POST /webhooks/tradingview`
   (`webhooks.py:47`) logs received alerts (`webhooks.py:91`) but (a) no
   audit row, (b) no persistence of the alert payload for regulator replay,
   (c) bad-secret attempts log at WARNING with IP only — no structured event,
   so grep is the investigation tool. A TV-webhook-to-order path produces an
   Alpaca fill with no server-side record connecting the two; only Alpaca
   has the lineage.

10. **Risk-monitor kill-switch has no audit trail.** `POST
    /strategies/admin/risk-monitor` (`strategies.py:1572`) flips
    `MasterAgent.RISK_MONITOR_ENABLED` in-process and logs at WARNING
    (`strategies.py:1588-1592`). No `audit(event="risk_monitor.toggle", ...)`.
    This is the single most consequential admin action in the platform — it
    disables P1-P4 risk checks and auto-approves trades — and it's recorded
    only as a plain log line that rotates out in 30 MB (observability-r4
    P2 #14). Same for `POST /trades/halt` / `POST /trades/resume` — market-wide
    kill switches with no tamper-evident audit row.

---

### Summary

The platform is positioned as "paper trading, not a broker-dealer"
(`MarketingShell.tsx:186`, Terms §07) which reduces the regulatory surface,
but for any audience beyond the single admin it is not compliance-ready. The
audit logger exists (`core/logging.py:161`) and is called from auth but
nowhere else; the `Trade` ORM model lacks any actor column; order rejects
and cancellations are unlogged; consent is not captured; account
self-service (deletion, password reset, data export) does not exist.
Retention policy is stated (30 days post-deletion) but not enforced. Before
opening the platform to additional users — especially in EU/EEA jurisdictions
— items 1, 2, 3, 4, 10 are load-bearing.
