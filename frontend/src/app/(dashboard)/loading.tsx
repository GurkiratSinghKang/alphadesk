export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6 max-w-[1800px] mx-auto">
      {/* Portfolio Hero skeleton */}
      <div className="h-[200px] rounded-xl bg-surface animate-pulse" />
      {/* Grid skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 h-[320px] rounded-xl bg-surface animate-pulse" />
        <div className="lg:col-span-2 h-[320px] rounded-xl bg-surface animate-pulse" />
      </div>
      {/* Bottom row skeleton */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="h-[280px] rounded-xl bg-surface animate-pulse" />
        <div className="h-[280px] rounded-xl bg-surface animate-pulse" />
      </div>
    </div>
  );
}
