/**
 * Design preview (dev-only).
 *
 * Route: /_design
 * Purpose: eyeball every token, type class, and Layer-1 primitive we ship.
 * NOT linked from navigation. In production builds this returns a 404 so
 * the 698 lines of fixture data below never ship to end users' browsers.
 */

import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  NumericChip,
  PnLNumber,
  RegimePill,
  Sparkline,
  StatusDot,
} from "@/components/primitives";
import {
  Display,
  Eyebrow,
  Mono,
  SectionRule,
  SerifEyebrow,
} from "@/components/typography";

import {
  AIMemoPanel,
  ClaudeStamp,
  ContextBar,
  EditorialNameplate,
  OrderBar,
  PositionsList,
  PriceChartPanel,
  StatusBar,
  StrategyCard,
  StrategyRail,
  TickerStrip,
  TopBar,
} from "@/components/composites";
import type {
  AIMemo,
  ContextCell,
  PositionRow,
  StatusPill,
  StrategyRailItem,
  TickerEntry,
} from "@/components/composites/types";

const SWATCHES: Array<{ name: string; bg: string; text: string }> = [
  { name: "bg-bg", bg: "bg-bg", text: "text-fg" },
  { name: "bg-bg-elev-1", bg: "bg-bg-elev-1", text: "text-fg" },
  { name: "bg-bg-elev-2", bg: "bg-bg-elev-2", text: "text-fg" },
  { name: "bg-bg-card", bg: "bg-bg-card", text: "text-fg" },
  { name: "bg-brand", bg: "bg-brand", text: "text-ink-1000" },
  { name: "bg-profit", bg: "bg-profit", text: "text-ink-050" },
  { name: "bg-loss", bg: "bg-loss", text: "text-ink-050" },
  { name: "bg-ice", bg: "bg-ice", text: "text-ink-050" },
  { name: "bg-wine", bg: "bg-wine", text: "text-ink-1000" },
  { name: "bg-amber", bg: "bg-amber", text: "text-ink-050" },
  { name: "bg-ink-200", bg: "bg-ink-200", text: "text-fg" },
  { name: "bg-ink-300", bg: "bg-ink-300", text: "text-fg" },
];

const TABLE_ROWS = [
  { sym: "NVDA", side: "Long", qty: 250, entry: 128.41, pnl: 1602, strat: "Momentum & Quality" },
  { sym: "INTC", side: "Short", qty: 120, entry: 32.4, pnl: 151, strat: "Pairs · Sector" },
  { sym: "UNH", side: "Long", qty: 40, entry: 588.2, pnl: -258, strat: "Claude Alpha" },
  { sym: "SPY", side: "Long", qty: 50, entry: 478.22, pnl: 234, strat: "Regime Adaptive" },
];

const SPARK_UP = [22, 18, 20, 14, 16, 10, 12, 7, 9, 4, 2];
const SPARK_DOWN = [4, 8, 6, 12, 10, 16, 14, 19, 17, 22, 24];
const SPARK_BRAND = [12, 14, 10, 15, 12, 16, 11, 18, 13, 20];

// ─── Composite mock fixtures (§10) ────────────────────────────
const CTX_CELLS: ContextCell[] = [
  { label: "Book equity", value: "$284,193.42", delta: "+0.82%", deltaTone: "profit", emphasis: true },
  { label: "Day P&L", value: "+$2,341.18", deltaTone: "profit" },
  { label: "Cash", value: "$47,812" },
  { label: "Exposure · Long / Short", value: "48%", delta: "62 / 14" },
  { label: "Sharpe · 30d", value: "1.08" },
  { label: "Beta", value: "0.62" },
  { label: "Positions · Orders", value: "12 · 2" },
];

const RAIL_ITEMS: StrategyRailItem[] = [
  { id: "mq", name: "Momentum & Quality", subtitle: "Swing · 5–20 day hold", status: "active", returnPct: 3.42, indexLabel: "01" },
  { id: "ra", name: "Regime Adaptive", subtitle: "Long/short macro", status: "active", returnPct: 1.84, indexLabel: "02" },
  { id: "pead", name: "PEAD", subtitle: "Post-earnings drift", status: "active", returnPct: 0.62, indexLabel: "03" },
  { id: "mr", name: "Mean Reversion", subtitle: "Short-horizon · 1–3 day", status: "paused", returnPct: null, indexLabel: "04" },
  { id: "pairs", name: "Pairs · Sector", subtitle: "Market-neutral", status: "active", returnPct: 0.41, indexLabel: "05" },
  { id: "claude", name: "Claude Alpha", subtitle: "AI opportunistic", status: "active", returnPct: -1.18, indexLabel: "06" },
];

