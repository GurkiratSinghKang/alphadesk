// _earnings/EarningsCalendarSidebar.tsx — stub; real impl in Task 13
import type { CalendarRow } from "@/types";
export default function EarningsCalendarSidebar(props: {
  rows: CalendarRow[]; loading: boolean; error: string | null;
  selected: string | null; onSelect: (symbol: string) => void;
}) {
  return (
    <aside data-slot="earnings-calendar-sidebar">
      {props.rows.map(r => (
        <button key={r.symbol} onClick={() => props.onSelect(r.symbol)}>{r.symbol}</button>
      ))}
    </aside>
  );
}
