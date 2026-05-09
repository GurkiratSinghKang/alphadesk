"use client";

import { useEffect, useMemo, useState } from "react";

import { useRegime, usePortfolioSummary } from "@/hooks/useQueries";
import { usePortfolioStore } from "@/stores/portfolio";

/**
 * V2DashHero — three-column hero band matching the v2 design.
 *
 * Columns: Portfolio (live-tick equity + delta) ·
 * Market regime (italic display title + confidence bar) ·
 * Book (open positions / working orders + Cash/Buy-pwr + exposure bar).
 *
 * Lives on top of an `--ink-100` slab with subtle inset shadows so the page
 * feels like a desk-top rather than a page header. All numerics use
 * tabular-nums and the existing data hooks. Missing dimensions (week/month
 * /YTD/Sharpe/Beta) render as em-dashes — the underlying API doesn't surface
 * them yet; we won't fabricate.
 */
export default function V2DashHero() {
  // Pull from the canonical portfolio store (same source the legacy desk
  // used). React Query bridges the data into the store via usePortfolioSummary
  // higher up the tree.
  usePortfolioSummary(); // ensure subscription is alive
  const summary = usePortfolioStore((s) => s.summary);
  const positions = usePortfolioStore((s) => s.positions);
  const orders = usePortfolioStore((s) => s.orders);
  const regime = useRegime();

  const equity = Number(summary?.equity ?? 0);
  const dayPnl = Number(summary?.dayPnl ?? 0);
  const dayPnlPct = Number(summary?.dayPnlPct ?? 0);
  const cash = Number(summary?.cash ?? 0);
  const buyingPower = Number(summary?.buyingPower ?? 0);

  const positionsCount = positions.length;
  const workingOrders = orders.filter(
    (o) => o.status === "submitted" || o.status === "open",
  ).length;

  const exposureLong = useMemo(() => {
    if (!positions.length || !equity) return 0;
    const longVal = positions
      .filter((p) => (p.side ?? "long") === "long")
      .reduce((s, p) => s + Number(p.marketValue ?? 0), 0);
    return Math.min(1, Math.max(0, longVal / equity));
  }, [positions, equity]);
  const exposureShort = useMemo(() => {
    if (!positions.length || !equity) return 0;
    const shortVal = positions
      .filter((p) => p.side === "short")
      .reduce((s, p) => s + Math.abs(Number(p.marketValue ?? 0)), 0);
    return Math.min(1, Math.max(0, shortVal / equity));
  }, [positions, equity]);

  const r = regime.data?.regime;
  const regimeLabel = r?.label || r?.regime?.replace(/_/g, " ") || "—";
  const confidence = Number(r?.confidence ?? 0);
  const vix = Number(r?.vix_level ?? 0);

  // Re-key the equity number so each update flashes the design's
  // `tick-flash` animation.
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    setFlashKey((k) => k + 1);
  }, [equity]);

  const up = dayPnl >= 0;

  return (
    <div
      className="relative overflow-hidden"
      style={{
        padding: "28px 32px 28px",
        background: "var(--ink-100)",
        borderBottom: "1px solid var(--border)",
        boxShadow:
          "inset 0 -1px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.025)",
      }}
    >
      <div
        className="grid relative"
        style={{
          gridTemplateColumns: "1.4fr 1fr 1fr",
          gap: 36,
          alignItems: "end",
        }}
      >
        <PortfolioColumn
          equity={equity}
          dayPnl={dayPnl}
          dayPnlPct={dayPnlPct}
          flashKey={flashKey}
          up={up}
        />
        <RegimeColumn
          label={regimeLabel}
          confidence={confidence}
          vix={vix}
        />
        <BookColumn
          positions={positionsCount}
          orders={workingOrders}
          cash={cash}
          buyingPower={buyingPower}
          exposureLong={exposureLong}
          exposureShort={exposureShort}
        />
      </div>
    </div>
  );
}

function PortfolioColumn(props: {
  equity: number;
  dayPnl: number;
  dayPnlPct: number;
  flashKey: number;
  up: boolean;
}) {
  return (
    <div>
      <div
        className="t-label"
        style={{
          marginBottom: 8,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--up-500)",
            boxShadow: "0 0 6px var(--up-500)",
            animation: "pulse 1.6s infinite",
          }}
        />
        Portfolio · today
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
        <div
          key={props.flashKey}
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 300,
            fontSize: 56,
            color: "var(--ink-1000)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.03em",
            lineHeight: 1,
          }}
        >
          {fmtMoney(props.equity, { dec: 2 }).replace("$", "")}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 16,
            color: "var(--gold-300)",
          }}
        >
          USD
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 22,
          marginTop: 12,
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 18,
            color: props.up ? "var(--up-500)" : "var(--down-500)",
          }}
        >
          {props.up ? "+" : "−"}${fmtNum(Math.abs(props.dayPnl))}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: props.up ? "var(--up-500)" : "var(--down-500)",
          }}
        >
          {props.up ? "+" : ""}
          {props.dayPnlPct.toFixed(2)}%
        </span>
        <span
          className="t-mono"
          style={{ fontSize: 11, color: "var(--fg-hint)" }}
        >
          vs yesterday close
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 28,
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid var(--border-hair)",
        }}
      >
        <Stat label="Week" value="—" />
        <Stat label="Month" value="—" />
        <Stat label="YTD" value="—" big />
        <Stat label="Sharpe · 30d" value="—" />
        <Stat label="Beta" value="—" />
      </div>
    </div>
  );
}

