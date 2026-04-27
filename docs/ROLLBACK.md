# AlphaDesk Rollback Playbook

One-page, 2-AM-ready instructions for rolling back a bad deploy.

## When to roll back

- `/readyz` returns 503 and the previous deploy was green.
- `/api/*` error rate spiked immediately after deploy.
- A strategy started firing obviously-wrong orders (paper-account-only,
  then halt — see RUNBOOK.md first).

Do NOT roll back for: a single 5xx burst, a transient provider outage
(Alpaca/Polygon), or a frontend-only visual glitch. Fix forward instead.

## Pre-requisite: find the prior SHA

You need the git SHA of the image you want to roll back TO (the last
good one).

Options, easiest first:

1. **GitHub Actions UI**: Actions → Deploy AlphaDesk → pick the last
   run that finished green → copy the commit SHA from the run header.
2. **git log**:
   ```
   git log --oneline --first-parent main -n 10
   ```
   Pick the commit before the one that was just deployed.
3. **GHCR tags**: every deploy pushes `:<sha>` alongside `:latest`. Old
   tags are never deleted — if you know the SHA you can always pull it.

## Roll back via GitHub CLI

```
gh workflow run deploy.yml -f image_sha=<prior_sha>
```

The workflow accepts an optional `image_sha` input (see
`.github/workflows/deploy.yml`). When set, the VPS pulls
`ghcr.io/<owner>/alphadesk-frontend:<sha>` and
`ghcr.io/<owner>/alphadesk-backend:<sha>` and recreates the containers
with those exact image hashes.

## Roll back via GitHub Actions UI

1. **Actions** tab → **Deploy AlphaDesk** → **Run workflow**.
2. Enter the prior SHA in the `image_sha` input.
3. Click **Run workflow**.

## What the rollback does NOT do

- **It does NOT downgrade the database schema.** `alembic upgrade head`
  is idempotent and runs on every deploy, but `alembic` does not
  downgrade automatically. If the bad deploy included a schema migration
  that is incompatible with the prior image, you must also run:
  ```
  ssh -i ~/.ssh/alphadesk root@178.156.145.213
  cd /opt/alphadesk
  docker compose exec -T backend alembic downgrade <prior_alembic_revision>
  ```
  Get `<prior_alembic_revision>` from `alembic history` or
  `backend/alembic/versions/`.
- **It does NOT roll back secrets.** `.env.prod` changes are not in
  git. If a rollback requires restoring an old secret, you own that
  manually.
- **It does NOT purge Redis.** Bracket-outbox and idempotency keys
  persist. Usually what you want; rarely problematic.

## Verifying the rollback

After the workflow goes green:

```
curl -sf https://tradingalpha.net/readyz
```

Expected: `200 {"db":"ok","redis":"ok","status":"ok"}`.

If `/readyz` still returns 503, SSH to the VPS and pull backend logs:

```
ssh -i ~/.ssh/alphadesk root@178.156.145.213
cd /opt/alphadesk
docker compose logs backend --tail 200
```

## If nothing works: halt trading, escalate

If rollback fails or the platform is still unhealthy after rollback, the
highest priority is **stop opening new positions**. See the halt section
in RUNBOOK.md.
