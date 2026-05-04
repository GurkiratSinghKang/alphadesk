"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRegime } from "@/hooks/useQueries";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { toRegime } from "@/app/(dashboard)/_desk/selectors";

// Dot color per regime tone. Codebase uses CSS-var-based profit/loss/amber tokens
// (not bg-up-500 / bg-down-500 — those don't exist in the design system).
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
          ? "text-amber"
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
          <span className="ml-1 text-amber">· elevated volatility</span>
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
      <SessionPill mode={tradingMode} />
    </div>
  );
}
