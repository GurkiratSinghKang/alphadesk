"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { WatchlistPanel } from "@/components/panels/WatchlistPanel";
import { ChartPanel } from "@/components/panels/ChartPanel";
import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { OptionsPanel } from "@/components/panels/OptionsPanel";
import { TradePanel } from "@/components/panels/TradePanel";
import type { TimeFrame } from "@/types";

const TOPBAR_H = 72; // px - TopBar h-11 (44px) + StatusStrip h-7 (28px)
const WATCHLIST_W = 240;
const ANALYSIS_W = 300;
const TRADE_PANEL_W = 380;

export default function TradePage() {
  const [optionsPanelHeight, setOptionsPanelHeight] = useState(250);
  const [optionsFullScreen, setOptionsFullScreen] = useState(false);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

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

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = optionsPanelHeight;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [optionsPanelHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY.current - e.clientY;
      const newHeight = Math.max(100, Math.min(window.innerHeight * 0.7, startHeight.current + delta));
      setOptionsPanelHeight(newHeight);
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Use calc() with viewport units for guaranteed sizing
  const totalH = `calc(100vh - ${TOPBAR_H}px)`;
  const topRowH = `calc(100vh - ${TOPBAR_H}px - ${optionsPanelHeight}px - 6px)`; // 6px = drag handle
  const chartW = `calc(100vw - ${WATCHLIST_W}px - ${ANALYSIS_W}px)`;
  const optionsW = `calc(100vw - ${TRADE_PANEL_W}px)`;

  // Full-screen toggle button (rendered inside each bottom panel container)
  const fullScreenToggle = (
    <button
      onClick={() => setOptionsFullScreen(!optionsFullScreen)}
      className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
      title={optionsFullScreen ? "Exit full screen" : "Full screen"}
      style={{
        position: "absolute",
        top: 10,
        right: 8,
        zIndex: 20,
        background: "transparent",
        border: "none",
        cursor: "pointer",
      }}
    >
      {optionsFullScreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
    </button>
  );

  return (
    <div style={{ width: "100vw", height: totalH, overflow: "hidden", position: "relative" }}>

      {/* ── Top Row (hidden in full-screen mode) ── */}
      {!optionsFullScreen && (
        <>
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
        </>
      )}

      {/* ── Drag Handle ── */}
      {!optionsFullScreen && (
        <div
          onMouseDown={handleDragStart}
          style={{
            position: "absolute",
            bottom: optionsPanelHeight,
            left: 0,
            width: "100%",
            height: 6,
            zIndex: 20,
          }}
          className="cursor-row-resize bg-border/50 hover:bg-primary/30 transition-colors flex items-center justify-center"
        >
          <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30" />
        </div>
      )}

      {/* ── Bottom Row — z-index 10 (above chart) ── */}

      {/* Options Chain */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: optionsW,
          height: optionsFullScreen ? totalH : optionsPanelHeight,
          overflow: "auto",
          borderTop: optionsFullScreen ? "none" : "1px solid #3a3a5e",
          zIndex: 10,
          background: "var(--panel)",
        }}
      >
        <OptionsPanel />
        {fullScreenToggle}
      </div>

      {/* Trade Panel */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          width: TRADE_PANEL_W,
          height: optionsFullScreen ? totalH : optionsPanelHeight,
          overflow: "auto",
          borderTop: optionsFullScreen ? "none" : "1px solid #3a3a5e",
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
