"use client";

import { useEffect, useState } from "react";

/**
 * V2TimeAndSalesPanel — recent prints rail matching the design's T&S
 * voice. Each row: time · price · size · aggressor (bid/ask).
 *
 * Synthesizes mock prints around the supplied last price so the panel
 * looks alive. Real-time WS wiring is a follow-up.
 */
export default function V2TimeAndSalesPanel({
  last = 134.82,
}: {
  last?: number;
}) {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(id);
  }, []);

  const rows = Array.from({ length: 14 }, (_, i) => {
    const t = new Date(now.getTime() - i * 5000);
    const drift = (Math.random() - 0.5) * 0.05;
    const px = last + drift;
    const size = Math.round(50 + Math.random() * 1500);
    const side: "bid" | "ask" = Math.random() > 0.5 ? "ask" : "bid";
    return { t, px, size, side };
  });

  return (
    <div>
      <div
        className="t-label"
        style={{
          padding: "12px 14px 6px",
          fontSize: 8.5,
          color: "var(--fg-hint)",
          borderTop: "1px solid var(--border-hair)",
        }}
      >
        Time &amp; sales
      </div>
      <div>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              alignItems: "baseline",
              gap: 10,
              padding: "5px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--fg)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span style={{ color: "var(--fg-hint)" }}>
              {fmtTime(r.t)}
            </span>
            <span
              style={{
                color: r.side === "ask" ? "var(--down-500)" : "var(--up-500)",
              }}
            >
              {r.px.toFixed(2)}
            </span>
            <span style={{ color: "var(--fg-muted)" }}>
              {r.size.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
