# Strategy Overhaul — Design Spec

**Date:** 2026-04-17
**Branch:** `feature/strategy-overhaul`
**Goal:** Replace the 12 existing broken/divergent strategy implementations with academically-faithful versions that demonstrably hit target Sharpe ratios on real 2019–2024 US-market data.

---

## 1. Why

The 16-agent audit (see `audit-reports/`) found that every strategy has two parallel implementations where the textbook class is dead code and the pipeline runs a degraded runner. Screener inputs are seeded RNG. Marketing copy describes features the code doesn't implement. No backtest harness exists — `big_run_result.json` is 0 bytes.

The current product is a shell without a core. This spec turns that around.

## 2. Success criteria

1. **Data** — real Alpaca bars (5yr), real Polygon options (5yr chain + IV + Greeks), real FMP earnings + fundamentals (SUE computable).
2. **Engine** — event-driven, walk-forward-capable backtest engine that takes a Strategy object and a date range and returns a reproducible metrics report.
3. **Strategies** — all 12 strategies, each as an independent module implementing the common `Strategy` protocol, each with an academic spec document citing the source paper(s).
4. **Targets** — each strategy's walk-forward Sharpe on 2019–2024 US data meets or beats its assigned target; a written justification is attached if convergence stalls below target.
5. **Modularity** — indicators library written once, shared; data providers swappable; cost model pluggable; strategies isolated; the 3,400-line `strategy_runner.py` is dissolved.

## 3. Target Sharpe ratios (2019–2024 walk-forward)

| Strategy | Target | Rationale |
|---|---:|---|
| Momentum Quality | 0.80 | L-only AQR/QMJ equity; 0.65–0.90 textbook |
| PEAD | 0.50 | L/S equity PEAD has decayed; 0.4–0.7 textbook |
| VRP Harvest | 0.70 | Options-based with tail hedge; 0.5–0.8 textbook |
| Earnings Vol | 0.70 | Short-vol straddles around earnings; 0.5–1.0 textbook |
| Regime Adaptive | 0.60 | Rule-based regime overlay; 0.4–0.8 textbook |
| TS Momentum | 0.80 | Multi-asset (sector ETFs + bonds); 0.7–1.0 textbook |
| RSI2 Reversal | 0.60 | SPY + large-caps with trend filter; 0.4–0.7 textbook |
| Dual Momentum | 0.80 | GEM with bond fallback; 0.6–0.9 textbook |
| Pairs Trading | 0.60 | Cointegration-gated, dollar-neutral; 0.3–0.7 textbook |
| KAMA Breakout | 0.50 | Equity-only trend; 0.3–0.6 textbook |
| ORB | 0.70 | 5-min ORB with TQQQ bias; 0.5–1.0 textbook |
| VWAP | 0.40 | Small intraday edge; 0.2–0.4 textbook |

**Blended portfolio target:** Sharpe 1.0+ via diversification across the 12.

## 4. Architecture (modular)

