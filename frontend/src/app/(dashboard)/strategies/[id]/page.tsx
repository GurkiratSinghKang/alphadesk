"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { Pause, Play, ArrowRight } from "lucide-react";

import DestructiveConfirmModal from "@/components/destructive/DestructiveConfirmModal";
import { useDestructiveAction } from "@/components/destructive/useDestructiveAction";
import Display from "@/components/typography/Display";
import Eyebrow from "@/components/typography/Eyebrow";
import Mono from "@/components/typography/Mono";
import SectionRule from "@/components/typography/SectionRule";
import RegimePill from "@/components/primitives/RegimePill";
import type { Regime, RegimeVol } from "@/components/primitives/RegimePill";
import {
  getStrategyPerformance,
  getStrategyTrades,
  getStrategyPositions,
  toggleStrategy,
  getBars,
  type StrategyPerformance,
  type StrategyTrade,
  type StrategyPositionDetail,
} from "@/lib/api";
import { STRATEGY_CONTENT, type StrategyContent } from "@/lib/strategy-content";
import { LIVE_DISABLED, PAPER_ONLY, STRATEGY_META } from "@/lib/strategies";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

import StrategyHero from "./_strategy/StrategyHero";
import EquityPanel, {
  type EquityPoint,
  type EquityRange,
} from "./_strategy/EquityPanel";
import SignalSection from "./_strategy/SignalSection";
import PositionsSection from "./_strategy/PositionsSection";
import LimitationsSection from "./_strategy/LimitationsSection";
import StrategyDisclosure from "@/components/strategies/StrategyDisclosure";

// ─── Slug alias (canonical strategy ids) ────────────────────────
// A1#6 — the previous map only rewrote one legacy slug. Any researcher who
// typed an underscore form in the URL bar (`/strategies/earnings_vol`,
// `/strategies/kama_breakout`, etc.) landed on a 404. We now alias every
// canonical strategy's `{strategy}_{name}` underscore form to its
// hyphen-delimited canonical id, plus keep the existing `earnings-vol`
// short-form alias for backwards compatibility with any shared links.
const SLUG_TO_ID: Record<string, string> = {
  // Legacy short-form alias (kept for any bookmarks).
  "earnings-vol": "earnings-vol-premium",
  "pairs-stat-arb": "pairs-trading",
  // Underscore fallbacks — one per canonical strategy id.
  earnings_options_play: "earnings-options-play",
  momentum_quality: "momentum-quality",
  vrp_harvesting: "vrp-harvesting",
  earnings_vol_premium: "earnings-vol-premium",
  earnings_vol: "earnings-vol-premium",
  regime_adaptive: "regime-adaptive",
  ts_momentum: "ts-momentum",
  rsi2_reversal: "rsi2-reversal",
  dual_momentum: "dual-momentum",
  pairs_trading: "pairs-trading",
  pairs_stat_arb: "pairs-trading",
  kama_breakout: "kama-breakout",
  vwap_strategy: "vwap-strategy",
  claude_alpha: "claude-alpha",
  dividend_capture: "dividend-capture",
  sector_rotation: "sector-rotation",
  mean_reversion: "mean-reversion",
  vcp_breakout: "vcp-breakout",
  gap_fill: "gap-fill",
  manual_discretionary: "manual-discretionary",
};
function resolveStrategyId(slug: string): string {
  return SLUG_TO_ID[slug] ?? slug;
}

// ─── Category label from STRATEGY_META.group ───────────────────

const GROUP_LABEL: Record<string, string> = {
  fundamental: "Fundamental / event-driven",
  technical: "Technical / signal-driven",
  other: "Discretionary",
};

// ─── Academic sources per strategy (derived from each strategy's spec.md) ──
// Each entry surfaces the canonical literature cited in
// `backend/strategies/<name>/spec.md` § "Academic grounding". Strategies
// without an entry skip § 04 References silently (per design spec).

