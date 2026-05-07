export interface DocSection {
  id: string;
  index: string;
  title: string;
  content: string[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "getting-started",
    index: "01",
    title: "Getting Started",
    content: [
      "AlphaDesk is invite-only. Sign in with the credentials your account administrator issued, or email support@tradingalpha.net to request access.",
      "After signing in you land on the Dashboard: live portfolio equity, active strategy status, and market context in a single view.",
      "Switch between Dashboard, Trade, and Pipeline via the top nav. On mobile, use the hamburger menu.",
      "Cmd+K (Mac) or Ctrl+K (Windows/Linux) opens the command palette — symbol search, navigation, and quick actions.",
    ],
  },
  {
    id: "dashboard",
    index: "02",
    title: "Dashboard",
    content: [
      "The Portfolio Hero shows total equity, daily P&L, and an equity curve for the session.",
      "The Activity Feed is a single chronological stream of pipeline runs, trade executions, regime changes, and breaking news.",
      "The Strategy Grid shows the active strategies (currently 12 of 19 catalogued) with status (active/paused), return percentage, win rate, and current position count.",
      "Below the feed: open positions with live P&L, and a P&L Calendar showing daily returns for the current month.",
      "The Market Context strip at the bottom shows S&P 500, NASDAQ 100, Russell 2000, VIX, sector heat, and recent market news.",
    ],
  },
  {
    id: "trading",
    index: "03",
    title: "Trading",
    content: [
      "The Trade page has a real-time candlestick chart, order entry panel, and position manager.",
      "Search any symbol via the search bar or command palette. The chart supports multiple timeframes and drawing tools.",
      "Market, limit, and stop orders route through your connected Alpaca brokerage account.",
      "Open positions appear below the chart with live P&L. Click a position to see detail or close it.",
    ],
  },
  {
    id: "strategies",
    index: "04",
    title: "Strategies",
    content: [
      "AlphaDesk runs nineteen catalogued strategies (twelve currently active) across fundamental, technical, and options books. All share the same execution layer, risk policy, and audit trail.",
      "Fundamental / regime books: Cross-Sectional Momentum + Quality (momentum-quality), Post-Earnings Announcement Drift (PEAD), Systematic VRP Harvesting, Earnings Volatility Premium, HMM Regime-Adaptive Allocation, and AI Alpha — the AI-driven adaptive sleeve.",
      "Technical books: Time-Series Momentum (ts-momentum), RSI-2 Mean Reversion (rsi2-reversal), Dual Momentum, Statistical Arbitrage Pairs (pairs-trading), KAMA + ATR Breakout (kama-breakout), Opening Range Breakout (ORB), and VWAP Bounce / Breakout.",
      "The full registry with descriptions and regime notes lives in lib/strategies.ts and is the source of truth. Toggle any strategy on or off from the Strategy Grid. Click a card to open its detail page: full performance history, open positions, monthly return heatmap, correlations, conviction distribution, and hold-time statistics.",
    ],
  },
  {
    id: "pipeline",
    index: "05",
    title: "Pipeline",
    content: [
      "The Pipeline page shows each scheduled run and its stage-level status: data collection, AI analysis, signal generation, risk checks, and order execution.",
      "Runs execute automatically on the trading-day schedule and can also be triggered manually from the Pipeline page.",
      "The history table shows each run's duration, signals generated, and orders placed. All signals pass risk-management checks before any order is submitted.",
    ],
  },
  {
    id: "keyboard-shortcuts",
    index: "06",
    title: "Keyboard Shortcuts",
    content: [
      "Press ? at any time to open the keyboard shortcuts overlay.",
      "Cmd/Ctrl+K opens the command palette for search and navigation.",
      "Number keys 1–3 switch between Dashboard, Trade, and Pipeline.",
      "The Trade page exposes additional shortcuts for chart controls, order entry, and position management — visible in the ? overlay.",
    ],
  },
  {
    id: "how-ai-works",
    index: "07",
    title: "How AI Analysis Works",
    content: [
      "Each pipeline run packages relevant market data and sends it to the AI. The model evaluates technical indicators (moving averages, RSI, MACD, volume profiles), fundamental data (earnings, revenue growth, valuation multiples), and sentiment signals (news flow, analyst revisions), then returns a per-strategy trade thesis.",
      "Each thesis carries a conviction score (0–100). The score reflects alignment across the indicator set — a high score means the technical, fundamental, and sentiment signals point the same direction; it is not a probability estimate.",
      "The AI's output is one stage in the pipeline. Risk-management rules, position-sizing constraints, and portfolio-level checks run after scoring before any order is placed.",
    ],
  },
  {
    id: "strategy-methodology",
    index: "08",
    title: "Strategy Methodology",
    content: [
      "Post-Earnings Announcement Drift (PEAD) positions in the direction of an earnings surprise and holds for the multi-week drift window documented since Bernard and Thomas (1989).",
      "Momentum strategies exploit the cross-sectional effect from Jegadeesh and Titman (1993): trailing 12-month winners tend to outperform trailing 12-month losers over the subsequent month.",
      "Volatility Risk Premium (VRP) strategies sell options to harvest the spread between implied and realized volatility, which historically runs positive across most equity underlyings.",
      "Each strategy detail page includes the full methodology and academic citations. Parameters are calibrated on out-of-sample data; in-sample results are not used to select final hyperparameters.",
    ],
  },
  {
    id: "faq",
    index: "09",
    title: "FAQ / Troubleshooting",
    content: [
      "Login fails: confirm you're using the credentials your administrator issued. If you need a password reset, see /login/reset — the desk rotates passwords on request by email to support@tradingalpha.net.",
      "Dashboard shows stale data: hard-refresh with Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows) to bust the browser cache. If data is still stale after the refresh, the backend may be mid-deployment — check /pipeline for the last completed run timestamp.",
      "WebSocket indicator stays red: the real-time feed disconnects during server deployments and some network transitions. The client reconnects automatically. If the indicator stays red longer than 30 seconds, refresh the page.",
      "Strategies page stuck on loading skeleton: refresh the page, then check /pipeline for upstream status if it repeats. The current strategies page fetches once on mount.",
      "Strategy not executing: confirm the strategy is toggled active in the Strategy Grid, your Alpaca API keys are valid (Settings > API Keys), and your account has sufficient buying power. Review the pipeline run log for the specific error message.",
    ],
  },
  {
    id: "api-keys",
    index: "10",
    title: "API Keys (Alpaca Setup)",
    content: [
      "AlphaDesk routes live orders through your Alpaca account. You need an API Key ID and Secret Key from alpaca.markets — paper-trading keys work for validation before you switch to live.",
      "Navigate to Settings (profile menu, top-right) to enter your keys. Use paper keys first; the toggle between paper and live is in the same panel.",
      "Keys are encrypted at rest and decrypted only when the desk makes an API call to Alpaca on your behalf. They are not stored in plain text.",
    ],
  },
];
