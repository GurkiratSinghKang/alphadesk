"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * AuthShell — full-screen takeover matching the v2 auth design
 * (two-column grid: left brand pane with morning brief, right form pane).
 *
 * Uses the existing dark-theme design tokens (--ink-100, --brand, --bg-elev-*,
 * --font-display, --font-mono) so the editorial-quiet voice carries through.
 * No layout chrome — this replaces AuthProductFrame for sign-in / 2FA /
 * recovery / pending / rejected / locked states.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  // Override --auth-* tokens scoped to the AuthShell so the existing
  // LoginForm (which uses `text-[var(--auth-fg)]`, `bg-[var(--auth-bg-tint)]`,
  // etc) picks up the dark editorial palette without rewriting 300 lines
  // of class names. The auth tokens were originally tuned for a light
  // marketing-style auth frame; this scope shifts them onto v2 dark.
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
    gridTemplateColumns: "1fr 1.05fr",
  } as React.CSSProperties;

  return (
    <div
      className="fixed inset-0 z-[100] grid overflow-hidden bg-bg"
      style={darkAuthTokens}
    >
      <AuthBrandPane />
      <AuthFormPane>{children}</AuthFormPane>
    </div>
  );
}

function AuthBrandPane() {
  const today = new Date();
  const longDate = today
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
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
    <aside
      className="flex flex-col overflow-auto border-r border-border"
      style={{ background: "var(--ink-100)", padding: "32px 44px 28px" }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[16px] font-semibold italic"
          style={{
            background: "var(--brand)",
            color: "var(--ink-050)",
            fontFamily: "var(--font-display)",
          }}
        >
          α
        </div>
        <div
          className="text-[19px] italic"
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
          {longDate} · 09:14 ET
        </div>
        <h1
          className="m-0 mt-4 italic"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--ink-1000)",
            fontSize: 56,
            fontWeight: 400,
            letterSpacing: "-0.03em",
            lineHeight: 0.98,
            textWrap: "balance",
          }}
        >
          Welcome back to <span style={{ color: "var(--brand)" }}>your desk</span>.
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
          The morning brief is ready. Three new pipeline candidates surfaced overnight, the Risk
          agent is green across all books, and your weekly memo is queued.
        </p>

        <div
          className="mt-8 rounded-[3px]"
          style={{
            padding: "16px 18px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderLeft: "2px solid var(--brand)",
          }}
        >
          <div
            className="t-eyebrow-italic"
            style={{ color: "var(--brand)", letterSpacing: "0.2em", fontSize: 9.5 }}
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
      </div>

      <div className="mt-6 flex items-center justify-between">
        <span
          className="t-mono"
          style={{ fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.06em" }}
        >
          TRADING ALPHA · TRADINGALPHA.NET
        </span>
        <span
          className="t-mono"
          style={{ fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.06em" }}
        >
          SYSTEM · OPERATIONAL
        </span>
      </div>
    </aside>
  );
}

function AuthFormPane({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col overflow-auto" style={{ padding: "32px 60px" }}>
      <header className="flex items-center justify-end gap-3.5">
        <span
          className="t-mono"
          style={{ fontSize: 11, color: "var(--fg-muted)", letterSpacing: "0.05em" }}
        >
          NEW HERE?
        </span>
        <Link
          href="/request-access"
          className="rounded-[3px] inline-flex items-center"
          style={{
            background: "var(--bg-elev-1)",
            color: "var(--ink-1000)",
            border: "1px solid var(--border-strong)",
            padding: "7px 14px",
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
          }}
        >
          Apply for access ↗
        </Link>
      </header>

      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center">
        {children}
      </div>

      <footer
        className="mt-6 flex items-center justify-between"
        style={{ minHeight: 24 }}
      >
        <span
          className="t-mono"
          style={{ fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.05em" }}
        >
          AlphaDesk · v2
        </span>
        <span
          className="t-mono"
          style={{ fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.05em" }}
        >
          Sign-ins are logged with IP and device fingerprint.
        </span>
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