```
backend/
├── data/
│   ├── providers/                 # NEW — swappable adapters, one concrete class per vendor
│   │   ├── base.py                # Protocols: BarProvider, OptionsProvider, EarningsProvider, FundamentalsProvider, CalendarProvider
│   │   ├── alpaca.py              # Daily + 1-min bars, corporate actions
│   │   ├── polygon.py             # Stock bars + options chain + options aggs + Greeks
│   │   ├── fmp.py                 # Earnings calendar (SUE), fundamentals, analyst consensus
│   │   └── cache.py               # Parquet-backed local cache keyed by (provider, endpoint, params)
│   └── calendar.py                # US market calendar (NYSE/NASDAQ), sessions, holidays, half-days
│
├── indicators/                    # NEW — written once, reused by every strategy
│   ├── momentum.py                # RSI (Wilder), ConnorsRSI, MACD, ADX, ROC
│   ├── trend.py                   # SMA, EMA, KAMA, Donchian, Ichimoku
│   ├── volatility.py              # ATR (Wilder), Parkinson, Garman-Klass, realized vol, HV_n
│   ├── volume.py                  # VWAP (session-anchored), OBV, volume Z-score
│   ├── stats.py                   # z-score, pct-rank, EWMA, OU half-life, Hurst R/S, Engle-Granger ADF, OLS hedge ratio
│   └── options.py                 # Black-Scholes Greeks, IV rank, IV percentile, term-structure slope
│
├── backtest/                      # NEW — the engine
│   ├── engine.py                  # Bar-by-bar event loop
│   ├── portfolio.py               # Positions, cash, equity, P&L (Decimal money)
│   ├── execution.py               # Fill simulation (MOO, MOC, limit, market on close of bar)
│   ├── costs.py                   # Alpaca commission schedule + ADV-based slippage + spread model
│   ├── metrics.py                 # Sharpe, Sortino, Calmar, MDD, CAGR, turnover, hit rate, profit factor, tail ratio, alpha, beta
│   ├── walkforward.py             # Rolling-window walk-forward, purged K-fold
│   ├── report.py                  # HTML + JSON reports with equity curve, drawdown curve, returns distribution
│   └── cli.py                     # `python -m backtest --strategy=X --start=... --end=...`
│
├── strategies/                    # restructured — one package per strategy
│   ├── base.py                    # Strategy protocol + lifecycle hooks
│   ├── registry.py                # Strategy registry (decorator-based, replaces __init__.py dict)
│   ├── momentum_quality/
│   │   ├── __init__.py
│   │   ├── strategy.py            # Implementation
│   │   ├── config.py              # Params with defaults + search ranges for tuner
│   │   ├── spec.md                # Academic spec (citations, math, rules)
│   │   └── test_strategy.py       # Unit tests + reproducibility test
│   ├── pead/
│   ├── vrp_harvest/
│   ├── earnings_vol/
│   ├── regime_adaptive/
│   ├── ts_momentum/
│   ├── rsi2_reversal/
│   ├── dual_momentum/
│   ├── pairs_trading/
│   ├── kama_breakout/
│   ├── orb/
│   └── vwap/
│
└── tuner/                          # NEW — parameter search
    ├── search.py                   # Random search + Bayesian optimization via Optuna
    ├── objective.py                # Walk-forward Sharpe as objective (with penalties for turnover, MDD)
    └── reports.py                  # Per-strategy tuning report
```

## 5. Interfaces (the contracts that keep things isolated)

### Strategy protocol

```python
from typing import Protocol, Iterable
from datetime import date
from backtest.types import Bar, Signal, Context

class Strategy(Protocol):
    name: str
    required_bars: list[str]   # e.g. ["daily"], ["1min", "daily"]
    required_lookback_days: int

    def configure(self, params: dict) -> None: ...
    def universe(self, asof: date, ctx: Context) -> list[str]: ...
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]: ...
    # Signal = (symbol, target_weight, stop_price, take_profit_price, legs=[])
    def on_fill(self, fill, ctx: Context) -> None: ...  # optional
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]: ...  # exit/adjust
```

### Data provider protocols

```python
class BarProvider(Protocol):
    def bars(self, symbols, start, end, tf="1D") -> pd.DataFrame: ...

class OptionsProvider(Protocol):
    def chain_snapshot(self, underlying, asof) -> pd.DataFrame: ...
    def contract_bars(self, contract, start, end, tf="1D") -> pd.DataFrame: ...
    def historical_iv(self, underlying, start, end) -> pd.DataFrame: ...

class EarningsProvider(Protocol):
    def calendar(self, start, end, symbols=None) -> pd.DataFrame: ...
    def surprises(self, symbol, start, end) -> pd.DataFrame: ...
    def consensus(self, symbol, asof) -> dict: ...

class FundamentalsProvider(Protocol):
    def statements(self, symbol, asof) -> dict: ...  # point-in-time
    def piotroski_f(self, symbol, asof) -> int: ...
```

Every strategy depends only on these protocols. A fake provider can be dropped in for tests.

## 6. Cost model

Alpaca fee schedule (zero commission for stocks, $0.01/share options with $0.65 floor). Slippage: linear in traded ADV fraction plus ½ × spread. Borrow cost for shorts: 1% p.a. plus hard-to-borrow lookup (static list for now, extensible). All monetary math uses `Decimal`. No free lunches.

