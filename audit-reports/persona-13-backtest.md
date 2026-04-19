# Persona 13 — Quant Developer: Backtest Engine Audit

**Verdict:** The **backend** Python engine at `backend/backtest/` is a genuinely usable, production-quality bar-by-bar engine. The **frontend** `BacktestPanel.tsx` is a cosmetically unrelated toy that shares nothing with the backend.

---

## 1. UI → backend wiring — BROKEN

`frontend/src/components/panels/BacktestPanel.tsx` is **100% client-side**. It calls `getBars(symbol, "D", 500)` and runs SMA/RSI/MACD in JavaScript (`runSmaBacktest`, `runRsiBacktest`, `runMacdBacktest`). There is **no `/api/backtest` endpoint**. `backend/api/routes/strategies.py` only serves precomputed OOS metrics via `_load_oos_for()` reading `backend/data/oos/phase1-*.json`. A quant cannot run an ad-hoc backtest from the UI against the real engine.

## 2. Engine quality — solid

`backend/backtest/engine.py` (630 lines). The `BacktestEngine.run()` loop is carefully sequenced:
- Apply splits/dividends BEFORE fills (prevents double-count).
- MOO orders fill at **today's open** (staged T-1).
- `strategy.manage()` runs mid-day on MTM prices.
- MOC/MKT fills at today's close; `generate_signals()` produces signals eligible T+1.
- Docstring explicitly claims "No look-ahead" — and `ExecutionSimulator._try_fill` enforces `bar.ts > order.staged_on` for non-MOC/MKT orders, `>=` for MOC/MKT. Correct.

Execution (`execution.py`): LMT, STOP, TP, MOO, MOC, MKT supported. LMT fills at `min(limit, open)` for BUYs (conservative). Multi-leg options price per-leg via `OptionsProvider.contract_bars` with Black-Scholes fallback.

Costs (`costs.py`): `DefaultCostModel` — Alpaca-style zero-commission equities, $0.01/contract + $0.65 min options, regulatory fees on sells, linear slippage `impact_coef * notional/adv_20d + 0.5*spread`. Borrow accrued daily.

## 3. Walk-forward — decent

`walkforward.py` supports both **train/test** (via `train_end`) and **K-fold purged** (default 60-day purge). One caveat in the docstring itself: *"we don't actually re-fit — we still report the test-region OOS result"*. The runner does not execute a training step; it just partitions sessions. Parameter tuning happens externally in `scripts/tune_*.py`. Aggregation stitches fold equity curves via `(1 + combined).cumprod()`.

## 4. Metrics — consistent

`metrics.py` produces: `sharpe`, `sortino`, `calmar`, `max_drawdown`, `cagr`, `tail_ratio`, `hit_rate`, `profit_factor`, `turnover`, `alpha`, `beta`. Annualised with 252 days. Sortino uses LPM2 (sum squared negatives / N, not just N_neg) — correct formulation. Scratches (pnl == 0) excluded from hit_rate denominator. Matches `portfolio.py`/frontend conventions.

## 5. Reproducibility — YES

`EngineConfig.seed=42` wired into `np.random.default_rng(seed)` on the engine. FakeBarProvider in tests also seeded.

## 6. Performance — concerning for 2GB VPS

No explicit parallelism. The engine materialises `equity_rows`, all `fills`, all `trades`, and calls `self.bar_provider.bars(syms, session, session, ...)` **once per session per symbol** — this is likely I/O-bound at scale. `phase1-ts_momentum-oos.json` reports `elapsed_seconds: 588` for a 2-year 11-asset OOS; fine offline, but would OOM a 2GB box under a 40-trial sweep.

## 7/8. Results + Reporting

`report.py` writes **JSON + self-contained HTML** with base64-embedded PNG charts (equity, drawdown, returns histogram, monthly heatmap). No PDF, no CSV export. No run-vs-run diff tool — comparison is manual. Frontend compare mode exists but only for the JS toy.

## 9. CLI — usable

`python -m backend.backtest --strategy=rsi2 --start=2020-01-01 --end=2024-12-31 --walk-forward --k-folds=5 --benchmark=SPY --params='{"period":2}'`. Reports written to `./backtest_reports/`. Args are clean.

## 10. Registry integration — functional

`cli.py` resolves via `strategies.registry.get_strategy(name)`. `scripts/tune_*.py` wire `BacktestEngine` directly against registered strategies. The `backend/data/oos/phase1-*.json` files are produced by those tuning scripts, not by CI — reproducibility from the committed code is possible but manual.

## Bottom Line

**Backend: ~85% production-ready.** A real event-driven engine with no look-ahead, per-contract option pricing, decent cost modelling, deterministic seeds, and good metrics. Missing: HTTP endpoint, CSV export, run comparison, real walk-forward re-fit, parallelism, memory bounds.

**Frontend BacktestPanel: throwaway.** A separate JS implementation that has no connection to the backend engine. Quants should use the CLI.
