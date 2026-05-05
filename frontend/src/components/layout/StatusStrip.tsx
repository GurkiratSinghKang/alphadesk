"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { usePortfolioStore } from "@/stores/portfolio";
import { useWs } from "@/lib/providers";
import { useUIStore } from "@/stores/ui";
import { formatCurrency, cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { useRegime, usePortfolioSummary, useBrokerConnections } from "@/hooks/useQueries";
import { getMarketSession } from "@/lib/marketHours";

// EH-3d: derive the global session pill label from the NY clock.
//   · "PRE-MARKET" — weekday before 09:30 ET
//   · "AFTER HOURS" — weekday between 16:00 ET and 24:00 ET
//   · "OVERNIGHT" — 00:00–04:00 ET (technically still "after hours" the
//     next morning but the term in industry use is "overnight"; the
//     EH brief calls this state out separately)
//   · null — regular session or weekend (regular pill display only)
//
// Defensive: ``getMarketSession`` already handles weekends (returns
// "closed") and the helper is browser-time-zone safe via Intl. We keep
// the exported tester so the unit test below can mock the clock.
export type SessionPillLabel = "PRE-MARKET" | "AFTER HOURS" | "OVERNIGHT";

export function getSessionPillLabel(now: Date = new Date()): SessionPillLabel | null {
  const session = getMarketSession(now);
  if (session === "open" || session === "closed") return null;
  if (session === "pre") {
    // OVERNIGHT band 00:00–04:00 ET. Reuse Intl to avoid host-tz drift.
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const hourPart = parts.find((p) => p.type === "hour");
      const hour = hourPart ? parseInt(hourPart.value, 10) % 24 : 6;
      if (hour < 4) return "OVERNIGHT";
    } catch {
      // fall through to PRE-MARKET on Intl failure (extremely rare)
    }
    return "PRE-MARKET";
  }
  // session === "post"
  return "AFTER HOURS";
}

