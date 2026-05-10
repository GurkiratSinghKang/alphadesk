"use client";

import * as React from "react";
import Link from "next/link";

import Section from "@/components/composites/Section";
import AgentChip, { type AgentArchetype } from "@/components/primitives/AgentChip";
import StatusBanner from "@/components/composites/StatusBanner";
import { cn } from "@/lib/utils";

/**
 * Phase 1.11 — post-approval onboarding flow per v2-plan §1.11.
 *
 * 6-step wizard: Welcome → Connect broker → Pick strategies → Set
 * risk limits → AI access → Ready. Steps live in a sticky 380px
 * left rail; main column shows the active step.
 *
 * Phase 0 ships the UI shell with local state; backend B.11
 * (POST /me/onboarding/answer + RecommendationEngine) wires the
 * persistence + tailored picks in the Phase 1.11 follow-up.
 */
type StepId = "welcome" | "broker" | "strategies" | "risk" | "ai" | "ready";

interface Step {
  id: StepId;
  ordinal: string;
  title: string;
  caption: string;
}

const STEPS: Step[] = [
  { id: "welcome",    ordinal: "01", title: "Welcome",          caption: "What AlphaDesk does for you" },
  { id: "broker",     ordinal: "02", title: "Connect broker",   caption: "Paper-only by default" },
  { id: "strategies", ordinal: "03", title: "Pick strategies",  caption: "Multi-select cards" },
  { id: "risk",       ordinal: "04", title: "Set risk limits",  caption: "Capital + daily-budget" },
  { id: "ai",         ordinal: "05", title: "AI access",        caption: "BYO AI provider key (optional)" },
  { id: "ready",      ordinal: "06", title: "Ready",            caption: "What happens at next open" },
];

const STRATEGIES: { id: string; name: string; archetype: AgentArchetype; desc: string }[] = [
  { id: "momentum-quality",      name: "Momentum + Quality",     archetype: "research", desc: "Trend-follow on quality screened by ROIC + low debt." },
  { id: "pead",                  name: "Post-earnings drift",    archetype: "signal",   desc: "Long names with positive earnings surprise + sustained drift." },
  { id: "earnings-options-play", name: "Earnings options play",  archetype: "exec",     desc: "Defined-risk options structures around earnings prints." },
  { id: "mean-reversion",        name: "Mean reversion",         archetype: "signal",   desc: "Counter-trend reversion on RSI(2) extremes." },
];

