"use client";

import { useState, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CalendarEvent {
  date: string;
  time: string;
  event: string;
  impact: "high" | "medium" | "low";
  actual?: string;
  forecast?: string;
  previous?: string;
}

// Generate events relative to today for demo purposes
function generateUpcomingEvents(): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const now = new Date();

  const templates = [
    { event: "FOMC Meeting Minutes", impact: "high" as const, time: "2:00 PM" },
    { event: "Non-Farm Payrolls", impact: "high" as const, time: "8:30 AM" },
    { event: "CPI (YoY)", impact: "high" as const, time: "8:30 AM", forecast: "3.2%", previous: "3.4%" },
    { event: "Initial Jobless Claims", impact: "medium" as const, time: "8:30 AM", forecast: "215K", previous: "210K" },
    { event: "Retail Sales (MoM)", impact: "medium" as const, time: "8:30 AM", forecast: "0.3%", previous: "0.2%" },
    { event: "Consumer Confidence", impact: "medium" as const, time: "10:00 AM", forecast: "104.5", previous: "103.8" },
    { event: "PMI Manufacturing", impact: "medium" as const, time: "9:45 AM", forecast: "52.1", previous: "51.8" },
    { event: "GDP (QoQ)", impact: "high" as const, time: "8:30 AM", forecast: "2.8%", previous: "3.1%" },
    { event: "Core PCE Price Index", impact: "high" as const, time: "8:30 AM", forecast: "2.6%", previous: "2.7%" },
    { event: "Housing Starts", impact: "low" as const, time: "8:30 AM" },
  ];

  const usedNames = new Set<string>();
  let templateIdx = 0;

  for (let i = 0; i < 14 && events.length < 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    // 1-2 events per trading day, skipping duplicates
    const count = i % 2 === 0 ? 2 : 1;
    let added = 0;
    while (added < count && templateIdx < templates.length) {
      const tmpl = templates[templateIdx];
      templateIdx++;
      if (usedNames.has(tmpl.event)) continue;
      usedNames.add(tmpl.event);
      events.push({
        date: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        time: tmpl.time,
        event: tmpl.event,
        impact: tmpl.impact,
        forecast: tmpl.forecast,
        previous: tmpl.previous,
      });
      added++;
    }
  }
  return events.slice(0, 8);
}

const impactColors = {
  high: "bg-[var(--loss)]/20 text-[var(--loss)]",
  medium: "bg-amber-500/20 text-amber-400",
  low: "bg-[var(--primary)]/20 text-[var(--primary)]",
};

const impactDot = {
  high: "bg-[var(--loss)]",
  medium: "bg-amber-500",
  low: "bg-[var(--primary)]",
};

const EVENT_DESCRIPTIONS: Record<string, string> = {
  "FOMC Meeting Minutes": "Federal Reserve policy decisions on interest rates. High impact on bonds, USD, and equities.",
  "Non-Farm Payrolls": "Monthly jobs report measuring employment changes excluding farm workers. Strong numbers signal economic strength and hawkish Fed expectations. High impact on all markets.",
  "CPI (YoY)": "Consumer Price Index measures year-over-year inflation. Above forecast readings increase rate hike expectations, pressuring equities and strengthening USD.",
  "Initial Jobless Claims": "Weekly count of new unemployment insurance claims. Rising claims signal labor market weakness. Watched as a leading recession indicator.",
  "Retail Sales (MoM)": "Monthly change in consumer spending at retail outlets. Reflects consumer confidence and spending trends. Stronger data supports growth expectations.",
  "Consumer Confidence": "Survey measuring household optimism about the economy. Higher confidence correlates with increased consumer spending and economic growth.",
  "PMI Manufacturing": "Purchasing Managers Index for manufacturing sector. Readings above 50 indicate expansion. A leading indicator of industrial activity and GDP.",
  "GDP (QoQ)": "Gross Domestic Product measures overall economic output quarter-over-quarter. The broadest measure of economic health. Major market mover.",
  "Core PCE Price Index": "The Fed's preferred inflation gauge, excluding food and energy. Directly influences monetary policy decisions. Critical for rate expectations.",
  "Housing Starts": "Number of new residential construction projects begun. Indicator of housing market health and broader economic activity.",
};

export function EconomicCalendar() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    setEvents(generateUpcomingEvents());
  }, []);

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Economic Calendar</h2>
        </div>
      </div>
      <div className="divide-y divide-border">
        {events.map((evt, i) => {
          const isExpanded = expandedIdx === i;
          const description = EVENT_DESCRIPTIONS[evt.event];
          return (
            <div key={i}>
              <div
                className="flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors hover:bg-accent/30"
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
              >
                <span className={cn("h-2 w-2 rounded-full shrink-0", impactDot[evt.impact])} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{evt.event}</p>
                  <p className="text-[10px] text-muted-foreground">{evt.date} · {evt.time}</p>
                </div>
                {evt.forecast && (
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-muted-foreground">Fcst: {evt.forecast}</p>
                    {evt.previous && <p className="text-[10px] text-muted-foreground">Prev: {evt.previous}</p>}
                  </div>
                )}
                <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded", impactColors[evt.impact])}>
                  {evt.impact}
                </span>
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
              </div>
              {isExpanded && description && (
                <div className="px-4 pb-3 pt-1 pl-9">
                  <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
