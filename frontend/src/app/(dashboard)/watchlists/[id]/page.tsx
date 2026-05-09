import type { Metadata } from "next";

import Section from "@/components/composites/Section";
import EmptyState from "@/components/primitives/EmptyState";

export const metadata: Metadata = {
  title: "Watchlist detail — AlphaDesk",
};

// Dashboard layout's useNotifications() requires <WebSocketProvider>,
// which is ssr:false. Skip static prerender.
export const dynamic = "force-dynamic";

interface WatchlistDetailShellProps {
  params: Promise<{ id: string }>;
}

export default async function WatchlistDetailShell({
  params,
}: WatchlistDetailShellProps) {
  const { id } = await params;
  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto">
      <Section
        eyebrow={`WATCHLIST · ${id.toUpperCase()}`}
        title="Watchlist detail"
        description="Custom columns, drag-reorder, share token. Ships in Phase 1.8."
        level={1}
      >
        <EmptyState
          eyebrow="COMING SOON"
          title="Per-watchlist detail view lands in Phase 1.8."
          description="~30-column picker, per-strategy auto-populate, share-token visibility, inline action cells (open Symbol, open Trade, set alert)."
        />
      </Section>
    </main>
  );
}
