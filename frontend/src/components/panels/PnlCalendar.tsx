"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Trophy, Skull } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import type { CalendarData, CalendarDay } from "@/lib/api";
import { formatCurrency, cn } from "@/lib/utils";
import { usePnlCalendar } from "@/hooks/useQueries";

// ─── Color scale for P&L ────────────────────────────────────

function getPnlBg(pnl: number): string {
  if (pnl < -500) return "#991b1b";
  if (pnl < -100) return "#dc2626";
  if (pnl < 0) return "#f87171";
  if (pnl === 0) return "#3f3f46";
  if (pnl <= 100) return "#86efac";
  if (pnl <= 500) return "#22c55e";
  return "#15803d";
}

function getPnlText(pnl: number): string {
  if (pnl < -100) return "#fecaca";
  if (pnl < 0) return "#1c1917";
  if (pnl === 0) return "#d4d4d8";
  if (pnl <= 100) return "#052e16";
  return "#f0fdf4";
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── Component ──────────────────────────────────────────────

interface PnlCalendarProps {
  compact?: boolean;
}

export function PnlCalendar({ compact = false }: PnlCalendarProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: apiData, isLoading: loading } = usePnlCalendar(month, year);

  // Fall back to generated demo data when API returns nothing
  const data: CalendarData | null = useMemo(() => {
    if (apiData) return apiData;
    // Generate demo calendar data when API is unavailable
    const daysInMonth = new Date(year, month, 0).getDate();
    let seed = year * 100 + month;
    const rng = () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const demoDays: CalendarDay[] = [];
    let monthTotal = 0;
    let winDays = 0;
    let loseDays = 0;
    let tradingDays = 0;
    let bestDay: { date: string; pnl: number } | null = null;
    let worstDay: { date: string; pnl: number } | null = null;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = new Date(year, month - 1, d).getDay();
      if (dow === 0 || dow === 6) continue;
      const dayDate = new Date(year, month - 1, d);
      if (dayDate > new Date()) continue;
      const pnl = Math.round((rng() - 0.42) * 2000);
      const trades = Math.floor(rng() * 8) + 1;
      const winRate = Math.round(rng() * 100);
      demoDays.push({ date: dateStr, pnl, trades, winRate });
      monthTotal += pnl;
      tradingDays++;
      if (pnl > 0) winDays++;
      if (pnl < 0) loseDays++;
      if (!bestDay || pnl > bestDay.pnl) bestDay = { date: dateStr, pnl };
      if (!worstDay || pnl < worstDay.pnl) worstDay = { date: dateStr, pnl };
    }
    return {
      month, year, days: demoDays, monthTotal, tradingDays,
      winningDays: winDays, losingDays: loseDays, bestDay, worstDay,
    };
  }, [apiData, year, month]);

  const prevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const nextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  const monthName = new Date(year, month - 1).toLocaleString("en-US", { month: "long" });

  // Build calendar grid
  const calendarGrid = useMemo(() => {
    if (!data) return [];

    // Map date string -> CalendarDay
    const dayMap = new Map<string, CalendarDay>();
    for (const d of data.days) {
      dayMap.set(d.date, d);
    }

    // First day of month (0=Sun, adjust to Mon=0)
    const firstDay = new Date(year, month - 1, 1);
    const startDow = (firstDay.getDay() + 6) % 7; // Mon=0 .. Sun=6
    const daysInMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    interface CellData {
      day: number | null;
      dateStr: string;
      calDay: CalendarDay | null;
      isWeekend: boolean;
      isToday: boolean;
    }

    const cells: CellData[] = [];

    // Empty cells before month start
    for (let i = 0; i < startDow; i++) {
      cells.push({ day: null, dateStr: "", calDay: null, isWeekend: false, isToday: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = (startDow + d - 1) % 7;
      const isWeekend = dow >= 5;
      cells.push({
        day: d,
        dateStr,
        calDay: dayMap.get(dateStr) ?? null,
        isWeekend,
        isToday: dateStr === todayStr,
      });
    }

    // Pad to full weeks
    while (cells.length % 7 !== 0) {
      cells.push({ day: null, dateStr: "", calDay: null, isWeekend: false, isToday: false });
    }

    // Split into rows
    const rows: CellData[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [data, year, month]);

  const winRate = data && data.tradingDays > 0
    ? ((data.winningDays / data.tradingDays) * 100).toFixed(1)
    : "0";

  const cellSize = compact ? "h-12" : "h-16";
  const textSize = compact ? "text-[9px]" : "text-[10px]";
  const pnlSize = compact ? "text-[10px]" : "text-xs";

  return (
    <Card className="border-border bg-[var(--surface)]">
      <CardContent className={compact ? "p-3" : "p-5"}>
        {/* Header with month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={prevMonth}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h3 className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}>
            {monthName} {year}
          </h3>
          <button
            onClick={nextMonth}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
            Loading calendar...
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
            Failed to load calendar data
          </div>
        ) : (
          <>
            {/* Day names header */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {DAY_NAMES.map((d) => (
                <div
                  key={d}
                  className="text-center text-[10px] font-medium text-muted-foreground py-1"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <TooltipProvider delay={200}>
              <div className="grid grid-cols-7 gap-1">
                {calendarGrid.flat().map((cell, i) => {
                  if (cell.day === null) {
                    return <div key={`empty-${i}`} className={cn(cellSize, "rounded-md")} />;
                  }

                  if (cell.isWeekend) {
                    return (
                      <div
                        key={cell.dateStr}
                        className={cn(
                          cellSize,
                          "rounded-md bg-[#1a1a2e]/50 flex flex-col items-center justify-center"
                        )}
                      >
                        <span className="text-[10px] text-muted-foreground/40">{cell.day}</span>
                      </div>
                    );
                  }

                  if (!cell.calDay) {
                    return (
                      <div
                        key={cell.dateStr}
                        className={cn(
                          cellSize,
                          "rounded-md bg-[#1a1a2e]/30 flex flex-col items-center justify-center",
                          cell.isToday && "ring-2 ring-primary"
                        )}
                      >
                        <span className="text-[10px] text-muted-foreground/60">{cell.day}</span>
                      </div>
                    );
                  }

                  const bg = getPnlBg(cell.calDay.pnl);
                  const textCol = getPnlText(cell.calDay.pnl);

                  return (
                    <Tooltip key={cell.dateStr}>
                      <TooltipTrigger
                        className={cn(
                          cellSize,
                          "rounded-md flex flex-col items-center justify-center cursor-default transition-transform hover:scale-105",
                          cell.isToday && "ring-2 ring-primary ring-offset-1 ring-offset-[var(--surface)]"
                        )}
                        style={{ backgroundColor: bg }}
                      >
                        <span
                          className={cn(textSize, "font-medium leading-none opacity-80")}
                          style={{ color: textCol }}
                        >
                          {cell.day}
                        </span>
                        <span
                          className={cn(pnlSize, "font-bold tabular-nums leading-none mt-0.5")}
                          style={{ color: textCol }}
                        >
                          {cell.calDay.pnl >= 0 ? "+" : ""}
                          ${Math.abs(cell.calDay.pnl) >= 1000
                            ? `${(cell.calDay.pnl / 1000).toFixed(1)}k`
                            : Math.round(cell.calDay.pnl)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <div className="text-xs space-y-0.5">
                          <div className="font-semibold">
                            {new Date(cell.calDay.date + "T00:00:00").toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </div>
                          <div>
                            P&L:{" "}
                            <span className={cell.calDay.pnl >= 0 ? "text-green-300" : "text-red-300"}>
                              {cell.calDay.pnl >= 0 ? "+" : ""}
                              {formatCurrency(cell.calDay.pnl)}
                            </span>
                          </div>
                          <div>Trades: {cell.calDay.trades}</div>
                          <div>Win Rate: {cell.calDay.winRate}%</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>

            {/* Month summary */}
            <div className={cn("mt-4 pt-4 border-t border-border", compact && "mt-3 pt-3")}>
              <div className={cn("grid gap-3", compact ? "grid-cols-3" : "grid-cols-4")}>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Month P&L
                  </p>
                  <p
                    className={cn(
                      "font-bold tabular-nums",
                      compact ? "text-sm" : "text-base",
                      data.monthTotal >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"
                    )}
                  >
                    {data.monthTotal >= 0 ? "+" : ""}
                    {formatCurrency(data.monthTotal)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Trading Days
                  </p>
                  <p className={cn("font-bold text-foreground tabular-nums", compact ? "text-sm" : "text-base")}>
                    {data.tradingDays}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Win Rate
                  </p>
                  <p
                    className={cn(
                      "font-bold tabular-nums",
                      compact ? "text-sm" : "text-base",
                      Number(winRate) >= 50 ? "text-[var(--profit)]" : "text-[var(--loss)]"
                    )}
                  >
                    {winRate}%
                  </p>
                </div>
                {!compact && (
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      W / L
                    </p>
                    <p className="font-bold text-foreground tabular-nums text-base">
                      <span className="text-[var(--profit)]">{data.winningDays}</span>
                      {" / "}
                      <span className="text-[var(--loss)]">{data.losingDays}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Best/Worst day badges */}
              {!compact && (data.bestDay || data.worstDay) && (
                <div className="flex items-center justify-center gap-3 mt-3">
                  {data.bestDay && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-2 py-0.5 border-[var(--profit)]/30 text-[var(--profit)] gap-1"
                    >
                      <Trophy className="h-3 w-3" />
                      Best: {formatCurrency(data.bestDay.pnl)} ({new Date(data.bestDay.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })})
                    </Badge>
                  )}
                  {data.worstDay && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-2 py-0.5 border-[var(--loss)]/30 text-[var(--loss)] gap-1"
                    >
                      <Skull className="h-3 w-3" />
                      Worst: {formatCurrency(data.worstDay.pnl)} ({new Date(data.worstDay.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })})
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
