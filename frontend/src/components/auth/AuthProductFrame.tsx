import Link from "next/link";
import type { ReactNode } from "react";

import AuthFrameIcon from "./AuthFrameIcon";
import AuthLuxuryPreview from "./AuthLuxuryPreview";

interface ProofPoint {
  label: string;
  value: string;
  detail: string;
}

interface AuthProductFrameProps {
  eyebrow: string;
  title: ReactNode;
  lead: string;
  activeLink: "login" | "request";
  proofPoints: ProofPoint[];
  panelTitle: string;
  panelSubtitle: string;
  children: ReactNode;
}

const journey = [
  {
    label: "Research",
    title: "Collect the why",
    detail: "Signals, notes, market context, and strategy behavior sit together before the trade gets emotional.",
    icon: "chart",
  },
  {
    label: "Challenge",
    title: "Ask for the hard case",
    detail: "AlphaDesk argues the other side, calls out assumptions, and turns loose thoughts into a reviewed plan.",
    icon: "brain",
  },
  {
    label: "Control",
    title: "Move only when ready",
    detail: "Paper-first routing, review checkpoints, and operator notes keep execution deliberate.",
    icon: "shield",
  },
  {
    label: "Remember",
    title: "Keep the record",
    detail: "Every decision keeps a timestamp, rationale, and audit trail so the next trade starts smarter.",
    icon: "checks",
  },
] as const;

const proofRail = [
  "Research ideas",
  "Backtest before conviction",
  "AI challenge",
  "Paper-first controls",
  "Execution notes",
  "Audit trail",
];

const credibilityNotes = [
  {
    value: "12",
    label: "strategy workspaces",
  },
  {
    value: "1.43",
    label: "example OOS Sharpe, caveated",
  },
  {
    value: "paper first",
    label: "default operating mode",
  },
];

