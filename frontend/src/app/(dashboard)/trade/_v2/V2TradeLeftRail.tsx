"use client";

import { useState } from "react";

import V2OrderBookPanel from "./V2OrderBookPanel";
import V2TimeAndSalesPanel from "./V2TimeAndSalesPanel";

/**
 * V2TradeLeftRail — slim 36px collapsible rail matching the design's
 * left side of the trade terminal. Closed: vertical "Order book · L2"
 * label. Open: glassy 280px panel with V2OrderBookPanel +
 * V2TimeAndSalesPanel that overlays the chart.
 *
 * Hidden below xl because the chart-and-ticket layout already stacks on
 * narrower viewports — the rail would crowd the mobile flow.
 */
export default function V2TradeLeftRail({
  last = 134.82,
}: {
  symbol?: string;
  last?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside
      className="hidden xl:flex"
      style={{
        background: "var(--bg-elev-1)",
        borderRadius: 4,
        border: "1px solid var(--border-hair)",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 14,
        gap: 10,
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? "Collapse book" : "Open book"}
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
        {open ? "◂" : "▸"} &nbsp; Order book · L2
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 37,
            width: 280,
            zIndex: 30,
            background: "var(--bg-elev-1)",
            backdropFilter: "blur(14px) saturate(140%)",
            WebkitBackdropFilter: "blur(14px) saturate(140%)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
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
              background: "var(--bg-elev-1)",
              borderBottom: "1px solid var(--border-hair)",
            }}
          >
            <span className="t-label" style={{ fontSize: 8.5 }}>
              Order book · L2
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
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
          <V2OrderBookPanel last={last} />
          <V2TimeAndSalesPanel last={last} />
        </div>
      )}
    </aside>
  );
}
