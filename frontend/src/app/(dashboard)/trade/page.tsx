"use client";

import { useEffect, useCallback } from "react";
import { WatchlistPanel } from "@/components/panels/WatchlistPanel";
import { ChartPanel } from "@/components/panels/ChartPanel";
import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { OptionsPanel } from "@/components/panels/OptionsPanel";
import { TradePanel } from "@/components/panels/TradePanel";
import type { TimeFrame } from "@/types";

const TOPBAR_H = 48; // px - matches TopBar h-12
const WATCHLIST_W = 240;
const ANALYSIS_W = 300;
const BOTTOM_H = 260;
const TRADE_PANEL_W = 380;

export default function TradePage() {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const tfMap: Record<string, TimeFrame> = {
        "1": "1m", "2": "5m", "3": "15m", "4": "1H",
        "5": "4H", "6": "D", "7": "W", "8": "M",
      };
      if (tfMap[e.key]) {
        window.dispatchEvent(
          new CustomEvent("timeframeChange", { detail: { timeframe: tfMap[e.key] } })
        );
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Use calc() with viewport units for guaranteed sizing
  const totalH = `calc(100vh - ${TOPBAR_H}px)`;
  const topRowH = `calc(100vh - ${TOPBAR_H}px - ${BOTTOM_H}px)`;
  const chartW = `calc(100vw - ${WATCHLIST_W}px - ${ANALYSIS_W}px)`;
  const optionsW = `calc(100vw - ${TRADE_PANEL_W}px)`;

  return (
    <div style={{ width: "100vw", height: totalH, overflow: "hidden", position: "relative" }}>
      {/* ── Top Row ── */}

      {/* Watchlist */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: WATCHLIST_W,
          height: topRowH,
          overflow: "auto",
          borderRight: "1px solid #3a3a5e",
          background: "var(--panel)",
        }}
      >
        <WatchlistPanel />
      </div>

      {/* Chart — z-index 1 (behind other panels) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: WATCHLIST_W,
          width: chartW,
          height: topRowH,
          overflow: "hidden",
          zIndex: 1,
        }}
      >
        <ChartPanel />
      </div>

      {/* Analysis — z-index 10 (above chart) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: ANALYSIS_W,
          height: topRowH,
          overflow: "auto",
          borderLeft: "1px solid #3a3a5e",
          zIndex: 10,
          background: "var(--panel)",
        }}
      >
        <AnalysisPanel />
      </div>

      {/* ── Bottom Row — z-index 10 (above chart) ── */}

      {/* Options Chain */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: optionsW,
          height: BOTTOM_H,
          overflow: "auto",
          borderTop: "1px solid #3a3a5e",
          zIndex: 10,
          background: "var(--panel)",
        }}
      >
        <OptionsPanel />
      </div>

      {/* Trade Panel */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          width: TRADE_PANEL_W,
          height: BOTTOM_H,
          overflow: "auto",
          borderTop: "1px solid #3a3a5e",
          borderLeft: "1px solid #3a3a5e",
          zIndex: 10,
          background: "var(--panel)",
        }}
      >
        <TradePanel />
      </div>
    </div>
  );
}
