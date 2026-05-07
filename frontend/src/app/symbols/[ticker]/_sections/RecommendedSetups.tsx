"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import OptionsPayoffPanel from "@/components/options/OptionsPayoffPanel";
import ConfidenceChip from "@/components/options/ConfidenceChip";
import LowConfidenceWarningModal from "@/components/options/LowConfidenceWarningModal";
import { isLowConfDirectional } from "@/lib/confidenceThresholds";
import { fmtCurrency, fmtPct } from "@/lib/intl";
import { formatOccSymbol } from "@/lib/occ";
import type { EarningsSetup } from "@/types";

import { payoffDraftFromSetup } from "../_lib/payoffDraftFromSetup";

// T8 audit P0 (2026-05-05): keep this aligned with the trade page's
// ALLOWED_COMBO_TYPES. Adding a setup_id here is a no-op until the
// backend's combo classifier accepts it, but a typo silently degrades
// the deep-link to "no combo" (the trade page falls back to per-leg
// notional pricing). Update both lists together.
//
// Keep in sync with backend trades.py:_ALLOWED.
const SETUP_ID_TO_COMBO_TYPE: Record<string, string> = {
  bull_put_spread: "vertical_spread",
  bear_call_spread: "vertical_spread",
  bull_call_spread: "vertical_spread",
  bear_put_spread: "vertical_spread",
  long_straddle: "straddle",
  short_straddle: "straddle",
  long_strangle: "strangle",
  short_strangle: "strangle",
  iron_condor: "iron_condor",
  iron_butterfly: "iron_butterfly",
  // Single-leg directional plays now accepted by the backend allowlist.
  long_call: "long_call",
  long_put: "long_put",
  // Income setups — backend supports these as combo_type values; the
  // recommender doesn't currently emit them but a manual deep-link
  // should still reach /trade with the correct classification.
  cash_secured_put: "cash_secured_put",
  covered_call: "covered_call",
};

function setupIdToComboType(setupId: string): string | null {
  return SETUP_ID_TO_COMBO_TYPE[setupId] ?? null;
}

export interface RecommendedSetupsProps {
  symbol: string;
  setups: EarningsSetup[] | null;
  isETF: boolean;
  underlying: number | null;
}

// T8 / UI-SPEC §1 Section 7. Surfaces the recommender's ranked top-3 as
// tradable cards (label + PoP + Kelly + payoff panel + trade CTA). The
// "Trade this setup" button deep-links into /trade using the canonical
// ``?legs=OCC:side:qty[:limit],…&combo_type=…`` shape so the ticket
// pre-stages without a network round-trip. Hidden for ETFs (no recommender
// coverage) and equities the recommender returned nothing for.
export function RecommendedSetups({
  symbol,
  setups,
  isETF,
  underlying,
}: RecommendedSetupsProps) {
  // P0 audit (2026-05-06): mirror EOP TradeButtonRow's discipline gate.
  // Directional setups under 50% confidence open a warning modal before
  // navigating to /trade; iron condor / long straddle bypass this surface.
  const router = useRouter();
  const [warningModal, setWarningModal] = useState<{
    href: string;
    setupName: string;
    confidencePct: number;
  } | null>(null);

  if (isETF) return null;
  if (!setups || setups.length === 0) return null;

  const top3 = setups.slice(0, 3);

  return (
    <section
      id="setups"
      data-testid="recommended-setups"
      data-slot="recommended-setups"
      className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24 mx-4 sm:mx-6 mb-6"
    >
      <h2 className="t-label u-muted">RECOMMENDED SETUPS</h2>
      <div className="mt-3 grid gap-3">
        {top3.map((setup, idx) => (
          <SetupCard
            key={setup.setupId + ":" + idx}
            setup={setup}
            symbol={symbol}
            underlying={underlying}
            rank={idx + 1}
            onLowConfClick={(payload) => setWarningModal(payload)}
          />
        ))}
      </div>
      <LowConfidenceWarningModal
        open={warningModal !== null}
        setupName={warningModal?.setupName ?? ""}
        confidencePct={warningModal?.confidencePct ?? 0}
        onCancel={() => setWarningModal(null)}
        onOverride={() => {
          const target = warningModal?.href ?? null;
          setWarningModal(null);
          if (target) router.push(target);
        }}
      />
    </section>
  );
}