const ACADEMIC_SOURCES: Record<string, string[]> = {
  "momentum-quality": [
    "Jegadeesh, N. & Titman, S. (1993). Returns to Buying Winners and Selling Losers. Journal of Finance 48(1).",
    "Carhart, M. (1997). On Persistence in Mutual Fund Performance. Journal of Finance 52(1).",
    "Piotroski, J. (2000). Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers. Journal of Accounting Research 38.",
    "Asness, C., Frazzini, A. & Pedersen, L. H. (2014/2019). Quality Minus Junk. Review of Accounting Studies 24.",
    "Daniel, K. & Moskowitz, T. J. (2016). Momentum Crashes. Journal of Financial Economics 122(2).",
    "Barroso, P. & Santa-Clara, P. (2015). Momentum Has Its Moments. Journal of Financial Economics 116(1).",
  ],
  pead: [
    "Bernard, V. & Thomas, J. (1989). Post-Earnings-Announcement Drift: Delayed Price Response or Risk Premium? Journal of Accounting Research 27.",
    "Bernard, V. & Thomas, J. (1990). Evidence that Stock Prices Do Not Fully Reflect the Implications of Current Earnings for Future Earnings. Journal of Accounting & Economics 13.",
    "Livnat, J. & Mendenhall, R. (2006). Comparing the Post-Earnings Announcement Drift for Surprises Calculated from Analyst and Time-Series Forecasts. Journal of Accounting Research 44(1).",
    "Chordia, T., Goyal, A., Sadka, G., Sadka, R. & Shivakumar, L. (2009). Liquidity and the Post-Earnings-Announcement Drift. Financial Analysts Journal 65(4).",
    "Chu, Y., Hirshleifer, D. & Ma, L. (2020). The Causal Effect of Limits to Arbitrage on Asset Pricing Anomalies. Journal of Finance 75(5).",
  ],
  "vrp-harvesting": [
    "Bakshi, G. & Madan, D. (2006). A Theory of Volatility Spreads. Management Science 52(12).",
    "Carr, P. & Wu, L. (2009). Variance Risk Premiums. Review of Financial Studies 22(3).",
    "Israelov, R. & Nielsen, L. (2015, 2020). Covered Calls Uncovered. AQR working paper series.",
    "Harvey, C. R., Liu, Y. et al. (2019). Short-Volatility Strategies: A Review.",
    "Dubinsky, A. & Johannes, M. (2023). Short-Vol Without Blowing Up: Systematic Short-Vol With Tail Hedges, 1996–2020. Journal of Derivatives.",
  ],
  "earnings-vol-premium": [
    "Beckers, S. (1981). Variances of Security Price Returns Based on High, Low and Closing Prices. Journal of Business 54(1).",
    "Ederington, L. & Lee, J. H. (1996). The Creation and Resolution of Market Uncertainty. Journal of Financial and Quantitative Analysis 31(4).",
    "Gao, X., Xing, Y. & Zhang, X. (2018). What Does the Individual Option Volatility Smirk Tell Us About Future Equity Returns? Review of Financial Studies 31(7).",
    "Dubinsky, A., Johannes, M., Kaeck, A. & Seeger, N. (2019). Option Pricing of Earnings Announcement Risk. Review of Financial Studies 32(2).",
    "Natenberg, S. (2015). Option Volatility and Pricing, 2e. McGraw-Hill.",
  ],
  "ts-momentum": [
    "Moskowitz, T. J., Ooi, Y. H. & Pedersen, L. H. (2012). Time Series Momentum. Journal of Financial Economics 104(2).",
    "Hurst, B., Ooi, Y. H. & Pedersen, L. H. (2013). Demystifying Managed Futures. Journal of Investment Management 11(3).",
    "Georgopoulou, A. & Wang, J. (2016). The Trend is Your Friend: Time Series Momentum Strategies across Equity and Commodity Markets. Review of Finance 21(4).",
  ],
  "rsi2-reversal": [
    "DeBondt, W. & Thaler, R. (1985). Does the Stock Market Overreact? Journal of Finance 40(3).",
    "Jegadeesh, N. (1990). Evidence of Predictable Behavior of Security Returns. Journal of Finance 45(3).",
    "Connors, L. & Alvarez, C. (2009). Short Term Trading Strategies That Work. Trading Markets Research.",
    "Avellaneda, M. & Lee, J.-H. (2010). Statistical Arbitrage in the U.S. Equities Market. Quantitative Finance 10(7).",
    "Connors Research (2013). An Introduction to ConnorsRSI. Whitepaper.",
    "Kakushadze, Z. (2015). Mean-Reversion and Optimization. Journal of Asset Management 16.",
  ],
  "pairs-trading": [
    "Engle, R. F. & Granger, C. W. J. (1987). Co-integration and Error Correction. Econometrica 55(2).",
    "Vidyamurthy, G. (2004). Pairs Trading: Quantitative Methods and Analysis. Wiley.",
    "Gatev, E., Goetzmann, W. N. & Rouwenhorst, K. G. (2006). Pairs Trading: Performance of a Relative-Value Arbitrage Rule. Review of Financial Studies 19(3).",
    "Avellaneda, M. & Lee, J.-H. (2010). Statistical Arbitrage in the U.S. Equities Market. Quantitative Finance 10(7).",
    "Do, B. & Faff, R. (2012). Are Pairs Trading Profits Robust to Trading Costs? Journal of Financial Research 35(2).",
    "Chan, E. P. (2013). Algorithmic Trading: Winning Strategies and Their Rationale. Wiley.",
  ],
  "pairs-stat-arb": [
    "Engle, R. F. & Granger, C. W. J. (1987). Co-integration and Error Correction. Econometrica 55(2).",
    "Vidyamurthy, G. (2004). Pairs Trading: Quantitative Methods and Analysis. Wiley.",
    "Gatev, E., Goetzmann, W. N. & Rouwenhorst, K. G. (2006). Pairs Trading: Performance of a Relative-Value Arbitrage Rule. Review of Financial Studies 19(3).",
    "Avellaneda, M. & Lee, J.-H. (2010). Statistical Arbitrage in the U.S. Equities Market. Quantitative Finance 10(7).",
  ],
  "dual-momentum": [
    "Jegadeesh, N. & Titman, S. (1993). Returns to Buying Winners and Selling Losers. Journal of Finance 48(1).",
    "Moskowitz, T., Ooi, Y. & Pedersen, L. (2012). Time Series Momentum. Journal of Financial Economics 104(2).",
    "Antonacci, G. (2012). Risk Premia Harvesting Through Dual Momentum. Journal of Management & Entrepreneurship.",
    "Antonacci, G. (2014). Dual Momentum Investing: An Innovative Strategy for Higher Returns with Lower Risk. McGraw-Hill.",
  ],
  "regime-adaptive": [
    "Hamilton, J. D. (1989). A New Approach to the Economic Analysis of Nonstationary Time Series and the Business Cycle. Econometrica 57(2).",
    "Whaley, R. E. (2000). The Investor Fear Gauge. Journal of Portfolio Management 26(3).",
    "Ang, A. & Bekaert, G. (2002). International Asset Allocation with Regime Shifts. Review of Financial Studies 15(4).",
    "Faber, M. T. (2007). A Quantitative Approach to Tactical Asset Allocation. Journal of Wealth Management.",
    "Guidolin, M. & Timmermann, A. (2007). Asset Allocation under Multivariate Regime Switching. Journal of Economic Dynamics and Control 31(11).",
    "Asness, C., Ilmanen, A., Israel, R. & Moskowitz, T. (2015). Investing with Style. Journal of Investment Management 13(1).",
  ],
  "kama-breakout": [
    "Donchian, R. (1960). Donchian's 5- and 20-day Moving Averages. Commodities magazine.",
    "LeBeau, C. & Lucas, D. (1992). Technical Traders Guide to Computer Analysis of the Futures Markets.",
    "Kaufman, P. J. (1995). Smarter Trading. McGraw-Hill (ch. 6); Trading Systems and Methods, 5e (Wiley, 2013).",
    "Faber, M. (2007). A Quantitative Approach to Tactical Asset Allocation. Journal of Wealth Management.",
    "Faith, C. (2007). Way of the Turtle. McGraw-Hill.",
    "Covel, M. (2007). The Complete TurtleTrader. HarperBusiness.",
  ],
  orb: [
    "Lo, A. W. & MacKinlay, A. C. (1988). Stock Market Prices Do Not Follow Random Walks. Review of Financial Studies 1(1).",
    "Crabel, T. (1990). Day Trading with Short Term Price Patterns and Opening Range Breakout.",
    "Cont, R. (2001). Empirical Properties of Asset Returns: Stylized Facts and Statistical Issues. Quantitative Finance 1(2).",
    "Fisher, M. (2002). The Logical Trader: Applying A Method To The Madness. Wiley.",
    "Zarattini, C. & Aziz, N. (2023). A Profitable Day Trading Strategy for the US Equity Market. Working paper (arXiv:2302.13811).",
  ],
  "vwap-strategy": [
    "Kyle, A. (1985). Continuous Auctions and Insider Trading. Econometrica 53(6).",
    "Berkowitz, S. A., Logue, D. E. & Noser, E. A. (1988). The Total Cost of Transactions on the NYSE. Journal of Finance 43(1).",
    "Bouchaud, J.-P., Gefen, Y., Potters, M. & Wyart, M. (2003). Fluctuations and Response in Financial Markets. Quantitative Finance 4(2).",
    "Shannon, B. (2008). Technical Analysis Using Multiple Timeframes.",
    "Connors, L. & Alvarez, C. (2009). Short Term Trading Strategies That Work. Trading Markets Research.",
  ],
};

