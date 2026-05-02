"use client";

import {
  Brain,
  ChartLineUp,
  Checks,
  Gauge,
  ShieldCheck,
} from "@phosphor-icons/react";

const marketCards = [
  { ticker: "NVDA", label: "AI semis", value: "+2.4%" },
  { ticker: "SPY", label: "Index hedge", value: "-0.3%" },
  { ticker: "TSLA", label: "Vol event", value: "+1.1%" },
  { ticker: "MSFT", label: "Quality trend", value: "+0.8%" },
];

const reviewSteps = [
  "Thesis is specific",
  "Risk window mapped",
  "Paper route ready",
];

interface AuthLuxuryPreviewProps {
  className?: string;
}

export default function AuthLuxuryPreview({ className = "" }: AuthLuxuryPreviewProps) {
  return (
    <div className={`relative min-h-[510px] overflow-hidden rounded-[8px] border border-[#d7e4d9] bg-[#10281f] p-3 shadow-[0_34px_90px_-58px_rgba(18,40,31,0.72)] sm:min-h-[560px] sm:p-4 ${className}`}>
      <style>{`
        @keyframes auth-scene-rise {
          from { opacity: 0; transform: translate3d(0, 14px, 0) scale(0.985); }
          to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        }
        @keyframes auth-scene-float {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(0, -10px, 0); }
        }
        @keyframes auth-scene-trace {
          0% { stroke-dashoffset: 620; opacity: 0.3; }
          45%, 100% { opacity: 1; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes auth-scene-flow {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes auth-scene-sheen {
          0% { transform: translateX(-120%) skewX(-12deg); opacity: 0; }
          22%, 78% { opacity: 0.42; }
          100% { transform: translateX(120%) skewX(-12deg); opacity: 0; }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(117,217,175,0.22),transparent_32%),linear-gradient(35deg,transparent_28%,rgba(247,251,244,0.1)_52%,transparent_74%)]" />
        <div className="absolute inset-0 opacity-[0.22] [background-image:linear-gradient(rgba(247,251,244,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(247,251,244,0.1)_1px,transparent_1px)] [background-size:44px_44px]" />
        <svg className="absolute left-0 top-5 h-[220px] w-full opacity-70" viewBox="0 0 900 260" fill="none" aria-hidden>
          <path
            d="M-40 190 C112 72 226 220 355 104 C506 -31 650 162 940 46"
            stroke="rgba(117,217,175,0.35)"
            strokeWidth="38"
            strokeLinecap="round"
          />
          <path
            d="M-20 206 C140 92 250 226 374 112 C514 -16 654 170 934 58"
            stroke="rgba(247,251,244,0.18)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="620"
            strokeDashoffset="620"
            style={{ animation: "auth-scene-trace 5.8s cubic-bezier(0.22, 1, 0.36, 1) infinite alternate" }}
          />
        </svg>
      </div>

      <div className="relative grid h-full gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
        <section className="relative flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-white/10 bg-[#f7fbf4] p-3 text-[#12281f] shadow-[0_24px_70px_-42px_rgba(0,0,0,0.68)] sm:p-4">
          <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent [animation:auth-scene-sheen_8.5s_cubic-bezier(0.22,1,0.36,1)_infinite]" aria-hidden />

          <div className="relative flex items-center justify-between gap-4 border-b border-[#d7e4d9] pb-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[#10281f] text-[#f8f7ef]">
                <ChartLineUp className="size-5" aria-hidden weight="regular" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-sans text-[13px] font-semibold tracking-tight">AlphaDesk workspace</p>
                <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[#819188]">
                  Idea to order
                </p>
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-[8px] bg-[#e8f5ea] px-2.5 py-2 text-[12px] font-medium text-[#0f7a5d] sm:flex">
              <span className="size-1.5 rounded-full bg-[#0f7a5d]" />
              Live review
            </div>
          </div>

          <div className="relative mt-4 grid flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_170px]">
            <div className="flex min-h-0 flex-col rounded-[8px] border border-[#d7e4d9] bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-sans text-[13px] font-semibold">Market idea canvas</p>
                  <p className="mt-1 max-w-[34ch] font-sans text-[12px] leading-[1.5] text-[#5d7268]">
                    Ask, test, adjust size, and keep the decision record in one flow.
                  </p>
                </div>
                <span className="rounded-[8px] bg-[#ecf4ed] px-2 py-1 font-mono text-[10px] text-[#0f7a5d]">
                  AAPL
                </span>
              </div>

              <svg className="mt-5 min-h-[154px] w-full flex-1 overflow-visible" viewBox="0 0 560 190" preserveAspectRatio="none" role="img" aria-label="Animated AlphaDesk chart and control path">
                <defs>
                  <linearGradient id="authSceneArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#0f7a5d" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#0f7a5d" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[32, 72, 112, 152].map((y) => (
                  <line key={y} x1="0" x2="560" y1={y} y2={y} stroke="rgba(18,40,31,0.08)" strokeWidth="1" />
                ))}
                <path
                  d="M0 150 C54 128 78 102 126 112 C180 124 185 63 239 72 C292 82 314 50 360 54 C420 60 424 23 474 34 C515 43 531 31 560 25 L560 190 L0 190 Z"
                  fill="url(#authSceneArea)"
                />
                <path
                  d="M0 150 C54 128 78 102 126 112 C180 124 185 63 239 72 C292 82 314 50 360 54 C420 60 424 23 474 34 C515 43 531 31 560 25"
                  fill="none"
                  stroke="#0f7a5d"
                  strokeLinecap="round"
                  strokeWidth="4"
                  style={{
                    strokeDasharray: 620,
                    strokeDashoffset: 620,
                    animation: "auth-scene-trace 6.2s cubic-bezier(0.22, 1, 0.36, 1) infinite alternate",
                  }}
                />
                <circle cx="474" cy="34" r="6" fill="#f7fbf4" stroke="#0f7a5d" strokeWidth="3" className="[animation:auth-scene-float_3.4s_ease-in-out_infinite]" />
              </svg>
            </div>

            <div className="grid min-h-0 gap-3">
              <div className="rounded-[8px] border border-[#d7e4d9] bg-[#10281f] p-3 text-[#f8f7ef]">
                <div className="flex items-center gap-2">
                  <Brain className="size-4 text-[#75d9af]" aria-hidden weight="regular" />
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#75d9af]">
                    AI challenge
                  </p>
                </div>
                <p className="mt-3 font-sans text-[13px] leading-[1.45] text-[#e9f2ea]">
                  “Your event window is thin. Cut size or wait for confirmation.”
                </p>
              </div>

              <div className="rounded-[8px] border border-[#d7e4d9] bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-sans text-[13px] font-semibold">Risk route</p>
                  <Gauge className="size-4 text-[#0f7a5d]" aria-hidden weight="regular" />
                </div>
                <div className="mt-3 space-y-2">
                  {reviewSteps.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2 rounded-[8px] bg-[#ecf4ed] px-2.5 py-2"
                    >
                      <Checks className="size-4 text-[#0f7a5d]" aria-hidden weight="regular" />
                      <span className="font-sans text-[12px] text-[#40574c]">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-[8px] border border-[#d7e4d9] bg-[#f7fbf4] p-2">
            <div className="grid gap-2 sm:grid-cols-4">
              {marketCards.map((item) => (
                <div
                  key={item.ticker}
                  className="rounded-[8px] border border-[#d7e4d9] bg-white px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[12px] font-semibold text-[#12281f]">{item.ticker}</span>
                    <span className="font-mono text-[12px] text-[#0f7a5d]">{item.value}</span>
                  </div>
                  <p className="mt-1 truncate font-sans text-[12px] text-[#5d7268]">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="grid min-h-0 gap-3 sm:grid-rows-[1fr_auto]">
          <div className="flex min-h-0 flex-col rounded-[8px] border border-white/12 bg-white/[0.12] p-3 text-[#f8f7ef] backdrop-blur-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#75d9af]">Today’s loop</p>
            <div className="mt-3 grid flex-1 content-start gap-2">
              {[
                ["Research", "Thesis saved"],
                ["Backtest", "Replay queued"],
                ["AI", "Review active"],
                ["Order", "Paper first"],
              ].map(([label, detail]) => (
                <div
                  key={label}
                  className="rounded-[8px] border border-white/10 bg-white/[0.08] p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-sans text-[13px] font-semibold">{label}</span>
                    <span className="size-2 rounded-full bg-[#75d9af] [animation:auth-scene-float_2.8s_ease-in-out_infinite]" />
                  </div>
                  <p className="mt-1 font-sans text-[12px] text-[#c7d6ce]">{detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-[8px] border border-white/10 bg-[#0b2119]/60 p-3">
              <p className="font-sans text-[12px] font-semibold text-white">Decision trail</p>
              <p className="mt-1 font-sans text-[12px] leading-[1.45] text-[#c7d6ce]">
                Every edit, review, and route keeps the context attached.
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[8px] border border-white/12 bg-[#f7fbf4] p-3 text-[#12281f]">
            <ShieldCheck className="size-5 text-[#0f7a5d]" aria-hidden weight="regular" />
            <p className="mt-3 font-sans text-[14px] font-semibold">Controls before speed.</p>
            <p className="mt-2 font-sans text-[12px] leading-[1.5] text-[#5d7268]">
              Paper mode, review history, and notes stay visible before any live workflow.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