export default function OnboardingClient() {
  const [activeStep, setActiveStep] = React.useState<StepId>("welcome");
  const [completed, setCompleted] = React.useState<Set<StepId>>(new Set());
  const [pickedStrategies, setPickedStrategies] = React.useState<Set<string>>(new Set(["momentum-quality"]));
  const [capitalBand, setCapitalBand] = React.useState<string>("100k-500k");
  const [riskTier, setRiskTier] = React.useState<"low" | "med" | "high">("med");

  const stepIndex = STEPS.findIndex((s) => s.id === activeStep);
  const next = () => {
    setCompleted((c) => new Set([...c, activeStep]));
    if (stepIndex < STEPS.length - 1) setActiveStep(STEPS[stepIndex + 1].id);
  };
  const back = () => {
    if (stepIndex > 0) setActiveStep(STEPS[stepIndex - 1].id);
  };

  return (
    <main className="min-h-dvh bg-bg flex">
      <aside className="hidden lg:flex w-[380px] shrink-0 flex-col gap-4 border-r border-border-hair bg-bg-elev-1 p-6">
        <div className="flex items-baseline gap-2">
          <span className="font-display italic text-h2 text-brand">α</span>
          <span className="font-display italic text-h2 text-fg">AlphaDesk</span>
        </div>
        {/* v2 phase 1.x — left-rail editorial header matching
         * onboarding-dark.png. Eyebrow + italic-Newsreader title +
         * two-line body, replacing the prior generic intro. */}
        <p
          className="t-eyebrow-italic"
          style={{ color: "var(--brand)", letterSpacing: "0.2em", margin: 0 }}
        >
          WELCOME · OPERATOR
        </p>
        <h2
          className="m-0 italic"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--ink-1000)",
            fontSize: 30,
            fontWeight: 400,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
            textWrap: "balance",
          }}
        >
          Six small steps before your first market open.
        </h2>
        <p className="font-display italic text-body text-fg-dim leading-relaxed">
          You can change every choice here later in Settings or Control
          Center. Nothing here puts capital at risk — live trading needs
          a separate approval after broker linkage.
        </p>
        <ol className="mt-4 flex flex-col gap-1.5">
          {STEPS.map((s) => {
            const isActive = s.id === activeStep;
            const isDone = completed.has(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setActiveStep(s.id)}
                  className={cn(
                    "w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
                    isActive
                      ? "bg-bg-elev-2 border border-brand/40"
                      : "border border-transparent hover:bg-bg-elev-2",
                  )}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border text-eyebrow font-semibold",
                      isDone
                        ? "bg-profit text-up-on border-profit"
                        : isActive
                        ? "bg-brand text-brand-on border-brand"
                        : "bg-bg-elev-2 text-fg-muted border-border-hair",
                    )}
                  >
                    {isDone ? "✓" : s.ordinal}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-body text-fg font-medium leading-snug">{s.title}</h3>
                    <p className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">{s.caption}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
        <Link
          href="/"
          className="mt-auto text-eyebrow uppercase tracking-[0.08em] text-fg-muted hover:text-fg underline-offset-2 hover:underline"
        >
          Skip for now →
        </Link>
      </aside>

      <div className="flex-1 px-6 py-12 max-w-3xl mx-auto space-y-6 w-full">
        <Section
          eyebrow={`ONBOARDING · ${STEPS[stepIndex].ordinal}`}
          title={STEPS[stepIndex].title}
          description={STEPS[stepIndex].caption}
          level={1}
        >
          {activeStep === "welcome" && (
            <div className="space-y-5">
              {/* v2 phase 1.x — design-mined italic-Newsreader hook +
               * 2×2 day-rhythm quadrant cards (MORNING / INTRADAY /
               * RISK / EVENING) matching onboarding-dark.png. */}
              <h3
                className="m-0 italic"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--ink-1000)",
                  fontSize: 28,
                  fontWeight: 400,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.15,
                  textWrap: "balance",
                }}
              >
                A trading desk that reads, decides, and trades alongside
                you.
              </h3>
              <p className="font-display italic text-body text-fg-dim leading-relaxed">
                AlphaDesk is a tightly-scoped trading environment for
                serious operators. Six AI agents — Scout, Strategist,
                Analyst, Risk, Execution, Memo — pre-process the open,
                surface candidates, and execute the rules you set. You
                stay in command of every order.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    eyebrow: "MORNING",
                    title: "Briefed before the bell",
                    body: "06:30 ET pre-market memo: overnight news, gap movers, your watchlists, and which strategies the agents think are live today.",
                  },
                  {
                    eyebrow: "INTRADAY",
                    title: "Pipeline of candidates",
                    body: "Scout filters the universe down to a working pipeline. You approve, defer, or veto — the desk doesn't move money without your say-so.",
                  },
                  {
                    eyebrow: "RISK",
                    title: "Pre-trade and live limits",
                    body: "Per-trade max loss, per-day stop-out, per-strategy book size, and a live drawdown circuit-breaker. All editable, all auditable.",
                  },
                  {
                    eyebrow: "EVENING",
                    title: "Memo every fill",
                    body: "Every trade gets a structured memo: thesis, fill quality, deviation from rules, and what to read tonight. Post-mortem in the morning.",
                  },
                ].map((q) => (
                  <article
                    key={q.eyebrow}
                    className="rounded-md border border-border-hair p-4"
                    style={{ background: "var(--bg-elev-1)" }}
                  >
                    <p
                      className="t-eyebrow-italic"
                      style={{
                        color: "var(--brand)",
                        letterSpacing: "0.18em",
                        margin: 0,
                      }}
                    >
                      {q.eyebrow}
                    </p>
                    <h4
                      className="mt-1.5 italic"
                      style={{
                        fontFamily: "var(--font-display)",
                        color: "var(--ink-1000)",
                        fontSize: 18,
                        fontWeight: 400,
                        margin: 0,
                        lineHeight: 1.2,
                      }}
                    >
                      {q.title}
                    </h4>
                    <p className="mt-2 font-display italic text-body-sm text-fg-dim leading-snug">
                      {q.body}
                    </p>
                  </article>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <AgentChip archetype="research" hideStatus size="lg" />
                <AgentChip archetype="signal"   hideStatus size="lg" />
                <AgentChip archetype="risk"     hideStatus size="lg" />
                <AgentChip archetype="exec"     hideStatus size="lg" />
              </div>
            </div>
          )}

          {activeStep === "broker" && (
            <div className="space-y-3">
              <p className="text-body text-fg-dim leading-relaxed">
                Start in paper. You can connect a live broker later from
                Settings → Trading. Live trading is admin-gated for v2.
              </p>
              <div className="rounded-md border border-border-hair bg-bg-elev-1 p-4 flex items-center justify-between">
                <div>
                  <p className="text-body text-fg font-medium">Alpaca (recommended)</p>
                  <p className="text-body-sm text-fg-muted">Paper account auto-created. Live requires admin approval.</p>
                </div>
                <button
                  type="button"
                  className="rounded-sm border border-brand/60 bg-brand text-brand-on px-3 py-2 text-body-sm font-semibold uppercase tracking-[0.08em] hover:bg-brand-dim transition-colors"
                  onClick={next}
                >
                  Connect (paper)
                </button>
              </div>
            </div>
          )}

          {activeStep === "strategies" && (
            <div className="space-y-3">
              <p className="text-body text-fg-dim">Pick the strategies you want enabled. Toggle anytime in Settings.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {STRATEGIES.map((s) => {
                  const picked = pickedStrategies.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setPickedStrategies((p) => {
                          const next = new Set(p);
                          if (next.has(s.id)) next.delete(s.id);
                          else next.add(s.id);
                          return next;
                        });
                      }}
                      className={cn(
                        "rounded-md border p-3 text-left flex flex-col gap-1.5 transition-colors",
                        picked
                          ? "border-brand/60 bg-tint-brand-1"
                          : "border-border-hair bg-bg-elev-1 hover:border-brand/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-body text-fg font-medium">{s.name}</h3>
                        <AgentChip archetype={s.archetype} hideStatus size="sm" />
                      </div>
                      <p className="text-body-sm text-fg-muted leading-snug">{s.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activeStep === "risk" && (
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="t-label">Capital band</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["<25k", "25k-100k", "100k-500k", "500k-2M", ">2M"] as const).map((band) => (
                    <button
                      key={band}
                      type="button"
                      aria-pressed={capitalBand === band}
                      onClick={() => setCapitalBand(band)}
                      className={cn(
                        "px-3 py-1.5 rounded-pill text-eyebrow font-semibold uppercase tracking-[0.08em] transition-colors",
                        capitalBand === band
                          ? "bg-brand text-brand-on"
                          : "bg-bg-elev-1 text-fg-muted hover:text-fg",
                      )}
                    >
                      {band}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="t-label">Risk tolerance</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["low", "med", "high"] as const).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      aria-pressed={riskTier === tier}
                      onClick={() => setRiskTier(tier)}
                      className={cn(
                        "px-3 py-1.5 rounded-pill text-eyebrow font-semibold uppercase tracking-[0.08em] transition-colors",
                        riskTier === tier
                          ? tier === "high"
                            ? "bg-loss text-down-on"
                            : tier === "med"
                            ? "bg-state-warning text-state-warning-fg"
                            : "bg-profit text-up-on"
                          : "bg-bg-elev-1 text-fg-muted hover:text-fg",
                      )}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {activeStep === "ai" && (
            <div className="space-y-4">
              <p className="text-body text-fg-dim leading-relaxed">
                AlphaDesk uses AI services for agent intelligence.
                You can either use the operator&apos;s pooled key (default,
                spend-capped per tier) OR bring your own.
              </p>
              <div className="rounded-md border border-border-hair bg-bg-elev-1 p-3 space-y-2">
                <p className="t-label">Bring your own key (optional)</p>
                <input
                  type="text"
                  placeholder="provider-key-…"
                  className="w-full rounded-sm border border-border bg-bg-elev-2 px-3 py-2 text-body font-mono text-fg-muted placeholder:text-fg-hint"
                />
                <p className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
                  Encrypted at rest. UI never echoes after submit.
                </p>
              </div>
            </div>
          )}

          {activeStep === "ready" && (
            <div className="space-y-4">
              <StatusBanner
                tone="info"
                message="Setup complete. Your dashboard renders with these picks at the next open."
              />
              <div className="rounded-md border border-border-hair bg-bg-elev-1 p-4 space-y-2">
                <p className="t-label">Your tailored picks</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-body-sm">
                  <dt className="text-fg-muted">Capital band</dt>
                  <dd className="text-fg t-mono">{capitalBand}</dd>
                  <dt className="text-fg-muted">Risk tolerance</dt>
                  <dd className="text-fg">{riskTier}</dd>
                  <dt className="text-fg-muted">Strategies</dt>
                  <dd className="text-fg">{Array.from(pickedStrategies).join(", ") || "—"}</dd>
                </dl>
              </div>
              <Link
                href="/"
                className="inline-flex w-full justify-center rounded-sm bg-brand text-brand-on px-4 py-2.5 text-body font-semibold uppercase tracking-[0.08em] hover:bg-brand-dim transition-colors"
              >
                Open dashboard →
              </Link>
            </div>
          )}
        </Section>

        <footer className="flex items-center justify-between pt-4 border-t border-border-hair">
          <button
            type="button"
            onClick={back}
            disabled={stepIndex === 0}
            className="text-eyebrow uppercase tracking-[0.08em] font-semibold text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Back
          </button>
          <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
            Step {stepIndex + 1} of {STEPS.length}
          </span>
          {activeStep !== "ready" ? (
            <button
              type="button"
              onClick={next}
              className="rounded-sm border border-brand/60 bg-brand text-brand-on px-3 py-1.5 text-eyebrow font-semibold uppercase tracking-[0.08em] hover:bg-brand-dim transition-colors"
            >
              Next →
            </button>
          ) : (
            <span className="text-eyebrow uppercase tracking-[0.08em] text-profit font-semibold">
              ✓ Done
            </span>
          )}
        </footer>
      </div>
    </main>
  );
}
