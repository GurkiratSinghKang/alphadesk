"use client";

/**
 * `/trade` — full-screen trade workspace.
 *
 * The earlier stub on this route redirected straight back to `/` which
 * created a nav loop whenever the TopBar / shortcuts / CommandPalette
 * pointed here. This implementation renders a focused trade workspace
 * composed entirely of existing Layer-2 composites so we're not inventing
 * new UI while the panel retirement pass is in-flight.
 *
 * Layout (single-column, scrolls): heading → chart → order bar →
 * pre-staged contract(s) → recent orders.
 *
 * Query-param pre-fill (Task 22/23, Round-5 F-1 / F-2 / F-3 / F-14):
 *   Single-leg:
 *     /trade?symbol=NVDA&contract=NVDA260425C00205000&side=sell&qty=1
 *           &limit=1.42&strategy=earnings-options-play
 *
 *   Multi-leg (canonical syntax — Round-5 F-3):
 *     /trade?symbol=NVDA&legs=OCC:side:qty[:limit][,OCC:side:qty[:limit]…]
 *           &strategy=earnings-options-play&combo_type=strangle
 *
 *   Backwards-compat: legs missing the `:limit` slot still parse — limit
 *   ends up undefined and the OrderBar shows blank in that field.
 *
 *   Examples:
 *     legs=NVDA260424P00200000:sell:1:1.45,NVDA260424C00220000:sell:1:1.32   (NEW — limits)
 *     legs=NVDA260424P00200000:sell:1,NVDA260424C00220000:sell:1             (OLD — still works)
 */
	import { useEffect, useMemo, useRef, useState, type ElementType } from "react";
	import Link from "next/link";
	import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ArrowsLeftRight,
  ArrowsOut,
  ChartLine,
  CheckCircle,
  Clock,
  Crosshair,
  FunnelSimple,
  Gauge,
  Lightning,
  ListChecks,
  LockSimple,
  Plug,
  Rows,
  Scales,
  ShieldWarning,
  SlidersHorizontal,
  TrendUp,
  WarningCircle,
} from "@phosphor-icons/react";

import {
  OrderBar,
  PriceChartPanel,
  type ChartBar,
  type ChartRange,
  type StagedOrder,
} from "@/components/composites";
import type { ChartOrderPlacement, ChartTradeOverlay } from "@/components/charts/ChartPane";
import OptionsPayoffPanel from "@/components/options/OptionsPayoffPanel";
import OptionsStrategyBuilder from "@/components/options/OptionsStrategyBuilder";
import { ExtendedHoursBadge } from "@/components/primitives/ExtendedHoursBadge";
import { getBars, getOrders, getSnapshots, placeOrder } from "@/lib/api";
import { barsRequestForRange } from "@/lib/chartRange";
import { isOccSymbol, parseOccSymbol } from "@/lib/occ";
import { ORDER_BAR_DEFAULTS, isValidOrderQty } from "@/lib/orderDefaults";
import { isMarketOpen } from "@/lib/marketHours";
import { isWorkingOrderStatus } from "@/lib/orders";
import {
  deriveLegReadiness,
  type LegQuoteUnavailable,
  type LegReadinessState,
} from "@/lib/legQuoteReadiness";
import type { OptionStrategyDraft, OptionStrategyLeg } from "@/lib/optionsPayoff";
import { cn, formatCurrency } from "@/lib/utils";
import type { Order, Position } from "@/types";
import { useMarketStore, useQuote } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { useStrategies } from "@/hooks/useQueries";
import { useToast } from "@/hooks/useToast";

import {
  toMarketSymbol,
  toMetaCells,
  toQuote,
  toRailItems,
  toStrategyOptions,
} from "../_desk/selectors";

function normalizeUnderlyingSymbol(raw: string | null): string | null {
  const sym = (raw ?? "").trim().toUpperCase();
  if (!sym) return null;
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym) ? sym : null;
}

function parseQuoteSnapshotTs(raw: string | null): number | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric / 1000 : numeric;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/**
 * Audit Persona F1.8 (2026-05-06): detect the backend's stale-quote /
 * price-drift 422 detail strings so the submit-path catch block can
 * route them into the inline banner instead of the disposable toast.
 *
 * Backend constants live in ``backend/services/orders.py``:
 *   ``QUOTE_STALENESS_MAX_SECONDS`` → "Quote staleness: snapshot is N.Ns old"
 *   ``QUOTE_PRICE_DRIFT_MAX_FRACTION`` → "Price drift exceeds N bps"
 *
 * Match is case-insensitive on both phrases. Returning true means the
 * trader needs to refresh the chain and re-stage, which is a multi-step
 * recovery the toast lifetime (4-6s) can't host.
 */
function isStaleQuoteOrDriftMessage(message: string): boolean {
  const lc = message.toLowerCase();
  return lc.includes("quote staleness") || lc.includes("price drift");
}

// ─── Pre-fill state types ──────────────────────────────────────────────────────

interface ActiveContract {
  occ: string;
  symbol: string;
  expiry: string;
  side: "call" | "put";
  strike: number;
  orderSide: "buy" | "sell";
  qty: number;
  /**
   * Round-5 F-3 — optional limit price parsed from `?limit=` (single-leg)
   * or the `:limit` slot in `?legs=` (multi-leg). Undefined when the URL
   * came from a context with no available mid (e.g. options chain
   * unavailable on the source page).
   */
  limitPrice?: number;
}

interface ActiveLeg {
  occ: string;
  symbol: string;
  expiry: string;
  side: "call" | "put";
  strike: number;
  orderSide: "buy" | "sell";
  qty: number;
  limitPrice?: number;
}

interface PlainEquityPrefill {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type: "market" | "limit" | "stop" | "stop_limit";
  price?: number;
  stop?: string;
}

// Keep in sync with backend trades.py:_ALLOWED — the frontend allowlist
// must mirror the server's combo classifier, otherwise deep-links from
// the symbols page (long_call, long_put, cash_secured_put, …) silently
// drop combo_type, fall back to per-leg notional pricing, and trip the
// undefined-risk reject at submit.
const ALLOWED_COMBO_TYPES = new Set([
  "custom",
  "cash_secured_put",
  "covered_call",
  "diagonal_spread",
  "iron_condor",
  "iron_butterfly",
  "long_call",
  "long_put",
  "married_put",
  "short_call",
  "short_put",
  "straddle",
  "strangle",
  "vertical_spread",
]);

// ─────────────────────────────────────────────────────────────────────────────

