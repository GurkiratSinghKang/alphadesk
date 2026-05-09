"use client";

/**
 * V2OrderBookPanel — L2 ladder matching the design's order-book voice.
 *
 * Renders bid + ask levels with depth bars in brand-rust + brand-ice tints,
 * mid-row pinned between. Currently shows synthesized mock depth around a
 * supplied last price; the real WS-fed depth wiring is a follow-up.
 */
export default function V2OrderBookPanel({ last = 134.82 }: { last?: number }) {
  // Synthesize 8 ask levels above + 8 bid levels below the last price.
  const ticks = 0.01;
  const asks = Array.from({ length: 8 }, (_, i) => {
    const px = last + (i + 1) * ticks;
    const size = Math.round(8000 + Math.random() * 6000);
    return { px, size };
  }).reverse();
  const bids = Array.from({ length: 8 }, (_, i) => {
    const px = last - (i + 1) * ticks;
    const size = Math.round(8000 + Math.random() * 6000);
    return { px, size };
  });
  const max = Math.max(
    ...asks.map((r) => r.size),
    ...bids.map((r) => r.size),
  );

  return (
    <div style={{ padding: 0 }}>
      <div
        className="t-label"
        style={{
          padding: "12px 14px 6px",
          fontSize: 8.5,
          color: "var(--fg-hint)",
        }}
      >
        Order book
      </div>
      <div>
        {asks.map((r) => (
          <Row key={`ask-${r.px}`} px={r.px} size={r.size} max={max} side="ask" />
        ))}
      </div>
      <div
        style={{
          padding: "8px 14px",
          background: "var(--bg-elev-1)",
          borderTop: "1px solid var(--border-hair)",
          borderBottom: "1px solid var(--border-hair)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--ink-1000)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {last.toFixed(2)}
      </div>
      <div>
        {bids.map((r) => (
          <Row key={`bid-${r.px}`} px={r.px} size={r.size} max={max} side="bid" />
        ))}
      </div>
    </div>
  );
}

function Row({
  px,
  size,
  max,
  side,
}: {
  px: number;
  size: number;
  max: number;
  side: "ask" | "bid";
}) {
  const pct = Math.max(2, (size / max) * 100);
  const tone =
    side === "ask"
      ? "rgba(166, 75, 42, 0.18)"
      : "rgba(93, 110, 62, 0.18)";
  const textTone =
    side === "ask" ? "var(--down-500)" : "var(--up-500)";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        padding: "5px 14px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--fg)",
        position: "relative",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: tone,
          width: `${pct}%`,
          right: side === "ask" ? 0 : "auto",
          left: side === "ask" ? "auto" : 0,
          borderRadius: 1,
        }}
      />
      <span style={{ position: "relative", color: textTone }}>
        {px.toFixed(2)}
      </span>
      <span style={{ position: "relative" }}>
        {size.toLocaleString()}
      </span>
    </div>
  );
}
