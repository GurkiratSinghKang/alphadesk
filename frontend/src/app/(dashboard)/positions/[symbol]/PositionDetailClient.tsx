"use client";

import * as React from "react";
import Link from "next/link";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";
import AgentChip from "@/components/primitives/AgentChip";
import StatusDot from "@/components/primitives/StatusDot";
import { useAgents } from "@/hooks/useAgents";
import { getPositions } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Position } from "@/types";
import type { Agent, AgentArchetype } from "@/lib/types/agents";

function normalizePositionSymbol(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * /positions/[symbol] — v2-plan §2.2.
 *
 * Per-symbol position detail with the design's chrome (back link, italic
 * "qty side sym" hero, 6-stat hero grid, trade log, scale-out plan,
 * risk panel) plus the Phase 2 archetype attribution: which agents own
 * this trade. The owner row reads the position's `strategy` slug, finds
 * the agents whose `ownerStrategy` matches, and surfaces them as chips
 * that link into /agents/[id].
 *
 * Data: live `/api/v1/trades/positions` via api.ts (mocked in dev).
 * Trade log + scale-out + risk numbers are deterministic synthesis
 * until backend B.4 ships per-position lot history.
 */
export default function PositionDetailClient({ symbol }: { symbol: string }) {
  const [positions, setPositions] = React.useState<Position[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const { data: agents = [] } = useAgents();

  React.useEffect(() => {
    let cancelled = false;
    getPositions()
      .then((rows) => {
        if (!cancelled) setPositions(rows ?? []);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err?.message ?? "Failed to load positions");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const position = React.useMemo<Position | null>(() => {
    if (!positions) return null;
    const requested = normalizePositionSymbol(symbol);
    return positions.find((p) => normalizePositionSymbol(p.symbol) === requested) ?? null;
  }, [positions, symbol]);

  if (loadError) {
    return (
      <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
        <Section eyebrow={`POSITION · ${symbol}`} title="Couldn't load positions" level={1}>
          <EmptyState eyebrow="ERROR" title="Position lookup failed." description={loadError} />
        </Section>
      </main>
    );
  }

  if (!positions) {
    return (
      <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
        <Section eyebrow={`POSITION · ${symbol}`} title="Loading…" level={1}>
          <p className="t-mono text-body-sm text-fg-muted">Pulling open positions.</p>
        </Section>
      </main>
    );
  }

  if (!position) {
    return (
      <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
        <Section eyebrow={`POSITION · ${symbol}`} title="No open position" level={1}>
          <EmptyState
            eyebrow="FLAT"
            title={`No open position in ${symbol}.`}
            description="Open the symbol research view to see signals, agent thesis, and stage a trade."
          />
          <p className="mt-3 flex items-center gap-3">
            <Link
              href={`/symbols/${encodeURIComponent(symbol)}`}
              className="inline-flex items-center gap-1 rounded-sm border border-brand/40 bg-tint-brand-1 px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-[0.08em] text-brand transition-colors hover:bg-brand hover:text-brand-on"
            >
              Research {symbol} ↗
            </Link>
            <Link
              href={`/trade?symbol=${encodeURIComponent(symbol)}`}
              className="inline-flex items-center gap-1 rounded-sm border border-border-hair bg-bg-elev-1 px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-[0.08em] text-fg-muted transition-colors hover:text-fg"
            >
              Stage trade
            </Link>
          </p>
        </Section>
      </main>
    );
  }

  const side = position.side ?? "long";
  const qty = position.quantity;
  const avg = position.avgCost;
  const last = position.currentPrice;
  const cost = qty * avg;
  const mv = position.marketValue;
  const pl = position.unrealizedPnl;
  const plPct = cost > 0 ? (pl / cost) * 100 : 0;
  const stop = +(avg * (side === "long" ? 0.92 : 1.08)).toFixed(2);
  const stopDist = ((Math.abs(last - stop) / last) * 100).toFixed(1);
  const concentration = mv > 0 ? Math.min((mv / 250_000) * 100, 999) : 0;

  // Trade log + scale-out are deterministic synthesis off the position
  // numbers — backend B.4 swaps for real lot history.
  const log = synthesizeTradeLog(position);
  const scaleOut = synthesizeScaleOut(position);
  const owners = ownersFor(position, agents);

  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 pb-4 border-b border-border-hair">
        <div className="min-w-0 flex flex-col gap-1.5">
          <Link
            href="/"
            className="t-mono text-eyebrow text-fg-muted hover:text-fg uppercase tracking-[0.08em] inline-flex items-center gap-1"
          >
            ← Book · positions
          </Link>
          <p className="t-label text-fg-hint">
            POSITION · {position.strategy ?? "manual"}
          </p>
          <h1
            className="font-display italic text-fg"
            style={{
              fontSize: 56,
              lineHeight: 1,
              letterSpacing: "-0.025em",
              color: "var(--ink-1000)",
            }}
          >
            {qty}{" "}
            <span className={side === "short" ? "text-loss" : "text-profit"}>
              {side}
            </span>{" "}
            {position.symbol}
          </h1>
          <p
            className="font-display italic text-fg-dim"
            style={{ fontSize: 16, marginTop: 4 }}
          >
            Market value ${mv.toLocaleString()} · cost ${cost.toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/symbols/${encodeURIComponent(position.symbol)}`}
            className="inline-flex items-center gap-1 rounded-sm border border-border-hair bg-bg-elev-1 px-3 py-2 text-eyebrow font-semibold uppercase tracking-[0.08em] text-fg-muted transition-colors hover:text-fg"
          >
            Research
          </Link>
          <Link
            href={`/trade?symbol=${encodeURIComponent(position.symbol)}`}
            className="inline-flex items-center gap-1 rounded-sm border border-brand/60 bg-brand px-3 py-2 text-eyebrow font-semibold uppercase tracking-[0.08em] text-brand-on transition-colors hover:opacity-90"
          >
            Adjust trade
          </Link>
        </div>
      </header>

      <div
        className="grid gap-px bg-border-hair rounded-md overflow-hidden border border-border-hair"
        style={{ gridTemplateColumns: "repeat(6, 1fr)" }}
      >
        <Stat label="Avg cost" value={`$${avg.toFixed(2)}`} />
        <Stat label="Last" value={`$${last.toFixed(2)}`} />
        <Stat
          label="Unrealized"
          value={`${pl >= 0 ? "+" : "−"}$${Math.abs(pl).toLocaleString()}`}
          tone={pl >= 0 ? "profit" : "loss"}
          big
        />
        <Stat
          label="Return"
          value={`${plPct >= 0 ? "+" : ""}${plPct.toFixed(2)}%`}
          tone={plPct >= 0 ? "profit" : "loss"}
        />
        <Stat label="Market value" value={`$${mv.toLocaleString()}`} />
        <Stat label="Cost basis" value={`$${cost.toLocaleString()}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr,1fr] gap-6">
        {/* Trade log + scale-out */}
        <div className="space-y-6">
          <Section eyebrow="LOG" title="Trade log" rule={false}>
            <ol className="rounded-md border border-border-hair bg-bg-elev-1 divide-y divide-border-hair">
              {log.map((t, i) => (
                <li
                  key={i}
                  className="grid items-baseline gap-3 px-4 py-2.5 font-mono text-body-sm"
                  style={{ gridTemplateColumns: "auto auto auto 1fr auto" }}
                >
                  <span className="text-fg-hint text-eyebrow">{t.ts}</span>
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded-pill text-eyebrow font-semibold uppercase tracking-[0.08em]",
                      t.side === "buy"
                        ? "bg-tint-up-1 text-profit border border-profit/40"
                        : "bg-tint-down-1 text-loss border border-loss/40",
                    )}
                  >
                    {t.side}
                  </span>
                  <span className="text-fg">
                    {t.qty} @ {t.px.toFixed(2)}
                  </span>
                  <span className="font-display italic text-fg-muted truncate">
                    {t.note}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums",
                      (last - t.px) * t.qty >= 0 ? "text-profit" : "text-loss",
                    )}
                  >
                    {(last - t.px) * t.qty >= 0 ? "+" : "−"}$
                    {Math.abs((last - t.px) * t.qty).toFixed(0)}
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          <Section eyebrow="EXIT" title="Scale-out plan · 3 levels" rule={false}>
            <div className="grid gap-3 sm:grid-cols-3">
              {scaleOut.map((step, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border bg-bg-elev-1 p-3 flex flex-col gap-1.5"
                >
                  <p className="t-label text-brand">
                    Step {i + 1} · {step.trigger}
                  </p>
                  <p className="font-mono text-body text-fg">
                    {typeof step.px === "number" ? `$${step.px.toFixed(2)}` : step.px}
                  </p>
                  <p className="font-mono text-eyebrow text-fg-muted">
                    Qty {step.qty}
                  </p>
                  <p className="font-display italic text-body-sm text-fg-muted leading-snug">
                    {step.note}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Risk panel + agent owners */}
        <div className="space-y-6">
          <Section eyebrow="RISK · LIVE" title="Live risk" rule={false}>
            <div className="rounded-md border border-border bg-bg-elev-1 p-4">
              <dl
                className="grid gap-y-2.5 gap-x-4 font-mono text-body-sm"
                style={{ gridTemplateColumns: "1fr auto" }}
              >
                <dt className="text-fg-muted">Stop · hard</dt>
                <dd className="text-loss tabular-nums">${stop.toFixed(2)} · {stopDist}%</dd>
                <dt className="text-fg-muted">Risk if stop</dt>
                <dd className="text-fg tabular-nums">−${((last - stop) * qty).toFixed(0)}</dd>
                <dt className="text-fg-muted">Concentration</dt>
                <dd className="text-fg tabular-nums">{concentration.toFixed(1)}% / 15% cap</dd>
                <dt className="text-fg-muted">Strategy alloc</dt>
                <dd className="text-fg">{position.strategy ? "32% / 40% cap" : "manual"}</dd>
                <dt className="text-fg-muted">Earnings in</dt>
                <dd className="text-state-warning">14d · pre-event</dd>
                <dt className="text-fg-muted">Sector</dt>
                <dd className="text-fg">{position.sector ?? "—"}</dd>
              </dl>
            </div>
          </Section>

          <Section eyebrow="AGENTS · OWN THIS TRADE" title="Owners" rule={false}>
            {owners.length === 0 ? (
              <EmptyState
                eyebrow="MANUAL"
                title="No agents are attributed to this position."
                description="Position was opened manually or its strategy slug doesn't match any agent's owner."
              />
            ) : (
              <ul className="rounded-md border border-border-hair bg-bg-elev-1 divide-y divide-border-hair">
                {owners.map((agent) => (
                  <li key={agent.id}>
                    <Link
                      href={`/agents/${encodeURIComponent(agent.id)}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-elev-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <AgentChip archetype={agent.archetype} status={agent.status} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className="text-body text-fg font-medium truncate">{agent.name}</p>
                        <p className="font-display italic text-body-sm text-fg-muted line-clamp-2">
                          {firstSentence(agent.lastOutput)}
                        </p>
                      </div>
                      <StatusDot
                        tone={agent.health === "ok" ? "profit" : agent.health === "degraded" ? "amber" : "loss"}
                        size={7}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "default",
  big = false,
}: {
  label: string;
  value: string;
  tone?: "default" | "profit" | "loss";
  big?: boolean;
}) {
  return (
    <div className="bg-bg-elev-1 px-4 py-3 flex flex-col gap-1">
      <span className="t-label text-fg-hint">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums text-fg",
          big ? "text-h2" : "text-body-sm",
          tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "",
        )}
      >
        {value}
      </span>
    </div>
  );
}

interface LogEntry {
  ts: string;
  side: "buy" | "sell";
  qty: number;
  px: number;
  note: string;
}

function synthesizeTradeLog(p: Position): LogEntry[] {
  const day = (n: number) => `Day -${n}`;
  return [
    { ts: day(18), side: "buy", qty: Math.round(p.quantity * 0.4), px: +(p.avgCost * 0.985).toFixed(2), note: "Pivot break entry" },
    { ts: day(12), side: "buy", qty: Math.round(p.quantity * 0.32), px: +(p.avgCost * 1.005).toFixed(2), note: "Add on confirmation" },
    { ts: day(5), side: "buy", qty: p.quantity - Math.round(p.quantity * 0.4) - Math.round(p.quantity * 0.32), px: +(p.avgCost * 1.015).toFixed(2), note: "Scale-in · thesis intact" },
  ];
}

interface ScaleOutStep {
  trigger: string;
  px: number | string;
  qty: number;
  note: string;
}

function synthesizeScaleOut(p: Position): ScaleOutStep[] {
  const third = Math.round(p.quantity / 3);
  return [
    { trigger: "+8%",   px: +(p.avgCost * 1.08).toFixed(2),  qty: third, note: "Take 1/3 at first resistance" },
    { trigger: "+15%",  px: +(p.avgCost * 1.15).toFixed(2),  qty: third, note: "Take 1/3 at next pivot" },
    { trigger: "Trail", px: "+10% trail", qty: p.quantity - 2 * third, note: "Ride remainder to trail-stop" },
  ];
}

function ownersFor(position: Position, agents: Agent[]): Agent[] {
  // 1. Direct strategy match — agent.ownerStrategy === position.strategy.
  if (position.strategy) {
    const direct = agents.filter((a) => a.ownerStrategy === position.strategy);
    if (direct.length > 0) return direct;
  }
  // 2. Risk + Exec are universal owners — they always have a stake even
  //    when no specific strategy claims the trade. Surface one of each.
  const fallbackArchetypes: AgentArchetype[] = ["risk", "exec"];
  return fallbackArchetypes
    .map((arch) => agents.find((a) => a.archetype === arch))
    .filter((a): a is Agent => Boolean(a));
}

function firstSentence(text: string): string {
  const stripped = text.replace(/\*\*/g, "");
  const dot = stripped.indexOf(".");
  if (dot > 0 && dot < 140) return stripped.slice(0, dot + 1);
  return stripped.length > 100 ? stripped.slice(0, 100) + "…" : stripped;
}
