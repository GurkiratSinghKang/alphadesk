"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * AuthShell — full-screen takeover matching the v2 auth design (two-column
 * grid: left brand pane with editorial copy + briefing card, right form pane).
 *
 * Used by /login (default brand-pane copy = sign-in welcome) and
 * /request-access (custom brand-pane copy = apply intake).
 */
export interface AuthShellProps {
  children: ReactNode;
  /**
   * Override the brand-pane content. Defaults to the sign-in welcome
   * (italic "Welcome back to your desk." + morning brief card).
   */
  brand?: {
    eyebrow?: string;
    /**
     * The headline. Use {brand: ReactNode} to mix italic with brand-gold
     * spans. Defaults match the design's auth.jsx welcome.
     */
    title?: ReactNode;
    body?: ReactNode;
    card?: ReactNode;
  };
  /**
   * Right-pane top-right link copy. Defaults to "Apply for access ↗"
   * pointing at /request-access.
   */
  topRight?: { label: string; href: string };
  /**
   * Right-pane footer copy (left side). Default surfaces "AlphaDesk · v2".
   */
  footerLeft?: ReactNode;
  /**
   * Right-pane footer copy (right side). Default surfaces audit hint.
   */
  footerRight?: ReactNode;
}

export function AuthShell({
  children,
  brand,
  topRight = { label: "Apply for access ↗", href: "/request-access" },
  footerLeft,
  footerRight,
}: AuthShellProps) {
  // Override --auth-* tokens scoped to the AuthShell so existing form
  // components (LoginForm, RequestAccessForm) which use `text-[var(--auth-fg)]`,
  // `bg-[var(--auth-bg-tint)]`, etc pick up the dark editorial palette
  // without rewriting hundreds of class names.
  const darkAuthTokens: React.CSSProperties = {
    "--auth-fg": "var(--ink-1000)",
    "--auth-fg-muted": "var(--fg-muted)",
    "--auth-fg-soft": "var(--fg-hint)",
    "--auth-bg": "var(--ink-100)",
    "--auth-bg-hover": "var(--bg-elev-1)",
    "--auth-bg-tint": "var(--brand-tint)",
    "--auth-border": "var(--border)",
    "--auth-border-strong": "var(--border-strong)",
    "--auth-border-soft": "var(--border-hair)",
    "--auth-primary": "var(--brand)",
    "--auth-primary-deep": "var(--brand-dim)",
    "--auth-primary-deeper": "var(--brand-dim)",
    "--auth-primary-soft": "var(--brand-tint)",
  } as React.CSSProperties;

  return (
    <div
      className="fixed inset-0 z-[100] grid grid-cols-1 overflow-auto bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:overflow-hidden"
      style={darkAuthTokens}
    >
      <AuthBrandPane brand={brand} />
      <AuthFormPane topRight={topRight} footerLeft={footerLeft} footerRight={footerRight}>
        {children}
      </AuthFormPane>
    </div>
  );
}