## 7. Walk-forward protocol

Primary protocol: **train 2019–2022, test 2023–2024** (33% OOS). Also reported: 5-fold purged walk-forward over 2019–2024 with 60-day purge between folds to control leakage. Reported Sharpe is the OOS number; IS Sharpe is informational only.

## 8. Delivery phases

**Phase 0 — Foundation** (1 team, 4 agents, serial):
- Team F1: backtest engine + portfolio + execution + costs + metrics + walk-forward + CLI + report
- Team F2: data providers (Alpaca/Polygon/FMP) + cache + calendar
- Team F3: indicators library (momentum/trend/volatility/volume/stats/options)
- Team F4: strategy base + registry + tuner framework (Optuna) + test harness

All four teams work against the interfaces above in parallel in Phase 0. Lead coordinator reviews for interface conformance and runs an end-to-end smoke test (fit trivial "buy SPY hold 5y" strategy, expect Sharpe≈SPY Sharpe).

**Phase 1 — Strategy rewrites** (4 waves × 9 agents = 36 agents total):

Each wave = 3 strategies in parallel. Each strategy gets a 3-agent team:
- **Researcher** — reads the academic paper(s), writes `spec.md`, enumerates parameters, documents known failure modes
- **Implementer** — writes `strategy.py` against the `Strategy` protocol, wires indicators + data providers, writes unit tests
- **Tuner** — runs walk-forward parameter search via Optuna until target Sharpe is hit or search converges; writes tuning report

Waves:
- **Wave A** — RSI2, KAMA Breakout, Dual Momentum (best-scoring in audit; good starters)
- **Wave B** — Momentum Quality, TS Momentum, Regime Adaptive (equity/allocation strategies)
- **Wave C** — Pairs Trading, ORB, VWAP (specialized: stat-arb, intraday, execution)
- **Wave D** — PEAD, VRP Harvest, Earnings Vol (earnings + options data heavy)

**Phase 2 — Integration**:
- Delete parallel runners in `strategy_runner.py` (the file is dissolved)
- Rewrite `frontend/src/lib/strategy-content.ts` to match what the code actually does
- Rewrite `backend/api/routes/strategies.py` to read from registry, not hardcoded metrics
- Merge to `feature/strategy-overhaul`, no prod deploy without explicit approval

## 9. What this does NOT do (YAGNI guard)

- Does not rewrite the live broker/order execution path (that's the `agents/execution.py` work — out of scope)
- Does not replace the production `trade_ledger.py` JSON-file issue (backend audit P0, separate task)
- Does not fix frontend fabricated-data issues (frontend audit P0, separate task)
- Does not add new strategies beyond the existing 12
- Does not change authentication, networking, or deployment

## 10. Open questions / defaults

- **Options strategies universe:** default to SPY/QQQ/IWM and top-50 liquid names (spread < 2% of premium, OI > 1000). Extensible via config.
- **Bond fallback proxy for Dual Momentum:** IEF + AGG blend (Antonacci's GEM uses AGG; we add IEF for rate-duration option).
- **TS Momentum universe:** 11 SPDR sector ETFs + IEF + TLT + GLD + DBC + UUP (9 equity sectors + bonds + commodity + dollar) — a multi-asset basket tradable through equity brokers.
- **Pairs universe:** cointegration-screened pairs from S&P 500 rebalanced quarterly, min 2yr history, p-value < 0.05.
- **Regime Adaptive:** 4 regimes (TrendUp, MeanRevert, HighVol, Crisis) defined by VIX level + SPY 200-SMA slope + sector-breadth.

---

## Approval status

- ✅ Scope (option A, all 12 strategies) — approved 2026-04-17
- ✅ Stack (Alpaca + Polygon Options Dev + FMP Starter) — approved 2026-04-17
- ✅ Concurrency (waves of 9) — approved 2026-04-17
- ✅ Modularity ("as modular as possible") — approved 2026-04-17
- ✅ Branch `feature/strategy-overhaul` created 2026-04-17
- ⏭️ Phase 0 dispatch — ready to go
