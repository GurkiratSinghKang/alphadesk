"use client";

import type { ElementType } from "react";
import { ArrowRight, ShieldCheck, Target } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

type StatusTone = "profit" | "loss" | "amber" | "muted";

export type DashboardStrategyPanelItem = {
  id: string;
  name: string;
  returnPct: number;
  positions: number;
  invested: number;
  readinessTone: StatusTone;
  readinessLabel: string;
  readinessDetail: string;
};

export function StrategyPanel({
  strategies,
  activeStrategyCount,
  totalStrategyCount,
  loading = false,
  error = false,
  onStrategyClick,
  onStrategies,
}: {
  strategies: DashboardStrategyPanelItem[];
  activeStrategyCount: number;
  totalStrategyCount: number;
  loading?: boolean;
  error?: boolean;
  onStrategyClick: (id: string) => void;
  onStrategies: () => void;
}) {
  const emptyCopy = error
    ? "Strategy data unavailable. Open Strategies for the full status page."
    : loading
      ? "Strategy data is loading."
      : "No strategy exceptions. Active systems are quiet.";

  return (
    <section
      aria-labelledby="strategy-ops-title"
      className="overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/95 shadow-[0_18px_48px_-38px_rgba(16,22,17,0.36)]"
    >
      <StrategyPanelHeader
        id="strategy-ops-title"
        icon={Target}
        title="Strategy fault line"
        detail={`${activeStrategyCount}/${totalStrategyCount || 0} active · showing blockers only`}
        actionLabel="Strategies"
        onAction={onStrategies}
      />
      <div className="grid gap-px bg-border-hair md:grid-cols-2">
        {strategies.length > 0 ? (
          strategies.map((strategy, index) => (
            <button
              key={strategy.id}
              type="button"
              onClick={() => onStrategyClick(strategy.id)}
              className="card-stagger group bg-bg-elev-1 px-4 py-4 text-left transition-colors hover:bg-brand/5"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-ink-1000">{strategy.name}</p>
                  <p className="mt-1 truncate text-[13px] text-fg-muted">
                    {strategy.positions} positions · {formatCurrency(strategy.invested, true)} invested
                  </p>
                </div>
                <span className={cn("font-mono text-[13px]", strategy.returnPct > 0 ? "text-profit" : strategy.returnPct < 0 ? "text-loss" : "text-fg-muted")}>
                  {strategy.returnPct === 0 ? "—" : formatPercent(strategy.returnPct)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StrategyStatusChip tone={strategy.readinessTone} label={strategy.readinessLabel} />
                <span className="min-w-0 truncate text-[12px] text-fg-muted">{strategy.readinessDetail}</span>
              </div>
            </button>
          ))
        ) : (
          <div className="col-span-full bg-bg-elev-1 px-5 py-8">
            <div className="mx-auto flex max-w-md flex-col items-center text-center">
              <div className="flex size-10 items-center justify-center rounded-sm bg-profit/10 text-profit">
                <ShieldCheck className="size-5" aria-hidden />
              </div>
              <p className="mt-4 text-[15px] font-semibold text-ink-1000">{emptyCopy}</p>
              <p className="mt-2 text-[13px] leading-snug text-fg-muted">
                Only blocked systems appear here; healthy strategies stay out of the way.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function StrategyPanelHeader({
  id,
  icon: Icon,
  title,
  detail,
  actionLabel,
  onAction,
}: {
  id: string;
  icon: ElementType;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border-hair bg-bg-elev-1 px-4 py-3 sm:items-center">
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-brand/10 text-brand">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id={id} className="truncate text-[15px] font-semibold text-ink-1000">{title}</h3>
          <p className="mt-0.5 text-[12px] leading-snug text-fg-muted">{detail}</p>
        </div>
      </div>
      {actionLabel && onAction ? (
        <Button variant="ghost" size="sm" onClick={onAction}>
          {actionLabel}
          <ArrowRight aria-hidden />
        </Button>
      ) : null}
    </header>
  );
}

function StrategyStatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[12px]",
        tone === "profit" && "border-profit/30 bg-profit/10 text-profit",
        tone === "loss" && "border-loss/30 bg-loss/10 text-loss",
        tone === "amber" && "border-amber/30 bg-amber/10 text-amber",
        tone === "muted" && "border-border-hair bg-bg-elev-2 text-fg-muted",
      )}
    >
      <span className={cn("status-breathe size-1.5 rounded-full", tone === "profit" ? "bg-profit" : tone === "loss" ? "bg-loss" : tone === "amber" ? "bg-amber" : "bg-fg-muted")} aria-hidden />
      {label}
    </span>
  );
}