function AuthBrandPane({ brand }: { brand?: AuthShellProps["brand"] }) {
  const today = new Date();
  const longDate = today
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();

  const eyebrow =
    brand?.eyebrow ?? `${longDate} · 09:14 ET`;
  const title =
    brand?.title ?? (
      <>
        Welcome back to <span style={{ color: "var(--brand)" }}>your desk</span>.
      </>
    );
  const body =
    brand?.body ??
    "The morning brief is ready. Three new pipeline candidates surfaced overnight, the Risk agent is green across all books, and your weekly memo is queued.";
  const card = brand?.card ?? <DefaultBriefingCard today={today} />;

  return (
    <aside
      className="flex flex-col overflow-visible border-b border-border lg:overflow-auto lg:border-b-0 lg:border-r"
      style={{ background: "var(--ink-100)", padding: "clamp(24px, 5vw, 32px) clamp(22px, 6vw, 44px) 28px" }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-numeric-md font-semibold italic"
          style={{
            background: "var(--brand)",
            color: "var(--ink-050)",
            fontFamily: "var(--font-display)",
          }}
        >
          α
        </div>
        <div
          className="text-numeric-lg italic"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--ink-1000)",
            letterSpacing: "-0.015em",
          }}
        >
          AlphaDesk
        </div>
      </div>

      <div className="ml-0 flex max-w-[480px] flex-1 flex-col justify-center">
        <div
          className="t-eyebrow-italic"
          style={{ color: "var(--brand)", letterSpacing: "0.2em" }}
        >
          {eyebrow}
        </div>
        <h1
          className="m-0 mt-4 italic"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--ink-1000)",
            fontSize: "clamp(42px, 12vw, 56px)",
            fontWeight: 400,
            letterSpacing: "-0.03em",
            lineHeight: 0.98,
            textWrap: "balance",
          }}
        >
          {title}
        </h1>
        <p
          className="mt-[18px] italic"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            color: "var(--fg-muted)",
            lineHeight: 1.55,
            maxWidth: 460,
            textWrap: "pretty",
          }}
        >
          {body}
        </p>

        {card && <div className="mt-8">{card}</div>}
      </div>

      <div className="mt-6 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <span
          className="t-mono"
          style={{ fontSize: 11, color: "var(--fg-hint)", letterSpacing: "0.06em", lineHeight: 1.4 }}
        >
          TRADING ALPHA · TRADINGALPHA.NET
        </span>
        <span
          className="t-mono"
          style={{ fontSize: 11, color: "var(--fg-hint)", letterSpacing: "0.06em", lineHeight: 1.4 }}
        >
          SYSTEM · OPERATIONAL
        </span>
      </div>
    </aside>
  );
}

