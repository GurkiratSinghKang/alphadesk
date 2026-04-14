"use client";

import { useMemo } from "react";
import { cn, formatCurrency } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────

export interface OptionLeg {
  strike: number;
  type: "call" | "put";
  side: "buy" | "sell";
  premium: number;
  quantity: number;
}

interface PayoffDiagramProps {
  legs: OptionLeg[];
  currentPrice?: number;
  className?: string;
}

// ─── Payoff Calculation ─────────────────────────────────────

function calculatePayoff(legs: OptionLeg[], underlyingPrice: number): number {
  let total = 0;
  for (const leg of legs) {
    const multiplier = leg.side === "buy" ? 1 : -1;
    let intrinsic = 0;
    if (leg.type === "call") {
      intrinsic = Math.max(0, underlyingPrice - leg.strike);
    } else {
      intrinsic = Math.max(0, leg.strike - underlyingPrice);
    }
    total += (intrinsic - leg.premium) * multiplier * leg.quantity * 100;
  }
  return total;
}

// ─── Component ──────────────────────────────────────────────

const CHART_W = 320;
const CHART_H = 140;
const PAD_L = 52;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 24;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;

export function PayoffDiagram({ legs, currentPrice, className }: PayoffDiagramProps) {
  const { points, breakevens, maxProfit, maxLoss, minX, maxX, minY, maxY } = useMemo(() => {
    const strikes = legs.map((l) => l.strike);
    const center = currentPrice ?? (strikes.reduce((a, b) => a + b, 0) / strikes.length);
    const range = center * 0.3;
    const lo = center - range;
    const hi = center + range;
    const steps = 200;
    const step = (hi - lo) / steps;

    const pts: { x: number; y: number }[] = [];
    let yMin = Infinity;
    let yMax = -Infinity;

    for (let i = 0; i <= steps; i++) {
      const x = lo + i * step;
      const y = calculatePayoff(legs, x);
      pts.push({ x, y });
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }

    // Add padding to Y range
    const yPad = Math.max(Math.abs(yMax - yMin) * 0.1, 10);
    yMin -= yPad;
    yMax += yPad;

    // Find breakeven points (where payoff crosses zero)
    const bkevens: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      if ((prev.y <= 0 && curr.y >= 0) || (prev.y >= 0 && curr.y <= 0)) {
        // Linear interpolation for the zero crossing
        const ratio = Math.abs(prev.y) / (Math.abs(prev.y) + Math.abs(curr.y));
        const bx = prev.x + ratio * (curr.x - prev.x);
        bkevens.push(bx);
      }
    }

    return {
      points: pts,
      breakevens: bkevens,
      maxProfit: yMax - yPad,
      maxLoss: yMin + yPad,
      minX: lo,
      maxX: hi,
      minY: yMin,
      maxY: yMax,
    };
  }, [legs, currentPrice]);

  // Map data coords to SVG coords
  const toSvgX = (x: number) => PAD_L + ((x - minX) / (maxX - minX)) * PLOT_W;
  const toSvgY = (y: number) => PAD_T + (1 - (y - minY) / (maxY - minY)) * PLOT_H;

  // Build the payoff path
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`).join(" ");

  // Build filled areas: green above zero, red below zero
  const zeroY = toSvgY(0);

  // Clip paths for green (above zero) and red (below zero)
  const fillPathAbove = linePath + ` L${toSvgX(maxX).toFixed(1)},${zeroY.toFixed(1)} L${toSvgX(minX).toFixed(1)},${zeroY.toFixed(1)} Z`;
  const fillPathBelow = linePath + ` L${toSvgX(maxX).toFixed(1)},${zeroY.toFixed(1)} L${toSvgX(minX).toFixed(1)},${zeroY.toFixed(1)} Z`;

  // Y-axis ticks
  const yRange = maxY - minY;
  const yTickCount = 4;
  const yTicks: number[] = [];
  for (let i = 0; i <= yTickCount; i++) {
    yTicks.push(minY + (yRange * i) / yTickCount);
  }

  // X-axis ticks (use strikes + endpoints)
  const xTicks = [minX, ...legs.map((l) => l.strike).sort((a, b) => a - b), maxX];
  const uniqueXTicks = Array.from(new Set(xTicks.map((t) => Math.round(t * 100) / 100)));

  return (
    <div className={cn("rounded-md border border-border bg-[var(--surface)] p-2", className)}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Payoff at Expiration
        </span>
        <div className="flex items-center gap-3 text-[10px] tabular-nums">
          <span className="text-[var(--profit)]">
            Max Profit: {maxProfit >= 1e7 ? "Unlimited" : formatCurrency(maxProfit)}
          </span>
          <span className="text-[var(--loss)]">
            Max Loss: {formatCurrency(Math.abs(maxLoss))}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        style={{ maxHeight: 160 }}
      >
        {/* Clip regions for fills */}
        <defs>
          <clipPath id="clip-above-zero">
            <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={Math.max(0, zeroY - PAD_T)} />
          </clipPath>
          <clipPath id="clip-below-zero">
            <rect x={PAD_L} y={zeroY} width={PLOT_W} height={Math.max(0, PAD_T + PLOT_H - zeroY)} />
          </clipPath>
        </defs>

        {/* Grid lines */}
        {yTicks.map((tick, i) => (
          <line
            key={`yg-${i}`}
            x1={PAD_L}
            y1={toSvgY(tick)}
            x2={CHART_W - PAD_R}
            y2={toSvgY(tick)}
            stroke="#ffffff08"
            strokeWidth={0.5}
          />
        ))}

        {/* Zero line */}
        <line
          x1={PAD_L}
          y1={zeroY}
          x2={CHART_W - PAD_R}
          y2={zeroY}
          stroke="#ffffff20"
          strokeWidth={1}
          strokeDasharray="4 2"
        />

        {/* Green fill (above zero) */}
        <path
          d={fillPathAbove}
          fill="#22c55e"
          fillOpacity={0.12}
          clipPath="url(#clip-above-zero)"
        />

        {/* Red fill (below zero) */}
        <path
          d={fillPathBelow}
          fill="#ef4444"
          fillOpacity={0.12}
          clipPath="url(#clip-below-zero)"
        />

        {/* Payoff line */}
        <path
          d={linePath}
          fill="none"
          stroke="#a78bfa"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Current price vertical line */}
        {currentPrice != null && currentPrice >= minX && currentPrice <= maxX && (
          <>
            <line
              x1={toSvgX(currentPrice)}
              y1={PAD_T}
              x2={toSvgX(currentPrice)}
              y2={PAD_T + PLOT_H}
              stroke="#f59e0b"
              strokeWidth={1}
              strokeDasharray="3 2"
            />
            <text
              x={toSvgX(currentPrice)}
              y={PAD_T - 4}
              fill="#f59e0b"
              fontSize={8}
              textAnchor="middle"
              fontFamily="Inter, system-ui, sans-serif"
            >
              {currentPrice.toFixed(0)}
            </text>
          </>
        )}

        {/* Breakeven dots */}
        {breakevens.map((bx, i) => (
          <g key={`be-${i}`}>
            <circle
              cx={toSvgX(bx)}
              cy={zeroY}
              r={3}
              fill="#f59e0b"
              stroke="#000"
              strokeWidth={0.5}
            />
            <text
              x={toSvgX(bx)}
              y={zeroY + 10}
              fill="#f59e0b"
              fontSize={7.5}
              textAnchor="middle"
              fontFamily="Inter, system-ui, sans-serif"
            >
              BE ${bx.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Strike markers on X-axis */}
        {legs.map((leg, i) => {
          const sx = toSvgX(leg.strike);
          if (sx < PAD_L || sx > CHART_W - PAD_R) return null;
          return (
            <g key={`strike-${i}`}>
              <line
                x1={sx}
                y1={PAD_T}
                x2={sx}
                y2={PAD_T + PLOT_H}
                stroke="#ffffff10"
                strokeWidth={0.5}
                strokeDasharray="2 2"
              />
            </g>
          );
        })}

        {/* Y-axis labels */}
        {yTicks.map((tick, i) => (
          <text
            key={`yl-${i}`}
            x={PAD_L - 4}
            y={toSvgY(tick) + 3}
            fill="#8a8a95"
            fontSize={7.5}
            textAnchor="end"
            fontFamily="Inter, system-ui, sans-serif"
          >
            {Math.abs(tick) >= 1000
              ? `$${(tick / 1000).toFixed(1)}k`
              : `$${tick.toFixed(0)}`}
          </text>
        ))}

        {/* X-axis labels */}
        {uniqueXTicks.map((tick, i) => {
          const sx = toSvgX(tick);
          if (sx < PAD_L + 10 || sx > CHART_W - PAD_R - 10) return null;
          return (
            <text
              key={`xl-${i}`}
              x={sx}
              y={CHART_H - 4}
              fill="#8a8a95"
              fontSize={7.5}
              textAnchor="middle"
              fontFamily="Inter, system-ui, sans-serif"
            >
              ${tick.toFixed(0)}
            </text>
          );
        })}

        {/* Axis labels */}
        <text x={PAD_L - 4} y={PAD_T - 4} fill="#666" fontSize={7} textAnchor="end" fontFamily="Inter, system-ui, sans-serif">
          P&L
        </text>
        <text x={CHART_W - PAD_R} y={CHART_H - 4} fill="#666" fontSize={7} textAnchor="end" fontFamily="Inter, system-ui, sans-serif">
          Price
        </text>
      </svg>

      {/* Breakeven summary */}
      {breakevens.length > 0 && (
        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
          <span className="text-[var(--chart-4)]">Breakeven{breakevens.length > 1 ? "s" : ""}:</span>
          {breakevens.map((bx, i) => (
            <span key={i} className="tabular-nums text-foreground">${bx.toFixed(2)}</span>
          ))}
        </div>
      )}
    </div>
  );
}
