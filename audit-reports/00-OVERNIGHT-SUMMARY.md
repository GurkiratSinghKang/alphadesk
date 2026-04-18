# AlphaDesk Overnight Sweep — Summary

**Date:** 2026-04-18
**Branch:** `feature/deployment` (all commits landed)
**Live at:** https://tradingalpha.net

## Four iterations

| Iteration | Goal | Outcome |
|---|---|---|
| 1 | Parallel audits (frontend, backend, pipeline, networking, infra) | ~44 open P0/P1 surfaced |
| 2 | Five parallel fix waves (A: alpha-engine · B: security · C: data · D: frontend · E: infra) | 17/21 claims verified live; 2 regressions |
| 3 | Re-audit every iter-2 claim + hunt regressions | Found psycopg2 missing + _OOS_DIR defense gap |
| 4 | Surgical close-out of iter-3 regressions + residue | All 4 fixes verified live |

## What's materially different on prod

### Security
- Postgres `5432`, Redis `6379`, backend `8000`, frontend `3000` now bind **127.0.0.1 only**. External probes time out. Caddy remains public on 80/443 as intended.
- Login rate-limit lowered 15→5/window, **fails closed** on Redis outage.
- Redis revocation check **fails open** with 60s cache (JWT signature stays primary auth).
- CSP removed `unsafe-eval`.
- `JWT_SECRET` now hard-fails if empty (no dev-fallback).
- `.env.prod` chmod 600.
- Ships `infrastructure/ssh-harden.sh` (user to run).

### Alpha engine
- Registry loads all **13 strategies** in-container (was 0 before fix).
- `ALL_STRATEGIES` resolves to **12 live adapters** (filters out smoke).
- OOS JSONs bundled in the backend image; API now returns **real Phase 1 Sharpe ratios**:
  - momentum-quality 2.21 · rsi2-reversal 1.88 · pead 1.32 · (12 total)
- Master Agent momentum gate **category-aware** — options/pairs/intraday/mean-reversion strategies no longer rejected for trading against momentum.
- Pipeline `only_strategies` `NameError` fixed.
- Anthropic key flagged as OAuth-not-API-key (user action required).

### Data integrity
- Trade ledger **migrated from JSON-file-with-threading-Lock to Postgres**. 8 historical entries preserved. Migration idempotent; falls back to in-memory if DB unreachable.
- `sync_with_alpaca` removed from 4 GET handlers (was corrupting ledger on every page load when Alpaca returned empty).
- Alpaca sync moved to background scheduler loop (5-min interval during RTH) with empty-response guard.
- Backups: `backup.systemd.timer` enabled. Next run: 2026-04-19 08:02 UTC. Dry-run verified.

### Frontend
- **Fonts actually load now.** Next.js `next/font/google` self-hosts Inter Tight + Newsreader (italic+normal, opsz axis) + JetBrains Mono. CSP `style-src` no longer the bottleneck.
- `--panel` / `--surface` aliases unblock 174 references across 43 files.
- 404 page editorial ("Not on the tape.").
- TradingChart reads design-tokens for all colors (candles, volume, BB bands, crosshair, grid) — no more hardcoded SaaS green/red.
- `apiFetch` 15s AbortSignal timeout.
- Docs list the real 12 strategies.
- Login hero: "Twelve strategies" not "Six".
- Login UX: password show/hide toggle, caps-lock warning, 5-failures-in-10-min lockout via localStorage.
- `/login/reset`, `/request-access` replace mailto links.
- Marketing shell mobile padding fixed; duplicate `/risk` footer link removed.
- `robots: { index: false }` on auth pages.
- `/_design` gated to dev-only.
- Pipeline page stops fabricating "stock-0" rows.

### CI / infra
- GitHub Actions Deploy now: rsyncs config + infra BEFORE image pull, force-recreates, removes orphans. Config-only changes (port bindings, env overrides) apply without manual intervention.
- `VPS_HOST` + `VPS_SSH_KEY` secrets set.
- CI logs into GHCR with ephemeral `GITHUB_TOKEN` — private images work.
- Postgres tuning: shared_buffers 512MB → 128MB, work_mem 16MB → 4MB.
- Uptime Kuma removed (was idle with 0 monitors).
- Journal vacuumed 22MB.
- 408 backend tests green. 723 frontend tests green. 21 tsc errors (all pre-existing in `__tests__/`).

## Commits on `feature/deployment` this sweep

```
5414735  fix(iter-4): psycopg2, OOS path defense, TradingChart BB tokens
f6b90fd  fix(ci): sync compose+infra config before deploy, force-recreate, remove-orphans
4de7549  fix(iter-2): 5-wave overnight bug sweep — alpha engine, security, data, frontend, infra
751c8c6  fix(frontend/proxy): allow /login/reset and /request-access without auth
1480067  feat(frontend+ci): kill 9 audit P0s + enable CI auto-deploy
```

---

## What still needs the human — manual VPS actions

From `audit-reports/iter-4-user-actions.md` (consolidated):

### 1. Rotate the Anthropic API key (P0 — blocks Claude analysis)
The current `ANTHROPIC_API_KEY` is an OAuth session token → every call 401s.
```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65
sed -i 's/^ANTHROPIC_API_KEY=.*/ANTHROPIC_API_KEY=sk-ant-…/' /opt/alphadesk/.env.prod
docker restart alphadesk-backend
```
Get a real key at https://console.anthropic.com.

### 2. Clear pipeline scheduler state (P0 — today's window)
The scheduler may have cached "already ran" from before iter-2's NameError fix. Clear it so the next window actually runs:
```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65 \
  'docker exec alphadesk-redis redis-cli -a "$(grep ^REDIS_PASSWORD /opt/alphadesk/.env.prod|cut -d= -f2-)" DEL pipeline:scheduler_state'
```

### 3. Disable SSH password auth (P1 — 30k failed-login attempts logged)
```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65
bash /opt/alphadesk/infrastructure/ssh-harden.sh
# Keep THIS session open, try a fresh login from another terminal, confirm it works, THEN close this session.
```

### 4. Apply security updates + reboot (P1 — 3 pending security patches, pending kernel 6.8.0-90 → 6.8.0-107)
```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65
apt update && apt upgrade -y
reboot       # ~2 minutes downtime
```

### 5. Add CAA DNS records (P2)
At your registrar (or Cloudflare DNS):
```
tradingalpha.net.   3600  IN  CAA  0 issue "letsencrypt.org"
tradingalpha.net.   3600  IN  CAA  0 iodef "mailto:security@tradingalpha.net"
```

### 6. (Optional) Deeper docker image cleanup (11GB reclaimable)
```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65 \
  "docker image prune -a --filter 'until=7d' --filter 'label!=keep'"
```
Interactive — confirm the running container's image tag isn't in the list.

---

## Scorecard

- **Start of sweep:** ~44 open P0/P1 bugs (from iter-1 audits).
- **End of sweep:** 5 open, all human-actionable (items 1–5 above).
- **Commits:** 5 (each verified via CI + live probe).
- **Downtime during sweep:** minor — 30s recreate pauses on timescaledb/redis; user-facing routes remained 200 throughout.
- **New tests added:** 9 (6 backend + 3 DashboardPageLayout).