function DefaultBriefingCard({ today }: { today: Date }) {
  const shortDate = today
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
  const briefRows = [
    { t: "Scout has surfaced", b: "47 candidates · 3 above 0.85 confidence" },
    { t: "Risk gating is GREEN", b: "Drawdown headroom 4.6% · book size 71% of cap" },
    { t: "Earnings tonight", b: "NVDA · CRM · ZS · 2 in your watchlists" },
    { t: "1 strategy needs review", b: "Pairs · drift outside cointegration band" },
  ];
  return (
    <div
      className="rounded-[3px]"
      style={{
        padding: "16px 18px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderLeft: "2px solid var(--brand)",
      }}
    >
      <div
        className="t-eyebrow-italic"
        style={{ color: "var(--brand)", letterSpacing: "0.18em", fontSize: 10.75, lineHeight: 1.35 }}
      >
        BEFORE THE BELL · {shortDate}
      </div>
      <ul className="m-0 mt-2.5 list-none p-0">
        {briefRows.map((r, i) => (
          <li
            key={r.t}
            className="flex gap-3"
            style={{
              padding: "8px 0",
              borderBottom: i < briefRows.length - 1 ? "1px solid var(--border-hair)" : "none",
            }}
          >
            <span
              className="t-mono"
              style={{ color: "var(--brand)", fontSize: 11, marginTop: 2 }}
            >
              ·
            </span>
            <div className="flex-1">
              <div
                className="italic"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 14,
                  color: "var(--ink-1000)",
                }}
              >
                {r.t}
              </div>
              <div
                style={{
                  marginTop: 1,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--fg-muted)",
                }}
              >
                {r.b}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ApplyBrandCard — alternative brand-pane card for /request-access.
 * Surfaces what an applicant gets after approval rather than the
 * morning brief. Keeps the editorial typography + brand left-border.
 */
export function ApplyBrandCard() {
  const items = [
    { t: "Reviewed access", b: "Sarah reads every application personally · 5 business days" },
    { t: "Paper-first workspace", b: "Your desk lands in paper mode · live routing comes after a check-in" },
    { t: "Operator agreement", b: "Plain-English terms · we explain every clause" },
    { t: "Onboarding cohort", b: "Next cohort: May 22 · 14 of 47 seats reserved" },
  ];
  return (
    <div
      className="rounded-[3px]"
      style={{
        padding: "16px 18px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderLeft: "2px solid var(--brand)",
      }}
    >
      <div
        className="t-eyebrow-italic"
        style={{ color: "var(--brand)", letterSpacing: "0.18em", fontSize: 10.75, lineHeight: 1.35 }}
      >
        AFTER YOU APPLY
      </div>
      <ul className="m-0 mt-2.5 list-none p-0">
        {items.map((r, i) => (
          <li
            key={r.t}
            className="flex gap-3"
            style={{
              padding: "8px 0",
              borderBottom: i < items.length - 1 ? "1px solid var(--border-hair)" : "none",
            }}
          >
            <span
              className="t-mono"
              style={{ color: "var(--brand)", fontSize: 11, marginTop: 2 }}
            >
              ·
            </span>
            <div className="flex-1">
              <div
                className="italic"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 14,
                  color: "var(--ink-1000)",
                }}
              >
                {r.t}
              </div>
              <div
                style={{
                  marginTop: 1,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--fg-muted)",
                }}
              >
                {r.b}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuthFormPane({
  children,
  topRight,
  footerLeft,
  footerRight,
}: {
  children: ReactNode;
  topRight: { label: string; href: string };
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
}) {
  const useDesignFooter = footerLeft === undefined && footerRight === undefined;

  return (
    <div className="flex flex-col overflow-visible lg:overflow-auto" style={{ padding: "clamp(24px, 5vw, 32px) clamp(22px, 7vw, 60px)" }}>
      <header className="flex items-center justify-end gap-3.5">
        <span
          className="t-mono"
          style={{ fontSize: 11, color: "var(--fg-muted)", letterSpacing: "0.05em" }}
        >
          NEW HERE?
        </span>
        <Link
          href={topRight.href}
          className="rounded-[3px] inline-flex items-center"
          style={{
            background: "var(--bg-elev-1)",
            color: "var(--ink-1000)",
            border: "1px solid var(--border-strong)",
            padding: "7px 14px",
            minHeight: 40,
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
          }}
        >
          {topRight.label}
        </Link>
      </header>

      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center">
        {children}
      </div>

      <footer
        className="mt-6 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center"
        style={{ minHeight: 24 }}
      >
        {useDesignFooter ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {["signin", "magic-sent", "twofa", "recovery", "pending", "rejected", "locked"].map((state) => (
                <span
                  key={state}
                  className="t-mono rounded-[2px]"
                  style={{
                    fontSize: 10.5,
                    padding: "4px 8px",
                    lineHeight: 1.25,
                    background: state === "signin" ? "var(--bg-elev-2)" : "transparent",
                    border: state === "signin" ? "1px solid var(--border-strong)" : "1px solid var(--border)",
                    color: state === "signin" ? "var(--ink-1000)" : "var(--fg-muted)",
                    letterSpacing: "0.05em",
                    fontWeight: state === "signin" ? 600 : 400,
                  }}
                >
                  {state}
                </span>
              ))}
            </div>
            <span
              className="t-mono"
              style={{ fontSize: 10.5, color: "var(--fg-hint)", letterSpacing: "0.05em", lineHeight: 1.35 }}
            >
              DEMO · STATE PICKER
            </span>
          </>
        ) : (
          <>
            <span
              className="t-mono"
              style={{ fontSize: 10.5, color: "var(--fg-hint)", letterSpacing: "0.05em", lineHeight: 1.35 }}
            >
              {footerLeft}
            </span>
            <span
              className="t-mono"
              style={{ fontSize: 10.5, color: "var(--fg-hint)", letterSpacing: "0.05em", lineHeight: 1.35 }}
            >
              {footerRight}
            </span>
          </>
        )}
      </footer>
    </div>
  );
}

/**
 * AuthHead — eyebrow + italic display title + optional sub.
 * Used by every state (sign-in, 2FA, recovery, pending, rejected, locked).
 */
export function AuthHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <header style={{ marginBottom: 24 }}>
      <div
        className="t-eyebrow-italic"
        style={{ color: "var(--brand)", letterSpacing: "0.2em" }}
      >
        {eyebrow}
      </div>
      <h2
        className="m-0 mt-2.5 italic"
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--ink-1000)",
          fontSize: 38,
          fontWeight: 400,
          letterSpacing: "-0.025em",
          lineHeight: 1.05,
          textWrap: "balance",
        }}
      >
        {title}
      </h2>
      {sub && (
        <p
          className="italic"
          style={{
            marginTop: 12,
            fontFamily: "var(--font-display)",
            fontSize: 15,
            color: "var(--fg-muted)",
            lineHeight: 1.55,
            textWrap: "pretty",
          }}
        >
          {sub}
        </p>
      )}
    </header>
  );
}
