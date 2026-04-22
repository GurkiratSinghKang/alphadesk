// _earnings/FiltersBar.tsx — stub; real impl in Task 12
import type { EarningsCalendarFilters } from "@/types";
export default function FiltersBar(_props: { filters: EarningsCalendarFilters; onChange: (f: EarningsCalendarFilters) => void }) {
  return <div data-slot="filters-bar" className="t-label">Filters</div>;
}