const POSITIONS: PositionRow[] = [
  { id: "1", symbol: "NVDA", quantity: 250, entryPrice: 128.41, strategyName: "Momentum & Quality", progress: 0.72, pnl: 1602, pnlPct: 5.0 },
  { id: "2", symbol: "SPY", quantity: 50, entryPrice: 478.22, strategyName: "Regime Adaptive", progress: 0.48, pnl: 234, pnlPct: 1.0 },
  { id: "3", symbol: "XOM", quantity: 180, entryPrice: 116.4, strategyName: "PEAD", progress: 0.22, pnl: 291, pnlPct: 1.4 },
  { id: "4", symbol: "UNH", quantity: 40, entryPrice: 588.2, strategyName: "Claude Alpha", progress: 0.38, pnl: -258, pnlPct: -1.1 },
  { id: "5", symbol: "JPM", quantity: 120, entryPrice: 186.5, strategyName: "Pairs · Sector", progress: 0.56, pnl: 412, pnlPct: 1.8 },
];

const MEMO: AIMemo = {
  text: "NVDA entry fits Momentum & Quality — 3-week high, regime bull/low-vol, earnings 14 days out. Suggest 250 sh at limit 134.80 with 4% stop. One caveat — semis beta 1.7, sizing uses scaled units.",
  chips: [
    { label: "Regime fit 0.82", tone: "profit" },
    { label: "Risk ok", tone: "ice" },
    { label: "Earn 14d", tone: "muted" },
  ],
  confidence: 0.72,
  model: "Haiku 4.5",
  latencyMs: 180,
  timestamp: "14:32:08",
};

const STATUS_PILLS: StatusPill[] = [
  { label: "Alpaca paper · connected", tone: "profit" },
  { label: "Market · open · 1h 28m to close", tone: "profit" },
  { label: "Claude · healthy · p50 180ms", tone: "muted" },
  { label: "Last tick 0.04s", tone: "muted" },
];

const TICKERS: TickerEntry[] = [
  { symbol: "NVDA", price: "134.82", deltaPct: 1.31 },
  { symbol: "SPY", price: "482.91", deltaPct: 0.44 },
  { symbol: "AAPL", price: "228.14", deltaPct: -0.22 },
  { symbol: "XOM", price: "118.02", deltaPct: 0.81 },
  { symbol: "UNH", price: "581.76", deltaPct: -1.04 },
  { symbol: "JPM", price: "209.30", deltaPct: 0.58 },
  { symbol: "MSFT", price: "414.62", deltaPct: 0.12 },
  { symbol: "GOOGL", price: "168.94", deltaPct: -0.38 },
];

// A handful of OHLCV bars for the chart preview. The chart canvas
// mounts asynchronously and gracefully no-ops in SSR.
const SERIES = Array.from({ length: 40 }, (_, i) => {
  const base = 130 + Math.sin(i / 3.5) * 3 + i * 0.1;
  return {
    time: 1_700_000_000 + i * 3600,
    open: base,
    high: base + 0.5,
    low: base - 0.5,
    close: base + (Math.random() - 0.45) * 0.8,
    volume: 1_000_000,
  };
});

