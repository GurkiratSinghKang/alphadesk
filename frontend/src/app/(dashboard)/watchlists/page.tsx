import type { Metadata } from "next";

import WatchlistsClient from "./WatchlistsClient";

export const metadata: Metadata = {
  title: "Watchlists — AlphaDesk",
  description:
    "Multiple named lists, custom columns, per-strategy auto-populated lists, sharing.",
};

export const dynamic = "force-dynamic";

export default function WatchlistsPage() {
  return <WatchlistsClient />;
}