export default function AuthProductFrame({
  eyebrow,
  title,
  lead,
  activeLink,
  proofPoints,
  panelTitle,
  panelSubtitle,
  children,
}: AuthProductFrameProps) {
  const primaryCta = activeLink === "login"
    ? { href: "/request-access", label: "Request access" }
    : { href: "#auth-panel", label: "Start request" };
  const secondaryCta = activeLink === "login"
    ? { href: "#auth-panel", label: "Sign in" }
    : { href: "/login", label: "Sign in" };

  return (
    <main id="main" className="alpha-auth-shell min-h-[100dvh] overflow-x-clip text-[var(--auth-fg)]">
      <a
        className="sr-only focus:not-sr-only fixed top-2 left-2 z-50 px-3 py-2 bg-primary text-primary-foreground"
        href="#main"
      >
        Skip to content
      </a>
      <style>{`
        @keyframes auth-page-band {
          0%, 100% { transform: translate3d(-2%, 0, 0) rotate(-1deg); opacity: 0.7; }
          50% { transform: translate3d(2%, -1.5%, 0) rotate(1deg); opacity: 1; }
        }
        @keyframes auth-page-enter {
          from { opacity: 0; transform: translate3d(0, 14px, 0); }
          to { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .auth-motion, .auth-motion * {
            animation-duration: 1ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 1ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>

      <div className="relative mx-auto flex min-h-[100dvh] max-w-[1500px] flex-col px-4 py-4 sm:px-6 sm:py-5 lg:px-8 xl:px-10">
        <header className="relative z-[1] mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/login"
            className="group inline-flex min-w-0 items-center gap-3 rounded-[8px] text-[var(--auth-fg)] outline-none transition-transform active:scale-[0.98]"
            aria-label="AlphaDesk sign in"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-[8px] bg-[var(--auth-fg)] font-mono text-body-sm font-semibold text-[var(--auth-bg)] shadow-[0_14px_34px_-20px_rgba(18,40,31,0.85)]">
              AD
            </span>
            <span className="min-w-0">
              <span className="block truncate font-sans text-body font-semibold tracking-tight">AlphaDesk</span>
              <span className="hidden truncate font-mono text-eyebrow uppercase tracking-[0.16em] text-[var(--auth-fg-muted)] sm:block">
                AI trading terminal
              </span>
            </span>
          </Link>

          <nav className="flex shrink-0 items-center rounded-[8px] border border-[var(--auth-border)] bg-white/75 p-1 text-body-sm shadow-[0_18px_48px_-38px_rgba(18,40,31,0.45)] backdrop-blur-xl">
            <Link
              href="/login"
              className={
                "inline-flex min-h-11 items-center rounded-[6px] px-3 py-2 font-sans transition-colors active:scale-[0.98] " +
                (activeLink === "login"
                  ? "bg-[var(--auth-fg)] text-[var(--auth-bg)]"
                  : "text-[var(--auth-fg-muted)] hover:bg-[var(--auth-bg-hover)] hover:text-[var(--auth-fg)]")
              }
            >
              Sign in
            </Link>
            <Link
              href="/request-access"
              className={
                "inline-flex min-h-11 items-center rounded-[6px] px-3 py-2 font-sans transition-colors active:scale-[0.98] " +
                (activeLink === "request"
                  ? "bg-[var(--auth-fg)] text-[var(--auth-bg)]"
                  : "text-[var(--auth-fg-muted)] hover:bg-[var(--auth-bg-hover)] hover:text-[var(--auth-fg)]")
              }
            >
              Request access
            </Link>
          </nav>
        </header>

        <section className="auth-motion relative overflow-hidden rounded-[8px] border border-white/80 bg-[var(--auth-bg)]/[0.84] shadow-[0_30px_90px_-52px_rgba(18,40,31,0.42)] backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-[-20%] top-[-18%] h-[420px] bg-[linear-gradient(112deg,rgba(24,143,105,0.18),rgba(212,235,220,0.24)_38%,rgba(248,247,239,0)_70%)] blur-2xl [animation:auth-page-band_13s_cubic-bezier(0.22,1,0.36,1)_infinite]" />
            <div className="absolute inset-x-[-18%] bottom-[-24%] h-[360px] bg-[linear-gradient(28deg,rgba(18,40,31,0.12),rgba(24,143,105,0.12)_46%,rgba(248,247,239,0)_76%)] blur-2xl [animation:auth-page-band_16s_cubic-bezier(0.22,1,0.36,1)_infinite_reverse]" />
            <div className="absolute inset-0 opacity-[0.42] [background-image:linear-gradient(rgba(18,40,31,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(18,40,31,0.045)_1px,transparent_1px)] [background-size:56px_56px]" />
          </div>

          <div className="relative grid gap-7 p-4 sm:p-6 lg:p-8 xl:grid-cols-[minmax(0,1fr)_minmax(360px,430px)] xl:items-stretch xl:gap-8">
            <section className="order-1 flex min-w-0 flex-col gap-5 xl:col-start-1 xl:row-start-1 xl:h-full">
              <div className="max-w-[760px] pt-2 sm:pt-5">
                <p className="font-mono text-eyebrow font-semibold uppercase tracking-[0.22em] text-[var(--auth-primary)]">
                  {eyebrow}
                </p>
                {/* design-intentional: leading-[0.95] on marketing hero — extreme tight leading for visual impact at large display size */}
                <h1 className="mt-5 max-w-[12ch] font-sans text-4xl font-semibold leading-[0.95] tracking-tight text-[var(--auth-fg)] sm:text-5xl lg:text-6xl">
                  {title}
                </h1>
                <p className="mt-5 max-w-[650px] font-sans text-numeric-md leading-loose text-[var(--auth-fg-dim)]">
                  {lead}
                </p>

                <div className="mt-7 flex flex-wrap gap-3">
                  <Link
                    href={primaryCta.href}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[8px] bg-primary px-5 font-sans text-body-sm font-semibold text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(0,0,0,0.08)] transition-colors hover:bg-gold-300 active:scale-[0.98]"
                  >
                    {primaryCta.label}
                    <AuthFrameIcon kind="arrow" className="size-4" />
                  </Link>
                  <Link
                    href={secondaryCta.href}
                    className="inline-flex min-h-12 items-center justify-center rounded-[8px] border border-[var(--auth-border)] bg-white/70 px-5 font-sans text-body-sm font-semibold text-[var(--auth-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-colors hover:border-[var(--auth-primary)]/35 hover:bg-white active:scale-[0.98]"
                  >
                    {secondaryCta.label}
                  </Link>
                </div>
              </div>

              <div className="rounded-[8px] border border-[var(--auth-border)] bg-white/55 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.74)]">
                <div className="flex flex-wrap gap-2">
                  {proofRail.map((item) => (
                    <span
                      key={item}
                      className="rounded-[8px] border border-[var(--auth-border)] bg-[var(--auth-bg-soft)] px-3 py-2 font-sans text-label font-medium text-[var(--auth-fg-dim)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="hidden flex-1 xl:flex">
                <AuthLuxuryPreview className="h-full w-full xl:min-h-[640px]" />
              </div>
            </section>

            <aside id="auth-panel" className="order-2 flex min-w-0 flex-col gap-4 scroll-mt-6 xl:col-start-2 xl:row-start-1">
              <div className="rounded-[8px] border border-[var(--auth-border)] bg-white/[0.78] p-4 shadow-[0_28px_70px_-46px_rgba(18,40,31,0.5)] backdrop-blur-xl sm:p-5">
                {children}
              </div>

              <section className="rounded-[8px] border border-[var(--auth-border)] bg-[var(--auth-bg-soft)]/[0.72] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] backdrop-blur-xl">
                <div className="flex items-start justify-between gap-4 border-b border-[var(--auth-border)] pb-3">
                  <div>
                    <p className="font-sans text-body font-semibold tracking-tight text-[var(--auth-fg)]">
                      {panelTitle}
                    </p>
                    <p className="mt-1 font-sans text-label leading-relaxed text-[var(--auth-fg-muted)]">
                      {panelSubtitle}
                    </p>
                  </div>
                  <span className="rounded-[6px] border border-[var(--auth-primary)]/20 bg-white/70 px-2 py-1 font-mono text-eyebrow uppercase tracking-[0.14em] text-[var(--auth-primary)]">
                    Trust
                  </span>
                </div>

                <div className="mt-3 divide-y divide-[var(--auth-border)]">
                  {proofPoints.map((point) => (
                    <div key={point.label} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-sans text-body-sm font-semibold text-[var(--auth-fg)]">{point.label}</span>
                        <span className="font-mono text-label text-[var(--auth-primary)]">{point.value}</span>
                      </div>
                      <p className="font-sans text-label leading-relaxed text-[var(--auth-fg-muted)]">{point.detail}</p>
                    </div>
                  ))}
                </div>
              </section>
            </aside>

            <section className="order-3 min-w-0 xl:hidden">
              <AuthLuxuryPreview />
            </section>
          </div>
        </section>

        {/* P2-29 (mobile fix wave-3): below sm: the auth marketing pane
            previously stacked 4+ screens deep under the form, forcing every
            mobile user to thumb-scroll past brand copy to reach the signup
            link. Wrap the long-form sections with a `<details>` collapsible
            so phones see only a "Learn more about AlphaDesk →" link by
            default; the disclosure summary is hidden at sm+ and the parent
            is force-open via the global `auth-marketing-pane.css` rule below
            so desktop renders identically to before. Mobile users tapping
            the link expand all marketing in place. */}
        <style>{`
          /* sm+ (>= 640px): force the disclosure open and hide the summary so
             desktop visitors keep the original always-visible marketing pane. */
          @media (min-width: 640px) {
            details[data-slot="auth-marketing-pane"] > summary { display: none; }
            details[data-slot="auth-marketing-pane"] > :not(summary) { display: revert; }
          }
        `}</style>
        <details
          data-slot="auth-marketing-pane"
          className="mt-2 [&_summary]:list-none"
        >
          <summary
            className="block cursor-pointer rounded-[8px] border border-[var(--auth-border)] bg-white/70 px-4 py-3 font-sans text-body-sm font-semibold text-[var(--auth-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-colors hover:bg-white sm:hidden"
          >
            <span className="flex items-center justify-between">
              Learn more about AlphaDesk
              <span aria-hidden="true" className="font-mono text-label text-[var(--auth-primary)]">→</span>
            </span>
          </summary>

          <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(260px,0.55fr)_minmax(0,1fr)] lg:items-start">
            <div className="rounded-[8px] border border-[var(--auth-border)] bg-white/60 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
              <p className="font-mono text-eyebrow font-semibold uppercase tracking-[0.18em] text-[var(--auth-primary)]">
                Product rhythm
              </p>
              <h2 className="mt-3 max-w-[14ch] font-sans text-h1 font-semibold leading-none tracking-tight text-[var(--auth-fg)]">
                From hunch to habit, without losing the thread.
              </h2>
              <p className="mt-4 font-sans text-body-sm leading-relaxed text-[var(--auth-fg-dim)]">
                The marketing promise is simple: AlphaDesk gives serious traders a calmer loop for deciding, challenging, routing, and learning.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {journey.map((item, index) => {
                return (
                  <article
                    key={item.label}
                    className="group rounded-[8px] border border-[var(--auth-border)] bg-white/62 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)] transition-transform duration-300 hover:-translate-y-0.5"
                    style={{
                      animation: "auth-page-enter 520ms cubic-bezier(0.22, 1, 0.36, 1) both",
                      animationDelay: `${index * 90}ms`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <span className="grid size-10 place-items-center rounded-[8px] bg-[var(--auth-bg-hover)] text-[var(--auth-primary)]">
                        <AuthFrameIcon kind={item.icon} className="size-5" />
                      </span>
                      <span className="font-mono text-eyebrow text-[var(--auth-fg-soft)]">{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <p className="mt-5 font-mono text-eyebrow font-semibold uppercase tracking-[0.16em] text-[var(--auth-primary)]">
                      {item.label}
                    </p>
                    <h3 className="mt-2 font-sans text-h3 font-semibold tracking-tight text-[var(--auth-fg)]">{item.title}</h3>
                    <p className="mt-2 font-sans text-body-sm leading-relaxed text-[var(--auth-fg-muted)]">{item.detail}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="mt-5 grid gap-4 rounded-[8px] border border-[var(--auth-border)] bg-[var(--auth-fg)] p-5 text-[var(--auth-bg)] shadow-[0_30px_80px_-56px_rgba(18,40,31,0.65)] lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
            <div>
              <p className="font-mono text-eyebrow uppercase tracking-[0.18em] text-[var(--auth-primary-soft)]">
                Evidence, with the caveats in view
              </p>
              <h2 className="mt-3 max-w-[18ch] font-sans text-h1 font-semibold leading-tight tracking-tight">
                The numbers support the story; they do not replace judgment.
              </h2>
              <p className="mt-3 max-w-[66ch] font-sans text-body-sm leading-relaxed text-[var(--auth-border-soft)]">
                Performance examples stay below the fold and remain framed as research artifacts. The first promise is workflow quality: clearer thinking, deliberate controls, and a usable record.
              </p>
            </div>
            <div className="grid gap-2">
              {credibilityNotes.map((item) => (
                <div key={item.label} className="flex items-baseline justify-between gap-4 border-t border-white/12 pt-2 first:border-t-0 first:pt-0">
                  <span className="font-mono text-numeric-lg text-white">{item.value}</span>
                  <span className="text-right font-sans text-label text-[var(--auth-border-soft)]">{item.label}</span>
                </div>
              ))}
            </div>
          </section>
        </details>
      </div>
    </main>
  );
}