export default function DesignPreviewPage() {
  // Dev-only surface. In production the whole page (including the fixture
  // constants above that would otherwise sit in the client bundle) is
  // short-circuited to a 404 via Next's notFound().
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }
  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-5xl px-8 py-16">
        {/* Nameplate */}
        <header className="mb-16 border-b border-border-hair pb-10">
          <div className="flex items-baseline gap-4">
            <span
              className="text-brand"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "72px",
                lineHeight: 1,
              }}
            >
              α
            </span>
            <Display size="lg" as="h1">
              AlphaDesk
            </Display>
          </div>
          <SerifEyebrow as="p" className="mt-4">
            § F1 · primitives &amp; typography
          </SerifEyebrow>
          <p className="t-body mt-2">
            Atomic components built on the tokens in{" "}
            <Mono size="body">src/styles/design-tokens.css</Mono>. Numbers run in
            JetBrains Mono · names in Newsreader italic · labels in Inter Tight
            tracked caps.
          </p>
        </header>

        {/* ─── §01 TOKENS ─── */}
        <section className="mb-16">
          <SectionRule tag="§ 01 · Tokens" />
          <h2 className="t-h2 mt-6 mb-2">Color surfaces</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {SWATCHES.map((s) => (
              <div
                key={s.name}
                className={`${s.bg} ${s.text} rounded-md border border-border-hair p-4`}
                style={{ minHeight: "88px" }}
              >
                <Mono size="hint">{s.name}</Mono>
              </div>
            ))}
          </div>
        </section>

        {/* ─── §02 TYPOGRAPHY ─── */}
        <section className="mb-16">
          <SectionRule tag="§ 02 · Typography" />
          <div className="mt-6 space-y-4">
            <Display size="xl">Alpha, delivered in italic.</Display>
            <Display size="lg">A louder serif, still restrained.</Display>
            <Display size="md">Page-level title in serif.</Display>
          </div>
          <div className="mt-8 grid gap-3">
            <Eyebrow as="div">Eyebrow · tracked caps</Eyebrow>
            <SerifEyebrow as="div">Eyebrow · italic serif gold</SerifEyebrow>
            <p className="t-body">
              Body copy in Inter Tight — the reading layer that carries descriptions,
              paragraphs, and helper text.
            </p>
            <p>
              <Mono size="display">+28.41</Mono>{" "}
              <Mono size="body">$1,234,567.89</Mono>{" "}
              <Mono size="micro">0421 · 2026-04-17</Mono>
            </p>
          </div>
        </section>

        {/* ─── §03 BUTTONS ─── */}
        <section className="mb-16">
          <SectionRule tag="§ 03 · Buttons" />
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3">
            {(["primary", "secondary", "ghost", "buy", "sell", "link"] as const).map(
              (variant) => (
                <div
                  key={variant}
                  className="rounded-md border border-border-hair p-4"
                >
                  <Eyebrow as="div" className="mb-3">
                    {variant}
                  </Eyebrow>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant={variant} size="sm">
                      {variant === "buy"
                        ? "Buy · 100 SPY"
                        : variant === "sell"
                          ? "Sell · 50 NVDA"
                          : "Action sm"}
                    </Button>
                    <Button variant={variant} size="default">
                      {variant === "buy"
                        ? "Buy · 100 SPY"
                        : variant === "sell"
                          ? "Sell · 50 NVDA"
                          : "Action default"}
                    </Button>
                    <Button variant={variant} size="lg">
                      {variant === "buy"
                        ? "Buy · 100 SPY"
                        : variant === "sell"
                          ? "Sell · 50 NVDA"
                          : "Action lg"}
                    </Button>
                  </div>
                </div>
              ),
            )}
          </div>
        </section>

        {/* ─── §04 INPUTS ─── */}
        <section className="mb-16">
          <SectionRule tag="§ 04 · Inputs" />
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Eyebrow as="div">Symbol</Eyebrow>
              <Input defaultValue="NVDA" />
              <span className="font-display italic text-[12px] text-fg-muted">
                Ticker · case-insensitive
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <Eyebrow as="div">Quantity</Eyebrow>
              <InputGroup>
                <InputGroupInput defaultValue="250" />
                <InputGroupAddon align="inline-end">shares</InputGroupAddon>
              </InputGroup>
              <span className="font-display italic text-[12px] text-fg-muted">
                Fractional supported
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <Eyebrow as="div">Limit price</Eyebrow>
              <InputGroup>
                <InputGroupAddon align="inline-start">$</InputGroupAddon>
                <InputGroupInput defaultValue="134.28" />
              </InputGroup>
              <span className="font-display italic text-[12px] text-fg-muted">
                —
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <Eyebrow as="div">Stop loss (error)</Eyebrow>
              <Input defaultValue="-5.0%" aria-invalid />
              <span className="font-display italic text-[12px] text-loss">
                Must be ≥ 3% per risk policy
              </span>
            </div>
          </div>
        </section>

        {/* ─── §05 BADGES ─── */}
        <section className="mb-16">
          <SectionRule tag="§ 05 · Badges, regime pills &amp; chips" />
          <div className="mt-6 flex flex-wrap gap-2">
            <Badge variant="active" withDot>Active</Badge>
            <Badge variant="paused" withDot>Paused</Badge>
            <Badge variant="halted" withDot>Halted</Badge>
            <Badge variant="idle" withDot>Idle</Badge>
            <Badge variant="ai" withDot>AI</Badge>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <RegimePill regime="bull" vol="low" />
            <RegimePill regime="neutral" vol="elevated" />
            <RegimePill regime="bear" vol="high" />
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <NumericChip label="Sharpe" value="1.08" />
            <NumericChip label="Beta" value="0.62" />
            <NumericChip label="Exposure" value="48%" />
            <NumericChip label="Positions" value={12} />
            <NumericChip label="P&L" value="+$24,381" tone="profit" />
          </div>
        </section>

        {/* ─── §06 CARDS ─── */}
        <section className="mb-16">
          <SectionRule tag="§ 06 · Cards" />
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Plain card</CardTitle>
              </CardHeader>
              <CardContent>
                <Mono size="display" className="text-fg">
                  $48,120
                </Mono>
              </CardContent>
            </Card>
            <Card leftAccent="brand">
              <CardHeader>
                <CardTitle>Momentum &amp; Quality</CardTitle>
                <Eyebrow as="div" className="text-fg-muted">
                  Strategy 01 · swing
                </Eyebrow>
              </CardHeader>
              <CardContent className="flex items-end justify-between">
                <PnLNumber value={3.42} format="percent" />
                <Sparkline data={SPARK_UP} tone="profit" width={120} />
              </CardContent>
            </Card>
            <Card leftAccent="loss">
              <CardHeader>
                <CardTitle>Claude Alpha</CardTitle>
                <Eyebrow as="div" className="text-fg-muted">
                  Strategy 06 · AI opp.
                </Eyebrow>
              </CardHeader>
              <CardContent className="flex items-end justify-between">
                <PnLNumber value={-1.18} format="percent" />
                <Sparkline data={SPARK_DOWN} tone="loss" width={120} />
              </CardContent>
            </Card>
            <Card leftAccent="brand" hoverable>
              <CardHeader>
                <CardTitle>Hoverable card</CardTitle>
                <Eyebrow as="div" className="text-fg-muted">
                  Hover me · lifts 1px
                </Eyebrow>
              </CardHeader>
              <CardContent>
                <Mono size="body">Try hovering — the accent widens and the card lifts.</Mono>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ─── §07 TABLE ─── */}
        <section className="mb-16">
          <SectionRule tag="§ 07 · Table · open positions" />
          <div className="mt-6 rounded-md border border-border bg-bg-card p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>P&amp;L</TableHead>
                  <TableHead>Strategy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TABLE_ROWS.map((r) => (
                  <TableRow key={r.sym}>
                    <TableCell className="text-ink-1000 font-sans font-medium">
                      {r.sym}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          r.side === "Long"
                            ? "text-up-500 uppercase tracking-[0.14em] text-[12px] font-sans font-semibold"
                            : "text-down-500 uppercase tracking-[0.14em] text-[12px] font-sans font-semibold"
                        }
                      >
                        {r.side}
                      </span>
                    </TableCell>
                    <TableCell>{r.qty}</TableCell>
                    <TableCell>{r.entry.toFixed(2)}</TableCell>
                    <TableCell>
                      <PnLNumber value={r.pnl} format="currency" />
                    </TableCell>
                    <TableCell className="font-display italic text-fg-dim">
                      {r.strat}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* ─── §08 SPARKLINE ─── */}
        <section className="mb-16">
          <SectionRule tag="§ 08 · Sparkline" />
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-md border border-border-hair p-4">
              <Eyebrow as="div" className="mb-2">
                profit
              </Eyebrow>
              <Sparkline data={SPARK_UP} tone="profit" />
            </div>
            <div className="rounded-md border border-border-hair p-4">
              <Eyebrow as="div" className="mb-2">
                loss
              </Eyebrow>
              <Sparkline data={SPARK_DOWN} tone="loss" />
            </div>
            <div className="rounded-md border border-border-hair p-4">
              <Eyebrow as="div" className="mb-2">
                brand
              </Eyebrow>
              <Sparkline data={SPARK_BRAND} tone="brand" />
            </div>
          </div>
        </section>

        {/* ─── §09 STATUSDOT / PNLNUMBER ─── */}
        <section className="mb-16">
          <SectionRule tag="§ 09 · StatusDot &amp; PnLNumber" />
          <div className="mt-6 space-y-4">
            <div className="rounded-md border border-border-hair p-4">
              <Eyebrow as="div" className="mb-4">
                StatusDot tones
              </Eyebrow>
              <div className="flex flex-wrap items-center gap-5">
                {(
                  ["profit", "loss", "ice", "amber", "wine", "brand", "muted"] as const
                ).map((t) => (
                  <span key={t} className="flex items-center gap-2">
                    <StatusDot tone={t} />
                    <Mono size="hint">{t}</Mono>
                  </span>
                ))}
                <span className="flex items-center gap-2">
                  <StatusDot tone="loss" pulse />
                  <Mono size="hint">loss · pulse</Mono>
                </span>
              </div>
            </div>
            <div className="rounded-md border border-border-hair p-4">
              <Eyebrow as="div" className="mb-4">
                PnLNumber formats
              </Eyebrow>
              <div className="flex flex-wrap items-center gap-6">
                <PnLNumber value={1602} format="currency" />
                <PnLNumber value={-258} format="currency" />
                <PnLNumber value={1.82} format="percent" />
                <PnLNumber value={-1.1} format="percent" />
                <PnLNumber value={24.38} format="bps" />
                <PnLNumber value={28400000} format="currency" abbreviate />
                <PnLNumber value={0} format="currency" />
              </div>
            </div>
          </div>
        </section>

        {/* ─── §10 COMPOSITES ─── */}
        <section className="mb-16">
          <SectionRule tag="§ 10 · Composites" />

          <div className="mt-6 space-y-10">
            {/* TopBar */}
            <div>
              <Eyebrow as="div" className="mb-3">TopBar</Eyebrow>
              <div className="rounded-md overflow-hidden border border-border">
                <TopBar
                  currentRoute="/desk"
                  routes={[
                    { label: "Overview", href: "/" },
                    { label: "Desk", href: "/desk", active: true },
                    { label: "Strategies", href: "/strategies" },
                    { label: "Research", href: "/research" },
                    { label: "Journal", href: "/journal" },
                  ]}
                  regime={{ regime: "bull", vol: "low" }}
                  clockEt="14:32:08 ET · Tue Nov 4"
                  avatarInitial="α"
                />
              </div>
            </div>

            {/* ContextBar */}
            <div>
              <Eyebrow as="div" className="mb-3">ContextBar</Eyebrow>
              <div className="rounded-md overflow-hidden border border-border">
                <ContextBar cells={CTX_CELLS} />
              </div>
            </div>

            {/* StrategyRail */}
            <div>
              <Eyebrow as="div" className="mb-3">StrategyRail</Eyebrow>
              <div className="grid grid-cols-[260px_1fr] gap-px bg-border rounded-md overflow-hidden border border-border">
                <div className="bg-bg">
                  <StrategyRail items={RAIL_ITEMS} selectedId="mq" />
                </div>
                <div className="bg-bg px-6 py-8 text-fg-muted">
                  <Mono size="micro">center pane placeholder</Mono>
                </div>
              </div>
            </div>

            {/* PriceChartPanel */}
            <div>
              <Eyebrow as="div" className="mb-3">PriceChartPanel</Eyebrow>
              <div className="rounded-md overflow-hidden border border-border bg-bg min-h-[520px]">
                <PriceChartPanel
                  symbol={{ ticker: "NVDA", name: "Nvidia", venue: "Nasdaq · Semis" }}
                  quote={{ last: 134.82, change: 1.74, changePct: 1.31 }}
                  meta={{
                    volume: "28.4M",
                    avgVolume: "42.1M",
                    range: "132.10 — 135.44",
                    iv: "41.2%",
                    regimeFit: 0.82,
                  }}
                  series={SERIES}
                  activeRange="1M"
                  onRangeChange={() => { /* preview */ }}
                />
              </div>
            </div>

            {/* OrderBar */}
            <div>
              <Eyebrow as="div" className="mb-3">OrderBar</Eyebrow>
              <div className="rounded-md overflow-hidden border border-border">
                <OrderBar
                  symbol="NVDA"
                  strategies={[
                    { id: "mq", label: "Momentum & Quality" },
                    { id: "ra", label: "Regime Adaptive" },
                  ]}
                  defaults={{
                    strategyId: "mq",
                    side: "buy",
                    quantity: 250,
                    type: "limit",
                    price: 134.8,
                    stop: "−4.0%",
                  }}
                  onSubmit={(o) => console.log("staged", o)}
                />
              </div>
            </div>

            {/* PositionsList */}
            <div>
              <Eyebrow as="div" className="mb-3">PositionsList</Eyebrow>
              <div className="rounded-md overflow-hidden border border-border bg-bg max-w-[340px]">
                <PositionsList positions={POSITIONS} activeTab="positions" />
              </div>
            </div>

            {/* AIMemoPanel */}
            <div>
              <Eyebrow as="div" className="mb-3">AIMemoPanel</Eyebrow>
              <div className="rounded-md overflow-hidden border border-border max-w-[340px]">
                <AIMemoPanel memo={MEMO} />
              </div>
            </div>

            {/* StatusBar */}
            <div>
              <Eyebrow as="div" className="mb-3">StatusBar</Eyebrow>
              <div className="rounded-md overflow-hidden border border-border">
                <StatusBar pills={STATUS_PILLS} buildVersion="2.4.1-edge" />
              </div>
            </div>

            {/* TickerStrip */}
            <div>
              <Eyebrow as="div" className="mb-3">
                TickerStrip (paused — WCAG default)
              </Eyebrow>
              <div className="rounded-md overflow-hidden border border-border">
                <TickerStrip tickers={TICKERS} />
              </div>
            </div>

            {/* StrategyCard */}
            <div>
              <Eyebrow as="div" className="mb-3">StrategyCard</Eyebrow>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <StrategyCard
                  name="Momentum & Quality"
                  subtitle="Strategy 01 · swing"
                  returnPct={3.42}
                  isLoss={false}
                  positions={4}
                  winRatePct={62}
                  invested="$18.2K"
                  sparkline={SPARK_UP.slice().reverse()}
                  href="#strategy/momentum-quality"
                />
                <StrategyCard
                  name="Claude Alpha"
                  subtitle="Strategy 06 · AI opp."
                  returnPct={-1.18}
                  isLoss
                  positions={2}
                  winRatePct={48}
                  invested="$6.4K"
                  sparkline={SPARK_DOWN}
                  href="#strategy/claude-alpha"
                />
              </div>
            </div>

            {/* EditorialNameplate */}
            <div>
              <Eyebrow as="div" className="mb-3">EditorialNameplate</Eyebrow>
              <div className="rounded-md border border-border p-4 bg-bg-card">
                <EditorialNameplate
                  volume="III"
                  issue="04"
                  title="Quiet money, loud math"
                  date="Apr 17, 2026"
                />
              </div>
            </div>

            {/* ClaudeStamp */}
            <div>
              <Eyebrow as="div" className="mb-3">ClaudeStamp</Eyebrow>
              <div className="rounded-md border border-border p-4 bg-bg-card flex flex-col gap-3">
                <ClaudeStamp
                  model="Haiku 4.5"
                  confidence={0.72}
                  latencyMs={180}
                  approvedAt="14:28 ET"
                  approved
                />
                <ClaudeStamp model="Haiku 4.5" confidence={0.64} latencyMs={142} />
                <ClaudeStamp model="Haiku 4.5" />
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t border-border-hair pt-6">
          <Mono size="micro">alphadesk · design · F2 · tradingalpha.net</Mono>
        </footer>
      </div>
    </main>
  );
}
