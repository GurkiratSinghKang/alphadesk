"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

import { TopBar } from "@/components/layout/TopBar";
import V2DashHero from "./_v2/V2DashHero";
import V2BriefingStrip from "./_v2/V2BriefingStrip";
import V2BodyGrid from "./_v2/V2BodyGrid";
// v2-plan §2.2 — "agents running right now" strip. Sits between the
// briefing strip and the body grid; renders nothing when no agents
// are running so the dashboard stays calm in the quiet state.
import V2AgentsRunningStrip from "./_v2/V2AgentsRunningStrip";

/**
 * AlphaDesk v2 dashboard — editorial operating picture.
 *
 * Layout matches /tmp/alphadesk-design/alphadesk-v2/project/dashboard.jsx:
 *   1. Hero band (3 columns: Portfolio · Market regime · Book) on --ink-100
 *   2. "Since you last logged in" briefing strip
 *   3. 3-column body (Market · Watchlist · Positions)
 *   4. 2-column row (Strategies · Alerts) underneath
 *
 * The route-group layout (`(dashboard)/layout.tsx`) handles banners +
 * overlays for "/" but does NOT mount TopBar (the desk-route branch
 * expects the page to bring its own). We mount it here at the top of
 * the page so the v2 layout looks complete.
 */
export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    const onRefresh = () => {};
    window.addEventListener("alphadesk:refresh", onRefresh);
    return () => window.removeEventListener("alphadesk:refresh", onRefresh);
  }, []);

  const onPickTicker = useCallback(
    (sym: string) => router.push(`/symbols/${sym}`),
    [router],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <TopBar />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
        }}
      >
        <V2DashHero />
        <V2BriefingStrip />
        <V2AgentsRunningStrip />
        <V2BodyGrid onPickTicker={onPickTicker} />
      </div>
    </div>
  );
}
