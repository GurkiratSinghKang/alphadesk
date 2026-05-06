"use client";

export function AgentsDebateStub() {
  return (
    <section
      id="agents"
      data-testid="agents-debate-stub"
      data-slot="agents-debate-stub"
      className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="t-label u-muted">AGENTS DEBATE</h2>
        <span className="t-mono text-label u-muted">Coming soon</span>
      </header>
      <div className="mt-4 h-72 rounded-sm bg-bg" data-slot="ghost-card" />
    </section>
  );
}

export default AgentsDebateStub;
