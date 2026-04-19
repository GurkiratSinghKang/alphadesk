# Persona 7 — The Pipeline Operator

**Audited:** 2026-04-18 (Saturday, market closed) against production `tradingalpha.net`.
**Question:** Can I actually run a trading operation with this?
**One-line verdict:** Acceptable for unattended scheduled runs. Unacceptable for active ops: no live-running indicator, no kill switch, no per-strategy trace of what's happening right now, and no Alpaca order-id surface.

---

## TL;DR — Top 10 findings

1. **P0 — `GET /pipeline/status` never reports `running: true`.** The backend `_pipeline_status` dict at `backend/data/ingestion/daily_pipeline.py:137` only stores `last_run` / `last_result`. The frontend at `frontend/src/app/(dashboard)/pipeline/page.tsx:383` reads `status.running` which is always `undefined`. The green "Running" status dot in the header is dead code — an operator watching this page during a scheduled run will see "Idle" even while a 5-min pipeline is burning Polygon quota. Fix: set `_pipeline_status["running"] = True` inside `_pipeline_lock`, return it from `get_pipeline_status`, and have the frontend poll every 5s while `running`.
2. **P0 — Run Now blocks the entire request for the full pipeline duration.** `POST /pipeline/run` awaits `run_daily_pipeline()` synchronously (`backend/api/routes/pipeline.py:85`). A real run takes 30-180s. The browser spinner ("Running…") only unblocks after completion. If the user closes the tab mid-run the HTTP response is lost but the pipeline continues — they have no way to rejoin. Fix: return `202 Accepted` with a `run_id`, expose `GET /pipeline/run/{id}` for polling.
3. **P0 — No kill switch.** I could not find any `cancel` / `abort` / `stop_pipeline` endpoint (`grep` against `pipeline.py` returned nothing). `_pipeline_lock` is an `asyncio.Lock` — if the pipeline is stuck on a hung Polygon call, the only way out is SSH in and restart uvicorn. The known-limitation block in `qa/pages/pipeline.md:103` even says "if the backend crashes mid-run, running remains true; user cannot re-trigger." That's a runaway condition with no operator escape hatch.
4. **P1 — No live progress during a run.** No SSE, no websocket, no per-stage indicator. The design spec (`qa/pages/pipeline.md:98`) promises a "Pipeline mid-run" state with a green dot and "Running" label, but that state is unreachable (see #1). An operator cannot tell whether we're at "Screening", "Analyzing", or "Placing orders".
5. **P1 — No per-strategy trace for the CURRENT run.** Per-strategy data only materializes in `/history/{date}` AFTER the run writes `pipeline_logs/{date}.json`. While the pipeline executes, the operator has zero visibility into which strategy is running or which symbols are being analyzed. The `master_agent.rejections` block is a rich postmortem but it's not a live feed.
6. **P1 — Errors surface only as raw strings in `errors: []`, no classification.** Today's run at `/pipeline/history/2026-04-19` returned `["Outside trading window (00:21 ET)", "Pipeline aborted: VIX unavailable..."]`. There's no distinction between "transient — retry in 5min" and "permanent — VIX provider is down, escalate". The frontend doesn't even render `errors` on the PipelineFlow card — it only shows "{n} error(s)" in expanded history rows (`page.tsx:749-753`), forcing a click-through.
7. **P1 — Alpaca order ids never reach the UI.** The Alpaca integration generates `client_order_id` like `pead_MRK_20260411195954` (`daily_pipeline.py:210`) but I could not find any rendering of `order_id` on `/pipeline`. If an order fails in Alpaca, an operator cannot paper-trail it forward into the broker dashboard. Historical logs at `/history/2026-04-11` show `"orders_placed": [{"error": "Client error '403 Forbidden'..."}]` — this catastrophic Alpaca auth failure is invisible on the pipeline page (only lives in a deeply nested JSON).
8. **P1 — No `/pipeline/scheduler_state` endpoint.** You prompted me to try it — it 404s. The scheduler does persist state to Redis at key `pipeline:scheduler_state` (`pipeline_runner.py:288`) tracking `last_premarket`, `last_open`, etc., but nothing exposes it. An operator cannot answer "did today's 09:35 ET open window actually fire?" without SSHing and running redis-cli. Same applies to next-fire time — the only hint is `schedule.windows[*].time` which is a static string, not a dynamic "next run at 09:35 ET Monday".
9. **P2 — Holiday-aware copy is done well.** `frontend/src/app/(dashboard)/pipeline/page.tsx:54-74` has `nextTradingSessionLabel()` that routes Sunday → Monday. I visited on a Sunday and the message is correctly "Market is closed today. Next scheduled run: Monday 09:30 ET." The scheduler itself uses `USMarketCalendar` (`pipeline_runner.py:102-121`) and respects half-days (e.g. July 3 half-day early-close logic at `pipeline_runner.py:242-267`). Good.
10. **P2 — No docs link anywhere on the page.** `grep` against `pipeline/page.tsx` for `help|doc|troubleshoot` — zero matches. An operator landing on their first red error has no "what do I do?" link. `qa/pages/docs.md` apparently exists but nothing from `/pipeline` references it.

---

## 400-word summary

The `/pipeline` page is **pretty for a postmortem, useless during an incident.**

**Walking in fresh (journey steps 1-2):** The page loads with a rich layout — 7 open positions ($57k deployed), 4-stage PipelineFlow (Screened → Analyzed → Signals → Orders), 7-day history table, 6-card perf grid. Today's Sunday copy correctly reads "Market is closed today. Next scheduled run: Monday 09:30 ET." The `Run Now` button is primary-styled and inviting.

I clicked Run Now. The button showed `Loader2` for ~4 seconds and returned with `{"errors": ["Outside trading window (01:37 ET)", "Pipeline aborted: VIX unavailable..."]}`. **The page did not re-render those errors** — they lived in the JSON response, not the DOM. I had to `curl /history/2026-04-19` to see them. Second click hit `429 rate_limited` from the 1-per-60s limiter. Good that the limiter exists; bad that the UI offers no backoff countdown.

**Running-right-now visibility (step 6):** Broken. The status dot never turns green. The header claims the design intent ("Running" / green dot / Loader2), but `GET /pipeline/status` never returns `running: true` — only `last_run` and `last_result`. So during a real 120-second premarket run on Monday 06:00 ET, an operator refreshing this page will see "Idle" next to a slightly-stale timestamp. Catastrophically misleading.

**Historical drill-down (step 3-4):** This is where the product earns its keep. Expanding 2026-04-18 reveals per-strategy `analyses[]` with symbols / signals / conviction / rationale AND `trades[]` with `approved: false` + human-readable `reason` ("Sector 'Unknown' would reach 100%") plus `remediation`. That's the good stuff a strategy researcher wants — but it's latent, only available after-the-fact via a chevron expand.

**Kill switch + scheduler state (steps 7-8):** Both absent. There is no cancel endpoint; there is no `/scheduler_state` endpoint. The Risk Monitor toggle IS exposed (`POST /strategies/admin/risk-monitor?enabled=false`) and I confirmed it flips — that's the one operator lever that works from the UI.

**Alpaca integration (step 12):** The backend creates `client_order_id` like `pead_MRK_20260411195954` for traceability but the frontend never renders it. When 2026-04-11's MRK order hit `403 Forbidden`, that failure lived only in JSON. An operator reconciling against the Alpaca dashboard has to go read logs.

**Bottom line:** Ship a `running: bool` flag, a live progress stream, and a kill button before letting this anywhere near a real book.