function SetupCard({
  setup,
  symbol,
  underlying,
  rank,
  onLowConfClick,
}: {
  setup: EarningsSetup;
  symbol: string;
  underlying: number | null;
  rank: number;
  onLowConfClick: (payload: {
    href: string;
    setupName: string;
    confidencePct: number;
  }) => void;
}) {
  const router = useRouter();
  const draft = payoffDraftFromSetup(setup, symbol, underlying);
  const tradeHref = buildTradeHref(symbol, setup);
  const isSkip = setup.setupId === "skip";
  const setupLabelText = humanLabel(setup.setupId);

  const handleTradeClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (isLowConfDirectional(setup.setupLabel, setup.confidence)) {
      onLowConfClick({
        href: tradeHref,
        setupName: setupLabelText,
        confidencePct: Math.round((setup.confidence as number) * 100),
      });
      return;
    }
    router.push(tradeHref);
  };

  return (
    <article
      data-testid="setup-card"
      data-slot="setup-card"
      data-setup-id={setup.setupId}
      data-rank={rank}
      className="rounded-md border border-border-hair bg-bg p-3"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="t-label u-brand">#{rank}</span>
          <h3 className="t-mono text-body font-semibold">
            {setupLabelText}
          </h3>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="t-mono text-label u-muted tabular-nums">
            PoP {fmtPct(setup.popEstimate, 0)} · Kelly {fmtPct(setup.sizingKellyPct, 1)}
          </span>
          <ConfidenceChip confidence={setup.confidence} />
        </div>
      </header>

      {setup.rationale ? (
        <p className="mt-2 t-mono text-body-sm">{setup.rationale}</p>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 t-mono text-label tabular-nums">
        <Stat label="MAX PROFIT" value={formatPnL(setup.maxProfit)} />
        <Stat label="MAX LOSS" value={formatPnL(setup.maxLoss == null ? null : -Math.abs(setup.maxLoss))} />
        <Stat
          label="NET"
          value={fmtCurrency(setup.netCreditOrDebit, "USD", { signDisplay: "always" })}
        />
        <Stat
          label="BE"
          value={
            setup.breakevens.length === 0
              ? "—"
              : setup.breakevens.map((be) => fmtCurrency(be, "USD")).join(" / ")
          }
        />
      </dl>

      {!isSkip && draft != null ? (
        <div className="mt-3" data-slot="setup-payoff">
          <OptionsPayoffPanel draft={draft} title={setupLabelText} compact />
        </div>
      ) : null}

      {!isSkip ? (
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            data-testid="setup-trade-cta"
            data-slot="setup-trade-cta"
            data-href={tradeHref}
            onClick={handleTradeClick}
            className="inline-flex min-h-9 items-center rounded-sm border border-border bg-bg px-3 text-label font-semibold u-muted transition hover:border-primary hover:text-fg"
          >
            Trade this setup
          </button>
        </div>
      ) : null}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="t-label u-muted">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function formatPnL(value: number | null): string {
  if (value === null) return "Unlimited";
  return fmtCurrency(value, "USD", { signDisplay: "always" });
}

function humanLabel(setupId: string): string {
  return setupId.replace(/_/g, " ");
}

// T8 audit P0 (2026-05-05): emit the canonical /trade deep-link shape
// — `symbol=&legs=OCC:side:qty[:limit],…&combo_type=…&strategy=…`.
// The previous version base64-encoded a JSON ``combo`` param the trade
// page never reads, so clicking "Trade this setup" silently navigated
// to a blank ticket. Reuse ``formatOccSymbol`` from ``@/lib/occ`` so we
// don't duplicate OCC-encoding logic across the surface; that helper
// also defends against malformed expiries/strikes by returning null,
// which lets us degrade gracefully to the bare ``/trade?symbol=`` link
// rather than emitting a corrupt OCC string the broker would reject at
// submit time.
export function buildTradeHref(symbol: string, setup: EarningsSetup): string {
  if (!setup.legs || setup.legs.length === 0) {
    return `/trade?symbol=${encodeURIComponent(symbol)}`;
  }

  const legParts: string[] = [];
  for (const leg of setup.legs) {
    const occ = formatOccSymbol({
      symbol,
      expiry: leg.expiry,
      side: leg.contractType,
      strike: leg.strike,
    });
    if (!occ) {
      // Any malformed leg invalidates the whole combo — fall back to
      // the bare symbol link rather than ship a partial leg list.
      return `/trade?symbol=${encodeURIComponent(symbol)}`;
    }
    const limit =
      leg.mid != null && Number.isFinite(leg.mid) && leg.mid > 0
        ? `:${leg.mid.toFixed(2)}`
        : "";
    legParts.push(`${occ}:${leg.side}:${leg.qty}${limit}`);
  }

  const params = new URLSearchParams({
    symbol,
    legs: legParts.join(","),
    strategy: "earnings-options-play",
  });
  const comboType = setupIdToComboType(setup.setupId);
  if (comboType) params.set("combo_type", comboType);
  return `/trade?${params.toString()}`;
}

export default RecommendedSetups;
