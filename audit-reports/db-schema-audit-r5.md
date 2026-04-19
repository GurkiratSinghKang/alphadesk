# DB Schema Audit — Round 5

**Scope:** `backend/data/storage/models.py` + alembic (`backend/alembic/versions/`) + ad-hoc DDL in `backend/data/ingestion/trade_ledger.py`; route-level query patterns in `backend/api/routes/*.py`; ingestion pipelines in `backend/data/ingestion/*.py`.

**Stack facts established during the audit (matter for the findings below):**
- Two separate trade tables coexist in production:
  - `trades` — SQLAlchemy ORM (`models.py`, class `Trade`), created via `Base.metadata.create_all`.
  - `trade_ledger` — raw DDL in `data/ingestion/trade_ledger.py:_ensure_schema`, created on first import. Has **no ORM model**, **no alembic coverage**, and **no foreign key to `trades`**. This is the table every pipeline actually writes to (`record_entry`, `record_exit`, `add`, `update`). `routes/trades.py:/history` tries the ledger first, falling back to `Trade`.
- No `ForeignKey(...)` relationship anywhere in `models.py` (verified via grep — zero hits in `backend/`).
- Alembic is bootstrapped but baseline is deliberately empty (`0001_baseline.py`). Only `0002_add_side` is a real migration. All model-level indexes added in `models.py` after baseline (e.g. `ix_trades_symbol_entry_time`, `ix_trades_strategy_status`, the compound on `agent_analyses`) have **not** been propagated via alembic — they exist only in the ORM metadata. Live DB is almost certainly missing them.
- No TimescaleDB chunk-interval tuning, retention policy, continuous aggregates, or compression policy — only the bare `create_hypertable('ohlcv_bars', 'timestamp')` call.
- No `users` table exists. `email`/auth uniqueness is not a DB concern today (auth is HTTP Basic against a single env-configured user).

---

## Summary — top 15 findings ranked by risk

| # | Pri | Table / Column | Class |
|---|-----|----------------|-------|
| 1 | P0 | `trades.pnl`, `trades.entry_price`, `trades.exit_price` | Money stored as `Float` |
| 2 | P0 | `trade_ledger` table (entire) | Unmanaged schema, not in alembic, created by raw DDL at import |
| 3 | P0 | `trades` vs `trade_ledger` | Two parallel trade tables with no FK linking them; dual writes diverge |
| 4 | P0 | `trade_ledger.list()` + `_list_all()` | Full-table scan on every call; routes wrap `for t in ledger._data.get('trades')` — loads every trade into memory |
| 5 | P0 | `positions.quantity`, `avg_cost`, `current_price`, `unrealized_pnl` | Money / quantity stored as `Float` |
| 6 | P1 | `ohlcv_bars` hypertable | No `chunk_time_interval` tuning, no retention policy, no compression |
| 7 | P1 | `trades.status` + `trade_ledger.status` | No `CHECK` constraint; free-form `VARCHAR`; typos become silent divergent states |
| 8 | P1 | `ohlcv_bars.open/high/low/close/volume/vwap` | Money as `Float` on a high-volume time-series table |
| 9 | P1 | Index drift between ORM and live DB | `ix_trades_symbol_entry_time`, `ix_trades_strategy_status`, `ix_agent_analysis_symbol_type`, `ix_options_underlying_expiry`, `ix_signal_strategy_symbol` declared only in ORM |
| 10 | P1 | `options_snapshots.strike`, `bid`, `ask`, `last`, greeks | Money + price-sensitive values as `Float` |
| 11 | P1 | `AgentAnalysis` table (entire) | No server-side pagination, no retention; full-table scan order-by timestamp |
| 12 | P1 | `trades.legs` / `positions.greeks` default | Python-level `default=list`/`default=dict`, no `server_default` — direct SQL inserts get NULL |
| 13 | P2 | `ohlcv_bars` and `strategy_signals` | No partial index on "recent N days" or on `status='open'` for `trades` |
| 14 | P2 | `OHLCVBar.symbol` column length | `String(20)` but `OptionsSnapshot.symbol` is `String(40)` — inconsistent bound for occasional options ticker storage |
| 15 | P2 | `Alert.acknowledged` | No partial index `WHERE acknowledged = false` — list-unacknowledged scans full table |

---

## Findings