export function StatusStrip() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  // EH-3d: keep the session pill label fresh. We refresh once per
  // minute — the bands transition at :00 of an even half-hour (09:30
  // open, 16:00 close, 04:00 overnight→pre) so 60s is plenty of
  // resolution and avoids burning re-renders on a 1Hz timer.
  const [sessionLabel, setSessionLabel] = useState<SessionPillLabel | null>(() =>
    getSessionPillLabel(),
  );
  useEffect(() => {
    // Sync immediately on mount in case our SSR/initial-state read
    // happened against a stale Date.
    setSessionLabel(getSessionPillLabel());
    const interval = window.setInterval(() => {
      setSessionLabel(getSessionPillLabel());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const summary = usePortfolioStore((s) => s.summary);
  const { isConnected } = useWs();
  const tradingMode = useUIStore((s) => s.tradingMode);

  const { data: regimeData } = useRegime();
  const regime = regimeData?.regime ?? null;
  // Wave 3N persona-94 #8: portfolio summary exposes its own `is_demo`
  // flag — when the user has no Alpaca creds, we want to light up the
  // banner regardless of whether regime data has loaded yet.
  const { data: portfolioResp } = usePortfolioSummary();
  // Batch E P1-21: tri-state PAPER pill. The pill must read from the
  // SAME source Settings → Brokerage uses so a "Not connected" pill on
  // the strip can never co-exist with a "Connected" badge in Settings.
  // The hook is also useBrokerConnections (see useQueries.ts).
  const { data: brokerConnections } = useBrokerConnections();
  const activePaperConn = (brokerConnections ?? []).find(
    (c) => c.status === "active" && c.account_env === "paper",
  );
  const activeLiveConn = (brokerConnections ?? []).find(
    (c) => c.status === "active" && c.account_env === "live",
  );
  // Tri-state: NOT CONNECTED (gray) when no active connection,
  // PAPER (chartreuse) when paper API key valid, LIVE (gold/amber)
  // when live API key valid. tradingMode is the user's chosen mode
  // (paper vs live); we surface what the broker connection actually
  // supports so a user with paper-only creds in "live" mode sees the
  // mismatch immediately.
  type BrokerPillState = "not-connected" | "paper" | "live";
  let brokerPillState: BrokerPillState;
  if (!activePaperConn && !activeLiveConn) {
    brokerPillState = "not-connected";
  } else if (tradingMode === "live" && activeLiveConn) {
    brokerPillState = "live";
  } else if (tradingMode === "paper" && activePaperConn) {
    brokerPillState = "paper";
  } else {
    // tradingMode and active connection don't agree — fall back to
    // whichever connection IS active so the pill still tells the truth
    // about real-money risk. live takes precedence (high-stakes signal).
    brokerPillState = activeLiveConn ? "live" : "paper";
  }

  const hasSummary =
    summary.is_demo !== undefined ||
    Boolean(summary.lastUpdated) ||
    summary.equity > 0 ||
    summary.buyingPower > 0 ||
    summary.positionsCount > 0;
  const dayPnl = Number.isFinite(summary.dayPnl) ? summary.dayPnl : 0;
  const dayPnlPct = Number.isFinite(summary.dayPnlPct) ? summary.dayPnlPct : 0;
  const hasPnl = hasSummary && Number.isFinite(summary.dayPnl);
  const signedCurrency = (n: number) => {
    const value = Number.isFinite(n) ? n : 0;
    if (value > 0) return `+${formatCurrency(value)}`;
    if (value < 0) return `-${formatCurrency(Math.abs(value))}`;
    return formatCurrency(0);
  };
  const signedPercent = (n: number) => {
    const value = Number.isFinite(n) ? n : 0;
    if (value > 0) return `+${value.toFixed(2)}`;
    if (value < 0) return `-${Math.abs(value).toFixed(2)}`;
    return value.toFixed(2);
  };

  const regimeColor = regime?.label === "bull" ? "text-[var(--profit)]" : regime?.label === "bear" ? "text-[var(--loss)]" : "text-amber";
  const isDemo =
    regimeData?.is_demo === true ||
    (portfolioResp as { is_demo?: boolean } | undefined)?.is_demo === true;

  if (!mounted) {
    return <div className="flex h-7 shrink-0 items-center border-b border-border bg-[var(--background)] px-4 text-label" />;
  }

  return (
    <div role="status" className="relative z-10 flex h-7 shrink-0 items-center gap-0 overflow-x-auto whitespace-nowrap border-b border-border/70 bg-ink-100/92 px-3 text-label shadow-[0_12px_34px_-32px_rgba(0,0,0,0.9)] scrollbar-none sm:px-4">
      <div className="flex items-center gap-1.5 pr-3 border-r border-border/50 sm:pr-4">
        <span className="text-fg-muted font-medium">P&L</span>
        {hasPnl ? (
          <span aria-live="polite" aria-atomic="true" className={cn("font-semibold tabular-nums", dayPnl > 0 ? "text-[var(--profit)] glow-profit" : dayPnl < 0 ? "text-[var(--loss)] glow-loss" : "text-muted-foreground")}>
            <span className="sr-only">{dayPnl > 0 ? "gain" : dayPnl < 0 ? "loss" : "flat"}</span>
            <AnimatedNumber value={dayPnl} format={signedCurrency} />
            <span className="text-muted-foreground ml-1">(<AnimatedNumber value={dayPnlPct} format={signedPercent} />%)</span>
          </span>
        ) : (
          <span aria-live="polite" aria-atomic="true" className="text-fg-muted tabular-nums">$--.--</span>
        )}
      </div>
      <div className="hidden md:flex items-center gap-1.5 px-4 border-r border-border/50">
        <span className="text-fg-muted">Regime</span>
        <span className={cn("font-medium truncate max-w-[160px]", regime ? regimeColor : "text-fg-muted", isDemo && "opacity-40")}>
          {regime?.regime ?? "---"}
        </span>
      </div>
      <div className="hidden lg:flex items-center gap-1.5 px-4 border-r border-border/50">
        <span className="text-fg-muted">VIX</span>
        <span className={cn("tabular-nums font-medium", isDemo ? "text-muted-foreground opacity-40" : "text-foreground")}>
          {regime?.vix_level ? regime.vix_level.toFixed(1) : "--.-"}
        </span>
      </div>
      {/* BUG-007: the green-dot indicator marks websocket stream health,
          not real-money live trading. Reserve "LIVE" for the real live-
          trading mode (see Alpaca (Paper|Live) cell to the right) and
          label this pill STREAMING / OFFLINE so it can't be mistaken. */}
      <span role="status" aria-live="polite" className="flex items-center gap-1.5 px-3 border-r border-border/50 sm:px-4">
        {isConnected ? (
          <>
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--profit)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--profit)]" />
            </span>
            <span className="text-[var(--profit)] font-medium">STREAMING</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--loss)]" aria-hidden="true" />
            <span className="text-[var(--loss)] font-medium">OFFLINE</span>
          </>
        )}
      </span>
      {/* BUG-043 — the PAPER badge's uppercase tracking crept close to
          the Trade nav-tab highlight on narrow viewports. Add a small
          inline-flex gap + relative/isolate so the badge's border-box
          can never overlap a sibling component's hover outline, and
          reserve a hair of right padding against the strip edge so the
          letter spacing doesn't push the last glyph into the overflow
          scroll track.

          Batch E P1-21 — tri-state pill. Was a static "PAPER" or
          "LIVE" derived from the trading-mode toggle alone, which
          could lie to a user who hadn't actually configured any
          broker creds yet (clicked the toggle, saw "PAPER" in the
          chrome, assumed everything was wired). Now reads:
            NOT CONNECTED — no active broker connection (gray)
            PAPER         — paper API key valid (chartreuse)
            LIVE          — live API key valid (gold/amber)
          The broker-connections list is the same source Settings →
          Brokerage uses, so the pill and the Settings badge can
          never disagree. */}
      <div className="relative isolate flex items-center gap-2 px-3 sm:px-4 sm:pr-5">
        <span className="hidden text-foreground font-medium sm:inline">
          {brokerPillState === "not-connected"
            ? "Broker"
            : `Alpaca (${brokerPillState === "paper" ? "Paper" : "Live"})`}
        </span>
        <span
          aria-label={
            brokerPillState === "not-connected"
              ? "No broker connected. Add credentials in Settings."
              : brokerPillState === "live"
                ? "Live trading mode — real-money execution active."
                : "Paper trading mode — simulated execution."
          }
          className={cn(
            "inline-flex min-h-5 items-center rounded px-2 py-0.5 text-label font-bold uppercase tracking-[0.1em] leading-none",
            brokerPillState === "not-connected"
              ? "bg-fg-muted/15 text-fg-muted"
              : brokerPillState === "paper"
                ? "bg-[var(--profit)]/15 text-[var(--profit)]"
                : "bg-state-mode/20 text-state-mode",
          )}
        >
          {brokerPillState === "not-connected"
            ? "Not connected"
            : brokerPillState === "paper"
              ? "PAPER"
              : "LIVE"}
        </span>
      </div>
      {/* EH-3d: globally visible session pill. Renders only outside
          the regular cash session — null during 09:30–16:00 ET on
          weekdays so the regular layout is byte-for-byte identical
          to pre-EH. Tooltip reminds the trader that extended-hours
          data may be limited or stale (per EH brief copy). */}
      {sessionLabel && (
        <span
          role="status"
          aria-live="polite"
          data-slot="session-pill"
          data-session={sessionLabel}
          title="Extended hours data may be limited or stale"
          className="ml-2 inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-amber/40 bg-amber/10 px-2 py-0.5 text-label font-bold uppercase tracking-[0.12em] leading-none text-amber"
        >
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber" />
          {sessionLabel}
        </span>
      )}
      {/* Wave 3N persona-94 #8: `is_demo` is the backend's signal that
          no Alpaca credentials are configured. Don't just mute the other
          cells — tell the user what state they're in and link them to
          the fix path. Rendered last so it sits at the right edge of the
          strip and doesn't re-layout the P&L cluster. */}
      {isDemo && (
        <Link
          href="/settings"
          aria-label="Demo data. Link Alpaca in settings."
          className="ml-0 flex shrink-0 items-center gap-1.5 border-l border-border/50 pl-3 text-state-warning hover:text-foreground sm:ml-auto sm:pl-4"
          title="AlphaDesk hasn't seen Alpaca credentials yet. Click to configure."
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-state-warning"
            aria-hidden
          />
          <span className="hidden font-semibold uppercase tracking-[0.1em] text-label sm:inline">
            Demo data
          </span>
          <span className="hidden sm:inline text-label text-muted-foreground">
            · link Alpaca in /settings
          </span>
        </Link>
      )}
    </div>
  );
}