// ─── Period filter for equity curve ────────────────────────────

function filterCurve(curve: EquityPoint[], range: EquityRange): EquityPoint[] {
  if (range === "ALL" || curve.length === 0) return curve;
  const now = new Date();
  const cutoff = new Date();
  switch (range) {
    case "1M":
      cutoff.setMonth(now.getMonth() - 1);
      break;
    case "3M":
      cutoff.setMonth(now.getMonth() - 3);
      break;
    case "YTD":
      cutoff.setMonth(0);
      cutoff.setDate(1);
      break;
    case "1Y":
      cutoff.setFullYear(now.getFullYear() - 1);
      break;
  }
  return curve.filter((p) => new Date(p.date) >= cutoff);
}

// ─── Metric cell formatters ────────────────────────────────────

function formatOrDash(value: number | null | undefined, format: (n: number) => string): string {
  // Only `null` / `undefined` / NaN should collapse to an em-dash. A literal
  // zero is meaningful (a real 0.00% return after a round-trip trade) and
  // should render through the formatter just like any other value.
  if (value == null || Number.isNaN(value)) return "\u2014";
  return format(value);
}
/**
 * Percentage-like values from the backend arrive in two shapes: live P&L
 * uses whole-percent units (e.g. `total_return_pct = 2.6` meaning 2.6 %),
 * but OOS / backtest numbers arrive as fractions (e.g. `cagr = 0.362`
 * meaning 36.2 %, `max_drawdown = 0.0801` meaning 8.01 %).
 *
 * The previous formatters assumed whole-percent and rendered `0.0801` as
 * `-0.1 %` — off by 100×. `toPct` auto-detects: when the magnitude is under
 * 1.5, treat the input as a fraction and scale. `1.5` is the threshold
 * because a 150 % live return is implausible on any production strategy and
 * a backtest fraction > 1.5 (150 %) is also implausible. Calibrated to the
 * live backend values from Wave 26: `max_drawdown ∈ [−0.073, 0.087]`,
 * `cagr ∈ [0.08, 0.60]`, `total_return_pct ≤ 2.6`.
 */