### [P0] Money columns stored as Float across every financial table
**Table/Column:** `trades.entry_price`, `trades.exit_price`, `trades.pnl`, `positions.quantity`, `positions.avg_cost`, `positions.current_price`, `positions.unrealized_pnl`, `options_snapshots.strike`, `options_snapshots.bid/ask/last`, `options_snapshots.iv/delta/gamma/theta/vega`, `ohlcv_bars.open/high/low/close/vwap`, plus the mirror columns in the raw-DDL `trade_ledger` table (`entry_price`, `exit_price`, `pnl`, `pnl_pct`, `stop_loss`, `take_profit` — all `DOUBLE PRECISION`).
**Current:** `Float` in SQLAlchemy, which emits PostgreSQL `DOUBLE PRECISION`.
**Should be:** `Numeric(12, 2)` for P&L / prices, `Numeric(18, 4)` for quantity (for fractional shares), `Numeric(10, 4)` for greeks / IV.
**Impact:** The app already went through a round of "compute P&L in Decimal, quantize ROUND_HALF_UP at the end" (`trade_ledger._money`, `_to_decimal`, code-patterns-audit-r4 P0 #3). That Decimal-layer work is **defeated the moment the value is assigned to a `Float` column** — SQLAlchemy silently casts back to Python `float` on write and reload, reintroducing the same banker's-rounding / binary-float drift on `.xx5` boundaries (e.g. `123.455 -> 123.45 vs 123.46` depending on fp representation). Also sub-penny ghosts in the UI ("P&L $42.01000000000001").
**Fix:**
```python
# models.py
from sqlalchemy import Numeric
entry_price = Column(Numeric(12, 4), nullable=True)
exit_price  = Column(Numeric(12, 4), nullable=True)
pnl         = Column(Numeric(14, 2), nullable=True)
```
Alembic migration:
```python
op.alter_column('trades', 'pnl',
    type_=sa.Numeric(14, 2),
    postgresql_using='pnl::numeric(14,2)')
op.alter_column('trades', 'entry_price',
    type_=sa.Numeric(12, 4),
    postgresql_using='entry_price::numeric(12,4)')
# ... same for exit_price, positions.*, options_snapshots.*, ohlcv_bars.*,
# and the raw-DDL trade_ledger money cols (ALTER TABLE trade_ledger ALTER COLUMN ...)
```
Python-side: update callers to pass/accept `Decimal`. `trade_ledger._row_to_dict` already returns scalars; the `TradeHistoryEntry` pydantic model (`routes/trades.py:163`) would need `pnl: Decimal | None` instead of `float | None` (or keep float at the API boundary with explicit quantize).

---

### [P0] `trade_ledger` is an unmanaged schema created by raw DDL at import time
**Table/Column:** `trade_ledger` (whole table).
**Current:** Created inside `data/ingestion/trade_ledger.py:_ensure_schema` (line 148–193) via a `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` block the first time `TradeLedger()` is constructed. No ORM model, no alembic coverage, not declared on `Base.metadata`.
**Should be:** A real SQLAlchemy model in `models.py`, with schema managed exclusively by alembic. The raw-DDL path should be deleted.
**Impact:**
- `alembic upgrade head` sees none of the `trade_ledger` columns or indexes, so schema drift is invisible to migrations.
- Adding a column means editing the DDL string in `trade_ledger.py` AND adding an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — the `side` column already has this anti-pattern (line 185).
- The `CREATE SEQUENCE IF NOT EXISTS trade_ledger_id_seq` (line 189) is the app's only PK-allocation mechanism (no `SERIAL`/identity). If someone runs `alembic autogenerate` with `target_metadata=Base.metadata`, alembic will want to DROP this table because it doesn't know it exists.
- `0002_add_side` already had to special-case this by running `ALTER TABLE trade_ledger ADD COLUMN IF NOT EXISTS side ...` as raw SQL inside the migration — confirming the table is outside normal alembic flow.
**Fix:**
1. Add `TradeLedger` ORM model (matching the column set in `_ensure_schema`) to `models.py`.
2. Generate alembic migration that `CREATE TABLE`s it properly (with `IF NOT EXISTS` to be idempotent against existing DBs).
3. Replace `_ensure_schema` / `_run_migration` call sites with ORM inserts via the async session factory.
4. Decide: collapse `trade_ledger` and `trades` into one table (see next finding), or at minimum add a FK from `trade_ledger.trade_id -> trades.id`.

---

### [P0] Two parallel trade tables (`trades` vs `trade_ledger`) with no FK or mapping
**Table/Column:** `trades` (ORM) and `trade_ledger` (raw DDL).
**Current:**
- `routes/trades.py:create_order` (line 333–344) inserts into `trades` (the ORM table) on every manual order.
- Pipeline code (`record_entry`, `record_exit`, `add`, `update` in `trade_ledger.py`) writes exclusively to `trade_ledger`.
- `routes/trades.py:/history` (line 548–595) reads `trade_ledger` first, then falls back to `trades` — so a single "trade history" page can mix records from two different tables with different schemas, different PK sequences (`trade_ledger_id_seq` vs `trades.id` autoincrement), and different status vocabularies.
- No FK, no join, no identity mapping.
**Should be:** One canonical table. If the distinction is "orders vs completed-lifecycle trades", name them `orders` + `trades` and FK `trades.order_id -> orders.id`.
**Impact:**
- Duplicate IDs are possible across the two tables (both start at 1). Any UI or audit log that references a trade by bare `id` is ambiguous.
- `/history` dedup is lossy — it takes ledger rows and skips the DB branch if the ledger returned ≥1 row (line 565), so a manual order recorded in `trades` but absent from `trade_ledger` is silently missing from history as long as the ledger has any row at all.
- Reconciliation with Alpaca (`sync_with_alpaca`) only touches `trade_ledger`; positions opened via the ORM path in `create_order` are orphaned from the reconciliation logic forever.
**Fix:** Pick one. Recommended: migrate all ledger writes to the ORM `Trade` model and drop `trade_ledger`. Add a `lifecycle` column (`submitted`/`filled`/`closed`/`cancelled`) if the two tables existed to distinguish states.

---

### [P0] `TradeLedger._list_all()` is a full-table SELECT called from hot routes
**Table/Column:** `trade_ledger` (whole table).
**Current:** `trade_ledger.py:403` — `SELECT * FROM trade_ledger ORDER BY id ASC` with no `LIMIT`. Called from:
- `_LegacyDataView.__getitem__("trades")` (line 346) — every time a caller does `ledger._data["trades"]`.
- `count_today_trades` (line 1060).
- `_match_strategy_for_symbol` (line 1026).
- `get_strategy_performance` (line 1072).
- Indirectly from `routes/trades.py:550`, `routes/strategies.py:1012, 1118, 1148, 1260, 1571, 1773`, `routes/portfolio.py:557, 847`, `routes/risk.py:170, 436`.
Every one of these is "pull the entire trade history, then filter in Python".
**Should be:** Push `WHERE`, `ORDER BY`, and `LIMIT` into the DB.
**Impact:** Linear growth in latency and memory as the ledger grows. Today the table is small enough not to hurt, but every one of those grep hits is a latent DoS vector. Worst offender: `routes/strategies.py:1148` is inside a loop over strategies — so it's `O(strategies × trades)` scanned per request, all in Python.
**Fix:**
- Add `get_recent(n)`, `get_open_for_symbol(symbol)`, `count_since(ts)` methods that push predicates into SQL.
- Remove the `_data["trades"]` legacy shim (line 332–355) or make it raise so callers migrate.
- Once consolidated into the ORM `Trade` model (fix #2+#3), routes use `select(Trade).where(...).limit(...)`.

---

### [P1] `ohlcv_bars` hypertable has no chunk-interval tuning, no retention, no compression
**Table/Column:** `ohlcv_bars` (TimescaleDB hypertable).
**Current:** `core/database.py:107` — `SELECT create_hypertable('ohlcv_bars', 'timestamp', if_not_exists => TRUE)` and nothing else. Default `chunk_time_interval` is 7 days for TimescaleDB, which is reasonable for daily bars but catastrophic if intraday bars are ingested into the same table (they aren't today — the raw-DDL ingestion actually writes to `ohlcv_bars` via SQLAlchemy — but the `ohlcv_bars` schema allows intraday via the `timestamp` column, and the `limit=5000` on `/bars` implies intraday reads).
**Should be:**
```sql
SELECT set_chunk_time_interval('ohlcv_bars', INTERVAL '1 day');
-- or INTERVAL '7 days' for daily bars.
SELECT add_retention_policy('ohlcv_bars', INTERVAL '2 years');
ALTER TABLE ohlcv_bars SET (timescaledb.compress, timescaledb.compress_segmentby = 'symbol');
SELECT add_compression_policy('ohlcv_bars', INTERVAL '30 days');
```
**Impact:** Without retention, the table grows unbounded; without compression, storage costs are ~10× what they need to be; without tuned chunk intervals, chunk-exclusion WHERE-`timestamp` filters scan wider ranges than necessary.
**Fix:** Alembic migration that runs the three statements above, guarded by `IF NOT EXISTS` / exception swallow for environments without TimescaleDB.

---

### [P1] `trades.status` and `trade_ledger.status` have no CHECK constraint
**Table/Column:** `trades.status` (`String(20)`, default `"open"`), `trade_ledger.status` (`VARCHAR(16)`, default `"open"`).
**Current:** Free-form string. Values observed in code: `"open"`, `"closed"`, `"submitted"` (`routes/trades.py:338`), `"alpaca_sync_zero_qty"` (no — that's an `exit_reason`, not a status), Alpaca mapping emits `OrderStatus.SUBMITTED/PARTIAL/FILLED/CANCELLED/...` but those never reach the DB because `create_order` writes literal `"submitted"`.
**Should be:** `CHECK (status IN ('open','submitted','filled','closed','cancelled'))` OR a PostgreSQL enum.
**Impact:** A typo (`"opne"`, `"CLOSED"` vs `"closed"`) becomes silent data. `get_open_positions()` filters `status = 'open'` and silently misses anything case-mangled. Routes that compute `len(wins) + len(losses)` from `pnl > 0 / < 0` don't notice bad rows because they skip on `status != 'closed'`.
**Fix:**
```python
from sqlalchemy import CheckConstraint
__table_args__ = (
    CheckConstraint(
        "status IN ('open','submitted','filled','closed','cancelled')",
        name='ck_trades_status_valid',
    ),
    Index('ix_trades_strategy_status', 'strategy', 'status'),
    Index('ix_trades_symbol_entry_time', 'symbol', 'entry_time'),
)
```
Same treatment for `trade_ledger.status`, `trades.side` (`long`/`short`), `options_snapshots.call_put` (`call`/`put`), `strategy_signals.signal_type` (`buy`/`sell`/`hold`/`close`).

---

### [P1] `ohlcv_bars` OHLCV values stored as Float on a time-series hypertable
**Table/Column:** `ohlcv_bars.open/high/low/close/vwap` (`Float`), `volume` (`Float`).
**Current:** `Float` = PG `DOUBLE PRECISION`.
**Should be:** `Numeric(12, 4)` for OHLC/vwap, `BigInteger` for volume (shares are whole, not fractional).
**Impact:** Same .xx5 drift as the P0 money issue, compounded over bar counts. Indicators that accumulate over 200 bars (SMAs, VWAP, etc.) drift materially from the backtest engine's Decimal-based computation. `volume` as `Float` is especially weird — shares are integer, and floating volume allows nonsense like `100.3 shares`.
**Fix:** Alter to `Numeric(12, 4)` + `BigInteger`; in the ingestion path (wherever `OHLCVBar` is inserted, though grep shows no direct `INSERT INTO ohlcv_bars` in the backend today — the hypertable appears to be write-via-Alembic-seed or external ETL), ensure the writer sends `Decimal`/`int`.

---

### [P1] Index drift — ORM has indexes that live DB likely doesn't
**Table/Column:** `ix_trades_symbol_entry_time`, `ix_trades_strategy_status`, `ix_agent_analysis_symbol_type`, `ix_options_underlying_expiry`, `ix_signal_strategy_symbol`, plus the `UniqueConstraint uq_ohlcv_symbol_timestamp` and `ix_ohlcv_symbol_timestamp`.
**Current:** Declared in `__table_args__` in `models.py`. Only `ix_ohlcv_symbol_timestamp` and `uq_ohlcv_symbol_timestamp` were present at `create_all` time for fresh DBs. The compound `ix_trades_symbol_entry_time` was added to the model in a recent change (comment line 120: "migration NOT generated in this wave"). Alembic baseline `0001_baseline.py` is empty and was intended to `stamp` existing DBs — so no pre-existing DB has been migrated to include these indexes.
**Should be:** Alembic migration `op.create_index(...)` for every index declared in the ORM after baseline. Going forward: every `Index(...)` added to `models.py` must be paired with an alembic revision.
**Impact:** `GET /trades/history?symbol=AAPL` is the documented hot path for `ix_trades_symbol_entry_time` and it's doing a sequential scan on live DBs that were stamped at baseline. Same for strategy-filtered queries (`ix_trades_strategy_status`).
**Fix:** Generate one migration per index with the `IF NOT EXISTS` equivalent:
```python
op.create_index('ix_trades_symbol_entry_time', 'trades',
    ['symbol', 'entry_time'], if_not_exists=True)
```

---

### [P1] `options_snapshots` strikes/bids/asks/greeks as Float
**Table/Column:** `options_snapshots.strike/bid/ask/last/iv/delta/gamma/theta/vega`.
**Current:** `Float`.
**Should be:** `Numeric(10, 4)` for strike/bid/ask/last (penny-quoted options allow strikes like 432.50 but also $.01 increments on wide-lister chains), `Numeric(8, 6)` for greeks (delta is 0.0–1.0, gamma is tiny), `Numeric(6, 4)` for IV.
**Impact:** Option P&L recomputed from stored greeks times underlying-move drifts from the broker's number by basis points. When reconciliation compares portfolio delta to Alpaca, off-by-a-penny spreads become an alert storm.
**Fix:** `op.alter_column(...)` per column; update the ingestion code at `data/ingestion/` to pass `Decimal`.

---

### [P1] `AgentAnalysis` table has no retention, no pagination, full-scan reads
**Table/Column:** `agent_analyses.timestamp`.
**Current:** `routes/analysis.py:700` — `select(AgentAnalysis).where(symbol=...).order_by(timestamp.desc()).limit(10)`. Index `ix_agent_analysis_symbol_type` is `(symbol, agent_type)`. The `.order_by(timestamp DESC).limit(10)` ignores that index and requires a sort step.
**Should be:** Either compound index `(symbol, timestamp DESC)` or `(symbol, agent_type, timestamp DESC)`, plus a retention policy (analyses older than 90 days are not useful — they're snapshots of momentary market state).
**Impact:** As `agent_analyses` grows (every symbol * every pipeline run * every agent), this ORDER BY timestamp DESC scans all rows for the symbol and then sorts. No cleanup — table grows unbounded.
**Fix:**
```python
Index('ix_agent_analysis_symbol_timestamp', 'symbol', 'timestamp')
# or: Index(..., symbol, timestamp.desc())
```
Plus a scheduled cleanup (`DELETE FROM agent_analyses WHERE timestamp < NOW() - INTERVAL '90 days'`) or a continuous-aggregate rollup of daily scores.

---

### [P1] JSON defaults are Python-side only; direct SQL inserts get NULL
**Table/Column:** `trades.legs` (`default=list`), `positions.greeks` (`default=dict`), `watchlists.symbols` (`default=list`), `screener_presets.filters` (`default=list`), `strategy_signals.signal_metadata` (`default=dict`).
**Current:** `default=list`/`default=dict` are **Python-level** defaults, applied by SQLAlchemy on INSERT. Not emitted as `DEFAULT '[]'::jsonb` at the column level.
**Should be:** Add `server_default=sa.text("'[]'::jsonb")` (or `'{}'::jsonb` for objects) so that direct SQL inserts (alembic seed scripts, `psql`, raw `INSERT` from `trade_ledger.py`-style code, Timescale continuous aggregates) get a valid JSON value instead of NULL.
**Impact:** `trade.legs[0]` in `routes/trades.py:621` assumes `legs` is a list. If a legacy row has NULL `legs` because it was inserted by something outside the ORM, that code does `None[0]` and 500s.
**Fix:**
```python
legs = Column(JSONB, nullable=False, default=list,
    server_default=sa.text("'[]'::jsonb"))
```
Then `nullable=False` can safely be set everywhere.

---

### [P1] Position vs open-trade quantities are floats without CHECK constraints
**Table/Column:** `positions.quantity` (`Float`), `trade_ledger.shares` (`INTEGER`).
**Current:** No `CHECK (quantity >= 0)` or `CHECK (shares != 0)`. `positions.quantity` can be any float including negatives (which might legitimately be short positions, but there's no encoded convention — see finding #7 on `side`).
**Should be:** `CheckConstraint('quantity >= 0', name='ck_positions_qty_nonneg')` for long-only accounts; or `CheckConstraint("(side='long' AND quantity > 0) OR (side='short' AND quantity < 0)")` for the dual-sign convention.
**Impact:** A bug that writes `quantity=-5` for a long position then passes through to `market_value` calc as negative. `entry_price <= 0` is another invariant worth enforcing.
**Fix:** Add CHECK constraints per column:
```python
CheckConstraint('entry_price IS NULL OR entry_price > 0', name='ck_trades_entry_price_positive')
CheckConstraint('pnl IS NULL OR pnl BETWEEN -1e9 AND 1e9', name='ck_trades_pnl_sane')
```

---

### [P2] No partial indexes on hot `status` / `acknowledged` filters
**Table/Column:** `trades.status='open'`, `alerts.acknowledged=false`, `options_snapshots` where `expiry >= NOW()`.
**Current:** Full indexes on the column with no predicate.
**Should be:** Partial indexes:
```python
Index('ix_trades_open_status', 'symbol',
    postgresql_where=text("status = 'open'"))
Index('ix_alerts_unacked', 'alert_type',
    postgresql_where=text('acknowledged = false'))
```
**Impact:** Small — partial indexes mostly help when the predicated-subset is <5% of the table. Open trades are probably <1% of the ledger over time, so a partial index on `(symbol) WHERE status='open'` is 100× smaller and faster to scan for the "is there an open position for X" check.
**Fix:** Low-priority but worth packaging with the main migration.

---

### [P2] Inconsistent `symbol` column lengths
**Table/Column:** `ohlcv_bars.symbol = String(20)`, `trades.symbol = String(20)`, `positions.symbol = String(20)`, `alerts.symbol = String(20)`, `strategy_signals.symbol = String(20)`, `agent_analyses.symbol = String(20)`, but `options_snapshots.symbol = String(40)` (for OCC option symbols like `AAPL240119C00150000`).
**Current:** Mixed.
**Should be:** Either unify (use `String(40)` everywhere and rely on the upper-bound check in `trades.OrderLeg.symbol` pydantic regex for application-level validation), or keep `String(20)` for equities and `String(40)` for options but document why. The regex in code (`^[A-Z][A-Z0-9.\-]{0,9}$`) only allows 10 chars; everything else (up to 20) is wasted for equities.
**Impact:** Cosmetic today. Relevant if you ever want to store OCC options symbols in `trades.symbol` (multi-leg combo orders already go into `trades.legs` JSON, so each leg's symbol is inside JSONB — but `trades.symbol` stores only the first leg's underlying).
**Fix:** Document the convention or unify at `String(40)`.

---

### [P2] `Alert.acknowledged` has no index; listing unacked alerts scans
**Table/Column:** `alerts.acknowledged` (`Boolean`, `default=False`).
**Current:** Not indexed.
**Should be:** Partial index `WHERE acknowledged = false` or `(alert_type, triggered_at DESC) WHERE acknowledged = false` if alert listings are type-grouped.
**Impact:** The Alerts table grows monotonically. The "unread alerts" badge / dropdown query has to scan all acknowledged rows to find the small unacknowledged tail.
**Fix:** Partial index as shown above.

---

## Additional notes (lower-priority / not in top 15)

- **`trade_ledger.list(filter=...)` builds raw SQL via f-string** for the `WHERE` clause (`trade_ledger.py:758, 761`). Column names are allowlist-validated (good), but the same pattern was called out in code-patterns-audit-r4 for a different call site — this one is still f-string, just with a validated allowlist. Low risk but worth knowing.
- **No `ForeignKey` anywhere in the codebase.** Not strictly a bug today (nothing needs cross-table integrity yet), but if/when a `users` table is added, every FK (user_id on trades, alerts, watchlists, screener_presets) will need its own index — Postgres does not auto-index FK columns. Plan for `Index('ix_trades_user_id', 'user_id')` alongside each FK addition.
- **No `UniqueConstraint` on `(symbol, strategy, status='open')` for `trades`**: theoretically you can have two open trades for the same symbol+strategy, which is how scale-in/scale-out works — but if the business rule is "one open position per symbol per strategy", enforce it with a partial unique index.
- **`Position.updated_at` has `onupdate=func.now()`** (Python-side). Consider adding a DB-level trigger or at least `server_default=func.now()` is present — good. But `onupdate` is Python-only; direct SQL UPDATEs (e.g. from ingestion) won't bump it.
- **Hypertable creation is silently swallowed** (`core/database.py:113` — `except Exception`) so on a non-Timescale Postgres the app continues without hypertables. That's fine for dev, but a production health-check that verifies Timescale is installed + `ohlcv_bars` is a hypertable would catch misconfigured deploys.
- **No continuous aggregates for `ohlcv_bars` 1-minute → 5m/1h/1d rollups.** Every read at a non-raw timeframe currently hits the external Alpaca/Polygon API rather than the local hypertable (grepping `INSERT INTO ohlcv_bars` returns nothing — the hypertable may be unused in production today). If ingestion is intended: add continuous aggregates `ohlcv_5m`, `ohlcv_1h`, `ohlcv_1d` materialized from the 1m chunks, with `refresh_continuous_aggregate` policies.
