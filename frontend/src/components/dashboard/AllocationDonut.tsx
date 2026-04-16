"use client";

import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";

interface AllocationDonutProps {
  cash: number;
  invested: number;
  equity: number;
  buyingPower: number;
  unrealizedPnl: number;
  realizedPnlToday: number;
  isDemo?: boolean;
}

export function AllocationDonut({ cash, invested, equity, buyingPower, unrealizedPnl, realizedPnlToday, isDemo }: AllocationDonutProps) {
  const total = cash + invested;
  const investedPct = total > 0 ? invested / total : 0;
  const cashPct = total > 0 ? cash / total : 1;

  // SVG donut using stroke-dasharray
  const r = 46; // radius
  const cx = 60;
  const cy = 60;
  const circumference = 2 * Math.PI * r;
  const investedDash = circumference * investedPct;
  const cashDash = circumference * cashPct;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-label">Allocation</h3>
      </div>
      <div className="flex items-start gap-4">
        {/* Donut SVG */}
        <div className="shrink-0">
          <svg width={120} height={120} viewBox="0 0 120 120">
            {/* Background track */}
            <circle
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke="var(--muted)"
              strokeWidth={12}
              opacity={0.15}
            />
            {/* Cash segment (blue) — starts at 12 o'clock */}
            <circle
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={12}
              strokeDasharray={`${cashDash} ${circumference - cashDash}`}
              strokeDashoffset={0}
              strokeLinecap="butt"
              transform={`rotate(-90 ${cx} ${cy})`}
              opacity={0.85}
            />
            {/* Invested segment (green) — starts right after cash */}
            {investedPct > 0.005 && <circle
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke="var(--profit)"
              strokeWidth={12}
              strokeDasharray={`${investedDash} ${circumference - investedDash}`}
              strokeDashoffset={-cashDash}
              strokeLinecap="butt"
              transform={`rotate(-90 ${cx} ${cy})`}
              opacity={0.85}
            />}
            {/* Center text */}
            <text x={cx} y={cy - 6} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>Total</text>
            <text x={cx} y={cy + 10} textAnchor="middle" className="fill-foreground" fontSize={13} fontWeight={600}>
              {formatCurrency(equity, true)}
            </text>
          </svg>
        </div>

        {/* Legend + details */}
        <div className="flex-1 space-y-3 pt-2">
          {/* Legend */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 shrink-0">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--primary)]" />
                <span className="text-xs text-muted-foreground">Cash</span>
              </div>
              <span className="text-xs tabular-nums text-foreground">{formatCurrency(cash)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 shrink-0">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--profit)]" />
                <span className="text-xs text-muted-foreground">Invested</span>
              </div>
              <span className="text-xs tabular-nums text-foreground">{formatCurrency(invested)}</span>
            </div>
          </div>

          {/* Compact account details */}
          <div className="border-t border-border pt-2 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-hint shrink-0">Buying Power</span>
              <span className="text-xs tabular-nums text-foreground">{formatCurrency(buyingPower)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-hint shrink-0">Unrealized</span>
              <span className={cn("text-xs tabular-nums font-medium", unrealizedPnl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                {unrealizedPnl >= 0 ? "+" : ""}{formatCurrency(unrealizedPnl)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-hint shrink-0">Realized Today</span>
              <span className={cn("text-xs tabular-nums font-medium", realizedPnlToday >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                {realizedPnlToday >= 0 ? "+" : ""}{formatCurrency(realizedPnlToday)}
              </span>
            </div>
          </div>
        </div>
      </div>
      {isDemo && (
        <div className="text-xs text-blue-400/70 mt-1">Connect Alpaca API for live data</div>
      )}
    </div>
  );
}
