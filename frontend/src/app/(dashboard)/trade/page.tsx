"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { WatchlistPanel } from "@/components/panels/WatchlistPanel";
import { ChartPanel } from "@/components/panels/ChartPanel";
import { LayoutSelector, type ChartLayout } from "@/components/panels/LayoutSelector";
import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { OptionsPanel } from "@/components/panels/OptionsPanel";
import { TradePanel } from "@/components/panels/TradePanel";

// TopBar h-11 (44px) + StatusStrip h-7 (28px) = 72px
const TOPBAR_H = 72;
const WATCHLIST_W = 240;
const ANALYSIS_W = 300;
const TRADE_PANEL_W = 380;

const CHART_LAYOUT_KEY = "alphadesk-chart-layout";

export default function TradePage() {
  const [optionsPanelHeight, setOptionsPanelHeight] = useState(250);
  const [optionsFullScreen, setOptionsFullScreen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chart' | 'watchlist' | 'analysis' | 'order'>('chart');
  const [chartLayout, setChartLayout] = useState<ChartLayout>(() => {
    if (typeof window === "undefined") return "1x1";
    const stored = localStorage.getItem(CHART_LAYOUT_KEY);
    if (stored && ["1x1", "2x1", "1x2", "2x2"].includes(stored)) return stored as ChartLayout;
    return "1x1";
  });
  const [chartSymbols, setChartSymbols] = useState<string[]>(["SPY"]);

  // Persist chart layout preference
  useEffect(() => {
    localStorage.setItem(CHART_LAYOUT_KEY, chartLayout);
  }, [chartLayout]);

  const chartCount = chartLayout === "2x2" ? 4 : chartLayout === "1x1" ? 1 : 2;
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Timeframe shortcuts 1-8 are handled globally by useKeyboardShortcuts,
  // which dispatches alphadesk:shortcut events consumed by ChartPanel.

  // Listen for chart layout changes dispatched by ChartPanel's LayoutSelector
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ layout: ChartLayout }>).detail;
      if (detail?.layout) setChartLayout(detail.layout);
    };
    window.addEventListener("alphadesk:chart-layout", handler);
    return () => window.removeEventListener("alphadesk:chart-layout", handler);
  }, []);

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

  const mobileTabs = ['chart', 'watchlist', 'analysis', 'order'] as const;

  return (
    <>
      {/* ── Mobile tab bar — visible below lg ── */}
      <div className="flex lg:hidden border-b border-border bg-[var(--panel)]">
        {mobileTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`flex-1 px-3 py-2 text-xs font-medium capitalize transition-colors ${
              mobileTab === tab
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Mobile layout — visible below lg ── */}
      <div className="lg:hidden flex-1 min-h-0 overflow-auto" style={{ height: totalH }}>
        {mobileTab === 'chart' && <ChartPanel />}
        {mobileTab === 'watchlist' && <WatchlistPanel />}
        {mobileTab === 'analysis' && <AnalysisPanel />}
        {mobileTab === 'order' && <TradePanel />}
      </div>

      {/* ── Desktop layout — hidden below lg ── */}
      <div className="hidden lg:block" style={{ width: "100%", height: totalH, overflow: "hidden", position: "relative" }}>
        <h1 className="sr-only">Trade</h1>

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
                borderRight: "1px solid var(--border)",
                background: "var(--panel)",
              }}
            >
              <WatchlistPanel />
            </div>

            {/* Chart area — z-index 1 (behind other panels) */}
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
              {/* Layout selector overlay — top-right of chart area */}
              {chartLayout !== "1x1" && (
                <div className="absolute top-1 right-1 z-20">
                  <LayoutSelector layout={chartLayout} onLayoutChange={setChartLayout} />
                </div>
              )}
              {chartLayout === "1x1" ? (
                <ChartPanel />
              ) : (
                <div
                  className="grid h-full w-full"
                  style={{
                    gridTemplateColumns: chartLayout === "2x1" || chartLayout === "2x2" ? "1fr 1fr" : "1fr",
                    gridTemplateRows: chartLayout === "1x2" || chartLayout === "2x2" ? "1fr 1fr" : "1fr",
                    gap: 1,
                  }}
                >
                  {Array.from({ length: chartCount }).map((_, i) => (
                    <div
                      key={`chart-${i}`}
                      className="min-h-0 min-w-0 overflow-hidden"
                      style={{
                        borderRight: (chartLayout === "2x1" || chartLayout === "2x2") && i % 2 === 0 ? "1px solid var(--border)" : undefined,
                        borderBottom: (chartLayout === "1x2" || chartLayout === "2x2") && i < 2 && chartLayout === "2x2" ? "1px solid var(--border)" : chartLayout === "1x2" && i === 0 ? "1px solid var(--border)" : undefined,
                      }}
                    >
                      <ChartPanel
                        symbol={chartSymbols[i] || "SPY"}
                        onSymbolChange={(sym) => {
                          setChartSymbols((prev) => {
                            const next = [...prev];
                            while (next.length <= i) next.push("SPY");
                            next[i] = sym;
                            return next;
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
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
                borderLeft: "1px solid var(--border)",
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
            minHeight: 200,
            overflow: "auto",
            borderTop: optionsFullScreen ? "none" : "1px solid var(--border)",
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
            borderTop: optionsFullScreen ? "none" : "1px solid var(--border)",
            borderLeft: "1px solid var(--border)",
            zIndex: 10,
            background: "var(--panel)",
          }}
        >
          <TradePanel />
        </div>
      </div>
    </>
  );
}