function toPct(v: number): number {
  return Math.abs(v) < 1.5 ? v * 100 : v;
}
function signedPct(v: number): string {
  const pct = toPct(v);
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}
function signedNumber(v: number): string {
  return v.toFixed(2);
}
function negPct(v: number): string {
  // MAX DD is always displayed as a negative number. The backend sometimes
  // emits it as a positive fraction (`0.0801`) and sometimes as a negative
  // fraction (`-0.0045`); the formatter normalises both to `-X.X %`.
  const pct = toPct(v);
  return `${pct < 0 ? pct.toFixed(1) : `-${Math.abs(pct).toFixed(1)}`}%`;
}

// ─── Hit rate derivation from closed trades ────────────────────

function deriveHitRate(trades: StrategyTrade[]): number | null {
  const closed = trades.filter(
    (t) => t.pnl != null && (t.status === "closed" || t.status === "filled" || t.exit_price != null)
  );
  if (closed.length === 0) return null;
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  return (wins / closed.length) * 100;
}

// ─── Last trade-date ───────────────────────────────────────────

function formatLastTrade(dateStr: string | undefined | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Empty-section helper ──────────────────────────────────────

/**
 * EmptySection
 * ────────────
 * Drop-in replacement for any § section that has no data yet. Keeps the
 * editorial rhythm (italic-serif copy, warm-muted tone) so the page reads
 * intentional instead of collapsed. Used when the performance endpoint
 * returns null (common on a freshly activated strategy).
 */
function EmptySection({ title, reason }: { title: string; reason: string }) {
  // 2026-04-21 polish: title eyebrow was 10.5px; normalised to the shared
  // `.t-label` (12px fs-label) used by every other eyebrow on the page so
  // empty-state and populated sections read with the same typographic
  // weight.
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-hair bg-bg-elev-1 px-5 py-6">
      <p className="t-label">{title}</p>
      <p className="font-display italic text-[15px] text-fg-muted leading-snug">
        {reason}
      </p>
    </div>
  );
}

// ─── Regime signal from status ────────────────────────────────

function statusRegime(
  status: string | undefined,
  opts: { liveDisabled?: boolean; paperOnly?: boolean } = {},
): { regime: Regime; vol?: RegimeVol; label: string } {
  // BUG-010: ACTIVE and NOT-READY-FOR-LIVE must not both appear on the same
  // strategy. If the backend (or static manifest) flags the strategy as
  // live-disabled, demote the pill to "paper only" regardless of the
  // backend's generic status string. Same for thin-OOS paper-only strategies.
  if (opts.liveDisabled) return { regime: "neutral", vol: "elevated", label: "paper only" };
  if (opts.paperOnly) return { regime: "neutral", vol: "elevated", label: "paper only" };
  if (status === "active") return { regime: "bull", vol: "low", label: "active" };
  if (status === "paused") return { regime: "neutral", vol: "elevated", label: "paused" };
  if (status === "halted") return { regime: "crisis", vol: "high", label: "halted" };
  return { regime: "neutral", vol: "elevated", label: status ?? "idle" };
}

