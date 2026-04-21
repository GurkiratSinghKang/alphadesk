"use client";

import * as React from "react";
import { useId } from "react";

import Eyebrow from "@/components/typography/Eyebrow";
import Mono from "@/components/typography/Mono";
import { cn } from "@/lib/utils";

export type EquityRange = "1M" | "3M" | "YTD" | "1Y" | "ALL";

export interface EquityPoint {
  date: string;
  value: number;
}

export interface EquityPanelProps {
  data: EquityPoint[];
  benchmark?: EquityPoint[];
  activeRange: EquityRange;
  onRangeChange: (range: EquityRange) => void;
  /** Formatted stats displayed alongside the chart. */
  summary?: { label: string; value: string; tone?: "profit" | "loss" | "neutral" }[];
  className?: string;
}

const RANGES: EquityRange[] = ["1M", "3M", "YTD", "1Y", "ALL"];

function pctToneClass(tone: "profit" | "loss" | "neutral" | undefined): string {
  if (tone === "profit") return "text-profit";
  if (tone === "loss") return "text-loss";
  return "text-fg";
}

/**
 * EquityPanel
 * ───────────
 * Minimalist equity-curve chart in the editorial style. Single stroke,
 * hairline grid, optional SPY benchmark overlay. No axis chrome — a
 * summary row below the SVG carries the numbers in mono.
 */
export default function EquityPanel({
  data,
  benchmark,
  activeRange,
  onRangeChange,
  summary,
  className,
}: EquityPanelProps) {
  const idBase = useId().replace(/:/g, "");
  const gradId = `equity-grad-${idBase}`;

  if (!data || data.length < 2) {
    // 2026-04-21 polish: empty-state copy was 14px italic serif; bumped
    // to 15px so the editorial voice reads with the same weight as the
    // equivalent copy block on the strategy hero empty state above.
    // Preserves the "no data" typographic rhythm across both surfaces.
    return (
      <div
        className={cn(
          "flex h-[280px] items-center justify-center rounded-lg border border-border bg-bg-elev-1",
          className
        )}
      >
        <p className="font-display italic text-[15px] text-fg-muted">
          Not enough data for equity curve.
        </p>
      </div>
    );
  }

  const w = 1000;
  const h = 320;
  const padX = 24;
  const padY = 24;

  const hasBench = benchmark && benchmark.length >= 2;

  // Normalise to % return when bench is present, otherwise use raw values.
  const mainValues = hasBench
    ? data.map((p) => ((p.value / data[0].value) - 1) * 100)
    : data.map((p) => p.value);
  const benchValues = hasBench ? benchmark!.map((p) => p.value) : [];

  const allVals = hasBench ? [...mainValues, ...benchValues] : mainValues;
  // Filter non-finite values before min/max — a single NaN (e.g. from
  // `data[0].value === 0` causing a divide-by-zero above, or from a bad
  // upstream parse) would silently NaN out the entire chart.
  const cleanVals = allVals.filter(Number.isFinite);
  const min = cleanVals.length ? Math.min(...cleanVals) : 0;
  const max = cleanVals.length ? Math.max(...cleanVals) : 0;
  const range = max - min || 1;

  const toPoint = (vals: number[], idx: number) => {
    const total = vals.length;
    const raw = vals[idx];
    // Clamp non-finite to the midline so a single bad point doesn't break
    // the SVG path (the min/max above already filtered them out).
    const v = Number.isFinite(raw) ? raw : (min + max) / 2;
    const x = padX + (idx / (total - 1)) * (w - 2 * padX);
    const y = padY + (1 - (v - min) / range) * (h - 2 * padY);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  const mainPoints = mainValues.map((_, i) => toPoint(mainValues, i));
  const benchPoints = hasBench ? benchValues.map((_, i) => toPoint(benchValues, i)) : [];

  const isPositive = mainValues[mainValues.length - 1] >= mainValues[0];
  const stroke = isPositive ? "var(--profit)" : "var(--loss)";

  const areaPoints = [
    ...mainPoints,
    `${padX + (w - 2 * padX)},${h - padY}`,
    `${padX},${h - padY}`,
  ];

  return (
    <section
      data-slot="strategy-equity"
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border bg-bg-elev-1 p-4",
        className
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <Eyebrow as="div">EQUITY CURVE</Eyebrow>
        <div
          role="radiogroup"
          aria-label="Equity curve range"
          className="flex items-center gap-1 rounded-md border border-border bg-bg p-0.5"
        >
          {RANGES.map((r) => {
            const active = r === activeRange;
            // 2026-04-21 polish: range chips were 24px tall (text-[11px]
            // + py-1) — below the 36px desktop hit-target floor and with
            // no visible focus ring. Raised to h-8 / min-w-[40px] and added
            // a focus-visible outline so keyboard users can see where they
            // are when arrowing through the radiogroup. Text bumped to
            // 12px (fs-label floor).
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={active}
                data-range={r}
                data-testid={`range-${r}`}
                onClick={() => onRangeChange(r)}
                className={cn(
                  "inline-flex h-8 min-w-[40px] items-center justify-center font-mono text-[12px] tabular-nums px-2.5 rounded transition-colors",
                  active
                    ? "bg-bg-elev-2 text-fg"
                    : "text-fg-muted hover:text-fg",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                )}
                style={{ letterSpacing: "0.04em" }}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-[320px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Strategy equity curve"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.24} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <polygon points={areaPoints.join(" ")} fill={`url(#${gradId})`} />
        {hasBench && (
          <polyline
            points={benchPoints.join(" ")}
            fill="none"
            stroke="var(--fg-muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
            strokeLinejoin="round"
            opacity={0.8}
          />
        )}
        <polyline
          points={mainPoints.join(" ")}
          fill="none"
          stroke={stroke}
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      {summary && summary.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border-hair pt-3 sm:grid-cols-4">
          {summary.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <dt>
                <Eyebrow as="span">{s.label}</Eyebrow>
              </dt>
              <dd>
                <Mono className={cn("text-[13px]", pctToneClass(s.tone))}>
                  {s.value}
                </Mono>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
