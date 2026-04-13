import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Documentation — AlphaDesk",
  description:
    "AlphaDesk user guide: dashboard, trading, strategies, pipeline, and keyboard shortcuts.",
};

const sections = [
  {
    id: "getting-started",
    title: "Getting Started",
    content: [
      "Log in with the credentials provided by your account administrator. AlphaDesk is an invite-only platform — contact support@tradingalpha.net to request access.",
      "After signing in you will land on the Dashboard, which provides a real-time overview of your portfolio, active strategies, and market context.",
      "Use the top navigation bar to switch between Dashboard, Trade, and Pipeline views. On mobile devices, tap the hamburger menu icon to access navigation.",
      'Press Cmd+K (Mac) or Ctrl+K (Windows/Linux) to open the command palette for quick symbol search, navigation, and actions.',
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    content: [
      "The Dashboard is your command center. At the top, the Portfolio Hero shows your total equity, daily P&L, and an equity curve chart.",
      "The Activity Feed displays recent pipeline runs, trade executions, market regime changes, and breaking news — all in a single chronological stream.",
      "The Strategy Grid on the right shows all 12 strategies at a glance with their status (active/paused), return percentage, win rate, and current position count.",
      "Below the feed you will find the Positions Summary (open positions with live P&L) and a P&L Calendar showing daily returns for the current month.",
      "The Market Context section at the bottom shows major index performance (S&P 500, NASDAQ 100, Russell 2000, VIX), sector heat, and recent market news.",
    ],
  },
  {
    id: "trading",
    title: "Trading",
    content: [
      "The Trade page provides a full-featured trading interface with a real-time candlestick chart, order entry panel, and position manager.",
      "Search for any symbol using the search bar or command palette. The chart supports multiple timeframes and drawing tools.",
      "Place market, limit, and stop orders through the order panel. All orders are executed via your connected Alpaca brokerage account.",
      "Open positions are listed below the chart with live P&L updates. Click any position to see detailed information or close it.",
      "The order book and recent trades panel shows real-time market depth when available.",
    ],
  },
  {
    id: "strategies",
    title: "Strategies",
    content: [
      "AlphaDesk runs 12 parallel trading strategies, each targeting different market conditions and opportunities:",
      "Momentum strategies (Trend Surfer, Breakout Hunter, Dip Buyer) follow price action patterns. Mean Reversion and Pairs Trading exploit statistical relationships.",
      "Sector Rotation and Growth at a Reasonable Price (GARP) focus on fundamental analysis. Options Wheel and Volatility Harvester generate income from options.",
      "Macro Regime, Event Catalyst, and Quality Compounder round out the strategy mix with macro-aware and event-driven approaches.",
      "Each strategy can be toggled on or off from the Strategy Grid on the dashboard. Click any strategy card to see its detail page with full performance history, open positions, and configuration.",
    ],
  },
  {
    id: "pipeline",
    title: "Pipeline",
    content: [
      "The Pipeline page shows the automated analysis and trading workflow that runs on a schedule throughout the trading day.",
      "Each pipeline run goes through multiple stages: data collection, Claude AI analysis, signal generation, risk checks, and order execution.",
      "The pipeline history table shows past runs with their status, duration, signals generated, and orders placed.",
      "Pipeline runs are fully automated but can be triggered manually from the Pipeline page. All generated signals go through risk management checks before execution.",
    ],
  },
  {
    id: "keyboard-shortcuts",
    title: "Keyboard Shortcuts",
    content: [
      "Press ? at any time to open the keyboard shortcuts overlay with a full reference of available shortcuts.",
      "Cmd/Ctrl+K opens the command palette for quick search and navigation.",
      "Use number keys 1-3 to quickly switch between Dashboard, Trade, and Pipeline views.",
      "On the Trade page, additional shortcuts are available for chart controls, order entry, and position management.",
    ],
  },
  {
    id: "api-keys",
    title: "API Keys (Alpaca Setup)",
    content: [
      "AlphaDesk connects to your Alpaca brokerage account for live trading. You need both a paper and/or live API key pair.",
      "Navigate to your profile menu (top-right) and select Settings to configure your Alpaca API keys.",
      "Enter your Alpaca API Key ID and Secret Key. You can use paper trading keys for testing before switching to live.",
      "AlphaDesk never stores your API keys in plain text — they are encrypted at rest and only decrypted when making API calls to Alpaca on your behalf.",
      'For help obtaining API keys, visit alpaca.markets and create a free account.',
    ],
  },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <nav className="mb-8">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to AlphaDesk
          </Link>
        </nav>

        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Documentation
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A guide to the AlphaDesk trading terminal.
        </p>

        {/* Table of contents */}
        <nav className="mt-8 rounded-xl border border-border bg-[var(--surface)] p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contents
          </p>
          <ul className="space-y-1">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Sections */}
        <div className="mt-10 space-y-10">
          {sections.map((s) => (
            <section key={s.id} id={s.id}>
              <h2 className="text-lg font-semibold text-foreground">
                {s.title}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
                {s.content.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-16 border-t border-border/30 pt-6 text-center text-xs text-muted-foreground">
          <p>
            Need help? Contact{" "}
            <a
              href="mailto:support@tradingalpha.net"
              className="text-primary hover:text-primary/80"
            >
              support@tradingalpha.net
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
