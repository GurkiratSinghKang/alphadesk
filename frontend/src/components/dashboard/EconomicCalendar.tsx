"use client";

import { Calendar, Info } from "lucide-react";

/**
 * EconomicCalendar
 * ────────────────
 * Honest empty state. Historically this component shipped hardcoded forecast
 * numbers (e.g. "CPI 2.4%", "NFP 155K") with a small "Demo Data" badge —
 * audit P0-6 flagged those as indistinguishable from live macro consensus.
 *
 * We now render editorial prose describing the cadence of the recurring
 * events we *would* surface if a calendar API were wired, and never invent
 * forecast/previous values. When a provider is connected (e.g. FMP
 * `/stable/economic-calendar` via a backend proxy), replace this empty
 * state with a live list.
 */

interface RecurringEvent {
  name: string;
  cadence: string;
}

const RECURRING_EVENTS: RecurringEvent[] = [
  { name: "FOMC Rate Decision", cadence: "Eight scheduled meetings per year · 2:00 PM ET" },
  { name: "Non-Farm Payrolls", cadence: "First Friday of each month · 8:30 AM ET" },
  { name: "CPI (YoY)", cadence: "Second week of the month · 8:30 AM ET" },
  { name: "Core PCE Price Index", cadence: "Last week of the month · 8:30 AM ET" },
  { name: "Initial Jobless Claims", cadence: "Every Thursday · 8:30 AM ET" },
  { name: "GDP (QoQ)", cadence: "Quarterly · 8:30 AM ET" },
];

export function EconomicCalendar() {
  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Economic Calendar</h2>
        </div>
      </div>
      <div className="flex flex-col gap-4 px-4 py-5">
        <p className="font-display italic text-body-sm leading-relaxed text-muted-foreground">
          Economic calendar not configured. The cadence of the recurring
          releases we track is listed below &mdash; no forecast or previous
          numbers are shown until a provider is connected.
        </p>
        <ul className="divide-y divide-border/60">
          {RECURRING_EVENTS.map((evt) => (
            <li key={evt.name} className="flex items-center justify-between py-2">
              <span className="text-label font-medium text-foreground">{evt.name}</span>
              <span className="font-sans text-label uppercase tracking-[0.14em] text-muted-foreground">
                {evt.cadence}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-1.5 border-t border-border px-4 py-2">
        <Info className="h-3 w-3 shrink-0 text-muted-foreground" />
        <p className="text-label text-muted-foreground">
          Connect an economic calendar API to populate forecast and actual values.
        </p>
      </div>
    </div>
  );
}
