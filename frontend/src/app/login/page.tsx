import type { Metadata } from "next";

import EditorialNameplate from "@/components/composites/EditorialNameplate";
import Display from "@/components/typography/Display";
import SectionRule from "@/components/typography/SectionRule";
import { formatDate } from "@/lib/formatDate";
import LoginForm from "./_login/LoginForm";

export const metadata: Metadata = {
  title: "Sign in — AlphaDesk",
  description:
    "Sign in to AlphaDesk — twelve systematic equity strategies, one execution layer, with Claude as a pre-trade second opinion.",
  // Auth surfaces should never appear in search results. Without this,
  // Google will index the sign-in page, which is both an SEO leak and a
  // footprint expansion.
  robots: { index: false, follow: false },
};

/**
 * /login — editorial auth surface.
 * ───────────────────────────────
 * Round-11 redesign: the page now SHOWS what AlphaDesk is rather than
 * pulling a vague editorial quote. Hero is concrete ("Twelve quantitative
 * edges. One execution layer."), workflow is illustrated as a 4-step
 * pipeline, and the strategies catalogue is surfaced as a visible grid —
 * what-you-see-is-what-you-get. Editorial voice (italic-serif display,
 * tan brand, dark warm-black) preserved.
 *
 * Auth logic is unchanged from the Round-3 reskin; this is a content
 * + composition change only.
 */

interface StrategyPreview {
  key: string;
  name: string;
  short: string;
  regime: string;
  stage: "live" | "research" | "planned";
}

/**
 * Curated subset of ``frontend/src/lib/strategies.ts::STRATEGY_META``.
 * Hardcoded here (not imported) because the login page is unauthenticated
 * and shouldn't reach into the dashboard module graph; six is the right
 * number for a 3-col × 2-row grid (also the Miller's-7±2 floor) and we
 * lead with the names a serious investor recognises. ``stage`` mirrors
 * the catalogue convention — "live" = trading, "research" = screener-
 * only.
 */
const FEATURED_STRATEGIES: StrategyPreview[] = [
  {
    key: "momentum_quality",
    name: "Cross-Sectional Momentum + Quality",
    short: "Momentum + Quality",
    regime: "Thrives in bull trends",
    stage: "live",
  },
  {
    key: "pead",
    name: "Post-Earnings Announcement Drift",
    short: "PEAD",
    regime: "Event-driven, all regimes",
    stage: "live",
  },
  {
    key: "regime_adaptive",
    name: "SMA + VIX Regime Allocation",
    short: "Regime Adaptive",
    regime: "Adjusts to any regime",
    stage: "live",
  },
  {
    key: "pairs_trading",
    name: "Statistical Arbitrage Pairs",
    short: "Pairs Trading",
    regime: "Market-neutral, all regimes",
    stage: "live",
  },
  {
    key: "rsi2_reversal",
    name: "RSI-2 Mean Reversion",
    short: "RSI-2 Reversal",
    regime: "Short-term dip buying, ~75% hit rate",
    stage: "live",
  },
  {
    key: "earnings_options_play",
    name: "Earnings Options Play",
    short: "Earnings Options",
    regime: "Research screener · pick your own trade",
    stage: "research",
  },
];

const WORKFLOW_STEPS: Array<{ idx: string; title: string; body: string }> = [
  {
    idx: "01",
    title: "Pick a strategy",
    body: "Twelve live edges + a research bench. Each one has a regime note, hit-rate, and an OOS backtest curve.",
  },
  {
    idx: "02",
    title: "Backtest + tune",
    body: "Single-source ReproMeta — same git_sha + params + seed = bitwise-identical results. No hidden datasets.",
  },
  {
    idx: "03",
    title: "Pre-trade memo",
    body: "Claude reads the live setup and writes a verdict + confidence + risks before you click. Second opinion, not co-pilot.",
  },
  {
    idx: "04",
    title: "Execute · audit",
    body: "Same risk policy across every strategy. Full ledger, fill-by-fill reconciliation, tax-correct holding periods on day one.",
  },
];

