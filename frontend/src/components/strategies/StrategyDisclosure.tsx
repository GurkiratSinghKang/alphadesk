"use client";

import * as React from "react";

import Eyebrow from "@/components/typography/Eyebrow";
import { cn } from "@/lib/utils";

/**
 * StrategyDisclosure
 * ──────────────────
 * Warning-toned banner attached to a handful of strategy detail pages that
 * carry caveats the consolidation report flagged. Copy is taken verbatim
 * from ``audit-reports/00-strategy-experts-consolidation.md`` §4
 * "Disclosure banners" — do NOT editorialise.
 *
 * Also accepts the ``live_disabled`` / ``paper_only`` flags surfaced by the
 * strategy catalog endpoint (see Wave 4) and renders a small
 * "NOT READY FOR LIVE" pill next to the headline when either is true.
 *
 * The component returns ``null`` for strategies that have no disclosure AND
 * no routing flag set, so the 7 non-disclosed strategy pages render
 * unchanged.
 */

// Keyed on the canonical hyphen-id the strategy detail page passes in
// (i.e. the ``strategyId`` already resolved by ``resolveStrategyId``).
const DISCLOSURE_COPY: Record<string, string> = {
  "momentum-quality":
    "Tuner-on-test selection bias (fixed Wave 5; re-tune pending). Realistic forward Sharpe 0.4 – 1.0 on random 2-year window. Universe is a frozen 2026-visibility mega-cap list (survivorship-biased).",
  pead: "Selection-on-test tuner (fixed Wave 5; re-tune pending). Static 170-name universe is 2024-era winners. FMP /stable earnings calendar does not supply AMC/BMO field, so all trades currently anchor to AMC — BMO reporters silently skipped. Post-Wave-1 OOS Sharpe 0.96 with event-conditional MOO slippage.",
  "vrp-harvesting":
    "Kill-switch exit paths are empirically untested; all OOS exits were DTE-rolls. Bid/ask spreads synthesised, not observed. Tuner selected params on OOS window (fixed Wave 5; re-tune pending). Do not pass to live capital until at least one OOS window contains a genuine tail event.",
  "ts-momentum":
    "Tuner-on-test selection bias (fixed Wave 5; re-tune pending). Ships long-only in the current config. Crisis alpha (short-leg during equity drawdowns) is architecturally available but switched off. Enable `shorts_enabled=True` only after explicit re-tune.",
  orb: "Headline OOS Sharpe 8.34 was inflated by leveraged ETFs, a 20% notional clip, and a disabled volume filter (all fixed Wave 2). Post-fix Sharpe 4.78 with 95% CI [-0.02, 9.57] — zero edge is within the confidence band. Strategy is structurally unfit for live capital.",
  "earnings-vol-premium":
    "Tuner-on-test selection bias (fixed Wave 5; re-tune pending). 10-event OOS sample is small (±0.5 Sharpe CI). Published Sharpe is an upper bound, not an expectation. `exit_timing=\"1h_after_open\"` is silently executed as MOO (daily-engine limitation).",
  "pairs-trading":
    "Tuner-on-test selection bias (fixed Wave 5; re-tune pending). Prior OOS Sharpe 1.23 was inflated by a raw-price spread bug; log-price fix (Wave 2) drops realistic Sharpe to 0.39 on old tune winners. Re-tune on log-space needed to recover into 0.5 – 0.8 band.",
  "dual-momentum":
    "Tuner-on-test selection bias (fixed Wave 5; re-tune pending). DEFAULTS (not tuned) produce Sharpe 1.26, consistent with Antonacci's published GEM. Tuned variant (SPY/EFA/EEM + blend_126_252) flagged as diagnostic-only.",
  "regime-adaptive":
    "Tuner-on-test selection bias (fixed Wave 5; re-tune pending). Regime machinery was not stressed in the 2023 – 2024 OOS window (no genuine bear regime). Reported Sharpe 1.62 is regime-favourable, not a forward expectation.",
  "kama-breakout":
    "PAPER-ONLY until at least 15 – 25 round-trip trades on a 2019 – 2024 walk-forward confirm an edge. Current OOS sample is 7 trades with Sharpe CI [0.2, 3.1] — too thin to claim alpha. Tuner-on-test selection bias (fixed Wave 5; re-tune pending).",
};

