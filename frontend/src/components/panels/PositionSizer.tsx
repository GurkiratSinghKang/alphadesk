"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { usePortfolioStore } from "@/stores/portfolio";
import { cn, safeNum } from "@/lib/utils";

interface PositionSizerProps {
  symbol: string;
  currentPrice: number;
}

export function PositionSizer({ symbol: _symbol, currentPrice }: PositionSizerProps) {
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState<"pct" | "price">("pct");
  const [riskPct, setRiskPct] = useState(2);
  const [stopLossPct, setStopLossPct] = useState(5);
  const [entryPrice, setEntryPrice] = useState(currentPrice);
  const [stopLossPrice, setStopLossPrice] = useState(
    currentPrice > 0 ? +(currentPrice * 0.95).toFixed(2) : 0
  );
  const summary = usePortfolioStore((s) => s.summary);

  // Keep entry price in sync with current price when user hasn't customized
  const effectiveEntry = mode === "price" ? entryPrice : currentPrice;
  const accountSize = summary.equity > 0 ? summary.equity : 100000;
  const riskAmount = accountSize * (riskPct / 100);

  let stopLossDistance: number;
  if (mode === "pct") {
    stopLossDistance = effectiveEntry * (stopLossPct / 100);
  } else {
    stopLossDistance = Math.abs(entryPrice - stopLossPrice);
  }

  const shares =
    stopLossDistance > 0 ? Math.floor(riskAmount / stopLossDistance) : 0;
  const positionValue = shares * effectiveEntry;
  const pctOfPortfolio =
    accountSize > 0 ? ((positionValue / accountSize) * 100).toFixed(1) : "0";
  const isOverRisk = positionValue > accountSize * 0.1;
  const effectiveStopPrice =
    mode === "pct"
      ? +(effectiveEntry - stopLossDistance).toFixed(2)
      : stopLossPrice;

  return (
    <div className="border border-border rounded-lg mb-3 bg-[var(--panel)]/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-2.5 py-2 text-left hover:bg-accent/30 transition-colors"
      >
        <span className="text-label uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
          Position Sizer
        </span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {/* Mode Toggle */}
          <div className="flex gap-1">
            <button
              onClick={() => setMode("pct")}
              className={cn(
                "flex-1 rounded py-1 text-label font-medium transition-colors",
                mode === "pct"
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "bg-[var(--panel)] text-muted-foreground"
              )}
            >
              % Based
            </button>
            <button
              onClick={() => setMode("price")}
              className={cn(
                "flex-1 rounded py-1 text-label font-medium transition-colors",
                mode === "price"
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "bg-[var(--panel)] text-muted-foreground"
              )}
            >
              Price Based
            </button>
          </div>

          {/* Inputs */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="position-risk-pct"
                className="text-label text-muted-foreground"
              >
                Risk %
              </label>
              <input
                id="position-risk-pct"
                type="number"
                value={riskPct}
                onChange={(e) => setRiskPct(safeNum(e.target.value, 0))}
                min={0.5}
                max={10}
                step={0.5}
                className="w-full h-7 rounded border border-border bg-background px-2 text-label tabular-nums text-foreground mt-0.5"
              />
            </div>

            {mode === "pct" ? (
              <div>
                <label
                  htmlFor="position-stop-loss"
                  className="text-label text-muted-foreground"
                >
                  Stop Loss %
                </label>
                <input
                  id="position-stop-loss"
                  type="number"
                  value={stopLossPct}
                  onChange={(e) => setStopLossPct(safeNum(e.target.value, 0))}
                  min={0.5}
                  max={20}
                  step={0.5}
                  className="w-full h-7 rounded border border-border bg-background px-2 text-label tabular-nums text-foreground mt-0.5"
                />
              </div>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="position-entry-price"
                    className="text-label text-muted-foreground"
                  >
                    Entry Price
                  </label>
                  <input
                    id="position-entry-price"
                    type="number"
                    value={entryPrice}
                    onChange={(e) => setEntryPrice(safeNum(e.target.value, 0))}
                    step={0.01}
                    className="w-full h-7 rounded border border-border bg-background px-2 text-label tabular-nums text-foreground mt-0.5"
                  />
                </div>
                <div className="col-span-2">
                  <label
                    htmlFor="position-stop-price"
                    className="text-label text-muted-foreground"
                  >
                    Stop Loss Price
                  </label>
                  <input
                    id="position-stop-price"
                    type="number"
                    value={stopLossPrice}
                    onChange={(e) => setStopLossPrice(safeNum(e.target.value, 0))}
                    step={0.01}
                    className="w-full h-7 rounded border border-border bg-background px-2 text-label tabular-nums text-foreground mt-0.5"
                  />
                </div>
              </>
            )}
          </div>

          {/* Results */}
          <div className="border-t border-border pt-2 space-y-0.5 text-label">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shares</span>
              <span className="text-foreground font-semibold tabular-nums">
                {shares.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Position Value</span>
              <span className="text-foreground tabular-nums">
                ${positionValue.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dollar Risk</span>
              <span className="text-[var(--loss)] tabular-nums">
                ${(riskAmount ?? 0).toFixed(0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Stop Price</span>
              <span className="text-muted-foreground tabular-nums">
                ${(effectiveStopPrice ?? 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Portfolio Weight</span>
              <span
                className={cn(
                  "text-foreground tabular-nums",
                  isOverRisk && "text-[var(--loss)] font-semibold"
                )}
              >
                {pctOfPortfolio}%{isOverRisk ? " (>10%)" : ""}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
