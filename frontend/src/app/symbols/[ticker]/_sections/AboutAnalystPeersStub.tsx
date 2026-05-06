"use client";

const PANELS = ["About", "Analyst ratings", "Peers"] as const;

export function AboutAnalystPeersStub() {
  return (
    <section
      id="about"
      data-testid="about-analyst-peers-stub"
      data-slot="about-analyst-peers-stub"
      className="grid grid-cols-1 gap-4 lg:grid-cols-3 scroll-mt-24 mx-4 sm:mx-6 mb-6"
    >
      {PANELS.map((label) => (
        <article
          key={label}
          data-slot="about-panel"
          className="rounded-md border border-border-hair bg-bg-elev-1 p-4"
        >
          <header className="flex items-baseline justify-between">
            <h3 className="t-label u-muted">{label.toUpperCase()}</h3>
            <span className="t-mono text-label u-muted">Coming soon</span>
          </header>
          <div className="mt-4 h-40 rounded-sm bg-bg" data-slot="ghost-card" />
        </article>
      ))}
    </section>
  );
}

export default AboutAnalystPeersStub;
