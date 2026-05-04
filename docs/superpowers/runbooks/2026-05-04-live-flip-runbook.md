# Live-Flip Runbook (Plan D)

**Date:** 2026-05-04
**Branch:** `feature/deployment`
**Scope:** Operational runbook for promoting the 19 implemented strategies from paper to live trading. Closes Plan D of the [19-strategy push design](../specs/2026-05-04-19-strategy-push-design.md).

This runbook does **not** ship code. It defines the operational protocol for the live flip.

---

## 1. Pre-flip checklist (per strategy)

Each strategy in `IMPLEMENTED_STRATEGY_ROUTE_IDS` must clear all six gates below before its `paper_only` flag is flipped to `False`:

| # | Gate | Verification command / location |
|---|---|---|
| 1 | All Phase A P1s for this strategy are merged | `audit-reports/00-strategy-experts-consolidation.md` §3 — verify each P1 has a closing commit or "already addressed" note |
| 2 | Theory faithfulness signed off | `audit-reports/expert-<name>.md` re-issued or confirmed unchanged |
| 3 | OOS JSON post-Wave-5 with bootstrap CI | `audit-reports/phase1-<name>-oos.json` has `sharpe_bootstrap_ci` field; `mtime > 2026-05-02` |
| 4 | Three-layer kill-switch wired | `python -c "from strategies._core.kill_switch import KillSwitch; print('ok')"` + `psql -c "SELECT 1 FROM strategy_disabled_events LIMIT 1"` |
| 5 | Health panel renders in UI | Visit `/strategies/<route-id>` as admin → § 04 · Health section visible with green dot |
| 6 | Disclosure banner shipped if applicable | `frontend/src/lib/strategy-content.ts` `risks` array contains the strategy-specific caveat |

For new strategies (C.1-C.6), an additional gate:

- **2-week paper runway**: 14 calendar days of paper trading with **zero** Layer-1 (drawdown) or Layer-2 (daily PnL) auto-disables and zero pipeline errors attributable to the strategy. Calendar-bound; cannot be compressed. Track via `SELECT * FROM strategy_disabled_events WHERE strategy = '<name>' ORDER BY triggered_at`.

---

## 2. Capital allocation

Equal-weight across **18 autonomous strategies**:

```
PORTFOLIO_DEPLOYMENT_PCT = 1.00  # 100% deployed when all 18 are live
PER_STRATEGY_WEIGHT      = 1.00 / 18 = 5.56%
```

The 19th implemented strategy is `earnings-options-play` (`kind="research"`, UI-only screener — never deploys capital). The 20th route ID `pairs-stat-arb` is a legacy alias backed by `pairs_trading`; counts as one strategy.

Override this default per strategy via `STRATEGY_LIMIT_OVERRIDES` in `backend/data/ingestion/master_agent.py`:

```python
STRATEGY_LIMIT_OVERRIDES: dict[str, float] = {
    # Example: weight pead heavier given its larger sample
    # "pead": 0.10,
}
```

The map is **empty by default**. For the initial flip, leave it empty.

**Future work** (out of scope for this push): risk-parity / inverse-vol allocation as a follow-on milestone.

---

## 3. Flip protocol

One strategy at a time, with a 24-48h observation gap between flips:

1. **Pre-flip**: verify the 6 gates from §1 (or 7 for new strategies)
2. **Flip the flag**: edit the strategy's `StrategyMeta` and remove `paper_only=True` (or set `paper_only=False`):
   ```python
   # backend/strategies/<name>/strategy.py
   @register_strategy(
       StrategyMeta(
           name="<name>",
           ...
           paper_only=False,  # was True
       )
   )
   ```
3. **Allocate capital**: leave `STRATEGY_LIMIT_OVERRIDES` at default (5.56% per strategy via equal-weight)
4. **Deploy**: merge to `feature/deployment`; trigger the Deploy AlphaDesk workflow
5. **Observe** for 24-48h with manual oversight:
   - Check `/strategies/<route-id>` Health panel every 12h
   - Watch `strategy_disabled_events` for any auto-disable triggers
   - Watch the master agent's `risk-monitor` panel for portfolio-level anomalies
6. **If no anomaly**: proceed to the next strategy
7. **If anomaly**: manually disable via Layer 3 (UI emergency-disable button), root-cause, fix, re-enable

### Order of flips (lowest-risk first)

