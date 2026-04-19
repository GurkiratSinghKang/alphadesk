# Persona 45 — Release Manager: Deploy Pipeline Audit

**Scope:** `.github/workflows/deploy.yml`, `docker-compose.yml`, `infrastructure/docker-compose.prod.yml`, `backend/alembic/*`, `backend/Dockerfile`, `backend/core/database.py`, `backend/main.py`, `infrastructure/backup.sh`.

**Production URL:** tradingalpha.net (single Hetzner VPS @ 87.99.143.65)
**Branch model:** push to `main` triggers auto-deploy. `workflow_dispatch` allowed.

---

## Top 10 Findings (ordered by release-risk severity)

### F1 — [P0] No rollback path; `:latest` and `:sha` are the only tags
`.github/workflows/deploy.yml:51-62` pushes two tags per image: `ghcr.io/.../{service}:<sha>` and `:latest`. There is no `previous`, `stable`, or version tag. The deploy script (`deploy.yml:101`) does `docker compose pull frontend backend` — compose resolves whatever tag is in the env var set by the workflow (`FRONTEND_IMAGE`, `BACKEND_IMAGE`), which is always the *new* SHA. **Rollback requires a human to SSH in, edit `.env.prod` (or the compose env), set `FRONTEND_IMAGE`/`BACKEND_IMAGE` to a prior SHA, and `docker compose up -d`.** There is no `rollback.yml` workflow, no `gh workflow run` path, no saved "last known good" reference. If the previous SHA isn't remembered, ops has to scrape `ghcr.io` tag list.

### F2 — [P0] No blue-green or canary; `--force-recreate` is a hard cutover
`deploy.yml:105` runs `docker compose up -d --remove-orphans --force-recreate`. This tears down the running backend/frontend containers and starts the new image in place. There is a ~5–15s window where the site returns 502 (Caddy upstream down) before the new container passes its 15s `start_period`. No parallel stack, no traffic shift, no weighted routing. `--remove-orphans` will also delete any service that got removed from the compose file on this deploy — already used once to kill `uptime-kuma` (infrastructure/docker-compose.prod.yml:148-151), which means an accidental compose-file edit can delete a live service.

### F3 — [P0] Cannot deploy arbitrary commit / no manual SHA input
`workflow_dispatch:` is declared (`deploy.yml:6`) but takes **no inputs**. Re-running it checks out `main` at whatever `HEAD` is — there's no `ref:` input, no `sha:` input. To deploy a specific commit, release manager must: (a) revert `main` to that commit, (b) force-push (destructive and disallowed on protected branches), or (c) manually SSH, `docker pull ghcr.io/...:<sha>`, edit env, `compose up`. `actions/checkout@v4` defaults to the ref that triggered the run, so workflow_dispatch from a non-main branch would deploy that branch's code — **a security footgun**, as feature-branch code could reach prod.

### F4 — [P0] Alembic migrations are manual and out-of-band from deploy
`backend/alembic/README.md:42-44` is explicit: *"This is currently a manual step. We deliberately do NOT run it from the container entrypoint."* The Dockerfile `CMD` (`backend/Dockerfile:36`) launches gunicorn directly; no `alembic upgrade head` precedes it. Meanwhile `backend/main.py:45` still calls `init_db()` which runs `Base.metadata.create_all` (`core/database.py:98`) on every startup. **Effect:** model changes that don't require raw DDL "just work" via `create_all` (appending new tables/columns if the model declares them), but anything Alembic-only (data migrations, drops, renames, type changes, constraint changes) will silently *not* apply on deploy and the app will start against a stale schema. A release manager has no signal that a deploy carried an unapplied migration.

### F5 — [P0] No pre-deploy backup; `docker system prune` runs on every deploy
`deploy.yml:109` runs `docker system prune -f --filter "until=24h"` *after* a successful health check. `infrastructure/backup.sh` exists as a systemd timer (nightly) but is **not invoked by the workflow** before mutation. Combined with F4, this means: deploy → `create_all` possibly mutates schema → if anything is wrong, the nightly backup might be up to 24h stale, and recently-pruned images (>24h old) may be unavailable for image-level rollback.

