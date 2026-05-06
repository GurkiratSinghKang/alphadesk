"use client";

const CELLS = Array.from({ length: 8 }, (_, i) => i);

export function KeyStatsStub() {
  return (
    <section
      id="key-stats"
      data-testid="key-stats-stub"
      data-slot="key-stats-stub"
      className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24"
    >
      <p className="t-label u-muted">Fundamentals</p>
      <p className="mt-1 t-mono text-body-sm u-muted">Coming soon</p>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {CELLS.map((i) => (
          <div key={i} className="rounded-sm bg-bg p-2">
            <div className="h-2 w-12 rounded-sm bg-fg-muted/30" />
            <div className="mt-2 h-3 w-16 rounded-sm bg-fg-muted/30" />
          </div>
        ))}
      </dl>
    </section>
  );
}

export default KeyStatsStub;