export default function LoginPage() {
  // BUG-012: use the shared ET formatter — `toISOString()` returns UTC,
  // which drifts a day ahead of the desk header after 20:00 ET.
  const todayIso = formatDate(new Date(), "iso");
  return (
    <div className="mx-auto grid min-h-screen max-w-[1440px] grid-cols-1 gap-8 sm:gap-12 lg:gap-16 px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
      <section className="flex flex-col gap-6 sm:gap-8 lg:gap-10">
        <EditorialNameplate
          volume="01"
          issue="01"
          title="Sign in"
          date={todayIso}
        />

        <div className="flex flex-col gap-6">
          <span
            className="font-sans text-[11px] font-semibold uppercase text-brand"
            style={{ letterSpacing: "0.2em" }}
          >
            A systematic trading terminal
          </span>

          <Display
            size="lg"
            as="h1"
            className="max-w-[16ch]"
          >
            Twelve quantitative{" "}
            <span className="not-italic text-fg-dim">edges.</span>{" "}
            One execution{" "}
            <span className="not-italic text-fg-dim">layer.</span>
          </Display>

          <p className="max-w-[560px] font-sans text-[15.5px] leading-[1.55] text-fg-dim">
            AlphaDesk is a single workstation for designing, back-testing, and
            executing systematic equity strategies — with Claude as a pre-trade
            second opinion, not a co-pilot on the wheel. Same risk policy across
            every alpha. Full audit trail. No black boxes, no dark UI for
            dark math.
          </p>
        </div>

        <SectionRule tag="§ 02 · How it works" />

        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {WORKFLOW_STEPS.map((step) => (
            <li
              key={step.idx}
              className="flex flex-col gap-1.5 rounded border border-border-hair bg-bg-elev-1/40 px-4 py-3"
            >
              <div className="flex items-baseline justify-between">
                <span
                  className="font-sans text-[10.5px] font-semibold uppercase text-fg-muted"
                  style={{ letterSpacing: "0.18em" }}
                >
                  Step
                </span>
                <span className="font-mono text-[11px] tabular-nums text-fg-hint">
                  {step.idx}
                </span>
              </div>
              <p className="font-display italic text-[16px] text-fg leading-tight">
                {step.title}
              </p>
              <p className="font-sans text-[13px] leading-[1.5] text-fg-dim">
                {step.body}
              </p>
            </li>
          ))}
        </ol>

        <SectionRule tag="§ 03 · Strategies on the desk" />

        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {FEATURED_STRATEGIES.map((s, i) => (
            <li
              key={s.key}
              className="flex flex-col gap-1 rounded border border-border-hair bg-bg-elev-1/40 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10.5px] tabular-nums text-fg-hint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={
                    "font-sans text-[9.5px] font-semibold uppercase tracking-wider " +
                    (s.stage === "live"
                      ? "text-[color:var(--up-500,var(--profit))]"
                      : "text-fg-muted")
                  }
                >
                  {s.stage === "live" ? "● Live" : "○ Research"}
                </span>
              </div>
              <p className="font-display italic text-[16px] text-fg leading-tight">
                {s.name}
              </p>
              <p className="font-sans text-[12.5px] leading-[1.45] text-fg-dim">
                {s.regime}
              </p>
            </li>
          ))}
        </ul>
        <p className="font-sans text-[12px] text-fg-muted">
          Plus six more on the bench — Time-Series Momentum, Dual Momentum,
          KAMA Breakout, VWAP/ORB intraday, Earnings Vol, and the manual
          discretionary ledger. Toggle any of them from{" "}
          <span className="font-mono">/strategies</span> after sign-in.
        </p>

        <SectionRule tag="§ 04 · Access" />

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <li className="flex flex-col gap-1.5">
            <span
              className="font-sans text-[10.5px] font-semibold uppercase text-fg-muted"
              style={{ letterSpacing: "0.18em" }}
            >
              Invite-only
            </span>
            <p className="font-display italic text-[15px] text-fg">
              Book access is granted by the desk, not by form.
            </p>
          </li>
          <li className="flex flex-col gap-1.5">
            <span
              className="font-sans text-[10.5px] font-semibold uppercase text-fg-muted"
              style={{ letterSpacing: "0.18em" }}
            >
              Paper-first
            </span>
            <p className="font-display italic text-[15px] text-fg">
              Live trading is admin-gated. Every order ships paper by default.
            </p>
          </li>
        </ul>
      </section>

      <section className="flex w-full justify-center lg:sticky lg:top-12 lg:justify-end">
        <div className="w-full max-w-[380px] rounded-md border border-border bg-bg-elev-1 p-5 sm:p-8">
          <div className="mb-6 flex items-baseline justify-between">
            <span
              className="font-sans text-[10.5px] font-semibold uppercase text-fg-muted"
              style={{ letterSpacing: "0.18em" }}
            >
              Desk &middot; live
            </span>
            <span
              className="font-mono text-[10.5px] text-fg-hint"
              style={{ letterSpacing: "0.05em" }}
            >
              tradingalpha.net
            </span>
          </div>
          <LoginForm />
        </div>
      </section>
    </div>
  );
}
