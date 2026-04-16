"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { BarChart3 } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { usePnlCalendar } from "@/hooks/useQueries";
import type { CalendarDay } from "@/lib/api";

export function PnlCalendarMini() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-based for the hook
  const year = now.getFullYear();

  const { data: calendarData, isLoading } = usePnlCalendar(month, year);
  const days: CalendarDay[] = calendarData?.days ?? [];
  const monthTotal = calendarData?.monthTotal ?? 0;

  const [hovered, setHovered] = useState<{ date: string; pnl: number; trades: number; winRate: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Pre-compute scaleMax outside the cell render loop
  const scaleMax = useMemo(
    () => Math.max(...days.map((d) => Math.abs(d.pnl)), 1),
    [days],
  );

  if (!mounted || isLoading) return (
    <div className="animate-pulse bg-[var(--panel)] rounded-xl h-48 border border-border" />
  );

  if (days.length === 0) return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">P&L Calendar</h2>
      </div>
      <div className="flex items-center justify-center gap-2 h-24 px-4">
        <p className="text-xs text-muted-foreground">No trading data this month</p>
      </div>
    </div>
  );

  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun (month is 1-based, Date needs 0-based)
  const daysInMonth = new Date(year, month, 0).getDate(); // month is 1-based, so this gives last day
  const monthName = now.toLocaleString("en-US", { month: "long" });

  // Build a map of date -> pnl
  const pnlMap = new Map(days.map((d) => [d.date, d.pnl]));

  const cells: { day: number; pnl: number | null }[] = [];
  // Empty leading cells
  for (let i = 0; i < firstDay; i++) cells.push({ day: 0, pnl: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, pnl: pnlMap.get(dateStr) ?? null });
  }

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            {monthName} P&L
          </h2>
        </div>
        <span className={cn("text-sm font-semibold tabular-nums", monthTotal >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
          {monthTotal >= 0 ? "+" : ""}{formatCurrency(monthTotal)}
        </span>
      </div>
      <div className="relative p-3" ref={containerRef}>
        <div className="grid grid-cols-7 gap-1">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="text-center text-[9px] font-medium text-muted-foreground py-0.5">{d}</div>
          ))}
          {cells.map((cell, i) => {
            if (cell.day === 0) return <div key={`e-${i}`} />;
            const isToday = cell.day === now.getDate();
            const hasPnl = cell.pnl !== null;
            const positive = (cell.pnl ?? 0) >= 0;
            const intensity = hasPnl ? Math.min(Math.abs(cell.pnl!) / scaleMax, 1) : 0;
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(cell.day).padStart(2, "0")}`;
            return (
              <div
                key={cell.day}
                className={cn(
                  "relative flex flex-col items-center justify-center rounded-md py-1 text-[10px] tabular-nums",
                  isToday && "ring-1 ring-primary/50",
                  hasPnl && positive && "bg-[var(--profit)]",
                  hasPnl && !positive && "bg-[var(--loss)]",
                  !hasPnl && "bg-[var(--surface)]"
                )}
                style={hasPnl ? { opacity: 0.3 + intensity * 0.7 } : undefined}
                onMouseEnter={(e) => {
                  if (!hasPnl) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const containerRect = containerRef.current?.getBoundingClientRect();
                  if (!containerRect) return;
                  setHovered({
                    date: dateStr,
                    pnl: cell.pnl!,
                    trades: days.find(d => d.date === dateStr)?.trades ?? 0,
                    winRate: days.find(d => d.date === dateStr)?.winRate ?? 0,
                    x: rect.left - containerRect.left + rect.width / 2,
                    y: rect.top - containerRect.top,
                  });
                }}
                onMouseLeave={() => setHovered(null)}
              >
                <span className={cn("font-medium", hasPnl ? "text-white" : "text-muted-foreground")}>{cell.day}</span>
                {hasPnl && (
                  <span className="text-[8px] tabular-nums text-white/80 leading-none">
                    {cell.pnl! >= 0 ? '+' : ''}{formatCurrency(cell.pnl!)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {hovered && (
          <div
            className="absolute z-10 rounded-lg border border-border bg-[var(--surface)] px-3 py-2.5 shadow-lg pointer-events-none"
            style={{
              left: Math.max(0, Math.min(hovered.x - 80, (containerRef.current?.offsetWidth ?? 320) - 160)),
              top: Math.max(0, hovered.y - 95),
              width: 160,
            }}
          >
            <p className="text-xs text-foreground font-medium">
              {new Date(hovered.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
            <p className={cn("text-sm font-semibold tabular-nums mt-0.5", hovered.pnl >= 0 ? "text-[var(--profit)] glow-profit" : "text-[var(--loss)] glow-loss")}>
              {hovered.pnl >= 0 ? "+" : "-"}{formatCurrency(Math.abs(hovered.pnl))}
            </p>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
              <span>{hovered.trades} trades</span>
              <span>Win: {(hovered.winRate ?? 0) > 0 ? `${(hovered.winRate ?? 0).toFixed(0)}%` : "N/A"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
