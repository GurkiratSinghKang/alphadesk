/**
 * MOCK_AGENTS — fixture data for the v2 agent system.
 *
 * Used by `useAgents()` hook in Phase 0; swapped for the real
 * `/api/v1/agents/list` endpoint when backend B.2 lands.
 *
 * Archetypes are the frozen taxonomy from v2-plan locked decision #4
 * (Research / Signal / Risk / Exec). Names are intentionally banal —
 * v2-plan rejected named characters in favor of archetype-attributed
 * voice ("Research thinks the regime is fragile" rather than "Atlas
 * thinks…"). Names here exist only to disambiguate multiple agents
 * of the same archetype in the UI.
 */

import type { Agent } from "@/lib/types/agents";

const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const MOCK_AGENTS: Agent[] = [
  {
    id: "research-regime",
    archetype: "research",
    name: "Regime",
    status: "running",
    lastOutput:
      "Macro regime tilted **fragile**: VIX 18.6 (+12% w/w), credit spreads widening 8bps. Slowing ISM + sticky core PCE = late-cycle posture; favor quality + momentum over deep value.",
    ownerStrategy: "momentum-quality",
    costToday: 4.82,
    runs24h: 18,
    model: "claude-opus-4-7-1m",
    lastRun: ago(8 * 60 * 1000),
    health: "ok",
  },
  {
    id: "research-earnings",
    archetype: "research",
    name: "Earnings",
    status: "queued",
    lastOutput:
      "NVDA tonight: street EPS 0.92, IV crush expected ~32% post-print. Setup leans bullish above 145.20; reject below.",
    ownerStrategy: "earnings-options-play",
    costToday: 2.31,
    runs24h: 9,
    model: "claude-opus-4-7-1m",
    lastRun: ago(45 * 60 * 1000),
    health: "ok",
  },
  {
    id: "signal-trend",
    archetype: "signal",
    name: "Trend",
    status: "running",
    lastOutput:
      "Trend score 0.72 (long bias). 14 of 22 names breaking 50d EMA on rising volume; sector tilt towards info-tech + industrials.",
    ownerStrategy: "momentum-quality",
    costToday: 1.18,
    runs24h: 96,
    model: "claude-haiku-4-5-20251001",
    lastRun: ago(2 * 60 * 1000),
    health: "ok",
  },
  {
    id: "signal-pead",
    archetype: "signal",
    name: "PEAD",
    status: "idle",
    lastOutput:
      "Post-earnings drift watchlist refreshed: 7 candidates surfaced (CRM, ADBE, MELI, ZS, NOW, SHOP, MDB). Median +2.1σ surprise.",
    ownerStrategy: "pead",
    costToday: 0.94,
    runs24h: 24,
    model: "claude-haiku-4-5-20251001",
    lastRun: ago(2 * HOUR),
    health: "ok",
  },
  {
    id: "risk-portfolio",
    archetype: "risk",
    name: "Portfolio",
    status: "running",
    lastOutput:
      "Sector concentration **flagged**: info-tech at 38.4% of book (limit 35%). Recommend trimming NVDA / MSFT or hedging via SMH puts.",
    costToday: 0.62,
    runs24h: 48,
    model: "claude-opus-4-7-1m",
    lastRun: ago(60 * 1000),
    health: "degraded",
  },
  {
    id: "risk-var",
    archetype: "risk",
    name: "VaR",
    status: "idle",
    lastOutput:
      "1d VaR 95: $18,420 (1.2% NAV). Within limits. Stress (oil −20%) ⇒ −$32,100; (rates +50bps) ⇒ −$11,800.",
    costToday: 0.21,
    runs24h: 24,
    model: "claude-haiku-4-5-20251001",
    lastRun: ago(15 * 60 * 1000),
    health: "ok",
  },
  {
    id: "exec-router",
    archetype: "exec",
    name: "Router",
    status: "idle",
    lastOutput:
      "Last fill on AAPL @ 224.18 (0.2bps below mid). Slippage 24h: 0.6bps avg, p95 1.8bps. Routing health: green.",
    costToday: 0.04,
    runs24h: 312,
    model: "claude-haiku-4-5-20251001",
    lastRun: ago(4 * 60 * 1000),
    health: "ok",
  },
  {
    id: "exec-options-builder",
    archetype: "exec",
    name: "Options builder",
    status: "queued",
    lastOutput:
      "Iron condor proposal on AAPL: 200/210/235/245 for July expiry. POP 64%, max profit $480, max loss $520. Risk 1R.",
    ownerStrategy: "earnings-options-play",
    costToday: 0.18,
    runs24h: 6,
    model: "claude-opus-4-7-1m",
    lastRun: ago(20 * 60 * 1000),
    health: "ok",
  },
  {
    id: "research-news",
    archetype: "research",
    name: "News",
    status: "failed",
    lastOutput:
      "NewsData.io rate limit hit (429). Last successful refresh 12 min ago.",
    costToday: 0.31,
    runs24h: 142,
    model: "claude-haiku-4-5-20251001",
    lastRun: ago(12 * 60 * 1000),
    health: "failed",
  },
  {
    id: "signal-options-skew",
    archetype: "signal",
    name: "Options skew",
    status: "idle",
    lastOutput:
      "Put/call skew on SPY: 0.84 (1m), 1.07 (3m). Term-structure normal; no immediate hedge demand visible.",
    costToday: 0.42,
    runs24h: 12,
    model: "claude-haiku-4-5-20251001",
    lastRun: ago(40 * 60 * 1000),
    health: "ok",
  },
];

export type { Agent };
