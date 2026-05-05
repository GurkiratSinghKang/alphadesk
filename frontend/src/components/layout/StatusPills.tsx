"use client";

import { useEffect, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRegime } from "@/hooks/useQueries";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { toRegime } from "@/app/(dashboard)/_desk/selectors";
import { getMarketSession } from "@/lib/marketHours";

// EH-3d: globally visible session pill — "PRE-MARKET" / "AFTER HOURS"
// / "OVERNIGHT" — exposed from StatusPills so the same chrome the rest
// of the app already renders carries the indicator. Returns null
// during the regular cash session (09:30–16:00 ET, weekdays) and on
// weekends so the regular layout is unchanged.
type MarketSessionLabel = "PRE-MARKET" | "AFTER HOURS" | "OVERNIGHT";
function getMarketSessionLabel(now: Date = new Date()): MarketSessionLabel | null {
  const session = getMarketSession(now);
  if (session === "open" || session === "closed") return null;
  if (session === "pre") {
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
      // Defensive: fall through to PRE-MARKET on Intl errors.
    }
    return "PRE-MARKET";
  }
  return "AFTER HOURS";
}

function MarketSessionPill() {
  const [label, setLabel] = useState<MarketSessionLabel | null>(() =>
    getMarketSessionLabel(),
  );
  useEffect(() => {
    setLabel(getMarketSessionLabel());
    // 60s tick is sufficient — the bands transition on 30-minute /
    // hour boundaries, so polling once a minute means at most a
    // 60s lag at a transition. Lighter-weight than a 1Hz timer.
    const id = window.setInterval(() => setLabel(getMarketSessionLabel()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (!label) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        data-slot="market-session-pill"
        data-session={label}
        className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-eyebrow font-mono uppercase tracking-[0.12em] text-amber hover:bg-bg-elev-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        aria-label={`Market session: ${label}`}
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber" />
        <span>{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Extended hours data may be limited or stale
      </TooltipContent>
    </Tooltip>
  );
}

// Dot color per regime tone. Codebase uses CSS-var-based profit/loss/amber tokens
// (not bg-profit / bg-down-500 — those don't exist in the design system).
function regimeDotClass(regime: ReturnType<typeof toRegime>["regime"]): string {
  if (regime === "bull") return "bg-profit";
  if (regime === "bear" || regime === "crisis") return "bg-loss";
  return "bg-amber";
}

function RegimePill({
  regime,
}: {
  regime: ReturnType<typeof toRegime>;
}) {
  const dotClass = regimeDotClass(regime.regime);
  const displayLabel = regime.label ?? regime.regime;
  return (
    <Tooltip>
      <TooltipTrigger
        className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-eyebrow font-mono text-fg-muted hover:bg-bg-elev-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        aria-label={`Market regime: ${displayLabel}`}
      >
        <span
          className={cn("size-1.5 shrink-0 rounded-full", dotClass)}
          aria-hidden
        />
        <span className="hidden sm:inline">{displayLabel}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="font-medium capitalize">{displayLabel}</span>
        {regime.vol ? (
          <span className="ml-1 text-fg-muted">· {regime.vol} vol</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function VixPill({ vixLevel }: { vixLevel: number | null }) {
  const display = vixLevel != null && vixLevel > 0 ? vixLevel.toFixed(1) : "--.-";
  const tone =
    vixLevel == null || vixLevel === 0
      ? "text-fg-muted"
      : vixLevel >= 30
        ? "text-loss"
        : vixLevel >= 20
          ? "text-state-warning"
          : "text-fg-muted";

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          "flex items-center gap-1 rounded-sm px-2 py-1 text-eyebrow font-mono hover:bg-bg-elev-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        )}
        aria-label={`VIX: ${display}`}
      >
        <span className="text-fg-muted">VIX</span>
        <span className={tone}>{display}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span>VIX {display}</span>
        {vixLevel != null && vixLevel >= 30 ? (
          <span className="ml-1 text-loss">· high volatility</span>
        ) : vixLevel != null && vixLevel >= 20 ? (
          <span className="ml-1 text-state-warning">· elevated volatility</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function SessionPill({ mode }: { mode: "paper" | "live" }) {
  const isLive = mode === "live";
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          "flex items-center gap-1.5 rounded-sm px-2 py-1 text-eyebrow font-mono hover:bg-bg-elev-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          isLive ? "text-loss" : "text-profit"
        )}
        aria-label={`Session mode: ${isLive ? "LIVE trading" : "Paper trading"}`}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            isLive ? "bg-loss" : "bg-profit"
          )}
          aria-hidden
        />
        <span>{isLive ? "LIVE" : "PAPER"}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isLive
          ? "Real-money trading active — orders hit the broker"
          : "Paper mode — orders simulate against the paper account"}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * StatusPills
 * ───────────
 * Compact right-cluster pills for the 48px TopBar:
 *   regime dot · VIX · LIVE/PAPER
 *
 * Each pill reveals full detail on hover via a Tooltip.
 * Absorbs info previously displayed in the now-removed StatusStrip.
 */
export default function StatusPills() {
  const { data: regimeData } = useRegime();
  const tradingMode = useUIStore((s) => s.tradingMode);

  const regime = toRegime(regimeData?.regime ?? null);
  const vixLevel = regimeData?.regime?.vix_level ?? null;

  return (
    <div
      className="flex items-center gap-0.5"
      data-slot="topbar-status-pills"
      aria-label="Market status"
    >
      <RegimePill regime={regime} />
      <VixPill vixLevel={vixLevel} />
      {/* EH-3d: market session pill — renders only outside RTH so the
          regular daytime cluster is unchanged. */}
      <MarketSessionPill />
      <SessionPill mode={tradingMode} />
    </div>
  );
}