export interface StrategyDisclosureProps {
  /** Strategy route id (hyphen form — e.g. "momentum-quality", "orb"). */
  strategyId: string;
  /**
   * Wave 4 — when true, renders a "NOT READY FOR LIVE" pill. Sourced from
   * the strategy catalog endpoint. Optional; defaults to false.
   */
  liveDisabled?: boolean;
  /**
   * Wave 4 — when true, renders a "NOT READY FOR LIVE" pill with the
   * paper-only qualifier in the copy. Optional; defaults to false.
   */
  paperOnly?: boolean;
  className?: string;
}

export default function StrategyDisclosure({
  strategyId,
  liveDisabled = false,
  paperOnly = false,
  className,
}: StrategyDisclosureProps) {
  const copy = DISCLOSURE_COPY[strategyId];
  const showPill = liveDisabled || paperOnly;

  // Render nothing for strategies with neither a disclosure nor a routing
  // flag. Keeps the 7 PASS strategy pages unchanged.
  if (!copy && !showPill) return null;

  const pillLabel = liveDisabled
    ? "Not ready for live"
    : paperOnly
      ? "Paper-only"
      : null;

  // A3#5 — WCAG contrast. Previously the pill used ``text-amber`` (#d9a441)
  // on a ``bg-amber/[0.04]`` surface. Against the near-black card
  // (effectively still dark after the 4% amber tint) the mid-tone amber
  // squeaked to ~4.0:1, which fails the 4.5:1 AA threshold for text below
  // 18pt. Lifting to ``text-amber-100`` (Tailwind default near-white pale
  // yellow #fef3c7) puts us comfortably over 12:1 on the same surface.
  const pillAriaLabel = liveDisabled
    ? "Live trading disabled"
    : paperOnly
      ? "Paper trading only"
      : undefined;

  return (
    <aside
      data-testid="strategy-disclosure"
      data-strategy={strategyId}
      data-live-disabled={liveDisabled || undefined}
      data-paper-only={paperOnly || undefined}
      role="note"
      // Persona 71-1 — the outer ``aria-live="polite"`` caused a double
      // announce on mount: VoiceOver/NVDA read the whole aside (Eyebrow +
      // pill + copy), then also announced the inner ``role="status"``
      // pill. Removed the outer live region so the pill's ``role=status``
      // is the sole late-arriving signal. The disclosure copy is static
      // content once the component mounts, so it does not need to be a
      // live region — a researcher navigating the page with AT will still
      // encounter the banner as a plain ``role=note`` landmark. This also
      // addresses persona 71-2 (every ``perf`` tick was re-announcing the
      // full copy while the polite region remained mounted).
      className={cn(
        "flex flex-col gap-3 border-l-2 border-amber/60 bg-amber/[0.04] py-3 pl-5 pr-4",
        "rounded-sm",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Eyebrow as="span" className="text-amber-100">
          Disclosure
        </Eyebrow>
        {pillLabel ? (
          <span
            data-testid="strategy-disclosure-pill"
            role="status"
            aria-label={pillAriaLabel}
            className={cn(
              "inline-flex items-center rounded-pill border border-amber/60 px-2 py-0.5",
              "font-sans text-[10.5px] font-semibold uppercase tracking-[0.14em] text-amber-100"
            )}
          >
            {pillLabel}
          </span>
        ) : null}
      </div>
      {copy ? (
        <p className="font-display italic text-[14.5px] leading-relaxed text-fg-dim">
          {copy}
        </p>
      ) : null}
    </aside>
  );
}