```
1.  dual-momentum         (binary monthly allocation, lowest fail surface)
2.  ts-momentum           (multi-asset diversified)
3.  regime-adaptive       (rule-based, well-tested)
4.  momentum-quality      (clean theory, large sample)
5.  pead                  (large sample, biggest single impact)
6.  rsi2-reversal         (largest sample, largest test exposure)
7.  pairs-trading         (after KPSS upgrade lands; opt-in)
8.  sector-rotation       (NEW — monthly, low frequency)
9.  dividend-capture      (NEW — event-driven monthly)
10. mean-reversion        (NEW — weekly)
11. kama-breakout         (intraday code-quality good; sample thin)
12. vwap                  (intraday)
13. gap-fill              (NEW intraday — paper_only first)
14. vcp-breakout          (NEW intraday — paper_only first)
15. orb                   (after retune confirms post-Round-27 honest numbers)
16. vrp-harvest           (options — requires multi-leg ledger validation)
17. earnings-vol          (options — requires multi-leg ledger validation)
18. claude-alpha          (LAST — kind="research" → "autonomous"; LLM drift is highest-risk)
```

`paper_only=True` strategies (`gap-fill`, `vcp-breakout`, `kama-breakout`, `vwap`, `orb`) require an additional in-flight verification: confirm the `DailyPipelineRunner.STRATEGY_LIVE_DISABLED` set no longer includes the strategy after the flag flip.

`kind="research"` strategy (`claude-alpha`) requires a separate flip of `kind` from `"research"` to `"autonomous"` in addition to `paper_only`. Don't do both at once — flip `kind` first, observe a paper runway with the live Claude prompt, then flip `paper_only`.

---

## 4. Done criteria

The flip is complete when, simultaneously:

- All 18 autonomous strategies have `paper_only=False`
- Each strategy has accrued live P&L within the first 7 trading days
- Zero strategies have triggered Layer 1 (drawdown) auto-disable in the first 7 trading days
- Master agent shows non-zero capital allocation to every strategy
- 7-day retrospective signed off:
  - Daily PnL by strategy reviewed for outliers
  - Per-strategy `strategy_disabled_events` reviewed (zero L1, ≤1 L2 per strategy)
  - Catalogue API `/api/v1/strategies/catalog` returns `status: ACTIVE` for all 18

---

## 5. Rollback plan

If any strategy auto-disables via Layer 1 within 7 trading days of going live:

1. **Manually disable via Layer 3** (UI emergency-disable button on `/strategies/<id>` Health panel) — prevents further fills while you investigate
2. **Investigate** via the `strategy_disabled_events` table:
   ```sql
   SELECT * FROM strategy_disabled_events
   WHERE strategy = '<name>' AND resolved_at IS NULL
   ORDER BY triggered_at DESC
   LIMIT 10;
   ```
3. **Root cause** — is this a real drawdown the strategy is supposed to absorb, or an unintended bug?
4. **Fix** the underlying issue (code change → PR → merge → deploy)
5. **Re-enable** via the UI → observe another 7 days
6. **If a second auto-disable** within 14 days: revert `paper_only=True` and root-cause more deeply before re-attempting

The kill-switch (Plan B.4 + B.5) makes individual strategy failure recoverable. A portfolio-level circuit breaker is **not** in this push (out-of-scope per design doc); if added later, the same Layer 4 pattern applies.

### Emergency: full halt

To halt all strategies immediately without redeploying:

```sql
INSERT INTO strategy_disabled_events (strategy, layer, manual_actor, reason)
SELECT name, 3, 'ops-emergency', 'full halt — investigating'
FROM (VALUES
    ('momentum_quality'), ('pead'), ('vrp_harvest'), ('earnings_vol'),
    ('regime_adaptive'), ('ts_momentum'), ('rsi2_reversal'),
    ('dual_momentum'), ('pairs_trading'), ('kama_breakout'), ('orb'),
    ('vwap'), ('sector_rotation'), ('mean_reversion'),
    ('dividend_capture'), ('gap_fill'), ('claude_alpha'), ('vcp_breakout')
) AS s(name);
```

This inserts a Layer-3 (manual) disable event for every strategy. The kill-switch's `is_enabled()` check fires before every `Strategy.run()` invocation, so the next pipeline tick will skip every strategy. Resume one at a time via the Health panel's re-enable button or:

```sql
UPDATE strategy_disabled_events
SET resolved_at = NOW(), resolved_by = 'ops-emergency'
WHERE strategy = '<name>' AND layer = 3 AND resolved_at IS NULL;
```

