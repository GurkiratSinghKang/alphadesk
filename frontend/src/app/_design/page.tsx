/**
 * Design preview (dev-only).
 *
 * Route: /_design
 * Purpose: eyeball every token, type class, and Layer-1 primitive we ship.
 * NOT linked from navigation.
 */

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

export default function DesignPreviewPage() {
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
                            ? "text-up-500 uppercase tracking-[0.14em] text-[9.5px] font-sans font-semibold"
                            : "text-down-500 uppercase tracking-[0.14em] text-[9.5px] font-sans font-semibold"
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

        <footer className="border-t border-border-hair pt-6">
          <Mono size="micro">alphadesk · design · F1 · tradingalpha.net</Mono>
        </footer>
      </div>
    </main>
  );
}
