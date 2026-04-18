export default function DashboardLoading() {
  // a11y audit r3 — WCAG 4.1.3: skeleton blocks were invisible to SR users.
  // Wrap in a labeled live region and include visually-hidden status copy so
  // AT announces "Loading dashboard" while the data arrives.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading dashboard"
      className="p-6 space-y-6 max-w-[1800px] mx-auto"
    >
      <span className="sr-only">Loading dashboard…</span>
      {/* Portfolio Hero skeleton */}
      <div aria-hidden="true" className="h-[200px] rounded-xl bg-surface animate-pulse" />
      {/* Grid skeleton */}
      <div aria-hidden="true" className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 h-[320px] rounded-xl bg-surface animate-pulse" />
        <div className="lg:col-span-2 h-[320px] rounded-xl bg-surface animate-pulse" />
      </div>
      {/* Bottom row skeleton */}
      <div aria-hidden="true" className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="h-[280px] rounded-xl bg-surface animate-pulse" />
        <div className="h-[280px] rounded-xl bg-surface animate-pulse" />
      </div>
    </div>
  );
}