### F6 — [P1] Pre-deploy testing covers frontend only; no backend tests in CI
`deploy.yml:9-23` defines a single `test` job: `cd frontend && npm run test -- --run` (vitest). The `backend/` has **no `tests/` directory** and no pytest / mypy / ruff step in CI. The `build-and-deploy` job does `needs: [test]` but that gate only checks the vitest run — the backend image is built and pushed even if backend code is syntactically broken (caught only at gunicorn startup, post-deploy). No lint, no type-check, no security scan (trivy/grype), no SBOM, no image signing.

### F7 — [P1] Health check is a single curl 15 seconds in, no soak
`deploy.yml:106-107`: `sleep 15 && curl -sf http://localhost:8000/health`. One request, one endpoint, no retries, no soak period, no verification of frontend (port 3000), no Caddy/TLS verification (443). Backend `start_period: 15s` (`docker-compose.prod.yml:77`) — the compose healthcheck itself allows 3 retries × 10s timeout, but the workflow doesn't wait for `docker compose ps --status healthy`; it makes its own single-shot request. A transient 500 at second 15 fails the deploy; a regression that shows up at second 60 will not.

### F8 — [P1] No auto-rollback on failed health check
`deploy.yml:107` uses `curl -sf ... || (echo "Health check failed!" && exit 1)`. The job exits non-zero but the containers have already been `--force-recreate`d onto the new image. **There is no `docker compose up -d` with the previous image on failure, no `docker rollback`, no compensating action.** Prod stays on the broken image; the site is down until a human intervenes.

### F9 — [P2] `0002_add_side.py` downgrade is destructive; baseline is not
`backend/alembic/versions/0002_add_side.py:60-63` implements `downgrade()` that `drop_column`s `side` on both `trades` and `trade_ledger` — real data loss if run in prod. Meanwhile `0001_baseline.py:46-49` explicitly has no downgrade. The rollback story for schema is: **restore from backup** — there is no safe `alembic downgrade -1` path that matches the deploy rollback. Release manager must treat any migration deploy as one-way.

### F10 — [P2] GHCR login uses `secrets.GITHUB_TOKEN` on VPS; secret shipped over SSH env
`deploy.yml:81,89,95` passes `GHCR_TOKEN` via `ssh-action`'s `envs:` list. The token is ephemeral (per-job) so blast radius is bounded, but: (a) it's the only way the VPS can pull, so if the workflow job expires before pull completes on a slow VPS, pull fails; (b) `docker logout ghcr.io` runs at `deploy.yml:110` only on the success path (after `set -e`, any earlier failure leaves creds cached in `/home/deploy/.docker/config.json`); (c) secrets are written into the remote shell environment — any process on the VPS with read access to `/proc/<pid>/environ` during the deploy window can scrape them.

---

## 250-Word Summary

AlphaDesk's deploy pipeline is a **single-stage, SSH-driven replace-in-place** triggered on push to `main`. It builds Docker images, pushes to GHCR tagged with the commit SHA and `:latest`, scps the compose config to a Hetzner VPS, and runs `docker compose up -d --force-recreate`, followed by a single curl against `/health`. It works for happy-path shipping but has significant release-management gaps.

**Rollback** is entirely manual: no `rollback.yml`, no stored "last-known-good" tag beyond whatever `ghcr.io` happens to retain, and no auto-revert on healthcheck failure. The operator must SSH to the VPS, identify the prior SHA, edit env vars, and recreate containers.

**Deploying a specific commit** is not supported cleanly — `workflow_dispatch` declares no inputs, so it only redeploys `HEAD` of whatever branch triggered the run. Running it from a feature branch would push that code to prod (no ref-restriction).

**Blue-green / canary** does not exist. Deploys are hard cutovers with a 5–15s user-visible gap.

**Pre-deploy testing** is frontend-only (vitest). The backend has no `tests/` dir, no lint, no type check, no security scan. Image gating is weak.

**DB migration risk is the biggest hazard.** Alembic exists but is manual ("we deliberately do NOT run it from entrypoint"), while `init_db()` still runs `create_all` on every startup. Anything requiring real migrations (renames, drops, data moves) will silently skip; `0002_add_side`'s downgrade is destructive; the only safe rollback for schema is restore-from-backup, and no backup runs pre-deploy.

**Priority fixes:** add `workflow_dispatch` ref input, wire migrations into deploy as a one-shot container, add auto-rollback on healthcheck failure, add a pre-deploy backup step, and tag a `:previous` image on every successful deploy for one-command revert.
