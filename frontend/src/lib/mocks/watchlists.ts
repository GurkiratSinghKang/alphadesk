/**
 * MOCK_WATCHLISTS — fixture for the Phase 1.8 Watchlists page.
 *
 * Phase 0c didn't include this since the underlying backend
 * (B.3 Watchlists v2) wasn't yet planned in detail. Adding now
 * so the Phase 1.8 page renders against realistic data without
 * a backend swap.
 */

export type WatchlistKind = "manual" | "auto_strategy" | "auto_earnings";
export type WatchlistShare = "private" | "tenant" | "public";

export interface WatchlistRow {
  symbol: string;
  name: string;
  px: number;
  pctDay: number;
  vol: string;
  techScore: number;     // 0..100
  fundScore: number;     // 0..100
  signal: string;
  strats: string[];
  reason: string;
  earningsInDays?: number;
  preMktPct?: number;
  held: boolean;
}

export interface Watchlist {
  id: string;
  name: string;
  kind: WatchlistKind;
  share: WatchlistShare;
  rows: WatchlistRow[];
  ownerLabel: string;
}

export const MOCK_WATCHLISTS: Watchlist[] = [
  {
    id: "wl-core",
    name: "My core",
    kind: "manual",
    share: "private",
    ownerLabel: "you",
    rows: [
      { symbol: "NVDA", name: "Nvidia",      px: 145.20, pctDay:  1.6, vol: "82.4M", techScore: 88, fundScore: 74, signal: "trend+",  strats: ["MQ", "PEAD"], reason: "Above 50d, RSI 58", earningsInDays: 0, preMktPct: 0.4, held: true },
      { symbol: "MSFT", name: "Microsoft",   px: 432.50, pctDay:  0.4, vol: "18.2M", techScore: 76, fundScore: 88, signal: "hold",    strats: ["MQ"],         reason: "Range-bound", earningsInDays: 22, held: true },
      { symbol: "AAPL", name: "Apple",       px: 224.18, pctDay: -0.2, vol: "44.8M", techScore: 64, fundScore: 86, signal: "watch",   strats: ["MQ"],         reason: "Below 50d", earningsInDays: 8, held: true },
      { symbol: "MELI", name: "MercadoLibre",px:1840.00, pctDay:  2.1, vol:  "0.8M", techScore: 82, fundScore: 71, signal: "trend+",  strats: ["MQ"],         reason: "Breakout above 1820", earningsInDays: 41, held: false },
      { symbol: "ZS",   name: "Zscaler",     px: 184.20, pctDay:  3.4, vol:  "2.4M", techScore: 80, fundScore: 64, signal: "PEAD",    strats: ["PEAD"],       reason: "Surprise +12σ", earningsInDays: -8, held: false },
    ],
  },
  {
    id: "wl-earnings",
    name: "Earnings season",
    kind: "auto_earnings",
    share: "tenant",
    ownerLabel: "auto · earnings",
    rows: [
      { symbol: "CRM",  name: "Salesforce",  px: 268.00, pctDay: -0.6, vol: "5.2M", techScore: 70, fundScore: 78, signal: "watch",  strats: ["EOP"], reason: "Reports tomorrow AMC",   earningsInDays: 1, held: false },
      { symbol: "ADBE", name: "Adobe",       px: 502.40, pctDay:  0.2, vol: "2.1M", techScore: 68, fundScore: 82, signal: "neutral",strats: ["EOP"], reason: "Reports in 4 days",      earningsInDays: 4, held: false },
      { symbol: "NOW",  name: "ServiceNow",  px: 942.10, pctDay:  1.2, vol: "1.4M", techScore: 84, fundScore: 80, signal: "trend+", strats: ["EOP"], reason: "Reports in 2 weeks",     earningsInDays: 14, held: false },
      { symbol: "SHOP", name: "Shopify",     px:  82.40, pctDay: -1.4, vol:"12.0M", techScore: 56, fundScore: 60, signal: "watch",  strats: ["EOP"], reason: "Reports next week",      earningsInDays: 7, held: false },
    ],
  },
  {
    id: "wl-vol",
    name: "Vol plays",
    kind: "manual",
    share: "private",
    ownerLabel: "you",
    rows: [
      { symbol: "VIX",  name: "Volatility Index", px: 18.6, pctDay: 12.3, vol: "—",     techScore: 92, fundScore: 0,  signal: "vol+",  strats: ["EOP"], reason: "Fear+Greed 32",         held: false },
      { symbol: "SVXY", name: "Short VIX 1.5x",  px: 86.40, pctDay: -8.1, vol: "1.0M", techScore: 32, fundScore: 0,  signal: "trim",  strats: [],     reason: "Inverse VIX gap",       held: false },
      { symbol: "UVXY", name: "VIX 1.5x ETF",    px: 18.20, pctDay: 9.8, vol: "9.4M", techScore: 80, fundScore: 0,  signal: "trend+",strats: [],     reason: "Vol regime fragile",   held: false },
    ],
  },
  {
    id: "wl-mq",
    name: "Strategy: Momentum + Quality",
    kind: "auto_strategy",
    share: "private",
    ownerLabel: "auto · MQ rules",
    rows: [
      { symbol: "NVDA", name: "Nvidia",     px: 145.20, pctDay:  1.6, vol: "82.4M", techScore: 88, fundScore: 74, signal: "trend+", strats: ["MQ"], reason: "Auto-include rule fired", held: true },
      { symbol: "AVGO", name: "Broadcom",   px:1620.00, pctDay:  0.8, vol:  "1.2M", techScore: 78, fundScore: 86, signal: "trend+", strats: ["MQ"], reason: "Above 50d + 200d",       held: false },
      { symbol: "ANET", name: "Arista",     px: 320.40, pctDay:  1.2, vol:  "1.0M", techScore: 76, fundScore: 80, signal: "trend+", strats: ["MQ"], reason: "Above 50d + 200d",       held: false },
    ],
  },
];
