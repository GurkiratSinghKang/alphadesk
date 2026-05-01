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

// ─── ET date helpers ────────────────────────────────────────
//
// "Today" for a trader is the ET calendar day, not the browser's local
// day. After 20:00 PT on a weekday, local date is still Monday but ET
// is already Tuesday — the highlighted cell must follow ET.
// Using `Intl.DateTimeFormat` avoids the broken
// `new Date(toLocaleString(...))` round-trip.
function getETDateParts(now: Date = new Date()): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let year = 0, month = 0, day = 0;
  for (const p of formatter.formatToParts(now)) {
    if (p.type === "year") year = parseInt(p.value, 10);
    else if (p.type === "month") month = parseInt(p.value, 10);
    else if (p.type === "day") day = parseInt(p.value, 10);
  }
  return { year, month, day };
}

function getETTodayStr(now: Date = new Date()): string {
  const { year, month, day } = getETDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Color scale for P&L ────────────────────────────────────
//
// Reads the design-token palette so the calendar speaks the same
// language as PortfolioHero / StrategyGrid / MorningBrief. Six tiers:
// strong loss / mid loss / weak loss / neutral / weak gain / strong
// gain — composed from `--down-500` (coral) and `--up-500` (chartreuse)
// at graduated alpha. Text uses `--ink-1000` on strong cells (readable
// on a saturated bg) and the warm `--fg` on weak tints.
function getPnlBg(pnl: number): string {
  if (pnl < -500) return "rgb(from var(--down-500) r g b / 0.7)";
  if (pnl < -100) return "rgb(from var(--down-500) r g b / 0.45)";
  if (pnl < 0) return "rgb(from var(--down-500) r g b / 0.2)";
  if (pnl === 0) return "var(--bg-elev-2)";
  if (pnl <= 100) return "rgb(from var(--up-500) r g b / 0.22)";
  if (pnl <= 500) return "rgb(from var(--up-500) r g b / 0.5)";
  return "rgb(from var(--up-500) r g b / 0.75)";
}

function getPnlText(pnl: number): string {
  if (pnl < -100) return "var(--ink-1000)";
  if (pnl < 0) return "var(--fg)";
  if (pnl === 0) return "var(--fg-muted)";
  if (pnl <= 100) return "var(--fg)";
  return "var(--ink-000)";
}

const DAY_NAMES = ["M", "T", "W", "T", "F", "S", "S"];

// ─── Component ──────────────────────────────────────────────

interface PnlCalendarProps {
  compact?: boolean;
}

export function PnlCalendar({ compact = false }: PnlCalendarProps) {
  // Initialise the visible month/year from the ET calendar day so late-PT
  // / international users don't see tomorrow's or yesterday's month by
  // default. Local browser time would land the wrong month for roughly
  // 1 hour / day for a US-Pacific user near midnight ET.
  const et = getETDateParts();
  const [year, setYear] = useState(et.year);
  const [month, setMonth] = useState(et.month);

  const { data: apiData, isLoading: loading } = usePnlCalendar(month, year);

  // Use API data when available; show nothing (null) otherwise — no fake data generation
  const data: CalendarData | null = useMemo(() => {
    if (apiData) return apiData;
    return null;
  }, [apiData]);

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

    // Today = today in New York. Backend buckets day-PnL by ET too, so
    // the highlighted cell aligns with the server's data boundary.
    const todayStr = getETTodayStr();

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
  const textSize = compact ? "text-[12px]" : "text-[12px]";
  const pnlSize = compact ? "text-[12px]" : "text-xs";

  return (
    <Card className="border-border bg-[var(--surface)]">
      <CardContent className={compact ? "p-3" : "p-5"}>
        {/* Header with month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={prevMonth}
            className="flex h-7 w-7 min-w-[28px] flex-shrink-0 items-center justify-center rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h3 className={cn("font-semibold text-foreground truncate", compact ? "text-sm" : "text-base")}>
            {monthName} {year}
          </h3>
          <button
            onClick={nextMonth}
            className="flex h-7 w-7 min-w-[28px] flex-shrink-0 items-center justify-center rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="space-y-2 py-4">
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="h-12 rounded-md bg-muted/20 animate-pulse" />
              ))}
            </div>
          </div>
        ) : !data || data.days.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
            No trading data for this month
          </div>
        ) : (
          <>
            {/* Day names header */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {DAY_NAMES.map((d, i) => (
                <div
                  key={i}
                  className="text-center text-[12px] font-medium text-muted-foreground py-1"
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
                          "rounded-md bg-bg-elev-1 flex flex-col items-center justify-center"
                        )}
                      >
                        <span className="text-[12px] text-muted-foreground/40">{cell.day}</span>
                      </div>
                    );
                  }

                  if (!cell.calDay) {
                    return (
                      <div
                        key={cell.dateStr}
                        className={cn(
                          cellSize,
                          "rounded-md bg-bg-elev-1/70 flex flex-col items-center justify-center",
                          cell.isToday && "ring-2 ring-primary"
                        )}
                      >
                        <span className="text-[12px] text-muted-foreground/60">{cell.day}</span>
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
                            <span className={cell.calDay.pnl >= 0 ? "text-profit" : "text-loss"}>
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
                  <p className="text-[12px] text-muted-foreground uppercase tracking-wider">
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
                  <p className="text-[12px] text-muted-foreground uppercase tracking-wider">
                    Trading Days
                  </p>
                  <p className={cn("font-bold text-foreground tabular-nums", compact ? "text-sm" : "text-base")}>
                    {data.tradingDays}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[12px] text-muted-foreground uppercase tracking-wider">
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
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wider">
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
                      className="text-[12px] px-2 py-0.5 border-[var(--profit)]/30 text-[var(--profit)] gap-1"
                    >
                      <Trophy className="h-3 w-3" />
                      Best: {formatCurrency(data.bestDay.pnl)} ({new Date(data.bestDay.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })})
                    </Badge>
                  )}
                  {data.worstDay && (
                    <Badge
                      variant="outline"
                      className="text-[12px] px-2 py-0.5 border-[var(--loss)]/30 text-[var(--loss)] gap-1"
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
