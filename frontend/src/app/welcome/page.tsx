import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AlphaDesk — A trading desk that reads, decides, and trades",
  description:
    "AlphaDesk is an invite-only trading terminal. AI agents pre-process every market open; you stay in command of every order.",
};

// Public landing matches /tmp/alphadesk-design/alphadesk-v2/project/marketing.jsx —
// hero + thesis + agents + results + footer. Lives at /welcome so it doesn't
// disturb the auth-redirect at /.
export const dynamic = "force-static";

export default function WelcomePage() {
  return (
    <div style={{ background: "var(--bg)", color: "var(--fg)", minHeight: "100vh" }}>
      <MKHeader />
      <MKHero />
      <MKThesis />
      <MKAgents />
      <MKResults />
      <MKFooter />
    </div>
  );
}

// ─── header ──────────────────────────────────────────────────────────────

function MKHeader() {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        background: "rgba(10, 10, 8, 0.78)",
        borderBottom: "1px solid var(--border-hair)",
        padding: "14px 40px",
      }}
    >
      <div
        style={{
          maxWidth: 1320,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link
          href="/welcome"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            textDecoration: "none",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "var(--brand)",
              color: "var(--ink-050)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            α
          </div>
          <div
            className="italic"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 19,
              color: "var(--ink-1000)",
              letterSpacing: "-0.015em",
            }}
          >
            AlphaDesk
          </div>
        </Link>
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
            color: "var(--fg-muted)",
          }}
        >
          {[
            { href: "#thesis", label: "Thesis" },
            { href: "#agents", label: "Agents" },
            { href: "/pricing", label: "Pricing" },
            { href: "/about", label: "About" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              style={{ color: "var(--fg-muted)", textDecoration: "none" }}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/login"
            style={{
              color: "var(--fg-muted)",
              textDecoration: "none",
              padding: "6px 12px",
            }}
          >
            Sign in
          </Link>
          <Link
            href="/request-access"
            style={{
              background: "var(--brand)",
              color: "var(--ink-050)",
              border: "1px solid var(--brand)",
              padding: "8px 18px",
              borderRadius: 3,
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Apply for access
          </Link>
        </nav>
      </div>
    </header>
  );
}

// ─── hero ────────────────────────────────────────────────────────────────

function MKHero() {
  return (
    <section
      style={{
        padding: "80px 40px 100px",
        maxWidth: 1320,
        margin: "0 auto",
      }}
    >
      <div
        className="t-eyebrow-italic"
        style={{ color: "var(--brand)", letterSpacing: "0.2em" }}
      >
        INVITE-ONLY · OPERATOR ACCESS
      </div>
      <h1
        className="m-0 mt-5 italic"
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--ink-1000)",
          fontSize: 96,
          fontWeight: 400,
          letterSpacing: "-0.035em",
          lineHeight: 0.95,
          maxWidth: 1100,
          textWrap: "balance",
        }}
      >
        A trading desk that{" "}
        <span style={{ color: "var(--brand)" }}>reads, decides, and trades</span>{" "}
        alongside you.
      </h1>
      <p
        className="italic"
        style={{
          marginTop: 28,
          fontFamily: "var(--font-display)",
          fontSize: 22,
          color: "var(--fg-muted)",
          lineHeight: 1.45,
          maxWidth: 760,
          textWrap: "pretty",
        }}
      >
        Six AI agents — Scout, Strategist, Analyst, Risk, Execution, Memo —
        pre-process every market open, surface candidates, and execute against
        the rules you set. You stay in command of every order. Capital never
        moves without your signature.
      </p>
      <div
        style={{
          marginTop: 36,
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/request-access"
          style={{
            background: "var(--brand)",
            color: "var(--ink-050)",
            border: "1px solid var(--brand)",
            padding: "14px 28px",
            borderRadius: 3,
            fontFamily: "var(--font-ui)",
            fontSize: 15,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Apply for access →
        </Link>
        <Link
          href="/about"
          style={{
            background: "var(--bg-elev-1)",
            color: "var(--ink-1000)",
            border: "1px solid var(--border)",
            padding: "14px 22px",
            borderRadius: 3,
            fontFamily: "var(--font-ui)",
            fontSize: 15,
            textDecoration: "none",
          }}
        >
          Read the thesis
        </Link>
        <span
          className="t-mono"
          style={{
            marginLeft: 12,
            fontSize: 11,
            color: "var(--fg-muted)",
            letterSpacing: "0.05em",
          }}
        >
          NEXT COHORT · MAY 22 · 14 SEATS
        </span>
      </div>

      <div
        style={{
          marginTop: 80,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 32,
          paddingTop: 32,
          borderTop: "1px solid var(--border-hair)",
        }}
      >
        {[
          { k: "OPERATORS", v: "284", s: "active across the platform" },
          { k: "STRATEGIES PUBLISHED", v: "23", s: "fully backtested · all auditable" },
          { k: "TRADES / WEEK", v: "11.4k", s: "executed across all books" },
          { k: "MEDIAN OPERATOR YTD", v: "+18.2%", s: "net of fees · 2025" },
        ].map((s) => (
          <div key={s.k}>
            <div
              className="t-eyebrow-italic"
              style={{
                color: "var(--fg-hint)",
                fontSize: 9.5,
                letterSpacing: "0.16em",
              }}
            >
              {s.k}
            </div>
            <div
              className="t-mono"
              style={{
                marginTop: 6,
                fontSize: 36,
                color: "var(--ink-1000)",
                fontWeight: 500,
                letterSpacing: "-0.01em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {s.v}
            </div>
            <div
              className="italic"
              style={{
                marginTop: 4,
                fontFamily: "var(--font-display)",
                fontSize: 12.5,
                color: "var(--fg-muted)",
              }}
            >
              {s.s}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── thesis ──────────────────────────────────────────────────────────────

function MKThesis() {
  const points = [
    {
      h: "Robo-advisors index. Funds index. We don't.",
      p: "AlphaDesk runs explicit, auditable strategies — earnings drift, mean reversion, momentum, pairs, options income. Every rule is visible. Every fill is explained. No black boxes, no proprietary scoring, no \"trust us.\"",
    },
    {
      h: "The agents read the tape. You stay the operator.",
      p: "Scout, Strategist, Analyst, Risk, Execution, and Memo handle the data work — scanning thousands of names, generating theses, sizing positions, writing post-trade memos. You read, approve, modify, or reject. Capital never moves without your signature.",
    },
    {
      h: "Risk first. Always.",
      p: "Per-trade max loss, per-day stop-out, max book size, live drawdown breaker. Every limit is a hard cap — not a recommendation. The execution engine refuses orders that would breach them, and a circuit-breaker banner stops everything if they're hit.",
    },
    {
      h: "Built for operators, not retail.",
      p: "If you're a quant, an ex-trader, a serious individual investor, or a small fund running personal capital — you're our user. We don't onboard people who don't already understand position sizing, beta, or the difference between Sharpe and Sortino.",
    },
  ];
  return (
    <section
      id="thesis"
      style={{
        padding: "100px 40px",
        maxWidth: 1320,
        margin: "0 auto",
        borderTop: "1px solid var(--border-hair)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 60,
          alignItems: "start",
        }}
      >
        <div style={{ position: "sticky", top: 100 }}>
          <div
            className="t-eyebrow-italic"
            style={{ color: "var(--brand)", letterSpacing: "0.2em" }}
          >
            01 / THESIS
          </div>
          <h2
            className="m-0 mt-3 italic"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--ink-1000)",
              fontSize: 48,
              fontWeight: 400,
              letterSpacing: "-0.025em",
              lineHeight: 1.0,
            }}
          >
            Why a desk, not a robo-advisor.
          </h2>
        </div>
        <div>
          {points.map((c, i) => (
            <div
              key={c.h}
              style={{
                paddingBottom: 36,
                marginBottom: 36,
                borderBottom:
                  i < points.length - 1
                    ? "1px solid var(--border-hair)"
                    : "none",
              }}
            >
              <div
                className="t-mono"
                style={{
                  fontSize: 11,
                  color: "var(--brand)",
                  letterSpacing: "0.08em",
                }}
              >
                0{i + 1}
              </div>
              <h3
                className="m-0 mt-2 italic"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--ink-1000)",
                  fontSize: 28,
                  fontWeight: 400,
                  letterSpacing: "-0.015em",
                  textWrap: "balance",
                }}
              >
                {c.h}
              </h3>
              <p
                className="italic"
                style={{
                  marginTop: 10,
                  fontFamily: "var(--font-display)",
                  fontSize: 17,
                  color: "var(--fg-muted)",
                  lineHeight: 1.55,
                  textWrap: "pretty",
                  maxWidth: 700,
                }}
              >
                {c.p}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── agents ──────────────────────────────────────────────────────────────

function MKAgents() {
  const agents = [
    {
      n: "01",
      name: "Scout",
      role: "Universe filter",
      who: "Reduces 8,000+ tickers to a working pipeline of 30–60 each morning. Filters by liquidity, volatility regime, news flow, and strategy fit.",
      color: "#7DA3D9",
    },
    {
      n: "02",
      name: "Strategist",
      role: "Thesis generation",
      who: "Generates an entry thesis for every Scout-selected name. Cross-checks against historical fills, regime, and the strategy's playbook.",
      color: "#C9A66B",
    },
    {
      n: "03",
      name: "Analyst",
      role: "Idea pressure-test",
      who: "Steel-mans the Strategist's thesis. Surfaces what would invalidate it. Writes the counter-argument the operator wants to read.",
      color: "#A86B5C",
    },
    {
      n: "04",
      name: "Risk",
      role: "Hard cap enforcer",
      who: "Sizes positions against per-trade and per-day limits. Refuses orders that would breach the book cap or live drawdown.",
      color: "#A64B2A",
    },
    {
      n: "05",
      name: "Execution",
      role: "Order routing",
      who: "Routes to the broker once you sign. Monitors fills, partial executions, and slippage. Auto-cancels resting orders on regime flip.",
      color: "#5D6E3E",
    },
    {
      n: "06",
      name: "Memo",
      role: "Post-trade narrative",
      who: "Writes the post-trade memo for every closed position. What worked, what didn't, what the next operator should watch for.",
      color: "#5B4767",
    },
  ];
  return (
    <section
      id="agents"
      style={{
        padding: "100px 40px",
        maxWidth: 1320,
        margin: "0 auto",
        borderTop: "1px solid var(--border-hair)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 60,
          alignItems: "start",
        }}
      >
        <div style={{ position: "sticky", top: 100 }}>
          <div
            className="t-eyebrow-italic"
            style={{ color: "var(--brand)", letterSpacing: "0.2em" }}
          >
            02 / AGENTS
          </div>
          <h2
            className="m-0 mt-3 italic"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--ink-1000)",
              fontSize: 48,
              fontWeight: 400,
              letterSpacing: "-0.025em",
              lineHeight: 1.0,
            }}
          >
            Six agents. Six jobs. One operator.
          </h2>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 24,
          }}
        >
          {agents.map((a) => (
            <div
              key={a.name}
              style={{
                padding: "20px 22px",
                background: "var(--bg-elev-1)",
                border: "1px solid var(--border-hair)",
                borderLeft: `2px solid ${a.color}`,
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <span
                  className="italic"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 22,
                    color: "var(--ink-1000)",
                    letterSpacing: "-0.015em",
                  }}
                >
                  {a.name}
                </span>
                <span
                  className="t-mono"
                  style={{
                    fontSize: 10,
                    color: "var(--fg-hint)",
                    letterSpacing: "0.06em",
                  }}
                >
                  {a.n}
                </span>
              </div>
              <div
                className="italic"
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-display)",
                  fontSize: 13,
                  color: a.color,
                }}
              >
                {a.role}
              </div>
              <p
                className="italic"
                style={{
                  marginTop: 12,
                  fontFamily: "var(--font-display)",
                  fontSize: 14.5,
                  color: "var(--fg-muted)",
                  lineHeight: 1.55,
                  textWrap: "pretty",
                }}
              >
                {a.who}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── results ─────────────────────────────────────────────────────────────

function MKResults() {
  return (
    <section
      style={{
        padding: "100px 40px",
        maxWidth: 1320,
        margin: "0 auto",
        borderTop: "1px solid var(--border-hair)",
      }}
    >
      <div
        className="t-eyebrow-italic"
        style={{ color: "var(--brand)", letterSpacing: "0.2em" }}
      >
        03 / RESULTS
      </div>
      <h2
        className="m-0 mt-3 italic"
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--ink-1000)",
          fontSize: 48,
          fontWeight: 400,
          letterSpacing: "-0.025em",
          lineHeight: 1.0,
          maxWidth: 760,
        }}
      >
        The numbers speak. Quietly.
      </h2>
      <p
        className="italic"
        style={{
          marginTop: 16,
          fontFamily: "var(--font-display)",
          fontSize: 17,
          color: "var(--fg-muted)",
          lineHeight: 1.55,
          maxWidth: 700,
        }}
      >
        Aggregate, anonymized, hand-checked. Every operator's individual
        performance is private — these are the platform-wide numbers we'd be
        comfortable defending in a deposition.
      </p>

      <div
        style={{
          marginTop: 40,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 1,
          background: "var(--border)",
          border: "1px solid var(--border)",
          borderRadius: 4,
        }}
      >
        {[
          {
            k: "MEDIAN STRATEGY SHARPE · 2025",
            v: "1.41",
            s: "across 23 published strategies",
          },
          {
            k: "MEDIAN OPERATOR DRAWDOWN",
            v: "−7.2%",
            s: "rolling 12 months · trough-to-peak",
          },
          {
            k: "AVG LIVE EXECUTION SLIPPAGE",
            v: "1.8 bps",
            s: "vs. mid · liquid US equities",
          },
        ].map((m) => (
          <div
            key={m.k}
            style={{
              padding: "20px 24px",
              background: "var(--ink-100)",
            }}
          >
            <div
              className="t-eyebrow-italic"
              style={{
                color: "var(--fg-hint)",
                fontSize: 9.5,
                letterSpacing: "0.16em",
              }}
            >
              {m.k}
            </div>
            <div
              className="t-mono"
              style={{
                marginTop: 6,
                fontSize: 36,
                color: "var(--ink-1000)",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {m.v}
            </div>
            <div
              className="italic"
              style={{
                marginTop: 4,
                fontFamily: "var(--font-display)",
                fontSize: 13,
                color: "var(--fg-muted)",
              }}
            >
              {m.s}
            </div>
          </div>
        ))}
      </div>

      <p
        className="t-mono"
        style={{
          marginTop: 22,
          fontSize: 10,
          color: "var(--fg-hint)",
          letterSpacing: "0.06em",
          maxWidth: 920,
          lineHeight: 1.55,
        }}
      >
        TRADING INVOLVES RISK. PAST PERFORMANCE IS NOT INDICATIVE OF FUTURE
        RETURNS. ALPHADESK IS A SOFTWARE PLATFORM · NOT A REGISTERED BROKER,
        ADVISOR, OR FUND. NUMBERS REFLECT AGGREGATE PLATFORM PERFORMANCE
        ACROSS ALL OPERATORS · INDIVIDUAL RESULTS WILL VARY MATERIALLY.
      </p>
    </section>
  );
}

// ─── footer ──────────────────────────────────────────────────────────────

function MKFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border-hair)",
        padding: "60px 40px 40px",
        background: "var(--ink-100)",
      }}
    >
      <div
        style={{
          maxWidth: 1320,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr 1fr 1fr",
          gap: 40,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "var(--brand)",
                color: "var(--ink-050)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              α
            </div>
            <div
              className="italic"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 18,
                color: "var(--ink-1000)",
              }}
            >
              AlphaDesk
            </div>
          </div>
          <p
            className="italic"
            style={{
              marginTop: 14,
              fontFamily: "var(--font-display)",
              fontSize: 13,
              color: "var(--fg-muted)",
              lineHeight: 1.55,
              maxWidth: 380,
            }}
          >
            A trading desk that reads, decides, and trades alongside you. Made
            by Trading Alpha · San Francisco · 2024.
          </p>
        </div>
        {[
          { h: "Product", l: [{ t: "Pricing", h: "/pricing" }, { t: "Apply", h: "/request-access" }] },
          { h: "Company", l: [{ t: "About", h: "/about" }, { t: "Contact", h: "/contact" }] },
          { h: "Legal", l: [{ t: "Terms", h: "/terms" }, { t: "Privacy", h: "/privacy" }, { t: "Risk disclosure", h: "/legal/risk" }] },
        ].map((c) => (
          <div key={c.h}>
            <div
              className="t-eyebrow-italic"
              style={{
                color: "var(--fg-hint)",
                fontSize: 9.5,
                letterSpacing: "0.18em",
              }}
            >
              {c.h}
            </div>
            <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none" }}>
              {c.l.map((li) => (
                <li
                  key={li.t}
                  style={{
                    padding: "5px 0",
                  }}
                >
                  <Link
                    href={li.h}
                    className="italic"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 14,
                      color: "var(--fg)",
                      textDecoration: "none",
                    }}
                  >
                    {li.t}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div
        style={{
          maxWidth: 1320,
          margin: "40px auto 0",
          paddingTop: 22,
          borderTop: "1px solid var(--border-hair)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          className="t-mono"
          style={{
            fontSize: 10.5,
            color: "var(--fg-hint)",
            letterSpacing: "0.05em",
          }}
        >
          © 2024–2026 TRADING ALPHA INC · ALL RIGHTS RESERVED
        </span>
        <span
          className="t-mono"
          style={{
            fontSize: 10.5,
            color: "var(--fg-hint)",
            letterSpacing: "0.05em",
            maxWidth: 700,
            textAlign: "right",
            lineHeight: 1.5,
          }}
        >
          Trading involves risk. Past performance is not indicative of future
          returns. AlphaDesk is a software platform · not a registered broker,
          advisor, or fund.
        </span>
      </div>
    </footer>
  );
}
