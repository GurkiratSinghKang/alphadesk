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
    id: "how-claude-works",
    title: "How Claude AI Analysis Works",
    content: [
      "AlphaDesk leverages Anthropic's Claude AI to analyze market opportunities across all 12 strategies. When a pipeline run executes, relevant market data is sent to Claude for analysis.",
      "Claude evaluates technical indicators (moving averages, RSI, MACD, volume profiles), fundamental data (earnings, revenue growth, valuation multiples), and sentiment signals (news flow, analyst revisions) to generate trade recommendations.",
      "Each recommendation includes a conviction score (0-100) reflecting the AI's confidence in the trade thesis. Higher conviction scores indicate stronger alignment across multiple analytical factors.",
      "The AI analysis is one input in the decision pipeline — risk management rules, position sizing constraints, and portfolio-level checks are applied after AI scoring before any order is placed.",
    ],
  },
  {
    id: "strategy-methodology",
    title: "Strategy Methodology",
    content: [
      "AlphaDesk strategies are grounded in academic research and well-established market phenomena.",
      "Post-Earnings Announcement Drift (PEAD) strategies exploit the documented tendency for stock prices to continue moving in the direction of an earnings surprise for weeks after the announcement.",
      "Momentum strategies are based on the cross-sectional momentum effect first documented by Jegadeesh and Titman (1993), where recent winners tend to continue outperforming.",
      "Volatility Risk Premium (VRP) strategies harvest the persistent spread between implied and realized volatility through systematic options selling.",
      "Each strategy detail page includes full methodology notes and academic citations. Strategy parameters are calibrated using out-of-sample testing to reduce overfitting risk.",
    ],
  },
  {
    id: "faq",
    title: "FAQ / Troubleshooting",
    content: [
      "Login problems: Ensure you are using the correct credentials. If you have forgotten your password, contact support@tradingalpha.net for a reset. Clear your browser cookies if you experience persistent session issues.",
      "Data not loading: Check your internet connection. If the dashboard shows stale data, try a hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows). If the issue persists, the backend service may be restarting — wait a few minutes and try again.",
      "WebSocket disconnection: The real-time feed may disconnect during server deployments or network interruptions. The client will attempt to reconnect automatically. If the connection indicator stays red, refresh the page.",
      "Clearing cache: If the UI behaves unexpectedly after an update, clear your browser cache and local storage. In Chrome: Settings > Privacy > Clear browsing data > Cached images and files.",
      "Strategy not executing: Verify the strategy is toggled on in the Strategy Grid. Check that your Alpaca API keys are valid and that your account has sufficient buying power. Review the pipeline logs for error messages.",
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
            href="/"
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

        <footer className="mt-16 border-t border-border/30 pt-6">
          <div className="text-center text-xs text-muted-foreground mb-4">
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
          <nav className="flex gap-4 text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms of Service
            </Link>
            <Link href="/risk" className="hover:text-foreground">
              Risk Disclosure
            </Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
