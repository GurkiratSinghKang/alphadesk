"use client";

import { useState, type ReactNode } from "react";

/**
 * V2TradeShell — 3-col grid matching the trade.jsx design:
 *   slim 30px left rail (collapsed by default) → 1fr center chart → 380px right rail.
 *
 * The shell handles only chrome — children own the data + business logic.
 * Left rail expands as a glassy 260px panel overlaid above the chart when
 * opened. Right rail collapses to a 36px vertical-text affordance when the
 * user wants the chart to fill the viewport.
 */
export interface V2TradeShellProps {
  /** Top metric strip — usually <MetricRibbon /> + <AssetTabSwitcher />. */
  topStrip: ReactNode;
  /** Left-rail content shown inside the glassy expanded panel. */
  leftRail: ReactNode;
  /** Center-pane content — TradeHeader + ChartToolbar + Chart + VolumeRail. */
  center: ReactNode;
  /** Right-rail content — AssetTabs + OrderBar + RiskPreview + AI memo. */
  rightRail: ReactNode;
  /** Label rendered vertically on the slim left rail. */
  leftRailLabel?: string;
}

export default function V2TradeShell({
  topStrip,
  leftRail,
  center,
  rightRail,
  leftRailLabel = "Order book · L2",
}: V2TradeShellProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(true);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--border)",
      }}
    >
      {topStrip}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `30px 1fr ${rightCollapsed ? "36px" : "380px"}`,
          gap: 1,
          flex: 1,
          minHeight: 0,
          position: "relative",
        }}
      >
        {/* LEFT — slim rail (always 30px); expanded panel overlays chart */}
        <aside
          style={{
            background: "var(--bg)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: 14,
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => setLeftCollapsed((c) => !c)}
            title={leftCollapsed ? "Open book" : "Collapse"}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 9,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "var(--fg-muted)",
              cursor: "pointer",
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              padding: "10px 0",
              background: "none",
              border: "none",
            }}
          >
            {leftCollapsed ? "▸" : "◂"} &nbsp; {leftRailLabel}
          </button>
        </aside>
        {!leftCollapsed && (
          <aside
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 31,
              width: 260,
              zIndex: 20,
              background: "var(--pill-bg, rgba(20,20,18,0.85))",
              backdropFilter: "blur(14px) saturate(140%)",
              WebkitBackdropFilter: "blur(14px) saturate(140%)",
              borderRight: "1px solid var(--border)",
              boxShadow: "var(--shadow-2, 0 12px 32px rgba(0,0,0,0.4))",
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                position: "sticky",
                top: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                background: "var(--pill-bg, rgba(20,20,18,0.85))",
                borderBottom: "1px solid var(--border-hair)",
                backdropFilter: "blur(8px)",
              }}
            >
              <span className="t-label" style={{ fontSize: 8.5 }}>
                {leftRailLabel}
              </span>
              <button
                type="button"
                onClick={() => setLeftCollapsed(true)}
                title="Collapse"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 9,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--fg-muted)",
                  cursor: "pointer",
                  padding: "2px 6px",
                  border: "1px solid var(--border-hair)",
                  borderRadius: 2,
                  background: "none",
                }}
              >
                ◂ close
              </button>
            </div>
            {leftRail}
          </aside>
        )}

        {/* CENTER — chart hero */}
        <section
          style={{
            background: "var(--bg)",
            padding: "18px 24px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {center}
        </section>

        {/* RIGHT — collapsible */}
        {rightCollapsed ? (
          <aside
            style={{
              background: "var(--bg-elev-1)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingTop: 14,
              gap: 10,
            }}
          >
            <button
              type="button"
              onClick={() => setRightCollapsed(false)}
              title="Open stage order"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 9,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "var(--fg-muted)",
                cursor: "pointer",
                writingMode: "vertical-rl",
                padding: "10px 0",
                background: "none",
                border: "none",
              }}
            >
              ◂ &nbsp; Stage order
            </button>
          </aside>
        ) : (
          <aside
            style={{
              background: "var(--bg-elev-1)",
              overflow: "auto",
              padding: "18px 20px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              position: "relative",
            }}
          >
            <button
              type="button"
              onClick={() => setRightCollapsed(true)}
              title="Collapse"
              style={{
                position: "absolute",
                top: 14,
                right: 14,
                fontFamily: "var(--font-ui)",
                fontSize: 9,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--fg-muted)",
                cursor: "pointer",
                padding: "2px 6px",
                border: "1px solid var(--border-hair)",
                borderRadius: 2,
                background: "none",
                zIndex: 2,
              }}
            >
              close ▸
            </button>
            {rightRail}
          </aside>
        )}
      </div>
    </div>
  );
}
