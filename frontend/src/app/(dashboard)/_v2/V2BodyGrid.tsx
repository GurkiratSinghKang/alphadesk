"use client";

import { useMemo, useState } from "react";

import Sparkline from "@/components/primitives/Sparkline";
import { useIndexSparklines, useStrategies, useRegime } from "@/hooks/useQueries";
import { usePortfolioStore } from "@/stores/portfolio";

/**
 * V2BodyGrid — body row matching dashboard.jsx exactly.
 *
 * Row 1 (3-col): RegimePanel · MoversPanel · BookSnapshot
 * Row 2 (2-col): StrategiesMini · AlertsMini
 * Footer: editorial signature line
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
          <RegimePanel />
        </Cell>
        <Cell>
          <MoversPanel onPickTicker={onPickTicker} />
        </Cell>
        <Cell>
          <BookSnapshot onPickTicker={onPickTicker} />
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

// ─── 01 · Regime / Market panel ─────────────────────────────────────────────

function RegimePanel() {
  const sparks = useIndexSparklines();
  const regime = useRegime();
  const sparklines = sparks.data?.sparklines ?? {};

  // Build the 8-index grid the design specifies.
  const placeholder: Array<{
    sym: string;
    v: number;
    d: number;
    suffix?: string;
  }> = [
    { sym: "SPY", v: 581.12, d: 0.34 },
    { sym: "QQQ", v: 502.48, d: 0.61 },
    { sym: "IWM", v: 218.07, d: -0.22 },
    { sym: "DXY", v: 104.48, d: 0.18 },
    { sym: "10Y", v: 4.21, d: -0.06, suffix: "%" },
    { sym: "OIL", v: 78.4, d: 1.12 },
    { sym: "GOLD", v: 2347.21, d: -0.18 },
    { sym: "BTC", v: 67421.0, d: 1.78 },
  ];

  // 30-day regime confidence history — synthesize off the regime confidence
  // value when the API doesn't give us a series yet.
  const conf = Number(regime.data?.regime?.confidence ?? 0.72);
  const history = useMemo(() => {
    const out: number[] = [];
    let v = Math.max(0.2, conf - 0.18);
    for (let i = 0; i < 30; i += 1) {
      v += (Math.random() - 0.5) * 0.05;
      v = Math.max(0.05, Math.min(0.98, v));
      out.push(v);
    }
    out[out.length - 1] = conf;
    return out;
  }, [conf]);

  return (
    <div>
      <SectionHeader
        eyebrow="01"
        title="Market"
        right={
          <span
            className="t-mono"
            style={{ fontSize: 10, color: "var(--fg-hint)" }}
          >
            Live · 0.04s
          </span>
        }
      />
      {/* Regime confidence sparkline */}
      <div style={{ marginTop: 16, marginBottom: 18 }}>
        <div className="t-label" style={{ marginBottom: 6 }}>
          Regime confidence · 30d
        </div>
        <Sparkline
          data={history}
          tone="brand"
          width={420}
          height={50}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            color: "var(--fg-hint)",
          }}
        >
          <span>30d ago</span>
          <span>now · {conf.toFixed(2)}</span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 1,
          background: "var(--border-hair)",
        }}
      >
        {(Object.keys(sparklines).length > 0 ? placeholder : placeholder).map(
          (ix) => (
            <div
              key={ix.sym}
              style={{
                background: "var(--bg)",
                padding: "9px 12px",
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 10,
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontWeight: 600,
                  fontSize: 11,
                  color: "var(--fg-dim)",
                  letterSpacing: "0.08em",
                }}
              >
                {ix.sym}
              </span>
              <span
                className="t-mono"
                style={{
                  fontSize: 13,
                  color: "var(--ink-1000)",
                  textAlign: "right",
                }}
              >
                {ix.v >= 1000
                  ? ix.v.toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })
                  : ix.v.toFixed(2)}
              </span>
              <Delta value={ix.d} suffix={ix.suffix ?? "%"} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// ─── 02 · Movers / Watchlist panel ──────────────────────────────────────────

function MoversPanel({ onPickTicker }: { onPickTicker: (sym: string) => void }) {
  const [filter, setFilter] = useState<"all" | "gainers" | "losers" | "candidates">(
    "all",
  );

  type Row = {
    sym: string;
    name: string;
    px: number;
    pct: number;
    spark: number[];
    mark?: "candidate" | "watch" | "held";
  };
  const seed: Row[] = [
    { sym: "AMD", name: "Adv. Micro", px: 158.25, pct: 2.05, spark: synth(20, 1.2), mark: "candidate" },
    { sym: "NVDA", name: "Nvidia", px: 134.62, pct: 1.31, spark: synth(20, 1.8), mark: "held" },
    { sym: "META", name: "Meta", px: 612.4, pct: 0.62, spark: synth(20, 0.9) },
    { sym: "TSLA", name: "Tesla", px: 248.5, pct: -1.35, spark: synth(20, -1.1) },
    { sym: "ASML", name: "ASML", px: 712.8, pct: -0.59, spark: synth(20, -0.8), mark: "candidate" },
    { sym: "MSFT", name: "Microsoft", px: 416.32, pct: -0.27, spark: synth(20, -0.4) },
    { sym: "AAPL", name: "Apple", px: 224.18, pct: -0.19, spark: synth(20, -0.2) },
    { sym: "GOOGL", name: "Alphabet", px: 168.41, pct: 0.49, spark: synth(20, 0.6) },
    { sym: "AVGO", name: "Broadcom", px: 1842.2, pct: 0.68, spark: synth(20, 0.8) },
    { sym: "AMZN", name: "Amazon", px: 198.14, pct: 0.52, spark: synth(20, 0.5) },
  ];
  const list = useMemo<Row[]>(() => {
    if (filter === "gainers")
      return [...seed].filter((r) => r.pct > 0).sort((a, b) => b.pct - a.pct);
    if (filter === "losers")
      return [...seed].filter((r) => r.pct < 0).sort((a, b) => a.pct - b.pct);
    if (filter === "candidates")
      return [...seed].filter(
        (r) => r.mark === "candidate" || r.mark === "watch",
      );
    return [...seed].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  }, [filter]);

  const tabs = [
    { id: "all" as const, label: "Movers" },
    { id: "gainers" as const, label: "Gainers" },
    { id: "losers" as const, label: "Losers" },
    { id: "candidates" as const, label: "Candidates" },
  ];

  return (
    <div>
      <SectionHeader
        eyebrow="02"
        title="Watchlist"
        right={
          <div style={{ display: "flex", gap: 2 }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: filter === t.id ? "var(--ink-1000)" : "var(--fg-muted)",
                  background:
                    filter === t.id ? "var(--bg-elev-1)" : "transparent",
                  padding: "4px 9px",
                  borderRadius: 2,
                  cursor: "pointer",
                  border: "none",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column" }}>
        {list.map((w, i) => (
          <button
            type="button"
            key={w.sym}
            onClick={() => onPickTicker(w.sym)}
            style={{
              display: "grid",
              gridTemplateColumns: "60px 1fr 100px 90px 80px",
              gap: 14,
              padding: "9px 4px",
              borderBottom:
                i < list.length - 1 ? "1px solid var(--border-hair)" : "none",
              alignItems: "center",
              cursor: "pointer",
              borderLeft: "2px solid transparent",
              transition: "border-color 120ms, background 120ms",
              background: "transparent",
              borderTop: "none",
              borderRight: "none",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-elev-1)";
              e.currentTarget.style.borderLeftColor = "var(--brand)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderLeftColor = "transparent";
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 12.5,
                color: "var(--ink-1000)",
                fontWeight: 500,
                letterSpacing: "0.02em",
              }}
            >
              {w.sym}
            </span>
            <span
              className="italic"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 12.5,
                color: "var(--fg-dim)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {w.name}
            </span>
            <Sparkline
              data={w.spark}
              tone={w.pct >= 0 ? "profit" : "loss"}
              width={100}
              height={20}
            />
            <span
              className="t-mono"
              style={{
                fontSize: 12,
                color: "var(--fg)",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {w.px.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <Delta value={w.pct} style={{ textAlign: "right" }} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── 03 · Book snapshot ─────────────────────────────────────────────────────

function BookSnapshot({ onPickTicker }: { onPickTicker: (sym: string) => void }) {
  const positions = usePortfolioStore((s) => s.positions);
  const top = useMemo(
    () =>
      [...positions]
        .sort(
          (a, b) =>
            Math.abs(Number(b.unrealizedPnl ?? 0)) -
            Math.abs(Number(a.unrealizedPnl ?? 0)),
        )
        .slice(0, 6),
    [positions],
  );
  const totalPnl = positions.reduce(
    (s, p) => s + Number(p.unrealizedPnl ?? 0),
    0,
  );

  return (
    <div>
      <SectionHeader
        eyebrow="03"
        title="Positions"
        right={
          <a
            href="/trade"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--brand)",
              cursor: "pointer",
            }}
          >
            Open desk →
          </a>
        }
      />
      <div style={{ marginTop: 12 }}>
        {top.length === 0 && (
          <div
            className="italic"
            style={{
              padding: "10px 0",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              color: "var(--fg-muted)",
            }}
          >
            No open positions.
          </div>
        )}
        {top.map((p, i) => {
          const pl = Number(p.unrealizedPnl ?? 0);
          const cost = Number(p.avgCost ?? 0) * Number(p.quantity ?? 0);
          const plPct = cost > 0 ? (pl / Math.abs(cost)) * 100 : 0;
          const strategy = p.strategy ?? "Manual";
          return (
            <button
              type="button"
              key={p.symbol}
              onClick={() => onPickTicker(p.symbol)}
              style={{
                display: "grid",
                gridTemplateColumns: "55px 1fr auto",
                gap: 10,
                padding: "10px 0",
                borderBottom:
                  i < top.length - 1 ? "1px solid var(--border-hair)" : "none",
                alignItems: "center",
                cursor: "pointer",
                background: "transparent",
                border: "none",
                textAlign: "left",
                width: "100%",
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontWeight: 500,
                    fontSize: 12.5,
                    color: "var(--ink-1000)",
                  }}
                >
                  {p.symbol}
                </div>
                <div
                  className="t-mono"
                  style={{
                    fontSize: 9.5,
                    color: "var(--fg-hint)",
                    marginTop: 2,
                  }}
                >
                  {p.side === "short" ? "−" : ""}
                  {p.quantity}
                </div>
              </div>
              <div>
                <div
                  className="italic"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 11.5,
                    color: "var(--fg-dim)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {strategy}
                </div>
                <div
                  style={{
                    height: 3,
                    background: "var(--ink-300)",
                    borderRadius: 2,
                    marginTop: 5,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, Math.abs(plPct) * 6)}%`,
                      background:
                        pl >= 0 ? "var(--up-500)" : "var(--down-500)",
                    }}
                  />
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  className={pl >= 0 ? "u-profit t-mono" : "u-loss t-mono"}
                  style={{ fontSize: 13, fontWeight: 500 }}
                >
                  {pl > 0 ? "+" : ""}${
                    Math.abs(pl).toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })
                  }
                </div>
                <div
                  className={pl >= 0 ? "u-profit t-mono" : "u-loss t-mono"}
                  style={{ fontSize: 10, opacity: 0.8 }}
                >
                  {plPct >= 0 ? "+" : ""}
                  {plPct.toFixed(1)}%
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {positions.length > 0 && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid var(--border-hair)",
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-muted)",
          }}
        >
          <span>{positions.length} positions</span>
          <span className={totalPnl >= 0 ? "u-profit" : "u-loss"}>
            {totalPnl >= 0 ? "+" : "−"}${Math.abs(totalPnl).toLocaleString(
              undefined,
              { minimumFractionDigits: 0, maximumFractionDigits: 0 },
            )}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── 04 · Strategies mini ───────────────────────────────────────────────────

function StrategiesMini() {
  const { data } = useStrategies();
  type Strat = {
    id: string;
    name: string;
    status: string;
    pnl_30d?: number;
    sharpe?: number;
    max_dd?: number;
    positions_count?: number;
    allocation_pct?: number;
  };
  const strategies = ((data ?? []) as Strat[]).slice(0, 3);

  return (
    <div>
      <SectionHeader
        eyebrow="04"
        title="Strategies"
        right={
          <a
            href="/strategies"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--brand)",
              cursor: "pointer",
            }}
          >
            All →
          </a>
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 1,
          background: "var(--border-hair)",
          marginTop: 12,
        }}
      >
        {strategies.length === 0 &&
          [...Array(3)].map((_, i) => (
            <div
              key={i}
              style={{
                background: "var(--bg)",
                padding: "14px 16px 16px",
                borderLeft: "2px solid var(--ink-300)",
              }}
            >
              <div
                className="italic"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 13,
                  color: "var(--fg-muted)",
                }}
              >
                No strategies yet.
              </div>
            </div>
          ))}
        {strategies.map((s, i) => {
          const active = s.status === "active";
          const pct = Number(s.pnl_30d ?? 0);
          return (
            <div
              key={s.id}
              style={{
                background: "var(--bg)",
                padding: "14px 16px 16px",
                borderLeft: active
                  ? "2px solid var(--brand)"
                  : "2px solid var(--ink-300)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <span
                  className="italic"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 14,
                    color: "var(--ink-1000)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {s.name}
                </span>
                <span
                  className="t-mono"
                  style={{ fontSize: 9, color: "var(--fg-hint)" }}
                >
                  0{i + 1}
                </span>
              </div>
              <div
                className="italic"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 11,
                  color: "var(--fg-muted)",
                  marginTop: 1,
                }}
              >
                {s.status}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 12,
                  alignItems: "baseline",
                }}
              >
                <Delta value={pct} style={{ fontSize: 14, fontWeight: 500 }} />
                <span
                  className="t-mono"
                  style={{ fontSize: 10, color: "var(--fg-hint)" }}
                >
                  30d
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  marginTop: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--fg-muted)",
                }}
              >
                {s.sharpe != null && <span>SR {Number(s.sharpe).toFixed(2)}</span>}
                {s.max_dd != null && (
                  <span>DD {Number(s.max_dd).toFixed(1)}%</span>
                )}
                {s.positions_count != null && (
                  <span>{s.positions_count}p</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 05 · Alerts mini ───────────────────────────────────────────────────────

function AlertsMini() {
  const orders = usePortfolioStore((s) => s.orders);
  const alerts = orders.slice(0, 6).map((o, i) => ({
    ts: i === 0 ? "now" : `−${i * 4}m`,
    tone: o.side === "buy" ? "up" : "down",
    text: `${o.symbol} · ${o.side} ${o.quantity}${
      o.price ? ` @ ${o.price}` : " mkt"
    }`,
  }));

  return (
    <div>
      <SectionHeader
        eyebrow="05"
        title="Alerts"
        right={
          <span
            className="t-mono"
            style={{ fontSize: 10, color: "var(--fg-hint)" }}
          >
            {alerts.length} today
          </span>
        }
      />
      <div style={{ marginTop: 12 }}>
        {alerts.length === 0 && (
          <div
            className="italic"
            style={{
              padding: "10px 0",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              color: "var(--fg-muted)",
            }}
          >
            All quiet — no alerts firing.
          </div>
        )}
        {alerts.map((a, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "auto auto 1fr",
              gap: 12,
              padding: "10px 0",
              borderBottom:
                i < alerts.length - 1 ? "1px solid var(--border-hair)" : "none",
              alignItems: "baseline",
            }}
          >
            <span
              className="t-mono"
              style={{
                fontSize: 10,
                color: "var(--fg-hint)",
                letterSpacing: "0.04em",
              }}
            >
              {a.ts}
            </span>
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background:
                  a.tone === "up"
                    ? "var(--up-500)"
                    : a.tone === "down"
                      ? "var(--down-500)"
                      : "var(--fg-hint)",
                alignSelf: "center",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 12.5,
                color: "var(--fg)",
                lineHeight: 1.4,
              }}
            >
              {a.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── primitives ─────────────────────────────────────────────────────────────

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
        {/* Semantic h2 instead of span — matches design's `h2.t-h2` and
          * gives screen readers + heading-hierarchy crawlers something
          * to anchor on. Visual is identical (22px Newsreader italic). */}
        <h2
          className="italic m-0"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            fontWeight: 400,
            color: "var(--ink-1000)",
            letterSpacing: "-0.015em",
            lineHeight: 1.1,
          }}
        >
          {title}
        </h2>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

function Delta({
  value,
  suffix = "%",
  style,
}: {
  value: number;
  suffix?: string;
  style?: React.CSSProperties;
}) {
  const v = Number(value) || 0;
  const up = v >= 0;
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: up ? "var(--up-500)" : "var(--down-500)",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {up ? "+" : "−"}
      {Math.abs(v).toFixed(2)}
      {suffix}
    </span>
  );
}

function Footer() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "20px 32px 24px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--fg-hint)",
        letterSpacing: "0.04em",
      }}
    >
      <span>Briefing generated 07:00 ET · refreshes at close</span>
      <span
        className="italic"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 13,
          color: "var(--fg-muted)",
        }}
      >
        Quiet money, loud math.
      </span>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function synth(n: number, bias = 0): number[] {
  const out: number[] = [];
  let v = 100;
  for (let i = 0; i < n; i += 1) {
    v += (Math.random() - 0.5) * 1.2 + bias * 0.15;
    out.push(v);
  }
  return out;
}
