"use client";

const CARDS = Array.from({ length: 4 }, (_, i) => i);

export function StrategyReverseLookupStub() {
  return (
    <section
      id="strategies"
      data-testid="strategy-reverse-lookup-stub"
      data-slot="strategy-reverse-lookup-stub"
      className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24 mx-4 sm:mx-6 mb-6"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="t-label u-muted">STRATEGIES</h2>
        <span className="t-mono text-label u-muted">Coming soon</span>
      </header>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CARDS.map((i) => (
          <div key={i} className="h-24 w-full rounded-sm bg-bg" data-slot="ghost-card" />
        ))}
      </div>
    </section>
  );
}

export default StrategyReverseLookupStub;
