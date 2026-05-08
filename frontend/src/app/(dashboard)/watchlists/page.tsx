import type { Metadata } from "next";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";

export const metadata: Metadata = {
  title: "Watchlists — AlphaDesk",
  description: "First-class multi-list watchlist surface — Phase 1.8.",
};

export default function WatchlistsShell() {
  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
      <Section
        eyebrow="WATCHLISTS · YOUR BENCH OF NAMES"
        title="Watchlists"
        description="Multiple named lists, custom columns, per-strategy auto-populated lists, sharing. Phase 1.8."
        level={1}
      >
        <EmptyState
          eyebrow="COMING SOON"
          title="The first-class watchlist page ships in Phase 1.8."
          description="Until then, the existing Watchlist composite remains embedded in the dashboard panel. The `g w` chord and the new top-bar nav already target this slug."
          action={{ label: "Open dashboard panel", onClick: () => { window.location.href = "/"; } }}
        />
      </Section>
    </main>
  );
}
