# Strategy Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a `/strategy/[id]` page showing full performance, trades, thesis, and analytics for each strategy.

**Architecture:** New Next.js page under `(dashboard)` route group. New backend analytics endpoint. Reuse existing `lightweight-charts` and `TradingChart` patterns. Dashboard cards updated to link here.

**Tech Stack:** Next.js 16, lightweight-charts, FastAPI, trade ledger JSON

---

### Task 1: Backend — Add strategy analytics endpoint

**Files:**
- Modify: `backend/api/routes/strategies.py`

Add `GET /strategies/{id}/analytics` endpoint that computes sector exposure, correlations, streaks, conviction distribution, hold time stats, and monthly returns from trade ledger data.

### Task 2: Frontend — Add API client functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

Add `getStrategyPerformance()`, `getStrategyTrades()`, `toggleStrategy()`, `getStrategyAnalytics()`.

### Task 3: Frontend — Create strategy detail page

**Files:**
- Create: `frontend/src/app/(dashboard)/strategies/[id]/page.tsx`

The main page with hero performance section, trade history table with expandable rows, and 5 tabs (About, Positions, Sector Exposure, Correlation, Analytics).

### Task 4: Frontend — Strategy thesis content

**Files:**
- Create: `frontend/src/lib/strategy-content.ts`

Static content for each strategy's About tab: thesis, edge, parameters, risk profile.

### Task 5: Frontend — Update dashboard card navigation

**Files:**
- Modify: `frontend/src/app/(dashboard)/page.tsx`

Change strategy card `onClick` from `router.push("/trade")` to `router.push(`/strategies/${strategy.id}`)`.

### Task 6: Deploy and verify

Sync all changes, rebuild, deploy, take QA screenshots.
