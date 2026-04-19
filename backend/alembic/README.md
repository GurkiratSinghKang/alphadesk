# Alembic Migrations

Alembic owns the AlphaDesk Postgres schema going forward. This folder is the
authoritative record of every schema change; the ORM models in
`backend/data/storage/models.py` describe the target, and the migrations here
describe how we get there from whatever state a given database is currently
in.

## How to run

### Production (first time only — one-off)

The live production DB was created via `Base.metadata.create_all` before
Alembic was wired up, so Alembic needs to be told "this database is already
at baseline" before it tries to apply the first migration:

```
docker exec alphadesk-backend alembic stamp 0001_baseline
docker exec alphadesk-backend alembic upgrade head
```

The `stamp` writes the baseline revision into `alembic_version` without
running the (empty) baseline migration. `upgrade head` then applies every
subsequent revision in order.

If production already has the `side` column on `trades` / `trade_ledger`
because the `ADD COLUMN IF NOT EXISTS` idempotent DDL already applied, skip
`0002_add_side` by stamping straight to head instead of running upgrade:

```
docker exec alphadesk-backend alembic stamp 0002_add_side
```

### Production (ongoing)

Every subsequent deploy just needs:

```
docker exec alphadesk-backend alembic upgrade head
```

This is currently a manual step. We deliberately do NOT run it from the
container entrypoint — rolling deploys would race two containers against the
same migration. See "Follow-ups" below.

### Developer (local)

From the `backend/` directory with a `DATABASE_URL` set (via `.env` or env
var):

```
cd backend
alembic upgrade head
```

### Generate a new migration

```
cd backend
alembic revision --autogenerate -m "short description"
```

Review the generated file in `alembic/versions/` before committing —
`--autogenerate` is a starting point, not the final word.

## Follow-ups

- Wire `alembic upgrade head` into a deploy pre-step (one-shot container,
  CI job, or Kubernetes Job) so migrations can't race with a rolling restart
  of the application containers. Keeping this manual for now.
