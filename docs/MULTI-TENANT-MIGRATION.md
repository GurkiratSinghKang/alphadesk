# Multi-Tenant Schema Migration — Planning Doc

> **Status:** DRAFT — not scheduled. Triggered by Round-21 / persona-A
> finding that `trades`, `positions`, `alerts`, `watchlist`,
> `screener_presets`, `strategy_signals` all lack a user/owner column.
> The application is single-tenant today; this doc is the runway for
> growing into multi-tenant without a lossy table rewrite.
>
> **Owner:** unassigned. **Target window:** TBD — requires a planned
> maintenance window with the broker disconnected.

## What's broken today

`audit_log.username` is the only user-attribution column anywhere in
the schema. Six tables (`Trade`, `Position`, `Watchlist`,
`ScreenerPreset`, `StrategySignal`, `Alert`) hold per-user state
without recording who owns the row. The application papers over this
by encoding the user into `Trade.client_order_id` (e.g.
`manual_<user>_<hex>`) and parsing it back on the cancel path
(`trades.py:_enforce_cancel_ownership`). Every other query reads
without a `WHERE user_id = ...` clause:

| Table              | How rows are filtered today        | Multi-tenant risk      |
|--------------------|------------------------------------|------------------------|
| `trades`           | client_order_id slug parse         | broken on legacy rows  |
| `positions`        | unique(symbol) — only ONE allowed  | conflicts immediately  |
| `watchlist`        | unique(symbol) — same as positions | conflicts immediately  |
| `screener_presets` | global list                        | every user sees every preset |
| `strategy_signals` | no filter                          | leaks signals across tenants |
| `alerts`           | no filter                          | leaks alerts across tenants  |

The `delete_account` path at `user.py:583` does
`db.execute(delete(Trade))` — **wipes every row, not just the calling
user's**. Acceptable today only because there's exactly one user; the
moment a second one onboards, the first "delete account" nukes both.

## Migration plan

### Phase 1 — schema (no behaviour change)

One alembic revision per table, all in the same chain. Each adds a
`user_id` column as `NULLABLE` first so the deploy doesn't need a
table-rewrite lock:

```python
# 0011_add_user_id_to_trades.py
def upgrade() -> None:
    op.add_column(
        "trades",
        sa.Column("user_id", sa.String(64), nullable=True),
    )
    op.create_index(
        "ix_trades_user_id_status_created",
        "trades",
        ["user_id", "status", "entry_time"],
    )
```

Repeat for: `positions`, `watchlist`, `screener_presets`,
`strategy_signals`, `alerts`. Drop the `unique(symbol)` constraints
on `positions` and `watchlist` (they become `unique(user_id, symbol)`
in Phase 2).

**Tested separately on staging.** Each migration must run cleanly
with the prior code shipped — the column will read NULL on every
existing row.

### Phase 2 — backfill

Single backfill script `backend/scripts/backfill_user_id.py`:

1. For `trades`: parse `client_order_id` for the `manual_<user>_*` /
   `<user>_<idem>` prefix. Update `Trade.user_id = <parsed>` for
   every row where parse succeeds. Log unparseable rows; they stay
   NULL.
2. For `positions`, `watchlist`: every existing row → `user_id = ADMIN_USERNAME`
   (the single tenant today).
3. For `screener_presets`, `strategy_signals`, `alerts`: same — set to
   `ADMIN_USERNAME`.

The script is idempotent (only updates `WHERE user_id IS NULL`). Run
once, verify the row count matches expected, run again as a no-op
sanity check.

### Phase 3 — make NOT NULL

```python
# 0012_user_id_not_null.py
def upgrade() -> None:
    # Pre-check: refuse to run if any rows still NULL.
    bind = op.get_bind()
    for table in ("trades", "positions", "watchlist",
                  "screener_presets", "strategy_signals", "alerts"):
        n = bind.execute(
            sa.text(f"SELECT COUNT(*) FROM {table} WHERE user_id IS NULL")
        ).scalar()
        if n:
            raise RuntimeError(
                f"{table} has {n} rows with NULL user_id — run backfill first"
            )
    op.alter_column("trades", "user_id", nullable=False)
    # ... same for the other 5 tables
    op.create_unique_constraint("uq_positions_user_symbol", "positions",
                                ["user_id", "symbol"])
    op.create_unique_constraint("uq_watchlist_user_symbol", "watchlist",
                                ["user_id", "symbol"])
    op.drop_constraint("positions_symbol_key", "positions", type_="unique")
    op.drop_constraint("watchlist_symbol_key", "watchlist", type_="unique")
```

### Phase 4 — code changes

Each handler now reads + writes scoped to the calling user.
Estimated touch surface (grep counts):

- `backend/api/routes/trades.py` — ~25 query sites
- `backend/api/routes/portfolio.py` — ~10 query sites
- `backend/api/routes/screener.py` — ~5 query sites
- `backend/api/routes/strategies.py` — ~3 query sites (signals)
- `backend/api/routes/user.py` — ~6 query sites in delete_account /
  data_export
- `backend/data/ingestion/fill_reconciler.py` — ~4 sites
- `backend/data/ingestion/trade_ledger.py` — ~3 sites

The `delete_account` path moves from `delete(Trade)` to
`delete(Trade).where(Trade.user_id == username)` — same for every
table. This is the highest-impact correctness fix in the whole
migration.

### Phase 5 — drop the legacy parser

Remove `_enforce_cancel_ownership`'s `client_order_id` parsing once
every cancel path resolves ownership via `WHERE user_id =` instead.

## Risk analysis

| Risk | Mitigation |
|------|------------|
| Phase 1 column-add locks the table | Use `NOT NULL DEFAULT` only in Phase 3 after backfill — Phase 1 keeps it nullable to avoid the rewrite. |
| Backfill misses rows due to malformed `client_order_id` | Log each parse failure; the rows stay nullable until Phase 3 errors loudly with the count. Triage manually before flipping. |
| Phase 4 introduces query bugs (forgot `WHERE user_id =`) | Add a SQLAlchemy event listener that warns when a `Trade` query has no `user_id` filter — log-only at first, raise in tests. |
| Position uniqueness change breaks open positions on the same symbol across users | None today (single tenant); future tenants must re-establish positions in their own scope. |
| Test fixtures reference `user_id`-free schema | Update fixtures in same alembic migration; full test suite must pass before Phase 1 lands. |

## Maintenance window estimate

- Phase 1 (additive schema): 30 seconds, zero downtime.
- Phase 2 (backfill): 1-5 minutes depending on row count.
- Phase 3 (NOT NULL + unique constraints): 30 seconds, brief lock.
- Phase 4 (code): blue-green deploy, no DB downtime.
- Phase 5 (cleanup): zero downtime.

Total user-visible disruption: ~30 seconds during Phase 3 alembic
upgrade. Recommend running during a market-closed weekend with the
broker WebSocket disconnected so no fill events arrive mid-migration.

## When to ship

This migration unlocks:
- Real per-user data isolation (currently theoretical — single user)
- Compliant `delete_account` (currently nukes the entire DB)
- Broker-side per-user position tracking
- Multi-user trial / beta cohorts

Until at least one of those is on the roadmap, the migration adds
schema complexity without changing behaviour. Defer until
multi-tenancy is a committed product requirement.