export default function TradePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const { toast } = useToast();
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
  const portfolioPositions = usePortfolioStore((s) => s.positions);
  const portfolioSummary = usePortfolioStore((s) => s.summary);
  const brokerDegraded = usePortfolioStore((s) => s.brokerDegraded);
  const [urlUnderlyingSymbol, setUrlUnderlyingSymbol] = useState<string | null>(() => {
    return normalizeUnderlyingSymbol(searchParams.get("symbol"));
  });
  const tradeContextSymbol = urlUnderlyingSymbol ?? selectedSymbol;
  // Wave 14 perf-audit-r3 P0 #3: scoped to selected symbol only.
  const selectedQuote = useQuote(tradeContextSymbol);
  // QA r1 A2: when an option contract is staged, also subscribe to the
  // contract's own quote so OrderBar telemetry can surface the option market
  // (bid/ask/spread) instead of the underlying stock's. Underlying freshness
  // remains the broker-degraded gate (see buildExecutionReadiness).
  const { data: strategiesResp } = useStrategies();

  const rail = useMemo(() => toRailItems(strategiesResp), [strategiesResp]);
  const strategyOptions = useMemo(() => toStrategyOptions(rail), [rail]);

  // ─── Query-param pre-fill (Task 22 / 23, Round-5 F-1 / F-2 / F-3) ──────────
  const [activeContract, setActiveContract] = useState<ActiveContract | null>(null);
  const [activeLegs, setActiveLegs] = useState<ActiveLeg[]>([]);
  // Strategy tag from URL — flows through to placeOrder so /reports
  // attributes the trade. Round-5 F-1.
  const [urlStrategy, setUrlStrategy] = useState<string | null>(null);
  // Combo classification — `strangle` | `iron_condor` | `vertical_spread`.
  // Set by the earnings deep-link; surfaced to the broker so the risk gate
  // recognises a defined-risk spread. Round-5 F-14.
  const [comboType, setComboType] = useState<string | null>(null);
  const [quoteAtFillTs, setQuoteAtFillTs] = useState<number | null>(null);
  const [plainEquityPrefill, setPlainEquityPrefill] =
    useState<PlainEquityPrefill | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(searchKey);
    const contractOcc = params.get("contract");
    const legsParam = params.get("legs");
    const strategyParam = params.get("strategy");
    const comboParam = params.get("combo_type");
    const quoteTsParam = parseQuoteSnapshotTs(params.get("quote_ts"));
    const underlyingFromUrl = normalizeUnderlyingSymbol(params.get("symbol"));
    let firstParsedUnderlying: string | null = null;

    setUrlStrategy(strategyParam || null);
    const normalizedCombo = (comboParam ?? "").trim().toLowerCase();
    setComboType(ALLOWED_COMBO_TYPES.has(normalizedCombo) ? normalizedCombo : null);
    setQuoteAtFillTs(quoteTsParam);
    setActiveContract(null);
    setActiveLegs([]);
    setPlainEquityPrefill(null);

    if (contractOcc) {
      // Single-leg deep-link.
      const parsed = parseOccSymbol(contractOcc);
      if (parsed) {
        firstParsedUnderlying = parsed.symbol;
        const rawSide = params.get("side") ?? "buy";
        const orderSide: "buy" | "sell" = rawSide === "sell" ? "sell" : "buy";
        const qty = parseInt(params.get("qty") ?? "1", 10) || 1;
        // Round-5 F-3 — `?limit=` populates the OrderBar's price field.
        const rawLimit = params.get("limit");
        const lim = rawLimit ? parseFloat(rawLimit) : NaN;
        const limitPrice = Number.isFinite(lim) && lim > 0 ? lim : undefined;
        setActiveContract({ occ: contractOcc, ...parsed, orderSide, qty, limitPrice });
      }
    } else if (legsParam) {
      // Multi-leg deep-link: comma-separated CONTRACT:side:qty[:limit] tuples.
      // Round-5 F-3: the optional `:limit` 4th field carries the per-leg
      // mid price so each pre-staged leg shows a sensible default. The
      // 3-field form (no `:limit`) keeps parsing for backwards-compat.
      const legs: ActiveLeg[] = [];
      for (const raw of legsParam.split(",")) {
        const parts = raw.split(":");
        // Audit MF-P0-2 (2026-05-05): the prior guard ``parts.length < 1``
        // was vacuously false — String.split always returns ≥1 element
        // (an empty string yields ``[""]``). The intended minimum is the
        // three mandatory fields OCC:side:qty. Without this guard, a
        // deep-link with a truncated leg (copy-paste that clipped a
        // colon, URL-shortener mangle) silently dropped that leg via
        // ``parseOccSymbol("")`` returning null, submitting a different-
        // risk combo than the user staged with no warning.
        if (parts.length < 3) continue;
        const [occ, rawSide, rawQty, rawLimit] = parts;
        const parsed = parseOccSymbol(occ);
        if (!parsed) continue;
        firstParsedUnderlying ??= parsed.symbol;
        const orderSide: "buy" | "sell" = rawSide === "sell" ? "sell" : "buy";
        const qty = parseInt(rawQty ?? "1", 10) || 1;
        const lim = rawLimit ? parseFloat(rawLimit) : NaN;
        const limitPrice = Number.isFinite(lim) && lim > 0 ? lim : undefined;
        legs.push({ occ, ...parsed, orderSide, qty, limitPrice });
      }
      if (legs.length > 0) setActiveLegs(legs);
    } else if (underlyingFromUrl) {
      const rawSide = params.get("side") ?? "buy";
      const side: "buy" | "sell" = rawSide === "sell" ? "sell" : "buy";
      const qtyRaw = Number(params.get("qty") ?? "1");
      const qty = Number.isInteger(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
      const rawType = params.get("type");
      const type: PlainEquityPrefill["type"] =
        rawType === "limit" ||
        rawType === "stop" ||
        rawType === "stop_limit" ||
        rawType === "market"
          ? rawType
          : "market";
      const rawLimit = params.get("limit") ?? params.get("price");
      const limit = rawLimit ? Number(rawLimit) : NaN;
      const rawStop = params.get("stop") ?? params.get("stop_price");
      const stop = rawStop ? Number(rawStop) : NaN;
      setPlainEquityPrefill({
        symbol: underlyingFromUrl,
        side,
        qty,
        type,
        price: Number.isFinite(limit) && limit > 0 ? limit : undefined,
        stop: Number.isFinite(stop) && stop > 0 ? String(stop) : undefined,
      });
    }
    const nextUnderlying = underlyingFromUrl ?? firstParsedUnderlying;
    if (nextUnderlying) {
      setUrlUnderlyingSymbol(nextUnderlying);
      setSelectedSymbol(nextUnderlying);
    }
  }, [searchKey, setSelectedSymbol]);

  // Audit Persona F1.8 (2026-05-06): auto-refresh ``quote_at_fill_ts`` while
  // a multi-leg option ticket is being drafted. The URL pre-fill captures
  // ``quote_ts`` ONCE at deep-link time; if the user then drafts the
  // ticket for >30s the backend's stale-quote gate
  // (``QUOTE_STALENESS_MAX_SECONDS = 30``) trips on submit and the trader
  // sees a generic "Order submission failed" toast.
  //
  // Auto-refresh ONLY changes the freshness timestamp — it does NOT
  // re-fetch the chain or re-price legs (out of scope). The 25s cadence
  // keeps it just below the backend's 30s gate so the most pessimistic
  // round-trip still lands inside the window.
  //
  // Equity-only tickets are exempt: the backend doesn't fail-closed on
  // equity quote staleness, and pumping ``quote_at_fill_ts`` for them
  // would mask genuinely-stale equity quotes from the drift gate.
  useEffect(() => {
    const hasOptionLegs = activeLegs.some((leg) => isOccSymbol(leg.occ));
    if (!hasOptionLegs) return;
    const interval = setInterval(() => {
      setQuoteAtFillTs(Date.now() / 1000);
    }, 25_000);
    return () => clearInterval(interval);
  }, [activeLegs]);

  useEffect(() => {
    function onAddAlert(e: Event) {
      const detail = (e as CustomEvent<{
        symbol?: string;
        price?: number;
      }>).detail;
      const sym = normalizeUnderlyingSymbol(detail?.symbol ?? null);
      const price = detail?.price;
      if (!sym || !Number.isFinite(price as number)) return;
      router.push(`/alerts?prefillSymbol=${encodeURIComponent(sym)}&prefillPrice=${(price as number).toFixed(2)}`);
    }

    function onPlaceLimit(e: Event) {
      const detail = (e as CustomEvent<{
        symbol?: string;
        price?: number;
        side?: "buy" | "sell";
      }>).detail;
      const sym = normalizeUnderlyingSymbol(detail?.symbol ?? null);
      const price = detail?.price;
      if (!sym || !Number.isFinite(price as number)) return;
      const side = detail?.side === "sell" ? "sell" : "buy";
      setUrlUnderlyingSymbol(sym);
      setSelectedSymbol(sym);
      setActiveContract(null);
      setActiveLegs([]);
      setComboType(null);
      setQuoteAtFillTs(null);
      setPlainEquityPrefill({
        symbol: sym,
        side,
        qty: 1,
        type: "limit",
        price: Number((price as number).toFixed(2)),
      });
      toast({
        type: "info",
        message: `Staged ${side.toUpperCase()} limit for ${sym} @ ${(price as number).toFixed(2)}`,
      });
    }

    window.addEventListener("alphadesk:add-price-alert", onAddAlert as EventListener);
    window.addEventListener("alphadesk:place-limit-from-chart", onPlaceLimit as EventListener);
    return () => {
      window.removeEventListener("alphadesk:add-price-alert", onAddAlert as EventListener);
      window.removeEventListener("alphadesk:place-limit-from-chart", onPlaceLimit as EventListener);
    };
  }, [router, setSelectedSymbol, toast]);

  const [range, setRange] = useState<ChartRange>("1M");
  const [series, setSeries] = useState<ChartBar[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [chartReloadKey, setChartReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSeriesLoading(true);
      setSeriesError(null);
      try {
        const { timeframe, limit } = barsRequestForRange(range);
        const bars = await getBars(tradeContextSymbol, timeframe, limit);
        if (!cancelled) setSeries(bars);
      } catch (err) {
        if (!cancelled) {
          setSeries([]);
          setSeriesError(err instanceof Error ? err.message : "Chart data unavailable");
        }
      } finally {
        if (!cancelled) setSeriesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tradeContextSymbol, range, chartReloadKey]);

  const quote = toQuote(selectedQuote ?? undefined);
  const meta = toMetaCells(selectedQuote ?? undefined);
  const symbol = toMarketSymbol(tradeContextSymbol);
  // QA r1 A2: option-contract quote (single-leg). useQuote("") returns null
  // and is a no-op subscription, so this is cheap when no contract is staged.
  const optionContractRawQuote = useQuote(activeContract?.occ ?? "");
  // R4-5 W-3 — track when the option snapshot fan-out came back missing
  // the staged OCC. Previously the silent .catch() left the trader staring
  // at "--" telemetry with no hint why; now we light up an inline banner in
  // the OrderBar with a Retry handler. The retry tick re-runs this effect
  // by changing the dep, mirroring the chartReloadKey pattern above.
  const [optionsSnapshotRetry, setOptionsSnapshotRetry] = useState(0);
  const [optionsUnavailable, setOptionsUnavailable] = useState<{
    occ: string;
    underlying: string;
  } | null>(null);
  // R6-5 (closes R5-B1, R5-M5) — multi-leg extension of optionsUnavailable
  // above. R4-W-3 shipped the singular activeContract path; the
  // activeLegs[] array path was untouched. The R5 sweep captured a
  // strangle deep-link where both legs 404'd and the trader was shown the
  // underlying NVDA quote dressed as a leg spread, with the
  // execution-readiness pill claiming "2 passed checks". A trader could
  // submit a real-money order on bogus pricing.
  //
  // This list mirrors the singular pattern: each entry describes a leg
  // whose OCC was missing from the snapshot fan-out's result map. The
  // OrderBar surfaces a per-leg banner; buildExecutionReadiness gates
  // submit via deriveLegReadiness (lib/legQuoteReadiness.ts).
  const [legsUnavailable, setLegsUnavailable] = useState<LegQuoteUnavailable[]>([]);
  // Audit MF-P0-3 (2026-05-05): refs that mirror activeLegs +
  // legsUnavailable so the async ``handleSubmit`` reads the freshest
  // committed state instead of a closure snapshot from a prior render.
  // Critical when the chart overlay's ``submit`` arrow is captured at
  // memo time but fires after a state change has cleared/added legs.
  const activeLegsRef = useRef(activeLegs);
  const legsUnavailableRef = useRef(legsUnavailable);
  useEffect(() => {
    activeLegsRef.current = activeLegs;
  }, [activeLegs]);
  useEffect(() => {
    legsUnavailableRef.current = legsUnavailable;
  }, [legsUnavailable]);
  // P1-19 BL-1.5: simple per-page network call counter. Increments inside
  // each batched fetch path below; logs to debug at unmount so QA / DevTools
  // can spot fan-out regressions in `console.jsonl`. Implementation lives
  // alongside the snapshot effect because that's where most of /trade's
  // network volume originates today.
  const networkCallCounter = useRef(0);
  useEffect(() => {
    return () => {
      // Only debug-level — production noise budget should stay tiny. The
      // payload makes regressions visible during QA replay (a 4-leg
      // deep-link should produce exactly ONE snapshot call now).
      // eslint-disable-next-line no-console
      console.debug(
        `[trade] page network calls: ${networkCallCounter.current}`,
      );
    };
  }, []);

  // P1-19 BL-1.4: stable join key for the snapshot effect deps. activeLegs
  // is a freshly-allocated array on every render of TradePage (e.g. when
  // the URL search-key flips), which previously made `[…, activeLegs]`
  // fire the effect every render even if the OCC list was identical.
  // Joining the OCCs into a comma-separated string gives the dep array a
  // value-stable identity — same legs ⇒ same string ⇒ no refetch.
  const legsKey = useMemo(
    () => activeLegs.map((leg) => leg.occ).join(","),
    [activeLegs],
  );
  const activeContractKey = activeContract?.occ ?? null;

  // QA r1 A2 follow-up: hydrate the OCC quote into the store. The data
  // pipeline bridge only fans out for the equity watchlist + selected
  // symbol — option contracts deep-linked via ?contract= / ?legs= aren't
  // part of either, so the store would otherwise stay empty for them and
  // OrderBar telemetry would render "--" indefinitely. Fetch on
  // activeContract / activeLegs change; updateQuotes merges into the
  // store, after which useQuote starts returning the contract's market.
  //
  // P1-19 BL-1.1: switched the per-symbol fan-out (getSnapshot) for the
  // batched `/api/v1/market/snapshots?symbols=…` endpoint via getSnapshots.
  // A 4-leg iron condor previously cost 4-5 sequential round-trips here
  // (one per OCC + underlying). The batched endpoint collapses that to
  // exactly ONE upstream call. getSnapshots falls back to the per-symbol
  // path internally if the batch endpoint is unavailable, so degradation
  // behaviour is identical to before. Also: the dep array uses
  // `legsKey` (joined OCCs) instead of the array reference so a re-render
  // with the same legs doesn't refire this effect — see BL-1.4 above.
  useEffect(() => {
    const symbols: string[] = [];
    if (activeContract) symbols.push(activeContract.occ);
    for (const leg of activeLegs) symbols.push(leg.occ);
    if (symbols.length === 0) {
      setOptionsUnavailable(null);
      setLegsUnavailable([]);
      return;
    }
    let cancelled = false;
    // R6-5: snapshot helper for the multi-leg branch. getSnapshots
    // returns a partial map of {OCC: Quote}; we detect missing OCCs by
    // absence rather than rejection.
    const computeMissingLegs = (
      snapshot: Record<string, unknown>,
    ): LegQuoteUnavailable[] => {
      if (activeLegs.length === 0) return [];
      const missing: LegQuoteUnavailable[] = [];
      for (const leg of activeLegs) {
        if (!(leg.occ in snapshot)) {
          missing.push({
            occ: leg.occ,
            symbol: leg.symbol,
            reason: "404",
          });
        }
      }
      return missing;
    };
    networkCallCounter.current += 1;
    getSnapshots(symbols)
      .then((snapshot) => {
        if (cancelled) return;
        const quotes = Object.values(snapshot);
        if (quotes.length > 0) {
          useMarketStore.getState().updateQuotes(quotes);
        }
        // R4-5 W-3: getSnapshots (and its fan-out fallback) swallows
        // per-symbol failures. If the staged OCC is missing from the
        // result map, surface that to the OrderBar so the trader sees
        // the degradation. Equity-only tickets (no activeContract)
        // don't get this banner.
        if (activeContract && !(activeContract.occ in snapshot)) {
          setOptionsUnavailable({
            occ: activeContract.occ,
            underlying: activeContract.symbol,
          });
        } else {
          setOptionsUnavailable(null);
        }
        // R6-5: same detection mirrored across activeLegs[]. The DOM
        // snapshot at qa/runs/2026-05-04T20-31-40Z confirmed both legs of
        // a strangle 404'd and zero `data-slot=order-bar-*` rendered;
        // setting this state populates the new banner + drives the pill.
        setLegsUnavailable(computeMissingLegs(snapshot));
      })
      .catch(() => {
        // Total network failure (rare — getSnapshots already falls back
        // to a per-symbol fan-out internally on batch failure). Still
        // surface as unavailable so the UI is honest.
        if (cancelled) return;
        if (activeContract) {
          setOptionsUnavailable({
            occ: activeContract.occ,
            underlying: activeContract.symbol,
          });
        }
        // R6-5: on a total network failure, every leg is effectively
        // unavailable. Mark the whole array so the pill goes coral.
        if (activeLegs.length > 0) {
          setLegsUnavailable(
            activeLegs.map((leg) => ({
              occ: leg.occ,
              symbol: leg.symbol,
              reason: "generic",
            })),
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // P1-19 BL-1.4: depend on stable scalar keys, not array references.
    // activeLegs / activeContract change reference per render even when
    // the underlying OCCs haven't moved; legsKey + activeContractKey
    // collapse identical-payload renders into a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContractKey, legsKey, optionsSnapshotRetry]);
  const optionContractQuote = useMemo(
    () =>
      activeContract && optionContractRawQuote
        ? toQuote(optionContractRawQuote)
        : null,
    [activeContract, optionContractRawQuote],
  );
  const quoteTone = quote.change > 0 ? "text-profit" : quote.change < 0 ? "text-loss" : "text-fg-muted";
  const [symbolDraft, setSymbolDraft] = useState(tradeContextSymbol);
  useEffect(() => {
    setSymbolDraft(tradeContextSymbol);
  }, [tradeContextSymbol]);

  function commitSymbolDraft() {
    const next = normalizeUnderlyingSymbol(symbolDraft);
    if (!next) {
      setOrderError("Enter a valid ticker before loading the chart");
      return;
    }
    setOrderError(null);
    setUrlUnderlyingSymbol(next);
    setSelectedSymbol(next);
    setActiveContract(null);
    setActiveLegs([]);
    setComboType(null);
    setQuoteAtFillTs(null);
    setPlainEquityPrefill({
      symbol: next,
      side: "buy",
      qty: 1,
      type: "market",
    });
    router.push(`/trade?symbol=${encodeURIComponent(next)}`);
  }

  /* ─── Recent orders strip ──────────────────────────────── */
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("working");
  useEffect(() => {
    let cancelled = false;
	    async function fetchRecent() {
	      try {
	        const status = orderFilter === "working" ? "open" : orderFilter === "all" ? undefined : orderFilter;
	        const orders = await getOrders(status);
	        if (!cancelled) setRecentOrders(orders.slice(0, 50));
	      } catch {
        /* keep last-known orders on transient fetch failures */
      }
    }
    fetchRecent();
    // Audit F-F10 (2026-05-05): the prior 20s interval ran independent
    // of the dashboard's 30s order poll, so a user with both surfaces
    // open (or rapid back-and-forth navigation) doubled the load on
    // /api/v1/orders. Two changes:
    //   (1) Match the dashboard's 30s cadence so the desk-shared query
    //       lands in lockstep across components that read it.
    //   (2) Pause when the tab is hidden — stale orders rendered to a
    //       background tab carry no value and traders only act on this
    //       view when it's actually visible. The store's WebSocket
    //       subscription continues to mutate ``recentOrders`` from
    //       fill events regardless of poll cadence.
    const POLL_MS = 30_000;
    let id: ReturnType<typeof setInterval> | null = setInterval(fetchRecent, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (id != null) {
          clearInterval(id);
          id = null;
        }
      } else {
        if (id == null) {
          fetchRecent();
          id = setInterval(fetchRecent, POLL_MS);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (id != null) clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [orderFilter]);
	  // Audit MF-P1-3 (2026-05-05): the prior memo re-filtered ``recentOrders``
	  // even though the fetch path already requested only the matching status
	  // from the backend (``orderFilter === "working"`` → ``status=open``).
	  // Worse, when toggling to ``"all"``, the stored 50-order slice was still
	  // whatever the previous filtered fetch returned — history truncated
	  // silently. Now: trust the backend filter, slice once for display.
	  // ``isWorkingOrderStatus`` is no longer needed at this layer.
	  const filteredRecentOrders = useMemo(
	    () => recentOrders.slice(0, 10),
	    [recentOrders],
	  );

  /* ─── Submit handler ───────────────────────────────────── */
  const [submitting, setSubmitting] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  // BUG-002 — inline-error mirror of the toast. See desk `page.tsx`.
  const [orderError, setOrderError] = useState<string | null>(null);
  // Audit Persona F1.8 (2026-05-06): when the backend rejects with a
  // stale-quote / price-drift 422 we surface the message in a dedicated
  // banner above the OrderBar. Toasts disappear in 4-6s; a stale-quote
  // rejection means the trader needs to refresh the chain and re-stage,
  // which is too much to ask in a fading toast on a fast-moving ticket.
  const [staleQuoteError, setStaleQuoteError] = useState<string | null>(null);

	  async function handleSubmit(order: StagedOrder): Promise<boolean> {
	    if (submitting) return false;
    setOrderError(null);
    setStaleQuoteError(null);
    const sym = (order.symbol || "").trim().toUpperCase();
    const qty = Number(order.quantity);
    const fail = (msg: string) => {
      toast({ type: "error", message: msg });
      setOrderError(msg);
    };
    // Symbol can be a bare equity ticker OR a full OCC option contract
    // (1-6 letters + 6 digits + C/P + 8 digits). The previous regex
    // capped at 10 chars and rejected the 21-char OCC form, which broke
    // single-leg option deep-links from the earnings page.
	    if (!sym || !(/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym) || /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(sym))) {
	      fail("Enter a valid symbol (1–10 letters/digits or full OCC contract)");
	      return false;
	    }
	    if (!isValidOrderQty(qty)) {
	      fail("Quantity must be a whole number between 1 and 999,999,999");
	      return false;
	    }
	    if ((order.type === "limit" || order.type === "stop_limit") && (order.price == null || !Number.isFinite(order.price))) {
	      fail("Limit orders require a price");
	      return false;
	    }
	    const stopNum = order.stop ? Number(order.stop) : undefined;
	    if ((order.type === "stop" || order.type === "stop_limit") && (stopNum == null || !Number.isFinite(stopNum))) {
	      fail("Stop orders require a stop price");
	      return false;
	    }
    if (activeLegs.length > 0) {
      const pricedLegs = activeLegs.filter((leg) => leg.limitPrice != null);
      if (pricedLegs.length > 0 && pricedLegs.length < activeLegs.length) {
        fail("Multi-leg option orders need either every leg priced or no leg prices.");
        return false;
      }
      if (comboType && !ALLOWED_COMBO_TYPES.has(comboType)) {
        fail("Unsupported combo type. Rebuild the strategy from the options builder.");
        return false;
      }
    }
    const submittedPreview = buildPreTradePreview({
      defaults: {
        ...ORDER_BAR_DEFAULTS,
        strategyId: order.strategyId,
        symbol: sym,
        side: order.side,
        quantity: qty,
        type: order.type,
        price: order.price,
        stop: order.stop,
      },
      quote: executionQuote,
      activeContract,
      activeLegs,
      comboType,
      quoteAtFillTs,
      recentOrders,
      positions: portfolioPositions,
      buyingPower: portfolioSummary.buyingPower,
      brokerDegraded,
      tradeContextSymbol,
    });
    const nowEpochSubmit = Date.now() / 1000;
    // R6-5: rebuild leg readiness on the submit path with current state.
    // Mirrors the live-render `legReadiness` memo above; we recompute
    // here because handleSubmit is async and the snapshot fetcher may
    // have settled with new failures since the last render.
    //
    // Audit MF-P0-3 (2026-05-05): read leg state from the refs so the
    // value is always the latest committed React state, not the
    // closure snapshot from the render where the chart overlay's
    // ``submit`` arrow was last memoized. Without this, a click
    // arriving at the same React tick the retry effect cleared
    // ``legsUnavailable`` would still see the stale ``blocked`` state
    // and refuse to place the order. Refs are kept in sync via the
    // useEffect just below this declaration.
    const submittedLegReadiness = deriveLegReadiness({
      totalLegs: activeLegsRef.current.length,
      unavailable: legsUnavailableRef.current,
    });
    const submittedReadiness = buildExecutionReadiness({
      preview: submittedPreview,
      quote: executionQuote,
      chartLimited: seriesError != null,
      chartLoading: seriesLoading,
      brokerDegraded,
      // Use executionQuote.timestamp (already normalized to seconds via
      // normalizeEpochSeconds) — see useMemo for quoteAgeSeconds above.
      quoteAgeSeconds:
        executionQuote.timestamp == null
          ? null
          : Math.max(0, nowEpochSubmit - executionQuote.timestamp),
      marketOpen: isMarketOpen(),
      legReadiness: submittedLegReadiness,
    });
	    if (!submittedReadiness.canSubmit) {
	      fail(submittedReadiness.blocker ?? "Resolve the execution gate before submitting.");
	      return false;
	    }
	    if (activeLegs.length > 0 && order.bracket) {
	      fail("Bracket exits are not supported for multi-leg option orders yet.");
	      return false;
	    }
	    setSubmitting(true);
	    try {
      // Round-5 F-14: when multi-leg legs are pre-staged from a deep-link,
      // submit them as one combo order with `legs[]` populated rather
      // than dropping them on the floor. The OrderBar's symbol/qty
      // become the first leg's by convention but the canonical legs
      // array is what reaches the broker.
      const hasLegs = activeLegs.length > 0;
      const placed = await placeOrder({
        symbol: sym,
        side: order.side,
        type: order.type,
	        quantity: qty,
	        price: order.price,
	        stop_price: stopNum,
	        time_in_force: order.timeInForce,
	        extended_hours: order.extendedHours,
	        bracket: order.bracket
	          ? {
	              stop_loss: order.bracket.stopLoss,
	              take_profit: order.bracket.takeProfit,
	            }
	          : undefined,
	        quote_at_fill_ts: quoteAtFillTs ?? undefined,
        // Round-5 F-1: thread the URL's strategy tag through to the
        // backend `CreateOrderRequest.strategy` field. When the user
        // changes the Strategy select on /trade, the current ticket
        // selection wins so reports reflect the intent they actually
        // submitted instead of the original deep-link default.
        strategy: order.strategyId || urlStrategy || undefined,
        // Round-5 F-14: forward combo metadata when present.
        combo_type: comboType ?? undefined,
        ...(hasLegs
          ? {
              legs: activeLegs.map((leg) => ({
                symbol: leg.occ,
                side: leg.orderSide,
                quantity: leg.qty,
                price: leg.limitPrice,
              })),
            }
          : {}),
      });
      usePortfolioStore.getState().addOrder(placed);
      const placedStatus = (placed.status ?? "pending").toLowerCase();
      const brokerRejected =
        placedStatus === "rejected" ||
        placedStatus === "canceled" ||
        placedStatus === "cancelled";
      const statusCopy = hasLegs
        ? `${activeLegs.length}-leg combo ${brokerRejected ? placedStatus : "staged"} — ${placedStatus}`
        : `${order.side.toUpperCase()} ${qty} ${sym} ${brokerRejected ? placedStatus : "staged"} — ${placedStatus}`;
      toast({
        type: brokerRejected ? "error" : "success",
        message: statusCopy,
      });
      if (brokerRejected) {
        setOrderError(`Order ${placedStatus}: broker or risk policy rejected the request.`);
      } else {
        if (plainEquityPrefill) {
          setPlainEquityPrefill(null);
          setTicketDraft(null);
        }
        setResetTick((t) => t + 1);
      }
      // Refresh recent orders strip immediately.
	      try {
	        const orders = await getOrders();
	        setRecentOrders(orders.slice(0, 50));
	      } catch { /* no-op */ }
	      return true;
	    } catch (err) {
	      const message = err instanceof Error ? err.message : "Order submission failed";
	      // Audit Persona F1.8 (2026-05-06): the backend's stale-quote and
	      // price-drift gates raise HTTPException(422) with detail strings
	      // that start "Quote staleness:" or contain "price drift". Route
	      // those into the dedicated inline banner so the trader can read
	      // them after the toast fades — they imply "refresh chain and
	      // re-stage", a multi-step recovery the toast lifetime can't host.
	      if (isStaleQuoteOrDriftMessage(message)) {
	        setStaleQuoteError(message);
	      } else {
	        toast({ type: "error", message });
	        setOrderError(message);
	      }
	      return false;
	    } finally {
	      setSubmitting(false);
	    }
	  }

  // Round-5 F-2: when a single contract is pre-staged from a deep-link,
  // hand its OCC symbol + side + qty + limit through to the OrderBar as
  // defaults so clicking "Place order" actually places THAT contract,
  // not the equity ticker the desk happens to be on.
  // Multi-leg combos likewise pre-fill the OrderBar with the FIRST leg
  // and rely on `activeLegs` to carry the remaining legs through to the
  // submit path.
  const orderBarDefaults = useMemo(() => {
    if (activeContract) {
      return {
        ...ORDER_BAR_DEFAULTS,
        strategyId: urlStrategy ?? rail[0]?.id ?? "",
        symbol: activeContract.occ,
        side: activeContract.orderSide,
        quantity: activeContract.qty,
        type:
          activeContract.limitPrice != null
            ? ("limit" as const)
            : ORDER_BAR_DEFAULTS.type,
        price: activeContract.limitPrice,
      };
    }
    if (activeLegs.length > 0) {
      const first = activeLegs[0];
      const pricedLegs = activeLegs.filter((leg) => leg.limitPrice != null);
      const allPriced = pricedLegs.length === activeLegs.length;
      return {
        ...ORDER_BAR_DEFAULTS,
        strategyId: urlStrategy ?? rail[0]?.id ?? "",
        symbol: first.occ,
        side: first.orderSide,
        quantity: first.qty,
        type: allPriced ? ("limit" as const) : ORDER_BAR_DEFAULTS.type,
        price: allPriced ? first.limitPrice : undefined,
      };
    }
    if (plainEquityPrefill) {
      return {
        ...ORDER_BAR_DEFAULTS,
        strategyId: urlStrategy ?? rail[0]?.id ?? "",
        symbol: plainEquityPrefill.symbol,
        side: plainEquityPrefill.side,
        quantity: plainEquityPrefill.qty,
        type: plainEquityPrefill.type,
        price: plainEquityPrefill.price,
        stop: plainEquityPrefill.stop,
      };
    }
    return {
      ...ORDER_BAR_DEFAULTS,
      strategyId: urlStrategy ?? rail[0]?.id ?? "",
    };
  }, [activeContract, activeLegs, plainEquityPrefill, rail, urlStrategy]);
  const [ticketDraft, setTicketDraft] = useState<StagedOrder | null>(null);
  useEffect(() => {
    setTicketDraft(null);
  }, [orderBarDefaults]);
  // Audit F-F1 (2026-05-05): the prior code did
  // ``const executionQuote = buildExecutionQuote(quote)`` directly in
  // the render body. ``buildExecutionQuote`` returns a fresh object on
  // every call, so every render produced a new reference for
  // ``executionQuote`` — invalidating six downstream useMemos
  // (executionReadiness, telemetry-derived values, chart overlays)
  // every tick of the underlying ``quote`` even when none of the
  // relevant fields actually changed. Memoise on the quote inputs so
  // referential stability is preserved across renders that don't
  // change the quote payload.
  const executionQuote = useMemo(
    () => buildExecutionQuote(quote),
    [quote],
  );
  // QA r1 A2: when an option contract is staged, build a parallel
  // executionQuote from the contract's own quote. Fall back to a placeholder
  // when the option quote hasn't arrived yet — better to show "--" than the
  // underlying stock's bid/ask under an options ticket.
  const optionExecutionQuote = useMemo(
    () => (optionContractQuote ? buildExecutionQuote(optionContractQuote) : null),
    [optionContractQuote],
  );
  // What the OrderBar telemetry cards (Bid / Ask / Spread) should show.
  // Multi-leg combos: per-leg pricing has no single combo bid/ask, so we
  // surface "--" rather than misleadingly showing the underlying.
  const telemetryQuote =
    activeLegs.length > 0
      ? null
      : activeContract
        ? optionExecutionQuote
        : executionQuote;
  const telemetryBidLabel =
    telemetryQuote?.bidLabel ?? (activeLegs.length > 0 ? "per leg" : "--");
  const telemetryAskLabel =
    telemetryQuote?.askLabel ?? (activeLegs.length > 0 ? "per leg" : "--");
  const telemetrySpreadLabel =
    telemetryQuote?.spreadLabel ?? (activeLegs.length > 0 ? "combo" : "--");
  const telemetrySpreadTone = telemetryQuote?.spreadTone ?? "text-fg-muted";
  const payoffDraft = useMemo(
    () =>
      buildOptionPayoffDraft({
        activeContract,
        activeLegs,
        comboType,
        quoteAtFillTs,
        spotPrice: executionQuote.last > 0 ? executionQuote.last : null,
        tradeContextSymbol,
        urlStrategy,
      }),
    [
      activeContract,
      activeLegs,
      comboType,
      quoteAtFillTs,
      executionQuote.last,
      tradeContextSymbol,
      urlStrategy,
    ],
  );
  const previewDefaults = ticketDraft ?? orderBarDefaults;
  const submitLabelDerived =
    activeLegs.length > 0
      ? `Submit ${activeLegs.length}-leg combo →`
      : "Place order";
  const tradePreview = useMemo(
    () =>
      buildPreTradePreview({
        defaults: previewDefaults,
        quote: executionQuote,
        activeContract,
        activeLegs,
        comboType,
        quoteAtFillTs,
        recentOrders,
        positions: portfolioPositions,
        buyingPower: portfolioSummary.buyingPower,
        brokerDegraded,
        tradeContextSymbol,
      }),
    [
      previewDefaults,
      executionQuote,
      activeContract,
      activeLegs,
      comboType,
      quoteAtFillTs,
      recentOrders,
      portfolioPositions,
      portfolioSummary.buyingPower,
      brokerDegraded,
      tradeContextSymbol,
    ],
  );
  const quoteAgeSeconds = useMemo(() => {
    // QA r1 A1 fix: use executionQuote.timestamp (already passed through
    // normalizeEpochSeconds), NOT raw quote.timestamp — provider payloads
    // can hand back epoch in milliseconds, in which case the prior raw
    // subtraction underflowed and Math.max clamped quoteAgeSeconds to 0,
    // suppressing the entire stale-feed branch.
    const ts = executionQuote.timestamp;
    if (ts == null) return null;
    return Math.max(0, Date.now() / 1000 - ts);
  }, [executionQuote.timestamp]);
  // Audit MF-P0-1 (2026-05-05): the prior ``useMemo(() => isMarketOpen(), [])``
  // cached the boolean from the FIRST render and never recomputed it. A
  // user opening /trade pre-market saw ``marketOpen=false`` for the rest
  // of the session — the execution-readiness pill stayed locked at
  // "Market closed · awaiting next session open" even after 09:30 ET,
  // and the submit button stayed disabled until a navigation away/back.
  // The submit-path itself called ``isMarketOpen()`` directly so the
  // server-side gate was correct; only the UI lied. Tick a state
  // variable every 30s so the pill state tracks reality.
  const [marketOpen, setMarketOpen] = useState(() => isMarketOpen());
  useEffect(() => {
    const id = setInterval(() => setMarketOpen(isMarketOpen()), 30_000);
    return () => clearInterval(id);
  }, []);
  // R6-5: derive the leg-quote readiness state once and reuse it for both
  // the live-render readiness pill and the on-submit readiness re-check.
  // `deriveLegReadiness` is pure — see lib/legQuoteReadiness.ts.
  const legReadiness = useMemo(
    () =>
      deriveLegReadiness({
        totalLegs: activeLegs.length,
        unavailable: legsUnavailable,
      }),
    [activeLegs.length, legsUnavailable],
  );
  const executionReadiness = useMemo(
    () =>
      buildExecutionReadiness({
        preview: tradePreview,
        quote: executionQuote,
        chartLimited: seriesError != null,
        chartLoading: seriesLoading,
        brokerDegraded,
        quoteAgeSeconds,
        marketOpen,
        legReadiness,
      }),
    [tradePreview, executionQuote, seriesError, seriesLoading, brokerDegraded, quoteAgeSeconds, marketOpen, legReadiness],
  );
  const chartOrderDraft = useMemo(
    () =>
      completeStagedOrder(
        previewDefaults,
        tradeContextSymbol,
        urlStrategy ?? rail[0]?.id ?? "",
      ),
    [previewDefaults, rail, tradeContextSymbol, urlStrategy],
  );
  const showChartOrderDraft = isChartDraftMeaningful(
    chartOrderDraft,
    orderBarDefaults,
    plainEquityPrefill != null,
  );
  const chartTradeOverlays = buildChartTradeOverlays({
    positions: portfolioPositions,
    orders: recentOrders,
    symbol: tradeContextSymbol,
    draft: activeContract || activeLegs.length > 0 || !showChartOrderDraft ? null : chartOrderDraft,
    quote: executionQuote,
    canSubmit: executionReadiness.canSubmit,
    submitLabel: executionReadiness.submitLabel ?? "Place order",
    submit: () => {
      void handleSubmit(chartOrderDraft);
    },
    cancel: clearChartDraft,
    error: orderError,
  });
  const chartOrderPlacement: ChartOrderPlacement | null =
    activeContract || activeLegs.length > 0
      ? null
      : {
          enabled: true,
          side: chartOrderDraft.side,
          label: "Chart limit",
          hint: "Click the price-axis affordance to stage a limit; Place remains explicit.",
          onStagePrice: (price, side) => stageLimitPreset(side, price),
        };

  function clearChartDraft() {
    setPlainEquityPrefill(null);
    setTicketDraft(null);
    setResetTick((tick) => tick + 1);
  }

  function stageLimitPreset(side: "buy" | "sell", price: number) {
    if (!Number.isFinite(price) || price <= 0) {
      toast({ type: "error", message: "No executable quote is available for that preset" });
      return;
    }
    const qty = Number(previewDefaults.quantity ?? orderBarDefaults.quantity);
    const normalizedQty = Number.isInteger(qty) && qty > 0 ? qty : 1;
    setActiveContract(null);
    setActiveLegs([]);
    setComboType(null);
    setQuoteAtFillTs(null);
    setPlainEquityPrefill({
      symbol: tradeContextSymbol,
      side,
      qty: normalizedQty,
      type: "limit",
      price: Number(price.toFixed(2)),
    });
    setResetTick((tick) => tick + 1);
    toast({
      type: "info",
      message: `Loaded ${side.toUpperCase()} ${tradeContextSymbol} limit @ ${price.toFixed(2)}`,
    });
  }

  function stageOptionDraft(draft: OptionStrategyDraft) {
    if (draft.legs.length === 0) {
      toast({ type: "error", message: "Add at least one option leg before staging." });
      return;
    }
    const nextComboType = draft.comboType && ALLOWED_COMBO_TYPES.has(draft.comboType)
      ? draft.comboType
      : draft.legs.length > 1
        ? "custom"
        : null;
    const quoteTs = parseQuoteSnapshotTs(
      draft.quoteTimestamp == null ? null : String(draft.quoteTimestamp),
    );
    setPlainEquityPrefill(null);
    setQuoteAtFillTs(quoteTs);
    setComboType(nextComboType);
    if (draft.legs.length === 1) {
      const leg = draft.legs[0];
      setActiveLegs([]);
      setActiveContract({
        occ: leg.occSymbol,
        symbol: leg.underlying,
        expiry: leg.expiry,
        side: leg.kind,
        strike: leg.strike,
        orderSide: leg.side,
        qty: leg.qty,
        limitPrice: leg.entryPrice ?? undefined,
      });
    } else {
      setActiveContract(null);
      setActiveLegs(draft.legs.map((leg) => ({
        occ: leg.occSymbol,
        symbol: leg.underlying,
        expiry: leg.expiry,
        side: leg.kind,
        strike: leg.strike,
        orderSide: leg.side,
        qty: leg.qty,
        limitPrice: leg.entryPrice ?? undefined,
      })));
    }
    setUrlUnderlyingSymbol(draft.underlying);
    setBuilderOpen(false);
    setResetTick((tick) => tick + 1);
    router.push(buildTradeUrlFromDraft(draft, nextComboType));
    toast({
      type: "success",
      message: `${draft.legs.length}-leg option strategy staged.`,
    });
  }
  const primaryQuoteLabel = executionQuote.hasTwoSided ? (quote.last > 0 ? "Last" : "Mid") : "Quote";
  const primaryQuoteValue =
    quote.last > 0
      ? formatCurrency(quote.last)
      : executionQuote.mid > 0
        ? executionQuote.midLabel
        : "Quote needed";
  const primaryQuoteTone = executionQuote.hasTwoSided && quote.last > 0 ? quoteTone : executionQuote.spreadTone;
  const chartStatusLabel = seriesError
    ? "Chart limited"
    : seriesLoading
      ? "Loading bars"
      : "Chart ready";
  const intentLabel =
    activeLegs.length > 0
      ? `${activeLegs.length}-leg combo`
      : activeContract
        ? "Option contract"
        : "Single ticket";

  return (
    <div className="relative min-h-[calc(100dvh-48px-22px)] overflow-hidden bg-bg px-3 py-3 md:px-5 md:py-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(236,230,210,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(236,230,210,0.03)_1px,transparent_1px)] bg-[size:72px_72px]"
      />
      <div className="relative mx-auto grid w-full max-w-[1760px] gap-4">
        <header
          id="trade-quote"
          className="scroll-mt-4 grid overflow-hidden rounded-lg border border-border-hair bg-border-hair shadow-[0_18px_60px_-38px_rgba(16,22,17,0.34)] lg:grid-cols-[minmax(240px,0.58fr)_minmax(0,1fr)_minmax(320px,0.7fr)]"
        >
          <div className="min-w-0 bg-bg-elev-1 px-4 py-4 md:px-5">
            {/* Batch E P0-mobile-only: at <sm: gate the execution-
                readiness chip onto its own line above the strategy/
                combo tags so the cockpit eyebrow + chip can't flex-
                wrap in a way that orphans "Execution cockpit" on a
                narrow mobile screen. From sm: up the original single-
                row flex-wrap behaviour returns. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="t-label text-fg-hint">Execution cockpit</span>
              <div className="flex flex-wrap items-center gap-2">
                <TradeStatusPill label={executionReadiness.label} tone={executionReadiness.tone} />
                {seriesError || seriesLoading ? (
                  <TradeStatusPill label={chartStatusLabel} tone={seriesError ? "amber" : "muted"} />
                ) : null}
                {urlStrategy && (
                  <span
                    data-slot="trade-strategy-tag"
                    className="inline-flex items-center gap-1 rounded-sm border border-border-hair bg-bg px-2 py-1 font-mono text-label text-fg-muted"
                  >
                    strategy: <span className="text-fg">{urlStrategy}</span>
                    {comboType && (
                      <>
                        <span aria-hidden> · </span>
                        combo: <span className="text-fg">{comboType}</span>
                      </>
                    )}
                  </span>
                )}
                {tradeContextSymbol && (
                  <Link
                    data-slot="trade-research-pill"
                    href={`/symbols/${encodeURIComponent(tradeContextSymbol)}?from=trade`}
                    className="inline-flex min-h-[28px] items-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 font-mono text-label text-fg-muted transition-colors hover:border-primary hover:text-primary"
                  >
                    Research →
                  </Link>
                )}
              </div>
            </div>
            <h1
              data-slot="trade-symbol"
              className="mt-3 text-h1 font-semibold leading-tight tracking-tight text-ink-1000 md:text-display-md"
              style={{ letterSpacing: 0 }}
            >
              Trade · {symbol.ticker}
            </h1>
            <p className="mt-2 truncate text-body-sm text-fg-muted">{symbol.venue} · {intentLabel}</p>
          </div>

          {/* Batch E P0-mobile-only: at <sm: keep the four telemetry
              cells in a 2-col grid (was already grid-cols-2 mobile,
              now annotated explicitly) so BID/ASK/SPREAD/MARK can't
              push into horizontal-overflow at 390px. The xl:grid-cols-4
              flips to a single row only when the parent column has
              the width budget. ``min-w-0`` on each cell prevents the
              mono value from forcing the cell wider than its 1fr share. */}
          <div className="grid grid-cols-2 gap-px bg-border-hair sm:grid-cols-2 xl:grid-cols-4">
            <TradeTelemetryCard icon={ChartLine} label={primaryQuoteLabel} value={primaryQuoteValue} valueClassName={primaryQuoteTone} />
            <TradeTelemetryCard icon={Crosshair} label="Bid" value={telemetryBidLabel} />
            <TradeTelemetryCard icon={ArrowsLeftRight} label="Ask" value={telemetryAskLabel} />
            <TradeTelemetryCard icon={Rows} label="Spread" value={telemetrySpreadLabel} valueClassName={telemetrySpreadTone} />
          </div>

          <div className="bg-bg-elev-1 p-3 md:p-4">
            <label className="flex flex-col gap-2">
              <span className="t-label text-fg-hint">Chart symbol</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <input
                  value={symbolDraft}
                  onChange={(e) => setSymbolDraft(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitSymbolDraft();
                  }}
                  inputMode="text"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="col-span-2 h-11 rounded-sm border border-border bg-bg-elev-1 px-3 font-mono text-base text-fg outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring sm:col-span-1 md:text-body"
                />
                <button
                  type="button"
                  onClick={commitSymbolDraft}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-border bg-primary px-4 text-body-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
                >
                  Load
                  <ArrowRight className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-border-hair bg-bg-elev-1 px-4 text-body-sm font-semibold text-fg-muted transition-transform hover:-translate-y-0.5 hover:text-fg"
                >
                  Desk
                </button>
              </div>
            </label>
          </div>
        </header>

        <ExecutionReadinessPanel readiness={executionReadiness} />

        <MobileTradeNav />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
          <section
            id="trade-chart"
            aria-label="Primary chart"
            className="surface-scan relative flex h-[clamp(480px,68dvh,640px)] scroll-mt-20 flex-col overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1 shadow-[0_24px_70px_-42px_rgba(16,22,17,0.58)] md:h-[clamp(720px,calc(100dvh-170px),1040px)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-hair px-4 py-3 text-fg">
              <div className="flex min-w-0 items-center gap-2">
                <ArrowsOut className="size-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold text-fg">Full canvas chart</p>
                  <p className="mt-0.5 line-clamp-2 font-mono text-label text-fg-muted">Structure overlays start off; add only what you need.</p>
                </div>
              </div>
              <TradeStatusPill label={range} tone="muted" />
            </div>
            <PriceChartPanel
              symbol={symbol}
              quote={quote}
              meta={meta}
              series={series}
              activeRange={range}
              onRangeChange={setRange}
              isLoading={seriesLoading}
              error={seriesError != null}
              onRetry={() => setChartReloadKey((k) => k + 1)}
              density="execution"
              tradeOverlays={chartTradeOverlays}
              chartOrderPlacement={chartOrderPlacement}
              className="h-full min-h-0 bg-bg-elev-1 text-fg"
            />
          </section>

          <aside className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
            <section
              id="trade-ticket"
              data-slot="trade-ticket-panel"
              className="scroll-mt-20 overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/95 shadow-[0_18px_60px_-40px_rgba(16,22,17,0.42)]"
            >
              <header className="flex items-center justify-between gap-3 border-b border-border-hair px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
                    <ListChecks className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-body font-semibold text-ink-1000">Execution ticket</h2>
                    <p className="truncate text-label text-fg-muted">{intentLabel}</p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <QuoteFreshness tsSeconds={quoteAtFillTs} />
                  <TradeStatusPill label="Paper" tone="muted" />
                </div>
              </header>
              <ExecutionQuotePanel
                quote={executionQuote}
                onStageLimit={stageLimitPreset}
              />
              {staleQuoteError && (
                <StaleQuoteBanner
                  message={staleQuoteError}
                  onDismiss={() => setStaleQuoteError(null)}
                />
              )}
              <OrderBar
                key={`trade-orderbar-${resetTick}`}
                symbol={tradeContextSymbol}
                strategies={strategyOptions}
                onSubmit={handleSubmit}
                onDraftChange={setTicketDraft}
                submitting={submitting}
                errorMessage={orderError}
                defaults={orderBarDefaults}
                submitLabel={submitLabelDerived}
                submitDisabled={!executionReadiness.canSubmit}
                submitDisabledReason={executionReadiness.blocker}
                submitDestination={executionReadiness.destination}
                reviewCopy={executionReadiness.reviewCopy}
                ticketLocked={activeLegs.length > 0}
                optionsUnavailable={optionsUnavailable}
                onRetryOptions={() =>
                  setOptionsSnapshotRetry((tick) => tick + 1)
                }
                legsUnavailable={legsUnavailable}
                onRetryLegs={() =>
                  setOptionsSnapshotRetry((tick) => tick + 1)
                }
                className="border-t-0 bg-transparent"
              />
              <div className="border-t border-border-hair p-4">
                <OptionsPayoffPanel
                  draft={payoffDraft}
                  compact
                  onOpenBuilder={() => setBuilderOpen(true)}
                />
              </div>
              <PreTradeImpactPanel
                preview={tradePreview}
              />
            </section>

            <TradeIntentPanel
              activeContract={activeContract}
              activeLegs={activeLegs}
              comboType={comboType}
            />
          </aside>
        </div>

        <RecentOrdersPanel
          orders={filteredRecentOrders}
          totalOrders={recentOrders.length}
          activeFilter={orderFilter}
          onFilterChange={setOrderFilter}
        />
        <OptionsStrategyBuilder
          key={tradeContextSymbol}
          open={builderOpen}
          underlying={tradeContextSymbol}
          onClose={() => setBuilderOpen(false)}
          onStage={stageOptionDraft}
        />
      </div>
    </div>
  );
}

type ExecutionQuote = ReturnType<typeof buildExecutionQuote>;
type PreTradePreview = ReturnType<typeof buildPreTradePreview>;
type ReadinessTone = "profit" | "loss" | "amber" | "muted";

function buildOptionPayoffDraft({
  activeContract,
  activeLegs,
  comboType,
  quoteAtFillTs,
  spotPrice,
  tradeContextSymbol,
  urlStrategy,
}: {
  activeContract: ActiveContract | null;
  activeLegs: ActiveLeg[];
  comboType: string | null;
  quoteAtFillTs: number | null;
  spotPrice: number | null;
  tradeContextSymbol: string;
  urlStrategy: string | null;
}): OptionStrategyDraft | null {
  const legs: OptionStrategyLeg[] = [];
  if (activeContract) {
    legs.push(activeToPayoffLeg(activeContract));
  } else {
    for (const leg of activeLegs) legs.push(activeToPayoffLeg(leg));
  }
  if (legs.length === 0) return null;
  const underlying = legs[0]?.underlying ?? tradeContextSymbol;
  return {
    underlying,
    spotPrice,
    label: comboType
      ? comboType.replace(/_/g, " ")
      : activeContract
        ? `${activeContract.orderSide} ${activeContract.side} ${activeContract.strike}`
        : `${legs.length}-leg options strategy`,
    source: urlStrategy === "earnings-options-play" ? "earnings-options-play" : "trade",
    quoteTimestamp: quoteAtFillTs,
    comboType,
    legs,
  };
}

function activeToPayoffLeg(leg: ActiveContract | ActiveLeg): OptionStrategyLeg {
  return {
    id: `${leg.occ}:${leg.orderSide}`,
    occSymbol: leg.occ,
    underlying: leg.symbol,
    expiry: leg.expiry,
    kind: leg.side,
    strike: leg.strike,
    side: leg.orderSide,
    qty: leg.qty,
    entryPrice: leg.limitPrice ?? null,
  };
}

function buildTradeUrlFromDraft(draft: OptionStrategyDraft, comboType: string | null): string {
  const params = new URLSearchParams({
    symbol: draft.underlying,
  });
  if (draft.legs.length === 1) {
    const leg = draft.legs[0];
    params.set("contract", leg.occSymbol);
    params.set("side", leg.side);
    params.set("qty", String(leg.qty));
    if (leg.entryPrice != null) params.set("limit", leg.entryPrice.toFixed(2));
  } else {
    params.set("legs", draft.legs.map((leg) => {
      const base = `${leg.occSymbol}:${leg.side}:${leg.qty}`;
      return leg.entryPrice != null ? `${base}:${leg.entryPrice.toFixed(2)}` : base;
    }).join(","));
    if (comboType) params.set("combo_type", comboType);
  }
  if (draft.source === "earnings-options-play") params.set("strategy", draft.source);
  if (draft.quoteTimestamp != null) params.set("quote_ts", String(draft.quoteTimestamp));
  return `/trade?${params.toString()}`;
}

function completeStagedOrder(
  defaults: Partial<StagedOrder>,
  fallbackSymbol: string,
  fallbackStrategyId: string,
): StagedOrder {
  const quantity = Number(defaults.quantity);
  return {
    strategyId: defaults.strategyId ?? fallbackStrategyId,
    symbol: String(defaults.symbol ?? fallbackSymbol).toUpperCase(),
    side: defaults.side === "sell" ? "sell" : "buy",
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
    type: defaults.type ?? "market",
    price: defaults.price,
    stop: defaults.stop,
    timeInForce: defaults.timeInForce,
    bracket: defaults.bracket,
    extendedHours: defaults.extendedHours,
  };
}

function isChartDraftMeaningful(
  draft: StagedOrder,
  defaults: Partial<StagedOrder>,
  hasChartPrefill: boolean,
) {
  if (hasChartPrefill) return true;
  if (draft.type !== "market") return true;
  if (draft.price != null || draft.stop != null || draft.bracket != null) return true;
  if (draft.side !== defaults.side) return true;
  if (draft.quantity !== defaults.quantity) return true;
  return false;
}

function buildChartTradeOverlays({
  positions,
  orders,
  symbol,
  draft,
  quote,
  canSubmit,
  submitLabel,
  submit,
  cancel,
  error,
}: {
  positions: Position[];
  orders: Order[];
  symbol: string;
  draft: StagedOrder | null;
  quote: ExecutionQuote;
  canSubmit: boolean;
  submitLabel: string;
  submit: () => void;
  cancel: () => void;
  error: string | null;
}): ChartTradeOverlay[] {
  const overlays: ChartTradeOverlay[] = [];
  const normalized = symbol.toUpperCase();
  const position = positions.find((p) => p.symbol.toUpperCase() === normalized);
  if (position) {
    const side = position.side === "short" || position.quantity < 0 ? "short" : "long";
    const stopLoss = getOptionalPrice(position, "stopLoss", "stop_loss");
    const takeProfit = getOptionalPrice(position, "takeProfit", "take_profit");
    overlays.push({
      id: `live:${position.symbol}`,
      label: `${position.symbol} live position`,
      status: "live",
      side,
      entry: safePositiveNumber(position.avgCost),
      stopLoss,
      takeProfit,
      quantity: Math.abs(position.quantity),
      summary:
        stopLoss != null || takeProfit != null
          ? `${formatCurrency(position.unrealizedPnl)} open P/L · protection visible`
          : `${formatCurrency(position.unrealizedPnl)} open P/L · no bracket levels on record`,
    });
  }

  for (const order of orders) {
    if (!isWorkingOrderStatus(order.status)) continue;
    if (underlyingFromTradeSymbol(order.symbol) !== normalized) continue;
    const entry = entryPriceForOrder(order, quote);
    if (entry == null) continue;
    const stopLoss = getOptionalPrice(order, "stopLoss", "stop_loss");
    const takeProfit = getOptionalPrice(order, "takeProfit", "take_profit");
    overlays.push({
      id: `order:${order.id}`,
      label: `${order.side.toUpperCase()} ${order.quantity} ${order.symbol}`,
      status: "pending",
      side: order.side === "sell" ? "short" : "long",
      entry,
      stopLoss,
      takeProfit,
      quantity: order.quantity,
      summary: `${order.status.replace("_", " ")} ${order.type.replace("_", " ")} order`,
    });
  }

  if (draft && underlyingFromTradeSymbol(draft.symbol) === normalized) {
    const entry = entryPriceForDraft(draft, quote);
    if (entry != null) {
      overlays.push({
        id: `draft:${draft.symbol}:${draft.side}:${entry}`,
        label: `${draft.side.toUpperCase()} ${draft.quantity} ${draft.symbol}`,
        status: "draft",
        side: draft.side === "sell" ? "short" : "long",
        entry,
        stopLoss: draft.bracket?.stopLoss ?? null,
        takeProfit: draft.bracket?.takeProfit ?? null,
        quantity: draft.quantity,
        canSubmit,
        submitLabel,
        onSubmit: submit,
        onCancel: cancel,
        error,
        summary: draft.bracket
          ? `${riskRewardLabel(draft.side, entry, draft.bracket.stopLoss, draft.bracket.takeProfit)} · explicit submit required`
          : "Click a chart price to move the limit; add brackets in the ticket for SL/TP zones.",
      });
    }
  }

  return overlays;
}

function entryPriceForDraft(draft: StagedOrder, quote: ExecutionQuote): number | null {
  if ((draft.type === "limit" || draft.type === "stop_limit") && draft.price != null) {
    return safePositiveNumber(draft.price);
  }
  if ((draft.type === "stop" || draft.type === "stop_limit") && draft.stop) {
    return safePositiveNumber(Number(draft.stop));
  }
  return safePositiveNumber(quote.mid || quote.last);
}

function entryPriceForOrder(order: Order, quote: ExecutionQuote): number | null {
  if ((order.type === "limit" || order.type === "stop_limit") && order.price != null) {
    return safePositiveNumber(order.price);
  }
  if (order.type === "stop" || order.type === "stop_limit") {
    return getOptionalPrice(order, "stopPrice", "stop_price");
  }
  return safePositiveNumber(quote.mid || quote.last);
}

function safePositiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function getOptionalPrice<T extends object>(obj: T, camel: string, snake: string): number | null {
  const record = obj as Record<string, unknown>;
  const bracket = record.bracket as Record<string, unknown> | undefined;
  return safePositiveNumber(record[camel] ?? record[snake] ?? bracket?.[camel] ?? bracket?.[snake]);
}

function riskRewardLabel(
  side: "buy" | "sell",
  entry: number,
  stopLoss: number,
  takeProfit: number,
) {
  const risk = side === "sell" ? stopLoss - entry : entry - stopLoss;
  const reward = side === "sell" ? entry - takeProfit : takeProfit - entry;
  if (risk <= 0 || reward <= 0) return "Bracket review needed";
  return `${(reward / risk).toFixed(2)}R target`;
}

interface ExecutionReadiness {
  label: string;
  tone: ReadinessTone;
  headline: string;
  detail: string;
  canSubmit: boolean;
  blocker: string | null;
  submitLabel?: string;
  destination: string;
  reviewCopy: string;
  icon: ElementType;
}

function ExecutionReadinessPanel({ readiness }: { readiness: ExecutionReadiness }) {
  const Icon = readiness.icon;
  return (
    <section
      aria-label="Execution readiness"
      data-slot="trade-execution-readiness"
      className={cn(
        "hidden gap-3 rounded-lg border px-4 py-3 md:grid md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center",
        readiness.tone === "profit" && "border-profit/25 bg-profit/10",
        readiness.tone === "loss" && "border-loss/30 bg-loss/10",
        readiness.tone === "amber" && "border-amber/30 bg-amber/10",
        readiness.tone === "muted" && "border-border-hair bg-bg-elev-1/95",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-sm border",
          readiness.tone === "profit" && "border-profit/25 bg-profit/10 text-profit",
          readiness.tone === "loss" && "border-loss/30 bg-loss/10 text-loss",
          readiness.tone === "amber" && "border-amber/30 bg-amber/10 text-amber",
          readiness.tone === "muted" && "border-border-hair bg-bg text-fg-muted",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="t-label text-fg-hint">Execution readiness</p>
          <TradeStatusPill label={readiness.label} tone={readiness.tone} />
        </div>
        <h2 className="mt-1 text-h3 font-semibold leading-snug text-ink-1000">
          {readiness.headline}
        </h2>
        <p className="mt-1 max-w-[78ch] text-body-sm leading-relaxed text-fg-muted">
          {readiness.detail}
        </p>
      </div>
      <div className="min-w-0 rounded-md border border-border-hair bg-bg px-3 py-2 md:min-w-[220px]">
        <p className="t-label text-fg-hint">{readiness.canSubmit ? "Submit path" : "Submit blocker"}</p>
        <p className={cn("mt-1 text-body-sm leading-snug", readiness.canSubmit ? "text-profit" : "text-amber")}>
          {readiness.blocker ?? "Ticket can submit after final review."}
        </p>
      </div>
    </section>
  );
}

function buildExecutionReadiness({
  preview,
  quote,
  chartLimited,
  chartLoading,
  brokerDegraded,
  quoteAgeSeconds,
  marketOpen,
  legReadiness,
}: {
  preview: PreTradePreview;
  quote: ExecutionQuote;
  chartLimited: boolean;
  chartLoading: boolean;
  brokerDegraded: boolean;
  quoteAgeSeconds: number | null;
  marketOpen: boolean;
  /**
   * R6-5 (closes R5-B1, R5-M5) — derived state for missing leg quotes
   * on multi-leg combo tickets. When `status === "blocked"` every
   * staged leg failed and the readiness pill must short-circuit to
   * coral; when `partial`, amber. When `ready` we fall through to the
   * existing checks. Always provided (defaults to a `ready` no-op when
   * no legs are staged).
   */
  legReadiness: LegReadinessState;
}): ExecutionReadiness {
  const hardBlock = preview.checks.find((check) => check.tone === "block");
  const review = preview.checks.find((check) => check.tone === "warn");

  if (brokerDegraded) {
    return {
      label: "Limited",
      tone: "loss",
      headline: "Broker data is in fallback mode",
      detail: "Live execution is locked until broker and market data recover. You can still review the paper ticket and inspect risk context.",
      canSubmit: false,
      blocker: "Broker/data fallback. Wait for a live broker snapshot before submitting.",
      submitLabel: "Broker data required",
      destination: "Submit locked while broker data is degraded",
      reviewCopy: "Live send locked · broker snapshot required",
      icon: Plug,
    };
  }

  // R6-5: leg-quote outage takes precedence over the (often
  // misleading) underlying-quote `hardBlock` and `review` checks. The
  // R5 capture proved the pre-existing checks happily passed when the
  // underlying NVDA quote was fresh, even though both staged strangle
  // legs 404'd. Short-circuit before those checks see the misleading
  // underlying-quote success.
  if (legReadiness.status === "blocked") {
    return {
      label: legReadiness.label,
      tone: "loss",
      headline: legReadiness.headline,
      detail: legReadiness.detail,
      canSubmit: false,
      blocker: legReadiness.blocker,
      submitLabel: "Cannot submit — refresh leg quotes",
      destination: "Submit locked while combo leg quotes are missing",
      reviewCopy: "Cannot submit · combo leg quotes missing",
      icon: LockSimple,
    };
  }

  if (legReadiness.status === "partial") {
    return {
      label: legReadiness.label,
      tone: "amber",
      headline: legReadiness.headline,
      detail: legReadiness.detail,
      canSubmit: false,
      blocker: legReadiness.blocker,
      submitLabel: "Refresh leg quotes",
      destination: "Submit locked until every leg quote returns",
      reviewCopy: "Combo leg quote missing · refresh before submit",
      icon: WarningCircle,
    };
  }

  if (hardBlock) {
    const quoteBlocked = hardBlock.label === "Quote freshness" || !quote.hasTwoSided;
    // Distinguish a stale-feed outage from a temporary user-fixable gap.
    // > 1h stale during regular hours = upstream feed problem; user can do
    // nothing, so we mirror brokerDegraded copy. Outside regular hours, a
    // weekend/overnight gap is expected — say so plainly instead of asking
    // the user to "resolve" it.
    //
    // QA r1 A1 follow-up: weekend / pre-open hits this branch with no
    // two-sided quote AND no timestamp at all (provider returns an empty
    // quote payload), so quoteAgeSeconds is null. Treat that as
    // severely stale when the market is closed — the "Awaiting market
    // open" copy is appropriate either way. During regular hours, an
    // unknown-age block stays in the user-actionable copy because it
    // could still be a transient gap the user can refresh past.
    const feedSeverelyStale =
      quoteBlocked &&
      ((quoteAgeSeconds != null && quoteAgeSeconds > 3600) ||
        (quoteAgeSeconds == null && !marketOpen));
    if (feedSeverelyStale && marketOpen) {
      return {
        label: "Limited",
        tone: "loss",
        headline: "Market data feed delayed",
        detail: "We have not received a fresh quote for this symbol in over an hour. The desk has been alerted; submission resumes when the feed catches up.",
        canSubmit: false,
        blocker:
          quoteAgeSeconds != null
            ? `Feed delayed · last quote ${formatAgeDuration(quoteAgeSeconds)} old.`
            : "Feed delayed · no fresh quote received.",
        submitLabel: "Feed delayed — try again shortly",
        destination: "Submit locked while market data feed is delayed",
        reviewCopy: "Live send locked · market data feed delayed",
        icon: Plug,
      };
    }
    if (feedSeverelyStale && !marketOpen) {
      return {
        label: "Closed",
        tone: "muted",
        headline: "Market is closed — no live quote",
        detail: "Live two-sided quotes resume at the next regular session. You can still review and stage the ticket; submission unlocks at the open.",
        canSubmit: false,
        blocker:
          quoteAgeSeconds != null
            ? `Market closed · last quote ${formatAgeDuration(quoteAgeSeconds)} old.`
            : "Market closed · awaiting next session open.",
        submitLabel: "Awaiting market open",
        destination: "Submit unlocks at next regular session open",
        reviewCopy: "Submit locked · market closed",
        icon: Clock,
      };
    }
    return {
      label: "Blocked",
      tone: "loss",
      headline: quoteBlocked ? "Executable quote required before submit" : `${hardBlock.label} blocks submit`,
      detail: quoteBlocked
        ? "Bid/ask is incomplete. Load a fresh two-sided quote or stage a priced limit before sending the order."
        : hardBlock.detail,
      canSubmit: false,
      blocker: `${hardBlock.label}: ${hardBlock.value}.`,
      submitLabel: quoteBlocked ? "Resolve quote first" : "Resolve blocker first",
      destination: "Submit locked until hard checks pass",
      reviewCopy: quoteBlocked ? "Cannot submit · quote gate failed" : "Cannot submit · risk gate failed",
      icon: LockSimple,
    };
  }

  if (review) {
    return {
      label: "Review",
      tone: "amber",
      headline: `${review.label} needs confirmation`,
      detail: `${review.detail} You may continue in paper mode after confirming the ticket inputs.`,
      canSubmit: true,
      blocker: null,
      submitLabel: "Place after review",
      destination: "Submits to paper account after review",
      reviewCopy: `${review.label} review · verify ticket before submit`,
      icon: WarningCircle,
    };
  }

  if (chartLimited || chartLoading) {
    return {
      label: chartLoading ? "Syncing" : "Limited",
      tone: "amber",
      headline: chartLoading ? "Chart is loading" : "Chart data is limited",
      detail: "The ticket can rely on the executable quote, but chart history is still recovering. Avoid using the canvas as confirmation until bars load.",
      canSubmit: true,
      blocker: null,
      submitLabel: "Place order",
      destination: "Submits to paper account; chart context limited",
      reviewCopy: "Chart context limited · verify quote and ticket",
      icon: chartLoading ? Clock : WarningCircle,
    };
  }

  return {
    label: "Ready",
    tone: "profit",
    headline: "Ticket can submit after final review",
    detail: "Quote, buying power estimate, session state, open-order collision, and position context are inside the paper execution gate.",
    canSubmit: true,
    blocker: null,
    submitLabel: "Place order",
    destination: "Submits to paper account",
    reviewCopy: "Ready after final review · paper account",
    icon: CheckCircle,
  };
}

function MobileTradeNav() {
  const items: Array<{ href: string; label: string; icon: ElementType }> = [
    { href: "#trade-quote", label: "Quote", icon: Clock },
    { href: "#trade-chart", label: "Chart", icon: ChartLine },
    { href: "#trade-ticket", label: "Ticket", icon: ListChecks },
    { href: "#trade-orders", label: "Orders", icon: Lightning },
  ];

  return (
    <nav
      aria-label="Mobile trade workspace"
      className="sticky top-2 z-[2] grid grid-cols-4 gap-1 rounded-lg border border-border-hair bg-bg-elev-1/95 p-1 shadow-[0_18px_48px_-36px_rgba(16,22,17,0.55)] backdrop-blur md:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <a
            key={item.href}
            href={item.href}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 font-mono text-label font-medium text-fg-muted transition-[border-color,background-color,color,transform] hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function ExecutionQuotePanel({
  quote,
  onStageLimit,
}: {
  quote: ExecutionQuote;
  onStageLimit: (side: "buy" | "sell", price: number) => void;
}) {
  const presets: Array<{ label: string; side: "buy" | "sell"; price: number; tone: string }> = [
    { label: "Buy bid", side: "buy", price: quote.bid, tone: "text-profit" },
    { label: "Buy mid", side: "buy", price: quote.mid, tone: "text-profit" },
    { label: "Sell mid", side: "sell", price: quote.mid, tone: "text-loss" },
    { label: "Sell ask", side: "sell", price: quote.ask, tone: "text-loss" },
  ];

  return (
    <div className="border-b border-border-hair bg-bg px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Clock className="size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-body-sm font-semibold text-ink-1000">Fast price loader</p>
            <p className="truncate text-label text-fg-muted">
              Two-sided quote {quote.hasTwoSided ? "live" : "incomplete"} · spread {quote.spreadLabel}
            </p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn("font-mono text-label", quote.spreadTone)}>{quote.midLabel}</span>
          {/* EH-3c: when buildExecutionQuote picked up an extended-hours
              mark, surface a small AH/PM pill next to the mid so the
              trader knows the displayed price is the extended-session
              tape, not the regular two-sided mid. Renders nothing on
              regular sessions — pre-EH layout is unchanged. */}
          {quote.extendedSession && (
            <ExtendedHoursBadge
              tone={quote.extendedSession}
              title={`Extended-hours mark: ${quote.midLabel}`}
            />
          )}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {presets.map((preset) => {
          const disabled = !Number.isFinite(preset.price) || preset.price <= 0;
          return (
            <button
              key={preset.label}
              type="button"
              disabled={disabled}
              onClick={() => onStageLimit(preset.side, preset.price)}
              className="min-h-10 rounded-sm border border-border-hair bg-bg-elev-1 px-2 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            >
              <span className="block truncate text-label font-medium text-fg-muted">{preset.label}</span>
              <span className={cn("block truncate font-mono text-body-sm", preset.tone)}>
                {disabled ? "--" : formatCurrency(preset.price)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PreTradeImpactPanel({ preview }: { preview: PreTradePreview }) {
  const priorityChecks = preview.checks.filter((check) => check.tone !== "pass");
  const visibleChecks = priorityChecks.length > 0 ? priorityChecks : preview.checks.slice(0, 2);
  const collapsedChecks =
    priorityChecks.length > 0
      ? preview.checks.filter((check) => check.tone === "pass")
      : preview.checks.slice(2);
  return (
    <div className="border-t border-border-hair bg-bg-elev-1 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
            <Scales className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-body-sm font-semibold text-ink-1000">Pre-submit confidence</p>
            <p className="truncate text-label text-fg-muted">{preview.subtitle}</p>
          </div>
        </div>
        <TradeStatusPill label={preview.policyLabel} tone={preview.policyTone} />
      </div>

      <div data-slot="pre-submit-checks" className="mt-4 grid gap-2">
        {visibleChecks.map((check) => (
          <ConfidenceCheckRow key={check.label} check={check} />
        ))}
        {collapsedChecks.length > 0 ? (
          <details className="rounded-md border border-border-hair bg-bg px-3 py-2">
            <summary className="cursor-pointer list-none font-mono text-label font-semibold text-profit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {collapsedChecks.length} passed check{collapsedChecks.length === 1 ? "" : "s"} collapsed
            </summary>
            <div className="mt-2 grid gap-2">
              {collapsedChecks.map((check) => (
                <ConfidenceCheckRow key={check.label} check={check} compact />
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <div className="mt-4 grid gap-px overflow-hidden rounded-md border border-border-hair bg-border-hair sm:grid-cols-2">
        {preview.rows.map((row) => (
          <div key={row.label} className="bg-bg px-3 py-3">
            <p className="t-label text-fg-hint">{row.label}</p>
            <p className={cn("mt-2 truncate font-mono text-body text-ink-1000", row.toneClass)}>{row.value}</p>
            <p className="mt-1 line-clamp-2 text-label leading-snug text-fg-muted">{row.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfidenceCheckRow({
  check,
  compact = false,
}: {
  check: ConfidenceCheck;
  compact?: boolean;
}) {
  const Icon = check.icon;
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-md border px-3 py-3",
        compact ? "min-h-[58px]" : "min-h-[76px]",
        confidenceSurfaceClass(check.tone),
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm",
          confidenceIconClass(check.tone),
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="t-label text-fg-hint">{check.label}</p>
          <span className={cn("font-mono text-label font-semibold", confidenceTextClass(check.tone))}>
            {confidenceStatusLabel(check.tone)}
          </span>
        </div>
        <p className={cn("mt-1 truncate font-mono text-body-sm", confidenceTextClass(check.tone))}>{check.value}</p>
        {!compact ? (
          <p className="mt-1 line-clamp-2 text-label leading-snug text-fg-muted">{check.detail}</p>
        ) : null}
      </div>
      <span className={cn("mt-1 size-2 rounded-full", confidenceDotClass(check.tone))} aria-hidden />
    </div>
  );
}

function TradeTelemetryCard({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: ElementType;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="bg-bg px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
        <p className="t-label text-fg-hint">{label}</p>
      </div>
      <p className={cn("mt-3 truncate font-mono text-body text-ink-1000", valueClassName)}>
        {value}
      </p>
    </div>
  );
}

type OrderFilter = "all" | "working" | "filled" | "rejected";

function TradeStatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "profit" | "loss" | "amber" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-label",
        tone === "profit" && "border-profit/30 bg-profit/10 text-profit",
        tone === "loss" && "border-loss/30 bg-loss/10 text-loss",
        tone === "amber" && "border-amber/30 bg-amber/10 text-amber",
        tone === "muted" && "border-border-hair bg-bg-elev-2 text-fg-muted",
      )}
    >
      <span
        className={cn(
          "status-breathe size-1.5 rounded-full",
          tone === "profit" ? "bg-profit" : tone === "loss" ? "bg-loss" : tone === "amber" ? "bg-amber" : "bg-fg-muted",
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

/**
 * Audit Persona F1.8 (2026-05-06): freshness indicator chip rendered in
 * the ticket header when an option ticket is staged with a deep-linked
 * ``quote_ts``. The auto-refresh effect (above) keeps ``quote_at_fill_ts``
 * inside the backend's 30s gate, but a trader still benefits from seeing
 * the actual age of the snapshot they're working from — short ages are
 * silent, mid ages render as a muted hint, and ages approaching the
 * 25s refresh boundary surface as a state-warning chip.
 *
 * Updates once per second internally so the visible age tracks the
 * passage of real time even between auto-refresh ticks.
 */
function QuoteFreshness({ tsSeconds }: { tsSeconds: number | null }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1_000);
    return () => clearInterval(id);
  }, []);
  if (tsSeconds == null) return null;
  const age = Math.max(0, Math.round(now - tsSeconds));
  // <5s: too noisy at deep-link arrival to render anything.
  if (age < 5) return null;
  // ≥25s aligns with the auto-refresh cadence — the timer should already
  // have fired; if we're here it likely hasn't yet (or the user is on an
  // equity-only ticket that is exempt). Either way, surface the warning.
  const tone =
    age >= 25
      ? "border-state-warning/30 bg-state-warning/10 text-state-warning-fg"
      : age >= 15
        ? "border-border-hair bg-bg-elev-2 text-fg-muted"
        : "border-border-hair bg-bg-elev-2 text-fg-hint";
  return (
    <span
      data-slot="quote-freshness"
      data-age={age}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-label tabular-nums",
        tone,
      )}
    >
      <Clock className="size-3" aria-hidden />
      Quotes {age}s old
    </span>
  );
}

/**
 * Audit Persona F1.8 (2026-05-06): inline banner surfaced above the
 * OrderBar's submit button when the backend rejects with a stale-quote
 * or price-drift 422. Keeps the message visible after the toast fades —
 * traders need to read it, refresh the chain, and re-stage; that flow
 * doesn't fit a 4-6s toast lifetime on a fast-moving ticket.
 */
function StaleQuoteBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      data-slot="stale-quote-banner"
      role="alert"
      className="mx-4 mt-3 flex items-start gap-3 rounded-sm border border-state-warning/40 bg-state-warning/10 px-3 py-2 text-state-warning-fg"
    >
      <WarningCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="t-label font-semibold">Quote freshness rejected</p>
        <p className="mt-1 text-body-sm leading-snug">{message}</p>
        <p className="mt-1 text-label text-fg-muted">
          Refresh the chain (or re-stage from the symbol page) so the
          ticket carries a current snapshot, then resubmit.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="t-label text-fg-muted underline-offset-2 hover:text-fg hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
}

function buildExecutionQuote(quote: ReturnType<typeof toQuote>) {
  const bid = Number(quote.bid ?? 0);
  const ask = Number(quote.ask ?? 0);
  const last = Number(quote.last ?? 0);
  const hasBid = Number.isFinite(bid) && bid > 0;
  const hasAsk = Number.isFinite(ask) && ask > 0;
  const hasTwoSided = hasBid && hasAsk && ask >= bid;
  // EH-3c: prefer the extended-hours mark when the broker reports it.
  // We only pick it up when the source quote actually carries an
  // active extended session — ``extended_price`` may be present without
  // ``extended_session`` on legacy backends, and we should not silently
  // replace a regular-hours mid in that case. ``buildExecutionQuote``
  // is called from both the underlying-equity and option-leg paths;
  // the EH branch fires for either when the field is set.
  const ehSession =
    (quote as { extended_session?: "pre" | "post" | null }).extended_session ??
    null;
  const ehPriceRaw = (quote as { extended_price?: number | null }).extended_price;
  const ehPrice =
    (ehSession === "pre" || ehSession === "post") &&
    typeof ehPriceRaw === "number" &&
    Number.isFinite(ehPriceRaw) &&
    ehPriceRaw > 0
      ? ehPriceRaw
      : null;
  // When the extended mark wins, it becomes the "mid" (closest analog
  // to the execution price). The bid/ask spread continues to render
  // the regular two-sided quote so a hedger can still check the lit
  // book at a glance.
  const mid = ehPrice ?? (hasTwoSided ? (bid + ask) / 2 : last);
  const spread = hasTwoSided ? ask - bid : 0;
  const spreadPct = hasTwoSided && mid > 0 ? (spread / mid) * 100 : 0;
  const spreadTone =
    !hasTwoSided
      ? "text-amber"
      : spreadPct > 1.2
        ? "text-loss"
        : spreadPct > 0.45
          ? "text-amber"
          : "text-profit";

  return {
    bid: hasBid ? bid : 0,
    ask: hasAsk ? ask : 0,
    last,
    mid: Number.isFinite(mid) && mid > 0 ? mid : 0,
    spread,
    spreadPct,
    hasTwoSided,
    bidLabel: hasBid ? formatCurrency(bid) : "--",
    askLabel: hasAsk ? formatCurrency(ask) : "--",
    midLabel: Number.isFinite(mid) && mid > 0 ? formatCurrency(mid) : "--",
    spreadLabel: hasTwoSided ? `${formatCurrency(spread)} · ${spreadPct.toFixed(2)}%` : "Quote needed",
    spreadTone,
    timestamp: normalizeEpochSeconds(quote.timestamp),
    // EH-3c: surface the extended-session token + price so the
    // ExecutionQuotePanel can render an "AH" / "PM" indicator next to
    // the mid without re-deriving from the raw quote. Null on regular
    // sessions / when the backend didn't emit the field.
    extendedSession: ehPrice != null ? ehSession : null,
    extendedPrice: ehPrice,
  };
}

type ConfidenceTone = "pass" | "warn" | "block" | "neutral";

interface ConfidenceCheck {
  label: string;
  value: string;
  detail: string;
  tone: ConfidenceTone;
  icon: ElementType;
}

function confidenceStatusLabel(tone: ConfidenceTone): string {
  if (tone === "pass") return "Pass";
  if (tone === "block") return "Blocked";
  if (tone === "warn") return "Review";
  return "Context";
}

function confidenceSurfaceClass(tone: ConfidenceTone): string {
  if (tone === "pass") return "border-profit/25 bg-profit/10";
  if (tone === "block") return "border-loss/30 bg-loss/10";
  if (tone === "warn") return "border-amber/30 bg-amber/10";
  return "border-border-hair bg-bg";
}

function confidenceIconClass(tone: ConfidenceTone): string {
  if (tone === "pass") return "bg-profit/15 text-profit";
  if (tone === "block") return "bg-loss/15 text-loss";
  if (tone === "warn") return "bg-amber/15 text-amber";
  return "bg-bg-elev-2 text-fg-muted";
}

function confidenceTextClass(tone: ConfidenceTone): string {
  if (tone === "pass") return "text-profit";
  if (tone === "block") return "text-loss";
  if (tone === "warn") return "text-amber";
  return "text-fg";
}

function confidenceDotClass(tone: ConfidenceTone): string {
  if (tone === "pass") return "bg-profit";
  if (tone === "block") return "bg-loss";
  if (tone === "warn") return "bg-amber";
  return "bg-fg-muted";
}

function buildPreTradePreview({
  defaults,
  quote,
  activeContract,
  activeLegs,
  comboType,
  quoteAtFillTs,
  recentOrders,
  positions,
  buyingPower,
  brokerDegraded,
  tradeContextSymbol,
}: {
  defaults: Partial<StagedOrder>;
  quote: ExecutionQuote;
  activeContract: ActiveContract | null;
  activeLegs: ActiveLeg[];
  comboType: string | null;
  quoteAtFillTs: number | null;
  recentOrders: Order[];
  positions: Position[];
  buyingPower: number;
  brokerDegraded: boolean;
  tradeContextSymbol: string;
}) {
  const qty = Number(defaults.quantity);
  const normalizedQty = Number.isInteger(qty) && qty > 0 ? qty : 1;
  const orderSide = defaults.side === "sell" ? "sell" : "buy";
  const orderSymbol = normalizeTradeSymbol(String(defaults.symbol ?? tradeContextSymbol));
  const intentSymbols = getIntentSymbols({
    orderSymbol,
    activeContract,
    activeLegs,
    tradeContextSymbol,
  });
  const underlyingSymbol =
    activeContract?.symbol ??
    activeLegs[0]?.symbol ??
    underlyingFromTradeSymbol(orderSymbol) ??
    normalizeUnderlyingSymbol(tradeContextSymbol) ??
    tradeContextSymbol;
  const limitPrice = Number(defaults.price);
  const ticketPrice =
    Number.isFinite(limitPrice) && limitPrice > 0
      ? limitPrice
      : quote.mid > 0
        ? quote.mid
        : quote.last;
  const rows: Array<{ label: string; value: string; detail: string; toneClass?: string }> = [];
  const relatedPositions = positions.filter((position) =>
    positionTouchesIntent(position, intentSymbols, underlyingSymbol),
  );
  const workingCollisions = recentOrders.filter((order) =>
    isWorkingOrderStatus(order.status) && orderTouchesIntent(order, intentSymbols, underlyingSymbol),
  );
  const exposure = estimateTicketExposure({
    normalizedQty,
    orderSide,
    ticketPrice,
    activeContract,
    activeLegs,
  });
  const checks = buildConfidenceChecks({
    quote,
    quoteAtFillTs,
    buyingPower,
    brokerDegraded,
    workingCollisions,
    relatedPositions,
    exposure,
    normalizedQty,
    orderSide,
    orderSymbol,
    underlyingSymbol,
    activeContract,
    activeLegs,
    comboType,
  });
  const blocked = checks.some((check) => check.tone === "block");
  const review = checks.some((check) => check.tone === "warn");
  const policyLabel = blocked ? "Blocked" : review ? "Review" : "Ready";
  const policyTone = blocked ? ("loss" as const) : review ? ("amber" as const) : ("profit" as const);

  if (activeLegs.length > 0) {
    const netCredit = activeLegs.reduce((sum, leg) => {
      const price = Number.isFinite(leg.limitPrice) && (leg.limitPrice ?? 0) > 0 ? leg.limitPrice ?? 0 : 0;
      const signed = leg.orderSide === "sell" ? 1 : -1;
      return sum + signed * price * leg.qty * 100;
    }, 0);
    const pricedLegs = activeLegs.filter((leg) => Number.isFinite(leg.limitPrice) && (leg.limitPrice ?? 0) > 0).length;
    rows.push(
      {
        label: "Premium",
        value: pricedLegs > 0 ? `${netCredit >= 0 ? "Credit" : "Debit"} ${formatCurrency(Math.abs(netCredit))}` : "Unpriced",
        detail: `${pricedLegs}/${activeLegs.length} legs have limits.`,
        toneClass: netCredit >= 0 ? "text-profit" : "text-loss",
      },
      {
        label: "Structure",
        value: comboType ? comboType.replace("_", " ") : `${activeLegs.length} legs`,
        detail: comboType === "iron_condor" || comboType === "vertical_spread" ? "Defined-risk shape recognized." : "Broker policy must validate margin.",
      },
      {
        label: "Ticket lock",
        value: "Combo owned",
        detail: "OrderBar shows the first leg; canonical legs submit together.",
      },
      {
        label: "Liquidity",
        value: quote.hasTwoSided ? quote.spreadLabel : "Quote needed",
        detail: "Underlying spread is shown for context; options spread depends on chain data.",
        toneClass: quote.spreadTone,
      },
    );
    return {
      subtitle: "Combo checks before send",
      policyLabel,
      policyTone,
      checks,
      rows,
    };
  }

  if (activeContract) {
    const premium = Number.isFinite(activeContract.limitPrice) && (activeContract.limitPrice ?? 0) > 0 ? activeContract.limitPrice ?? 0 : ticketPrice;
    const cashImpact = premium * activeContract.qty * 100;
    rows.push(
      {
        label: "Premium",
        value: formatCurrency(cashImpact),
        detail: `${activeContract.qty} contract${activeContract.qty === 1 ? "" : "s"} x 100 multiplier.`,
      },
      {
        label: "Contract",
        value: `${activeContract.side.toUpperCase()} ${activeContract.strike}`,
        detail: `${activeContract.expiry} expiry.`,
      },
      {
        label: "Max debit",
        value: activeContract.orderSide === "buy" ? formatCurrency(cashImpact) : "Short option",
        detail: activeContract.orderSide === "buy" ? "Long premium is the debit at risk." : "Short option risk requires broker margin check.",
        toneClass: activeContract.orderSide === "buy" ? "text-fg" : "text-amber",
      },
      {
        label: "Liquidity",
        value: quote.hasTwoSided ? quote.spreadLabel : "Quote needed",
        detail: "Underlying quote freshness only; option two-sided data remains the execution gate.",
        toneClass: quote.spreadTone,
      },
    );
    return {
      subtitle: "Option checks before send",
      policyLabel,
      policyTone,
      checks,
      rows,
    };
  }

  const notional = ticketPrice > 0 ? ticketPrice * normalizedQty : 0;
  rows.push(
    {
      label: "Notional",
      value: notional > 0 ? formatCurrency(notional) : "Awaiting price",
      detail: `${normalizedQty} share${normalizedQty === 1 ? "" : "s"} at ${ticketPrice > 0 ? formatCurrency(ticketPrice) : "no quote"}.`,
    },
    {
      label: "Order type",
      value: String(defaults.type ?? "market").replace("_", " "),
      detail: defaults.price ? "Limit price is staged." : "Uses current quote context.",
    },
    {
      label: "Spread",
      value: quote.hasTwoSided ? quote.spreadLabel : "Quote needed",
      detail: quote.hasTwoSided ? "Use mid when speed is less important than price." : "Do not submit blindly into an incomplete quote.",
      toneClass: quote.spreadTone,
    },
    {
      label: "Policy",
      value: quote.hasTwoSided ? "Ready" : "Check quote",
      detail: "Risk gate still validates buying power and broker state on submit.",
      toneClass: quote.hasTwoSided ? "text-profit" : "text-amber",
    },
  );
  return {
    subtitle: "Equity checks before broker validation",
    policyLabel,
    policyTone,
    checks,
    rows,
  };
}

function buildConfidenceChecks({
  quote,
  quoteAtFillTs,
  buyingPower,
  brokerDegraded,
  workingCollisions,
  relatedPositions,
  exposure,
  normalizedQty,
  orderSide,
  orderSymbol,
  underlyingSymbol,
  activeContract,
  activeLegs,
  comboType,
}: {
  quote: ExecutionQuote;
  quoteAtFillTs: number | null;
  buyingPower: number;
  brokerDegraded: boolean;
  workingCollisions: Order[];
  relatedPositions: Position[];
  exposure: TicketExposure;
  normalizedQty: number;
  orderSide: "buy" | "sell";
  orderSymbol: string;
  underlyingSymbol: string;
  activeContract: ActiveContract | null;
  activeLegs: ActiveLeg[];
  comboType: string | null;
}): ConfidenceCheck[] {
  const now = new Date();
  const nowEpoch = now.getTime() / 1000;
  const quoteAge = quote.timestamp == null ? null : Math.max(0, nowEpoch - quote.timestamp);
  const snapshotAge = quoteAtFillTs == null ? null : Math.max(0, nowEpoch - quoteAtFillTs);
  const session = getMarketSessionState(now);
  const currentPositionQty = relatedPositions.reduce((sum, position) => sum + (position.quantity ?? 0), 0);
  const nextPositionQty =
    activeContract || activeLegs.length > 0
      ? currentPositionQty
      : currentPositionQty + (orderSide === "buy" ? normalizedQty : -normalizedQty);

  const quoteTone: ConfidenceTone =
    brokerDegraded || !quote.hasTwoSided
      ? "block"
      : quoteAge == null
        ? "warn"
        : quoteAge <= 90
          ? "pass"
          : quoteAge <= 300
            ? "warn"
            : "block";
  const quoteValue =
    brokerDegraded
      ? "Broker degraded"
      : !quote.hasTwoSided
        ? "Quote needed"
        : quoteAge == null
          ? "Timestamp missing"
          : `${formatAgeDuration(quoteAge)} old`;
  const snapshotCopy =
    snapshotAge == null
      ? "No strategy snapshot timestamp."
      : `Strategy snapshot ${formatAgeDuration(snapshotAge)} old.`;

  const buyingPowerLoaded = Number.isFinite(buyingPower) && buyingPower > 0;
  const buyingPowerTone: ConfidenceTone =
    exposure.marginUnknown
      ? "warn"
      : !buyingPowerLoaded
        ? "warn"
        : exposure.cashDebit > buyingPower
          ? "block"
          : "pass";
  const buyingPowerValue =
    exposure.marginUnknown
      ? "Margin check"
      : exposure.cashDebit > 0
        ? formatCurrency(exposure.cashDebit)
        : exposure.label;
  const buyingPowerDetail =
    exposure.marginUnknown
      ? `${exposure.label}. Broker margin validation still decides final capacity.`
      : buyingPowerLoaded
        ? `${formatCurrency(buyingPower)} buying power; ${formatCurrency(Math.max(0, buyingPower - exposure.cashDebit))} after estimate.`
        : "Buying power has not loaded; broker validation remains authoritative.";

  const collisionTone: ConfidenceTone = workingCollisions.length > 0 ? "warn" : "pass";
  const collisionValue = workingCollisions.length > 0 ? `${workingCollisions.length} working` : "Clear";
  const collisionDetail =
    workingCollisions.length > 0
      ? `Review existing ${underlyingSymbol} working order${workingCollisions.length === 1 ? "" : "s"} before sending another.`
      : `No working orders detected for ${underlyingSymbol} or staged legs.`;

  const sessionTone: ConfidenceTone = brokerDegraded ? "block" : session.tone;
  const sessionValue = brokerDegraded ? "Data fallback" : session.label;
  const sessionDetail = brokerDegraded
    ? "Broker or data provider is degraded; avoid trusting a new live send."
    : `${session.detail} ${quote.hasTwoSided ? "Quote is two-sided." : "Quote is incomplete."}`;

  const positionTone: ConfidenceTone =
    activeContract || activeLegs.length > 0
      ? activeContract?.orderSide === "sell" || activeLegs.some((leg) => leg.orderSide === "sell")
        ? "warn"
        : "pass"
      : orderSide === "sell" && nextPositionQty < 0
        ? "warn"
        : "pass";
  const positionValue =
    activeLegs.length > 0
      ? `${activeLegs.length} legs`
      : activeContract
        ? `${activeContract.orderSide.toUpperCase()} ${activeContract.qty}`
        : `${formatSignedQuantity(currentPositionQty)} -> ${formatSignedQuantity(nextPositionQty)}`;
  const positionDetail =
    activeLegs.length > 0
      ? `${comboType ? comboType.replace("_", " ") : "Combo"} submits canonical legs together; ${relatedPositions.length} related position${relatedPositions.length === 1 ? "" : "s"} found.`
      : activeContract
        ? `${activeContract.expiry} ${activeContract.side.toUpperCase()} ${activeContract.strike}; ${relatedPositions.length} related position${relatedPositions.length === 1 ? "" : "s"} found.`
        : `${orderSymbol} position context before and after a ${normalizedQty} share ${orderSide}.`;

  return [
    {
      label: "Quote freshness",
      value: quoteValue,
      detail: `${quote.hasTwoSided ? `Spread ${quote.spreadLabel}.` : "Bid/ask is incomplete."} ${snapshotCopy}`,
      tone: quoteTone,
      icon: Clock,
    },
    {
      label: "Buying power",
      value: buyingPowerValue,
      detail: buyingPowerDetail,
      tone: buyingPowerTone,
      icon: Scales,
    },
    {
      label: "Open orders",
      value: collisionValue,
      detail: collisionDetail,
      tone: collisionTone,
      icon: Rows,
    },
    {
      label: "Session state",
      value: sessionValue,
      detail: sessionDetail,
      tone: sessionTone,
      icon: Gauge,
    },
    {
      label: activeContract || activeLegs.length > 0 ? "Contract context" : "Position context",
      value: positionValue,
      detail: positionDetail,
      tone: positionTone,
      icon: TrendUp,
    },
  ];
}

interface TicketExposure {
  cashDebit: number;
  label: string;
  marginUnknown: boolean;
}

function estimateTicketExposure({
  normalizedQty,
  orderSide,
  ticketPrice,
  activeContract,
  activeLegs,
}: {
  normalizedQty: number;
  orderSide: "buy" | "sell";
  ticketPrice: number;
  activeContract: ActiveContract | null;
  activeLegs: ActiveLeg[];
}): TicketExposure {
  if (activeLegs.length > 0) {
    const netCredit = activeLegs.reduce((sum, leg) => {
      const price = Number.isFinite(leg.limitPrice) && (leg.limitPrice ?? 0) > 0 ? leg.limitPrice ?? 0 : 0;
      return sum + (leg.orderSide === "sell" ? 1 : -1) * price * leg.qty * 100;
    }, 0);
    const debit = netCredit < 0 ? Math.abs(netCredit) : 0;
    const hasShortLeg = activeLegs.some((leg) => leg.orderSide === "sell");
    return {
      cashDebit: debit,
      label: netCredit >= 0 ? `Credit ${formatCurrency(netCredit)}` : `Debit ${formatCurrency(debit)}`,
      marginUnknown: hasShortLeg,
    };
  }

  if (activeContract) {
    const premium = Number.isFinite(activeContract.limitPrice) && (activeContract.limitPrice ?? 0) > 0
      ? activeContract.limitPrice ?? 0
      : ticketPrice;
    const notional = premium > 0 ? premium * activeContract.qty * 100 : 0;
    return {
      cashDebit: activeContract.orderSide === "buy" ? notional : 0,
      label: activeContract.orderSide === "buy" ? `Debit ${formatCurrency(notional)}` : "Short option margin",
      marginUnknown: activeContract.orderSide === "sell",
    };
  }

  const notional = ticketPrice > 0 ? ticketPrice * normalizedQty : 0;
  return {
    cashDebit: orderSide === "buy" ? notional : 0,
    label: orderSide === "buy" ? `Debit ${formatCurrency(notional)}` : `Sell notional ${formatCurrency(notional)}`,
    marginUnknown: false,
  };
}

function getIntentSymbols({
  orderSymbol,
  activeContract,
  activeLegs,
  tradeContextSymbol,
}: {
  orderSymbol: string;
  activeContract: ActiveContract | null;
  activeLegs: ActiveLeg[];
  tradeContextSymbol: string;
}): Set<string> {
  const symbols = new Set<string>();
  if (orderSymbol) symbols.add(orderSymbol);
  const tradeSymbol = normalizeTradeSymbol(tradeContextSymbol);
  if (tradeSymbol) symbols.add(tradeSymbol);
  if (activeContract) symbols.add(normalizeTradeSymbol(activeContract.occ));
  for (const leg of activeLegs) symbols.add(normalizeTradeSymbol(leg.occ));
  return symbols;
}

function normalizeTradeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function underlyingFromTradeSymbol(symbol: string): string | null {
  const normalized = normalizeTradeSymbol(symbol);
  return parseOccSymbol(normalized)?.symbol ?? normalizeUnderlyingSymbol(normalized);
}

function orderTouchesIntent(order: Order, intentSymbols: Set<string>, underlyingSymbol: string): boolean {
  const symbols = [order.symbol, ...(order.legs ?? []).map((leg) => leg.symbol)];
  return symbols.some((symbol) => symbolTouchesIntent(symbol, intentSymbols, underlyingSymbol));
}

function positionTouchesIntent(position: Position, intentSymbols: Set<string>, underlyingSymbol: string): boolean {
  return symbolTouchesIntent(position.symbol, intentSymbols, underlyingSymbol);
}

function symbolTouchesIntent(symbol: string, intentSymbols: Set<string>, underlyingSymbol: string): boolean {
  const normalized = normalizeTradeSymbol(symbol.split(/\s+/)[0] ?? symbol);
  if (!normalized) return false;
  if (intentSymbols.has(normalized)) return true;
  const parsedUnderlying = parseOccSymbol(normalized)?.symbol;
  if (parsedUnderlying && parsedUnderlying === underlyingSymbol) return true;
  return normalized === underlyingSymbol;
}

function normalizeEpochSeconds(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric > 1e12 ? numeric / 1000 : numeric;
}

function formatAgeDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "unavailable";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatSignedQuantity(quantity: number): string {
  if (!Number.isFinite(quantity) || quantity === 0) return "Flat";
  const abs = Math.abs(quantity);
  return `${quantity > 0 ? "+" : "-"}${abs}`;
}

function getMarketSessionState(now: Date): {
  label: string;
  detail: string;
  tone: ConfidenceTone;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const weekday = byType.get("weekday") ?? "Sat";
  const hour = Number(byType.get("hour"));
  const minute = Number(byType.get("minute"));
  const safeHour = Number.isFinite(hour) ? (hour === 24 ? 0 : hour) : 0;
  const safeMinute = Number.isFinite(minute) ? minute : 0;
  const minutes = safeHour * 60 + safeMinute;
  const isWeekday = !["Sat", "Sun"].includes(weekday);

  if (!isWeekday) {
    return {
      label: "Market closed",
      detail: "Weekend session; most orders queue for the next regular open.",
      tone: "warn",
    };
  }
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
    return {
      label: "Regular session",
      detail: "US cash market is open.",
      tone: "pass",
    };
  }
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
    return {
      label: "Premarket",
      detail: "Liquidity can be thinner before the cash open.",
      tone: "warn",
    };
  }
  if (minutes >= 16 * 60 && minutes < 20 * 60) {
    return {
      label: "After hours",
      detail: "Extended-hours liquidity can widen spreads.",
      tone: "warn",
    };
  }
  return {
    label: "Market closed",
    detail: "Regular session is closed; broker may queue eligible orders.",
    tone: "warn",
  };
}

function TradeIntentPanel({
  activeContract,
  activeLegs,
  comboType,
}: {
  activeContract: ActiveContract | null;
  activeLegs: ActiveLeg[];
  comboType: string | null;
}) {
  if (!activeContract && activeLegs.length === 0) {
    return (
      <section className="rounded-lg border border-border-hair bg-bg-elev-1/95 px-4 py-4 shadow-[0_18px_60px_-42px_rgba(16,22,17,0.36)]">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-sm bg-primary/10 text-primary">
            <SlidersHorizontal className="size-4" aria-hidden />
          </span>
          <h2 className="text-body font-semibold text-ink-1000">Intent rail</h2>
        </div>
        <p className="mt-3 text-body-sm leading-snug text-fg-muted">
          No pre-staged legs. The ticket owns the executable order and the chart stays dedicated to price.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-border-hair bg-bg px-3 py-2 text-label text-fg-muted">
          <ShieldWarning className="size-4 shrink-0 text-amber" aria-hidden />
          Broker and risk policy still run on submit.
        </div>
      </section>
    );
  }

  if (activeContract) {
    return (
      <section
        className="rounded-lg border border-border-hair bg-bg-elev-1/95 p-4 shadow-[0_18px_60px_-42px_rgba(16,22,17,0.36)]"
        aria-label="Pre-staged option contract"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendUp className="size-4 text-primary" aria-hidden />
            <h2 className="text-body font-semibold text-ink-1000">Staged contract</h2>
          </div>
          <TradeStatusPill label="1 leg" tone="amber" />
        </div>
        <div
          data-order-side={activeContract.orderSide}
          data-slot="active-contract"
          className="flex flex-col gap-2 rounded-md border border-border-hair bg-bg px-3 py-3 font-mono text-body-sm"
        >
          <span className="break-all font-semibold text-fg">{activeContract.occ}</span>
          <span className="text-fg-muted">
            {activeContract.expiry} · {activeContract.side.toUpperCase()} · ${activeContract.strike}
          </span>
          <span className={cn("uppercase font-medium", activeContract.orderSide === "sell" ? "text-loss" : "text-profit")}>
            {activeContract.orderSide} x {activeContract.qty}
          </span>
          {activeContract.limitPrice != null && (
            <span data-slot="active-contract-limit" className="text-fg-muted">
              @ ${activeContract.limitPrice.toFixed(2)}
            </span>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-lg border border-border-hair bg-bg-elev-1/95 p-4 shadow-[0_18px_60px_-42px_rgba(16,22,17,0.36)]"
      aria-label="Pre-staged multi-leg order"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" aria-hidden />
          <h2 className="text-body font-semibold text-ink-1000">Staged combo</h2>
        </div>
        <TradeStatusPill label={comboType ?? `${activeLegs.length} legs`} tone="amber" />
      </div>
      <div data-slot="active-legs" className="flex flex-col gap-2">
        {activeLegs.map((leg, i) => (
          <div
            key={leg.occ}
            data-slot="active-leg"
            data-order-side={leg.orderSide}
            className="flex flex-col gap-1 rounded-md border border-border-hair bg-bg px-3 py-3 font-mono text-body-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-label text-fg-muted">Leg {i + 1}</span>
              <span className={cn("uppercase font-medium", leg.orderSide === "sell" ? "text-loss" : "text-profit")}>
                {leg.orderSide} x {leg.qty}
              </span>
            </div>
            <span className="break-all font-semibold text-fg">{leg.occ}</span>
            <span className="text-fg-muted">
              {leg.expiry} · {leg.side.toUpperCase()} · ${leg.strike}
            </span>
            {leg.limitPrice != null && (
              <span data-slot="active-leg-limit" className="text-fg-muted">
                @ ${leg.limitPrice.toFixed(2)}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentOrdersPanel({
  orders,
  totalOrders,
  activeFilter,
  onFilterChange,
}: {
  orders: Order[];
  totalOrders: number;
  activeFilter: OrderFilter;
  onFilterChange: (filter: OrderFilter) => void;
}) {
  const filters: Array<{ id: OrderFilter; label: string }> = [
    { id: "working", label: "Working" },
    { id: "all", label: "All" },
    { id: "filled", label: "Filled" },
    { id: "rejected", label: "Rejected" },
  ];

  return (
    <section
      id="trade-orders"
      className="scroll-mt-20 overflow-hidden rounded-lg border border-border-hair bg-bg-elev-1/95 shadow-[0_18px_60px_-42px_rgba(16,22,17,0.36)]"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-2 px-4 pt-4 md:py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
            <Lightning className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-ink-1000">Execution activity</h2>
            <p className="mt-0.5 text-label text-fg-muted">{totalOrders} recent broker event{totalOrders === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 px-4 pb-4 md:py-4">
          <FunnelSimple className="mr-1 size-4 self-center text-fg-muted" aria-hidden />
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => onFilterChange(filter.id)}
              data-active={activeFilter === filter.id || undefined}
              className={cn(
                "rounded-sm border px-2.5 py-1.5 font-mono text-label transition-colors",
                activeFilter === filter.id
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border-hair bg-bg-elev-2 text-fg-muted hover:text-fg",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="border-t border-border-hair bg-bg px-4 py-8 text-center">
          <p className="text-body font-medium text-fg">
            {totalOrders === 0 ? "No orders yet today." : "No orders match this view."}
          </p>
          <p className="mt-1 text-body-sm text-fg-muted">
            {totalOrders === 0 ? "Submitted orders will appear here after broker acknowledgement." : "Switch filters to review other broker states."}
          </p>
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto border-t border-border-hair scrollbar-thin">
          <table className="w-full min-w-[520px] text-label">
            <caption className="sr-only">Recent orders</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="px-2 py-2 t-label">Date</th>
                <th scope="col" className="px-2 py-2 t-label">Time</th>
                <th scope="col" className="px-2 py-2 t-label">Symbol</th>
                <th scope="col" className="px-2 py-2 t-label">Side</th>
                <th scope="col" className="px-2 py-2 t-label">Qty</th>
                <th scope="col" className="px-2 py-2 t-label">Type</th>
                <th scope="col" className="px-2 py-2 t-label">Strategy</th>
                <th scope="col" className="px-2 py-2 t-label">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border/40">
                  <td className="px-2 py-2 t-meta">
                    {o.createdAt
                      ? new Date(o.createdAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="px-2 py-2 t-meta">
                    {o.createdAt ? new Date(o.createdAt).toLocaleTimeString() : "—"}
                  </td>
                  <td className="px-2 py-2 font-mono text-fg">{o.symbol}</td>
                  <td className={cn("px-2 py-2 font-medium uppercase", o.side === "buy" ? "text-profit" : "text-loss")}>
                    {o.side}
                  </td>
                  <td className="px-2 py-2 t-num-md text-fg">{o.quantity}</td>
                  <td className="px-2 py-2 capitalize text-fg-muted">{o.type.replace("_", " ")}</td>
                  <td className="px-2 py-2 font-mono text-label text-fg">{o.strategy ?? "—"}</td>
                  <td className="px-2 py-2">
                    <span
                      className={cn(
                        "inline-block rounded-sm px-1.5 py-0.5 text-label font-medium uppercase tracking-wider",
                        o.status === "filled" && "bg-profit/15 text-profit",
                        o.status === "rejected" && "bg-loss/15 text-loss",
                        o.status === "cancelled" && "bg-fg-muted/15 text-fg-muted",
                        o.status !== "filled" && o.status !== "rejected" && o.status !== "cancelled" && "bg-ice/15 text-ice",
                      )}
                    >
                      {o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
