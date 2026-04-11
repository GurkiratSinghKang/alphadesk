"use client";

import { useState, useEffect } from "react";
import { BarChart3 } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { getPnlCalendar, type CalendarDay } from "@/lib/api";

export function PnlCalendarMini() {
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [monthTotal, setMonthTotal] = useState(0);

  useEffect(() => {
    getPnlCalendar().then((data) => {
      setDays(data.days);
      setMonthTotal(data.monthTotal);
    }).catch(() => {});
  }, []);

  if (days.length === 0) return null;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = now.toLocaleString("en-US", { month: "long" });

  // Build a map of date -> pnl
  const pnlMap = new Map(days.map((d) => [d.date, d.pnl]));

  const cells: { day: number; pnl: number | null }[] = [];
  // Empty leading cells
  for (let i = 0; i < firstDay; i++) cells.push({ day: 0, pnl: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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
      <div className="p-3">
        <div className="grid grid-cols-7 gap-1">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="text-center text-[9px] font-medium text-muted-foreground py-0.5">{d}</div>
          ))}
          {cells.map((cell, i) => {
            if (cell.day === 0) return <div key={`e-${i}`} />;
            const isToday = cell.day === now.getDate();
            const hasPnl = cell.pnl !== null;
            const positive = (cell.pnl ?? 0) >= 0;
            const intensity = hasPnl ? Math.min(Math.abs(cell.pnl!) / 500, 1) : 0;
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
                title={hasPnl ? `${cell.pnl! >= 0 ? "+" : ""}$${cell.pnl!.toFixed(0)}` : undefined}
              >
                <span className={cn("font-medium", hasPnl ? "text-white" : "text-muted-foreground")}>{cell.day}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