Per the kill-switch operator runbook (`backend/strategies/_core/KILL_SWITCH.md`).

---

## 6. Per-strategy live-flip status (snapshot at runbook publish)

| # | Strategy | Pre-flip status | Notes |
|---|---|---|---|
| 1 | momentum-quality | LIVE-READY | Tuner-on-test disclosure shipped (A.3); P1-C docstring + universe survivorship-bias closed (B.2) |
| 2 | pead | LIVE-READY | sp500_constituents (B.2) closed survivorship; AMC/BMO data input pending (operator must wire production fundamentals provider) |
| 3 | vrp-harvesting | RESEARCH (gated) | kind="research"; needs multi-leg execution ledger full port (B.1 follow-on) before kind="autonomous" |
| 4 | earnings-vol-premium | RESEARCH (gated) | kind="research"; same multi-leg blocker as vrp-harvesting |
| 5 | regime-adaptive | LIVE-READY | P1-S soft-decrement shipped (A.1) |
| 6 | ts-momentum | LIVE-READY | Long-only-by-config disclosure shipped (A.3); shorts re-tune is CI batch (A.2 wired but not yet run) |
| 7 | rsi2-reversal | LIVE-READY | P1-J bdate_range fix shipped (A.1) |
| 8 | dual-momentum | LIVE-READY | Search-space already constrained pre-milestone |
| 9 | pairs-trading | LIVE-READY (KPSS opt-in) | P1-K KPSS counter-test + P1-L Hurst tighten + P1-M asymmetric regression all shipped (A.1) |
| 10 | kama-breakout | PAPER-ONLY | Sample thin (7 RTs); paper-only by spec until 2019-2024 walk-forward shows ≥15-25 RTs |
| 11 | orb | PAPER-ONLY | Tuner OOS-peek concern; paper-only deny-list per consolidation §4 |
| 12 | vwap-strategy | PAPER-ONLY | 6-month OOS only; paper-only until full 2023-24 OOS reruns post-Wave-5 |
| 13 | earnings-options-play | UI-ONLY | kind="research"; never deploys capital — manual-trade screener only |
| 14 | sector-rotation | PAPER-FIRST (NEW) | C.5 shipped 2026-05-04; paper runway begins on first monthly rebalance (May 30 EOM) |
| 15 | mean-reversion | PAPER-FIRST (NEW) | C.4 shipped 2026-05-04; paper runway begins on next Friday rebalance |
| 16 | dividend-capture | PAPER-FIRST (NEW) | C.2 shipped 2026-05-04; paper runway begins on next ex-event in window |
| 17 | gap-fill | PAPER-ONLY (NEW) | C.3 shipped; paper_only=True until intraday paper runway demonstrates Sharpe |
| 18 | vcp-breakout | PAPER-ONLY (NEW) | C.6 shipped; paper_only=True until weekly breakout signals validate |
| 19 | claude-alpha | RESEARCH (NEW v0) | C.1 shipped; kind="research" — replay-cache + scoring infra in place; live Claude prompt path is v1 follow-on |

**Live-ready (paper_only=False, no extra gates):** 9 strategies (rows 1-2, 5-9). Can flip immediately following the order in §3.

**Paper-first (paper_only=True; flip after 2-week paper runway):** 5 strategies (rows 14-18). Flip when paper runway clears.

**Research-gated (kind="research"; flip kind first):** 3 strategies (rows 3, 4, 19). vrp + earnings_vol need multi-leg ledger; claude_alpha needs live prompt path.

**Permanent paper-only by spec:** 3 strategies (rows 10-12). kama-breakout, orb, vwap need either longer history or post-Wave-5 retune confirmation.

**UI-only:** 1 strategy (row 13). Never flips — earnings-options-play is a manual-trade screener.

---

## 7. References

- [Master push design](../specs/2026-05-04-19-strategy-push-design.md) — the umbrella plan (§D Live flip)
- [Strategy report cards](../../audit-reports/00-strategy-report-cards.md) — per-strategy current state
- [Strategy experts consolidation](../../audit-reports/00-strategy-experts-consolidation.md) — P0/P1 backlog (most closed)
- [Kill-switch runbook](../../backend/strategies/_core/KILL_SWITCH.md) — Plan B.4 operator docs
- [Live-flip readiness completion (2026-05-02)](../../audit-reports/live-flip-readiness-completion-2026-05-02.md) — pre-milestone readiness pass
