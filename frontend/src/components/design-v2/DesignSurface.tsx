'use client';

import dynamic from "next/dynamic";
import type { AlphaDeskDesignPage } from "./AlphaDeskDesign";

const AlphaDeskDesignApp = dynamic(() => import("./AlphaDeskDesign"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-bg" />,
});

/**
 * DesignSurface — wraps the v2 visual mock.
 *
 * 2026-05-10 sizing fix: previously used `h-dvh min-h-dvh`, which
 * forced the surface to 100vh even when nested inside a layout that
 * already reserves vertical space for chrome (banners, BottomTabBar
 * safe-area, etc.). After we re-mounted `DashboardRuntimeLayout` for
 * the design-surface routes (so the WS provider, useNotifications,
 * banners, CommandPalette, JarvisBar, etc. come back), we need the
 * inner surface to size against its parent's `flex-1 min-h-0` slot
 * instead of the raw viewport. Switched to `h-full` to play nicely
 * inside the desk-route flex column.
 */
export default function DesignSurface({
  page,
  symbol = "NVDA",
  strategyName = "Momentum & Quality",
}: {
  page: AlphaDeskDesignPage;
  symbol?: string;
  strategyName?: string;
}) {
  return (
    <div
      className="h-full min-h-0 w-full overflow-hidden bg-bg text-fg"
      data-design-surface={page}
    >
      <AlphaDeskDesignApp initialPage={page} initialSymbol={symbol} initialStrategy={strategyName} />
    </div>
  );
}