function RegimeColumn(props: {
  label: string;
  confidence: number;
  vix: number;
}) {
  return (
    <div>
      <div className="t-label" style={{ marginBottom: 8 }}>
        Market regime
      </div>
      <div
        className="italic"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 36,
          color: "var(--ink-1000)",
          lineHeight: 1.05,
          letterSpacing: "-0.02em",
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 12,
          alignItems: "center",
        }}
      >
        <RegimeBar value={props.confidence} />
        <span
          className="t-mono"
          style={{ fontSize: 11, color: "var(--fg-muted)" }}
        >
          conf {Number(props.confidence).toFixed(2)}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 22,
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid var(--border-hair)",
        }}
      >
        <Stat label="VIX" value={props.vix ? props.vix.toFixed(1) : "—"} />
        <Stat label="Breadth" value="—" sub="up/total" />
        <Stat label="Hi/Lo" value="—" />
        <Stat label="Fear/Greed" value="—" />
      </div>
    </div>
  );
}

function BookColumn(props: {
  positions: number;
  orders: number;
  cash: number;
  buyingPower: number;
  exposureLong: number;
  exposureShort: number;
}) {
  return (
    <div>
      <div className="t-label" style={{ marginBottom: 8 }}>
        Book
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          rowGap: 4,
          columnGap: 18,
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 28,
            color: "var(--ink-1000)",
            fontWeight: 300,
          }}
        >
          {props.positions}
        </span>
        <span
          className="italic"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            color: "var(--fg-dim)",
          }}
        >
          open positions
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 28,
            color: "var(--ink-1000)",
            fontWeight: 300,
          }}
        >
          {props.orders}
        </span>
        <span
          className="italic"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            color: "var(--fg-dim)",
          }}
        >
          working orders
        </span>
      </div>
      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid var(--border-hair)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
        }}
      >
        <Stat label="Cash" value={fmtMoney(props.cash, { dec: 0 })} />
        <Stat label="Buy pwr" value={fmtMoney(props.buyingPower, { dec: 0 })} />
      </div>
      <ExposureBar long={props.exposureLong} short={props.exposureShort} />
    </div>
  );
}

function Stat(props: {
  label: string;
  value: string;
  sub?: string;
  big?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="t-label">{props.label}</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: props.big ? 16 : 14,
          color: "var(--ink-1000)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.005em",
        }}
      >
        {props.value}
      </span>
      {props.sub && (
        <span
          className="t-mono"
          style={{ fontSize: 10, color: "var(--fg-hint)" }}
        >
          {props.sub}
        </span>
      )}
    </div>
  );
}

function RegimeBar(props: { value: number }) {
  const pct = Math.max(0, Math.min(1, Number(props.value) || 0));
  return (
    <div
      style={{
        width: 130,
        height: 4,
        background: "var(--ink-300)",
        borderRadius: 2,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: "100%",
          width: `${pct * 100}%`,
          background: "linear-gradient(90deg, var(--ice-500), var(--up-500))",
        }}
      />
    </div>
  );
}

function ExposureBar(props: { long: number; short: number }) {
  const long = Math.max(0, Math.min(1, Number(props.long) || 0));
  const short = Math.max(0, Math.min(1, Number(props.short) || 0));
  const flat = Math.max(0, 1 - long - short);
  return (
    <div style={{ marginTop: 16 }}>
      <div className="t-label" style={{ marginBottom: 6, fontSize: 9.5 }}>
        Net exposure · long {Math.round(long * 100)}% / short{" "}
        {Math.round(short * 100)}%
      </div>
      <div
        style={{
          display: "flex",
          height: 6,
          borderRadius: 1,
          overflow: "hidden",
          background: "var(--ink-200)",
        }}
      >
        <div
          style={{
            width: `${long * 100}%`,
            background: "var(--up-500)",
            opacity: 0.8,
          }}
        />
        <div
          style={{
            width: `${flat * 100}%`,
            background: "var(--ink-300)",
          }}
        />
        <div
          style={{
            width: `${short * 100}%`,
            background: "var(--down-500)",
            opacity: 0.8,
          }}
        />
      </div>
    </div>
  );
}

function fmtMoney(n: number, opts?: { dec?: number }): string {
  const dec = opts?.dec ?? 2;
  return `$${Number(n).toLocaleString(undefined, {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })}`;
}

function fmtNum(n: number): string {
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