// ─── Main page component ──────────────────────────────────────

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const rawSlug = params.id as string;
  const strategyId = resolveStrategyId(rawSlug);
  // Wave 26 — unknown-slug detection. `resolveStrategyId` only aliases legacy
  // slugs; any other unknown string falls through to STRATEGY_META's default
  // object. We render a "not found" state at the bottom of the page for
  // unknown slugs instead of silently rendering a blank hero with the slug as
  // the title (Persona 1 audit found this reads as broken).
  //
  // A3#8 (Wave 8) — call ``notFound()`` unconditionally for unknown slugs
  // instead of waiting for the backend to confirm with a 404 response.
  // Previously the page would spin indefinitely while the perf request
  // queued/timed-out for a typo'd URL; now we short-circuit as soon as the
  // frontend manifest says the id is unknown. `resolveStrategyId` covers
  // the common underscore-form typos (see ``SLUG_TO_ID`` above), so the
  // remaining cases really are garbage paths that should 404.
  const isKnownStrategy = strategyId in STRATEGY_META;
  if (!isKnownStrategy) {
    notFound();
  }

  const [perf, setPerf] = useState<StrategyPerformance | null>(null);
  const [trades, setTrades] = useState<StrategyTrade[]>([]);
  const [positions, setPositions] = useState<StrategyPositionDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<EquityRange>("3M");
  const [toggling, setToggling] = useState(false);
  const [benchmark, setBenchmark] = useState<EquityPoint[]>([]);
  const destructive = useDestructiveAction();
  // Persona 71-8 — on navigation from ``/strategies → /strategies/[id]``
  // we move keyboard / AT focus to the banner (when it renders) or the
  // hero wrapper. The ``tabIndex={-1}`` makes the element
  // programmatically focusable without inserting it into the Tab order;
  // the effect below only fires on ``strategyId`` change so repeated
  // in-page interactions don't re-steal focus.
  const focusTargetRef = useRef<HTMLDivElement>(null);
  const fetchSeqRef = useRef(0);
  useEffect(() => {
    focusTargetRef.current?.focus();
  }, [strategyId]);
  // Wave 8 (A3#8) — the ``perfNotFound`` flag used to guard the editorial
  // "Strategy not available" fallback branch. That branch is gone (unknown
  // slugs now short-circuit to ``notFound()`` at the top of the component,
  // see the ``if (!isKnownStrategy) notFound()`` block), so the 404-sniff
  // state was dead and removed alongside it.

  const meta = STRATEGY_META[strategyId] || {
    name: strategyId,
    shortName: strategyId,
    group: "other" as const,
  };
  const content: StrategyContent | null = STRATEGY_CONTENT[strategyId] ?? null;
  const categoryLabel = GROUP_LABEL[meta.group] ?? "Strategy";

  const fetchData = useCallback(async () => {
    const requestId = ++fetchSeqRef.current;
    setLoading(true);
    setPerf(null);
    setTrades([]);
    setPositions([]);
    setBenchmark([]);
    const [p, t, pos] = await Promise.allSettled([
      getStrategyPerformance(strategyId),
      getStrategyTrades(strategyId),
      getStrategyPositions(strategyId),
    ]);
    if (requestId !== fetchSeqRef.current) return;
    if (p.status === "fulfilled") {
      setPerf(p.value);
    }
    // A3#8 — backend 404s are no longer sniffed here. Unknown slugs were
    // already handled by ``notFound()`` at the top of the component; a
    // rejection on a known slug is treated as a transient failure and the
    // retry block at the bottom of the page surfaces it to the user.
    if (t.status === "fulfilled") setTrades(t.value);
    if (pos.status === "fulfilled") setPositions(pos.value);
    setLoading(false);
  }, [strategyId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchData();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      fetchSeqRef.current += 1;
    };
  }, [fetchData]);

  // SPY benchmark pull once we know equity-curve length
  useEffect(() => {
    if (!perf?.equity_curve || perf.equity_curve.length < 2) return;
    let cancelled = false;
    getBars("SPY", "D", perf.equity_curve.length + 5)
      .then((bars) => {
        if (cancelled || bars.length === 0) return;
        const first = bars[0].close;
        setBenchmark(
          bars.map((b) => ({
            date: new Date(b.time * 1000).toISOString().slice(0, 10),
            value: (b.close / first - 1) * 100,
          }))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [perf?.equity_curve]);

  async function executePauseStrategy() {
    if (!perf) return;
    setToggling(true);
    try {
      const res = await toggleStrategy(strategyId);
      setPerf((prev) => (prev ? { ...prev, status: res.new_status } : prev));
      toast({
        type: "success",
        message: `${meta.name} ${res.new_status === "active" ? "resumed" : "paused"}`,
      });
    } catch (e) {
      // Persona 2 #9 — previously swallowed. Surface both to the toast stack
      // (user-visible) and the console (for debugging). `err?.message` covers
      // the common `Error("API 4xx: …")` shape thrown by `apiFetch`.
      const msg = e instanceof Error ? e.message : "Pause/resume failed. Please retry.";
      console.error("toggleStrategy failed", e);
      toast({ type: "error", message: msg });
    } finally {
      setToggling(false);
    }
  }

  function handleToggle() {
    if (!perf) return;
    // Resume is not destructive — fire directly.
    if (perf.status !== "active") {
      executePauseStrategy();
      return;
    }
    // Pause is destructive — confirm first.
    destructive.request({
      title: "Pause strategy",
      description: `${meta.name} stops generating new signals.`,
      consequences: [
        "Open positions stay; no new entries.",
        "Pending signals discarded.",
        "Resume any time from this page.",
      ],
      confirmLabel: "Pause strategy",
      onConfirm: executePauseStrategy,
    });
  }

  // ─── Derived metrics ─────────────────────────────────────────
  const hitRate = useMemo(() => deriveHitRate(trades), [trades]);
  const equityData = useMemo(
    () => (perf ? filterCurve(perf.equity_curve, range) : []),
    [perf, range]
  );
  const benchmarkData = useMemo(() => {
    if (equityData.length < 2) return [];
    const start = equityData[0].date;
    return benchmark.filter((b) => b.date >= start);
  }, [benchmark, equityData]);

  const status = statusRegime(perf?.status, {
    liveDisabled:
      LIVE_DISABLED.has(strategyId) || (perf?.live_disabled ?? false),
    paperOnly:
      PAPER_ONLY.has(strategyId) || (perf?.paper_only ?? false),
  });

  // Wave 26 — hero metrics now prefer OOS backtest values. `cagr` and
  // `hit_rate` are published by the backend (fractions) alongside the live
  // `annualized_return_pct`/derived hitRate, which are almost always 0 / null
  // for strategies that haven't traded yet. Fall back to the live number only
  // when the OOS one is missing.
  //
  // BUG-019 — discretionary strategies have no backtest at all. When NONE of
  // Sharpe / MaxDD / HitRate / CAGR come back from the API, surface all four
  // as em-dashes with a single explanatory footnote instead of computing a
  // live-derived CAGR on its own (which produced a confusing "CAGR +x% ·
  // Sharpe — · MaxDD — · HitRate —" row).
  const hasAnyBacktestMetric =
    perf?.sharpe_ratio != null ||
    perf?.max_drawdown != null ||
    perf?.hit_rate != null ||
    perf?.cagr != null;
  const cagrValue = hasAnyBacktestMetric
    ? (perf?.cagr ?? perf?.annualized_return_pct ?? null)
    : null;
  // `hit_rate` from the backend is a fraction (0..1). Convert to whole-percent
  // for display, then fall back to the live-derived hit rate (already in
  // percent) when the backend didn't return it.
  const hitRateBackend = perf?.hit_rate != null ? perf.hit_rate * 100 : null;
  const hitRateDisplay = hasAnyBacktestMetric ? (hitRateBackend ?? hitRate) : null;
  const showNoBacktestNote = perf != null && !hasAnyBacktestMetric;
  // High-OOS-Sharpe caveat threshold. Research-shell strategies can publish
  // excellent checked-in OOS metrics while still being explicitly not ready
  // for live capital; render the editorial caveat when a value clears this.
  const SHARPE_CAVEAT_THRESHOLD = 3.0;
  const suspiciousSharpe =
    perf?.sharpe_ratio != null && perf.sharpe_ratio > SHARPE_CAVEAT_THRESHOLD;

  const cells = [
    {
      label: "OOS SHARPE",
      value: formatOrDash(perf?.sharpe_ratio ?? null, signedNumber),
      testId: "sharpe",
    },
    {
      label: "MAX DD",
      value: formatOrDash(perf?.max_drawdown ?? null, negPct),
      tone: perf?.max_drawdown != null && perf.max_drawdown !== 0
        ? ("loss" as const)
        : undefined,
      testId: "dd",
    },
    {
      label: "CAGR",
      value: formatOrDash(cagrValue, signedPct),
      tone: (cagrValue ?? 0) > 0
        ? ("profit" as const)
        : (cagrValue ?? 0) < 0
          ? ("loss" as const)
          : undefined,
      testId: "cagr",
    },
    {
      label: "HIT RATE",
      value: hitRateDisplay != null ? `${hitRateDisplay.toFixed(0)}%` : "\u2014",
      testId: "hit",
    },
  ];

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-6 py-8">
        <div className="h-6 w-48 animate-pulse rounded bg-bg-elev-1" />
        <div className="h-14 w-80 animate-pulse rounded bg-bg-elev-1" />
        <div className="h-[320px] animate-pulse rounded-lg bg-bg-elev-1" />
      </div>
    );
  }

  // A3#8 (Wave 8) — unknown-slug handling moved to the top of the component
  // (see the ``if (!isKnownStrategy) notFound()`` block). An unknown slug now
  // short-circuits before the loading spinner mounts, so the deferred-404 and
  // "strategy not available" retry branches that used to live here are no
  // longer reachable. If the user sees a spinner past this point, the slug
  // is known — any backend failure on a known slug is handled by the retry
  // block at the bottom of the page (``{!perf ? retryBlock}``).

  const totalReturnPct = perf?.total_return_pct ?? 0;
  // Wave 26 — the summary row previously showed `TOTAL RETURN +0.00%` for
  // every strategy that hadn't traded yet, even when the OOS Sharpe / MaxDD /
  // CAGR cells clearly showed a real backtested strategy. Prefer the live
  // total-return when it's non-zero (real P&L); otherwise fall through to
  // `cagr` and label the cell "OOS CAGR" so the data and copy match.
  const showOosCagr =
    (totalReturnPct === 0 || totalReturnPct == null) &&
    perf?.cagr != null;
  const summaryReturnLabel = showOosCagr ? "OOS CAGR" : "TOTAL RETURN";
  const summaryReturnRaw = showOosCagr ? (perf!.cagr as number) : totalReturnPct;
  const returnSummary: { label: string; value: string; tone?: "profit" | "loss" | "neutral" }[] = perf
    ? [
        {
          label: summaryReturnLabel,
          value: signedPct(summaryReturnRaw),
          tone: summaryReturnRaw >= 0 ? "profit" : "loss",
        },
        {
          label: "CURRENT VALUE",
          value: new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(perf.current_value ?? 0),
        },
        {
          label: "INVESTED",
          value: new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(perf.invested_amount ?? 0),
        },
        {
          label: "ACTIVE POSITIONS",
          value: String(perf.active_positions_count ?? 0),
        },
      ]
    : [];

  const academicSources = ACADEMIC_SOURCES[strategyId] ?? [];
  const knownLimitations = content?.risks ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-10 px-6 py-8">
      {/* Breadcrumb — BUG-020: previously said "Dashboard / <name>" even
          though this page lives under /strategies. Anchor to the strategies
          catalogue so the trail mirrors the URL path. */}
      <nav className="flex items-center gap-2 font-sans text-[13px] text-fg-muted" aria-label="Breadcrumb">
        {/* 2026-04-21 polish: breadcrumb size lifted from 12px to 13px and a
            focus-visible ring added — previously the link had no visible
            outline when tabbed to, making keyboard navigation blind to it. */}
        <Link
          href="/strategies"
          className={cn(
            "rounded-sm transition-colors hover:text-fg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:px-1"
          )}
        >
          Strategies
        </Link>
        <span aria-hidden>/</span>
        <span className="text-fg">{meta.name}</span>
      </nav>

      {/* Focus wrapper for persona 71-8 — receives programmatic focus on
          slug change so navigation from the catalogue lands the user on
          the hero (or the disclosure banner when it renders underneath).
          ``outline-none`` because the visible focus ring on a page
          heading reads as a bug to sighted users; AT users still get
          the announcement. */}
      <div
        ref={focusTargetRef}
        tabIndex={-1}
        aria-label={
          (LIVE_DISABLED.has(strategyId) || (perf?.live_disabled ?? false))
            ? `${meta.name} — not ready for live`
            : (PAPER_ONLY.has(strategyId) || (perf?.paper_only ?? false))
              ? `${meta.name} — paper-only`
              : meta.name
        }
        className="outline-none flex flex-col gap-10"
      >
      {/* Hero */}
      <StrategyHero
        categoryLabel={categoryLabel.toUpperCase()}
        name={meta.name}
        description={perf?.description ?? null}
        cells={cells}
      />

      {/* BUG-019 — single footnote under the hero grid when the strategy
          has no backtest (discretionary). Renders only when ALL four
          backtest cells collapse to em-dash; prevents the misleading
          "partial metrics" look where one metric was real and the others
          were dashes. */}
      {showNoBacktestNote ? (
        <p
          data-testid="no-backtest-note"
          className="-mt-6 font-display italic text-[13px] leading-snug text-fg-muted"
        >
          No backtest (discretionary) — Sharpe, MaxDD, CAGR and Hit Rate are not shown for manually-traded positions.
        </p>
      ) : null}

      {/* Wave 4 — consolidation-report disclosure banner. Renders verbatim
          copy for the 5 strategies in audit-reports/00-strategy-experts-
          consolidation.md §4 and a NOT-READY-FOR-LIVE pill when the
          backend's live_disabled / paper_only flag is set. Returns null
          (renders nothing) for PASS strategies — the 7 non-disclosed pages
          remain unchanged.

          A3#6 (Wave 8) — the pill now pre-seeds from the shared client-side
          manifest (``LIVE_DISABLED`` / ``PAPER_ONLY``) so it
          appears on first paint. Without this, researchers saw a headline
          high-OOS-Sharpe banner for ~500ms with no "NOT READY FOR LIVE"
          pill while ``perf`` was loading — a dangerous gap for ``orb`` and
          ``kama-breakout``. Once ``perf`` arrives, the backend flag can
          still widen the set (``||``), so the server remains the source of
          truth but the client never shows the banner without the caveat. */}
      <StrategyDisclosure
        strategyId={strategyId}
        liveDisabled={
          LIVE_DISABLED.has(strategyId) || (perf?.live_disabled ?? false)
        }
        paperOnly={
          PAPER_ONLY.has(strategyId) || (perf?.paper_only ?? false)
        }
      />
      </div>

      {/* Wave 26 — honesty caveat for unusually high OOS Sharpe. Instead of
          hiding the number we attach a small italic disclosure so researchers
          understand in-sample selection bias can flatter backtest Sharpe.
          Renders only when the threshold is cleared. */}
      {suspiciousSharpe ? (
        <p
          data-testid="sharpe-caveat"
          className="-mt-6 font-display italic text-[13px] leading-snug text-fg-muted"
        >
          Live deployment may diverge from this OOS Sharpe — see in-sample limitations below.
        </p>
      ) : null}

      {/* Status + actions row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <RegimePill
            regime={status.regime}
            vol={status.vol}
            label={status.label.toUpperCase()}
          />
          <div className="flex flex-col">
            <Eyebrow as="span">Last trade</Eyebrow>
            <Mono className="text-[13px] text-fg">
              {formatLastTrade(perf?.last_trade_date)}
            </Mono>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 2026-04-21 polish: both action buttons previously rendered at
              ~28px tall (px-3 py-1.5 + 12px text). Hit-target floor is 36px
              on desktop. Swapped px/py for `h-9` + `px-3.5` so the visual
              weight matches the rest of the row (regime pill, last-trade
              chip). Added `focus-visible:ring-2 ring-brand` to both buttons
              so keyboard users see a visible outline — previously none. */}
          <button
            type="button"
            data-testid="strategy-pause"
            onClick={handleToggle}
            disabled={toggling || !perf}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-bg-elev-1 px-3.5 font-sans text-[12px] font-semibold text-fg transition-colors",
              "hover:bg-bg-elev-2 disabled:opacity-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            )}
            aria-label={perf?.status === "active" ? `Pause ${meta.name}` : `Resume ${meta.name}`}
          >
            {perf?.status === "active" ? (
              <>
                <Pause className="h-3.5 w-3.5" aria-hidden />
                Pause
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden />
                Resume
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/?strategy=${strategyId}`)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-sm bg-brand px-3.5 font-sans text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-gold-300",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            )}
            aria-label={`View ${meta.name} trades on the desk`}
          >
            View trades
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {/* § 01 Signal */}
      {content ? (
        <section className="flex flex-col gap-6">
          <SectionRule tag="§ 01 · Signal" />
          <SignalSection
            thesis={content.thesis}
            edge={content.edge}
            howItWorks={content.howItWorks}
          />
        </section>
      ) : null}

      {/* § 02 Performance */}
      <section className="flex flex-col gap-6">
        <SectionRule tag="§ 02 · Performance" />
        {perf ? (
          <EquityPanel
            data={equityData}
            benchmark={benchmarkData.length > 1 ? benchmarkData : undefined}
            activeRange={range}
            onRangeChange={setRange}
            summary={returnSummary}
          />
        ) : (
          <EmptySection
            title="Equity curve"
            reason="Strategy has not produced closed trades yet. The curve, drawdowns and summary will populate after the first exit."
          />
        )}
      </section>

      {/* § 03 Positions */}
      <section className="flex flex-col gap-6">
        <SectionRule tag="§ 03 · Positions" />
        <PositionsSection
          positions={positions}
          strategyLabel={meta.shortName}
        />
      </section>

      {/* § 04 References */}
      {academicSources.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionRule tag="§ 04 · References" />
          <ul className="flex flex-col gap-2">
            {academicSources.map((src, i) => (
              <li
                key={i}
                className="font-display italic text-[13px] leading-relaxed text-fg-muted"
              >
                {src}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* § 05 Known limitations */}
      {knownLimitations.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionRule tag="§ 05 · Known limitations" />
          <LimitationsSection items={knownLimitations} />
        </section>
      ) : null}

      {/* When-to-use epilogue (optional, renders in italic serif) */}
      {content?.whenToUse ? (
        <section className="flex flex-col gap-3 border-t border-border-hair pt-6">
          <Display size="md" as="h2">
            When to deploy
          </Display>
          <p className="max-w-[640px] font-display italic text-[15px] leading-relaxed text-fg">
            {content.whenToUse}
          </p>
        </section>
      ) : null}

      {/* Retry — shown only when perf didn't load. Gives the user a way
          to refetch without refreshing the whole page.
          2026-04-21 polish: bumped button text from 11px to 12px and
          raised min-height to `h-9` (36px) to meet the desktop hit-target
          floor. Added a focus-visible ring so the button is keyboard-
          reachable with a legible outline. */}
      {!perf ? (
        <div className="flex flex-col items-center gap-3 border-t border-border-hair pt-6">
          <span className="font-display italic text-[15px] text-fg-muted">
            Performance data unavailable.
          </span>
          <button
            type="button"
            onClick={fetchData}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-bg-elev-1 px-4 font-sans text-[12px] font-semibold text-fg transition-colors hover:bg-bg-elev-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            )}
            style={{ letterSpacing: 0 }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Persona 67-10 — visually-subdued past-performance footer. The
          disclosure banner above covers strategy-specific caveats; this
          footer is the blanket "backtests are backtests" disclaimer
          that applies to every strategy page regardless of stage. Uses
          ``text-fg-hint`` so it does not compete with the editorial
          sections above. */}
      {/* 2026-04-21 polish: disclaimer was 11.5px — below the fs-hint floor.
          Bumped to 13px so the legal copy is readable without straining;
          `text-fg-hint` keeps it visually subordinate to the editorial
          sections. */}
      <footer className="border-t border-border-hair pt-6">
        <p className="font-sans text-[13px] leading-relaxed text-fg-hint">
          Past performance does not guarantee future results. Backtest
          metrics are derived from historical data; live results may
          differ materially. See the{" "}
          <Link
            href="/risk"
            className="underline underline-offset-2 hover:text-fg-muted"
          >
            Risk Disclosure
          </Link>{" "}
          at /risk.
        </p>
      </footer>
      {destructive.pending && (
        <DestructiveConfirmModal
          open={true}
          onOpenChange={(open) => !open && destructive.dismiss()}
          loading={destructive.loading}
          title={destructive.pending.title}
          description={destructive.pending.description}
          consequences={destructive.pending.consequences}
          confirmLabel={destructive.pending.confirmLabel}
          onConfirm={destructive.fire}
        />
      )}
    </div>
  );
}
