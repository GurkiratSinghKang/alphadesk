# Audit Loop State (auto-managed across Ralph iterations)

**Last updated:** 2026-05-05T14:13Z (iteration 6 of Ralph loop)

## Status: Phase 1 — Findings collection (5 agents running)

### Currently running

**Harness:** PID 79388 (auth, /tmp/harness-run-2026-05-05-auth.log) — on settings spec, ~3-4 specs left, ETA ~3 min
**Run output:** `qa/runs/2026-05-05T14-04-37Z/`

**Agents (general-purpose subagent_type, have Write access):**
- `aee664f938ccb0bdd` — Backend security/perf — writes `.audit/2026-05-05/backend-findings.md`
- `a1d3a75e083a1a845` — Frontend perf — writes `.audit/2026-05-05/frontend-perf-findings.md`
- `a17991eb86b267fff` — Realtime/async — writes `.audit/2026-05-05/realtime-async-findings.md`
- `a5236f14fc60bdcba` — Persona workflows (5 personas) — writes `.audit/2026-05-05/persona-workflow-findings.md`
- `ab338790b5fa9661b` — Deep a11y — writes `.audit/2026-05-05/a11y-deep-findings.md`

### Lessons from prior iterations

- **iter 1-5**: Initially used `feature-dev:code-reviewer` agent type — BUG: that agent type has Read/WebFetch/WebSearch/TodoWrite/TaskStop only, NO Write tool. Agents did the analysis but couldn't deliver. Killed at iter 6 and re-launched with `general-purpose` (has all tools).
- **harness duplicates**: Each loop iteration may re-launch a harness. Verify no duplicates and kill extras with `pkill -f "node qa/harness"`.

### What NOT to do in next iteration

- Don't re-spawn agents listed above (check if findings files exist first)
- Don't re-run harness if `qa/runs/2026-05-05T14-04-37Z/manifest.json` exists and is current
- Don't touch the 41 files listed in /tmp/r6-locked-files.txt (R6 worktree work in flight)

## Phase 2 — Consolidation (next, after agents complete)

When ALL 5 findings files exist at `.audit/2026-05-05/<name>-findings.md`:
1. Read each, dedupe against R5 BLOCKERs (R5-B1 through R5-B7) and R6 plan items
2. Consolidate NEW findings into REPORT.md ranked by severity
3. Build P0/P1 fix queue with file:line + suggested fix + R6-conflict check

## Phase 3 — Fix dispatch (after Phase 2)

For each P0/P1 in fix queue:
- Verify file is NOT in /tmp/r6-locked-files.txt
- Spawn `general-purpose` agent with surgical fix prompt + verification gates
- Limit to 5-8 parallel fix agents max
- Each fix lands as atomic commit on `feature/deployment` (or per-fix branch if user prefers PRs)

## Phase 4 — Verification (after fixes)

- Re-run harness (or rely on next manual sweep)
- Re-read affected DOMs to confirm fix landed at rendered level (R5 standard — source-grep is not enough)
- Update REPORT.md with fix evidence
- Mark loop complete or queue further iteration

---

## Locked files (DO NOT TOUCH — R6 worktree work)

See /tmp/r6-locked-files.txt for full list (41 files). Highlights:
- frontend/eslint.config.mjs
- frontend/src/app/(dashboard)/{analytics,pipeline,reports,strategies,trade}/page.tsx
- frontend/src/app/(dashboard)/strategies/earnings-options-play/**
- frontend/src/components/charts/ChartPane.tsx
- frontend/src/components/composites/OrderBar.tsx
- frontend/src/components/dashboard/*.tsx
- frontend/src/components/layout/NotificationCenter.tsx
- frontend/src/components/panels/{StrategyBuilder,StrategyTemplates,TradePanel,WatchlistPanel}.tsx
- frontend/src/components/strategies/StrategyDisclosure.tsx
- frontend/src/lib/strategies.ts
- frontend/src/lib/strategy-content.ts
- frontend/src/styles/design-tokens.css
- frontend/src/app/{layout,login}.tsx and friends

R6 worktree branches (all locked):
- qa/r4-1-copy-polish, qa/r4-2-color-decomposition, qa/r4-3-typography-polish, qa/r4-4-spacing-primitives, qa/r4-5-experience-polish
- qa/r6-1-typography-wiring, qa/r6-2-color-decomposition-2, qa/r6-3-static-article-rhythm (MERGED PR #43), qa/r6-4-chrome-consolidation, qa/r6-5-multi-leg-occ-safety, qa/r6-6-sector-rotation-stage, qa/r6-9-typography-polish
