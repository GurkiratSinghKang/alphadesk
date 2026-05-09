"use client";

import { useState } from "react";

import { useIndexSparklines, useStrategies } from "@/hooks/useQueries";
import { usePortfolioStore } from "@/stores/portfolio";

/**
 * V2BodyGrid — 3-column body matching the design's `Market · Watchlist ·
 * Positions` row + a 2-col `Strategies · Alerts` row underneath.
 */
export default function V2BodyGrid({
  onPickTicker,
}: {
  onPickTicker: (sym: string) => void;
}) {
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.05fr 1.2fr 1fr",
          gap: 1,
          background: "var(--border)",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Cell>
          <MarketPanel onPickTicker={onPickTicker} />
        </Cell>
        <Cell>
          <WatchlistPanel onPickTicker={onPickTicker} />
        </Cell>
        <Cell>
          <PositionsPanel onPickTicker={onPickTicker} />
        </Cell>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr",
          gap: 1,
          background: "var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Cell>
          <StrategiesMini />
        </Cell>
        <Cell>
          <AlertsMini />
        </Cell>
      </div>

      <Footer />
    </>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg)", padding: "24px 28px 28px" }}>
      {children}
    </div>
  );
}

// ─── columns ────────────────────────────────────────────────────────────────

function MarketPanel({ onPickTicker }: { onPickTicker: (sym: string) => void }) {
  const sparks = useIndexSparklines();
  const sparklines = sparks.data?.sparklines ?? {};

  // Sparklines is a Record<symbol, number[]>. Build a small index list with
  // last + day-pct synthesized from the points so the column has a credible
  // shape even when no rich indices payload is wired through.
  const placeholder: Array<{ sym: string; price: number; pct: number }> = [
    { sym: "SPY", price: 581.12, pct: 0.34 },
    { sym: "QQQ", price: 502.48, pct: 0.61 },
    { sym: "IWM", price: 218.07, pct: -0.22 },
    { sym: "DIA", price: 478.41, pct: 0.18 },
    { sym: "VTI", price: 295.62, pct: 0.42 },
    { sym: "GOLD", price: 2347.21, pct: -0.18 },
  ];
  const rows = Object.keys(sparklines).length
    ? Object.entries(sparklines)
        .slice(0, 6)
        .map(([sym, points]) => {
          const last = Number(points?.[points.length - 1] ?? 0);
          const first = Number(points?.[0] ?? last);
          const pct = first > 0 ? ((last - first) / first) * 100 : 0;
          return { sym, price: last, pct };
        })
    : placeholder;

  return (
    <div>
      <SectionHeader eyebrow="01" title="Market" />
      <div style={{ marginTop: 18 }}>
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {rows.map((r) => (
            <li
              key={r.sym}
              onClick={() => onPickTicker(r.sym)}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "baseline",
                gap: 14,
                padding: "9px 0",
                borderBottom: "1px solid var(--border-hair)",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--ink-1000)",
                  letterSpacing: "0.02em",
                }}
              >
                {r.sym}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--fg)",
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                }}
              >
                {r.price.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <PctBadge pct={r.pct} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function WatchlistPanel({
  onPickTicker,
}: {
  onPickTicker: (sym: string) => void;
}) {
  const [tab, setTab] = useState<"movers" | "gainers" | "losers" | "candidates">(
    "movers",
  );
  const rows = [
    { sym: "AMD", name: "AMD", price: 168.2, pct: 1.7 },
    { sym: "META", name: "Meta", price: 612.4, pct: 0.62 },
    { sym: "NVDA", name: "Nvidia", price: 134.62, pct: 1.31 },
    { sym: "TSLA", name: "Tesla", price: 248.18, pct: -1.2 },
    { sym: "UNH", name: "UnitedHealth", price: 415.3, pct: 0.4 },
    { sym: "INTC", name: "Intel", price: 32.18, pct: -0.8 },
    { sym: "XOM", name: "Exxon Mobil", price: 117.04, pct: 0.31 },
    { sym: "SPY", name: "S&P 500 ETF", price: 581.12, pct: 0.34 },
    { sym: "MSFT", name: "Microsoft", price: 422.3, pct: 0.26 },
  ];

  return (
    <div>
      <SectionHeader eyebrow="02" title="Watchlist" />
      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 12,
          paddingBottom: 8,
          borderBottom: "1px solid var(--border-hair)",
        }}
      >
        {(["movers", "gainers", "losers", "candidates"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="t-mono"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontSize: 10,
              letterSpacing: "0.06em",
              color: tab === t ? "var(--brand)" : "var(--fg-muted)",
              fontWeight: tab === t ? 600 : 400,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {rows.map((r) => (
          <li
            key={r.sym}
            onClick={() => onPickTicker(r.sym)}
            style={{
              display: "grid",
              gridTemplateColumns: "60px 1fr auto auto",
              alignItems: "baseline",
              gap: 12,
              padding: "9px 0",
              borderBottom: "1px solid var(--border-hair)",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--ink-1000)",
                letterSpacing: "0.02em",
              }}
            >
              {r.sym}
            </span>
            <span
              className="italic"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 13,
                color: "var(--fg-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.name}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--fg)",
                fontVariantNumeric: "tabular-nums",
                textAlign: "right",
              }}
            >
              {r.price.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <PctBadge pct={r.pct} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PositionsPanel({
  onPickTicker,
}: {
  onPickTicker: (sym: string) => void;
}) {
  const positions = usePortfolioStore((s) => s.positions);
  const rows = positions.slice(0, 8);

  return (
    <div>
      <SectionHeader eyebrow="03" title="Positions" right={<span className="t-label">OPEN DESK</span>} />
      <ul style={{ margin: 0, padding: 0, listStyle: "none", marginTop: 12 }}>
        {rows.length === 0 && (
          <li
            className="italic"
            style={{
              padding: "10px 0",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              color: "var(--fg-muted)",
            }}
          >
            No open positions.
          </li>
        )}
        {rows.map((p) => {
          const pnl = Number(p.unrealizedPnl ?? 0);
          const strategy = p.strategy ?? "Manual";
          return (
            <li
              key={p.symbol}
              onClick={() => onPickTicker(p.symbol)}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "baseline",
                gap: 14,
                padding: "10px 0",
                borderBottom: "1px solid var(--border-hair)",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  color: "var(--ink-1000)",
                  letterSpacing: "0.02em",
                }}
              >
                {p.symbol}
              </span>
              <span
                className="italic"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 12.5,
                  color: "var(--fg-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {strategy}
              </span>
              <span
                className={pnl >= 0 ? "u-profit" : "u-loss"}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {pnl >= 0 ? "+" : "−"}$
                {Math.abs(pnl).toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StrategiesMini() {
  const { data } = useStrategies();
  type Strat = { id: string; name: string; status: string; pnl_30d?: number };
  const strategies = (data ?? []) as Strat[];
  const rows = strategies.slice(0, 4);
  return (
    <div>
      <SectionHeader eyebrow="04" title="Strategies" right={<span className="t-label">30 DAYS</span>} />
      <ul style={{ margin: 0, padding: 0, listStyle: "none", marginTop: 12 }}>
        {rows.length === 0 && (
          <li
            className="italic"
            style={{
              padding: "10px 0",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              color: "var(--fg-muted)",
            }}
          >
            No strategies yet.
          </li>
        )}
        {rows.map((s) => {
          const pnl = Number(s.pnl_30d ?? 0);
          return (
            <li
              key={s.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto auto",
                alignItems: "baseline",
                gap: 14,
                padding: "10px 0",
                borderBottom: "1px solid var(--border-hair)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background:
                    s.status === "active"
                      ? "var(--up-500)"
                      : s.status === "paused"
                        ? "var(--gold-300)"
                        : "var(--ink-300)",
                  alignSelf: "center",
                }}
              />
              <span
                className="italic"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 14,
                  color: "var(--ink-1000)",
                }}
              >
                {s.name}
              </span>
              <span
                className="t-mono"
                style={{
                  fontSize: 10,
                  color: "var(--fg-muted)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {s.status}
              </span>
              <span
                className={pnl >= 0 ? "u-profit" : "u-loss"}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {pnl >= 0 ? "+" : "−"}$
                {Math.abs(pnl).toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AlertsMini() {
  const orders = usePortfolioStore((s) => s.orders);
  const rows = orders.slice(0, 5);
  return (
    <div>
      <SectionHeader eyebrow="05" title="Alerts" />
      <ul style={{ margin: 0, padding: 0, listStyle: "none", marginTop: 12 }}>
        {rows.length === 0 && (
          <li
            className="italic"
            style={{
              padding: "10px 0",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              color: "var(--fg-muted)",
            }}
          >
            All quiet — no alerts firing.
          </li>
        )}
        {rows.map((o, i) => (
          <li
            key={`${o.id ?? i}`}
            style={{
              padding: "10px 0",
              borderBottom: "1px solid var(--border-hair)",
            }}
          >
            <span
              className="italic"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 13.5,
                color: "var(--fg)",
                lineHeight: 1.45,
              }}
            >
              {o.symbol} · {o.side} {o.quantity}
              {o.price ? ` @ ${o.price}` : " mkt"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span
          className="t-mono"
          style={{
            fontSize: 10,
            color: "var(--fg-hint)",
            letterSpacing: "0.06em",
          }}
        >
          {eyebrow}
        </span>
        <span
          className="italic"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            color: "var(--ink-1000)",
            letterSpacing: "-0.015em",
            lineHeight: 1.1,
          }}
        >
          {title}
        </span>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

function PctBadge({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: up ? "var(--up-500)" : "var(--down-500)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {up ? "+" : "−"}
      {Math.abs(pct).toFixed(2)}%
    </span>
  );
}

function Footer() {
  return (
    <div
      className="t-mono"
      style={{
        padding: "16px 32px",
        fontSize: 10,
        color: "var(--fg-hint)",
        letterSpacing: "0.06em",
        display: "flex",
        justifyContent: "space-between",
      }}
    >
      <span>ALPHADESK · OPERATING PICTURE</span>
      <span>EDITORIAL DENSITY · DARK</span>
    </div>
  );
}
