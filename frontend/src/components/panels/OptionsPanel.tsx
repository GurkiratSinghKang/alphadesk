"use client";

import { useState, useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useMarketStore } from "@/stores/market";
import { useOptionsStore } from "@/stores/options";
import { HelpCircle } from "@/components/ui/HelpCircle";
import { cn, formatNumber, formatGreek } from "@/lib/utils";
import { useOptionsChain, useIVData } from "@/hooks/useQueries";

// ─── Generate demo options chain ─────────────────────────────

interface ChainRow {
  strike: number;
  call: {
    last: number;
    bid: number;
    ask: number;
    vol: number;
    oi: number;
    iv: number;
    delta: number;
  };
  put: {
    last: number;
    bid: number;
    ask: number;
    vol: number;
    oi: number;
    iv: number;
    delta: number;
  };
}

function generateChain(spotPrice: number, _expiry: string): ChainRow[] {
  const strikes: ChainRow[] = [];
  const baseStrike = Math.round(spotPrice / 5) * 5;

  // Use expiry as seed to generate different data per expiry
  let seed = 0;
  for (let c = 0; c < _expiry.length; c++) seed += _expiry.charCodeAt(c);
  const rng = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = -8; i <= 8; i++) {
    const strike = baseStrike + i * 5;
    const moneyness = (spotPrice - strike) / spotPrice;

    const callITM = strike < spotPrice;
    const callIntrinsic = callITM ? spotPrice - strike : 0;
    const callIV = 0.22 + Math.abs(moneyness) * 0.3 + rng() * 0.05;
    const callTimeValue = spotPrice * callIV * 0.08 * Math.exp(-Math.abs(moneyness) * 3);
    const callPrice = callIntrinsic + callTimeValue;
    const callDelta = callITM ? 0.5 + moneyness * 2.5 : Math.max(0.02, 0.5 + moneyness * 2.5);

    const putITM = strike > spotPrice;
    const putIntrinsic = putITM ? strike - spotPrice : 0;
    const putIV = 0.23 + Math.abs(moneyness) * 0.3 + rng() * 0.05;
    const putTimeValue = spotPrice * putIV * 0.08 * Math.exp(-Math.abs(moneyness) * 3);
    const putPrice = putIntrinsic + putTimeValue;
    const putDelta = -(1 - Math.min(0.98, Math.max(0.02, callDelta)));

    const spread = Math.max(0.01, callPrice * 0.03);

    strikes.push({
      strike,
      call: {
        last: Math.max(0.01, callPrice),
        bid: Math.max(0.01, callPrice - spread),
        ask: callPrice + spread,
        vol: Math.floor(100 + rng() * 5000),
        oi: Math.floor(500 + rng() * 20000),
        iv: callIV * 100,
        delta: Math.min(0.99, Math.max(0.01, callDelta)),
      },
      put: {
        last: Math.max(0.01, putPrice),
        bid: Math.max(0.01, putPrice - spread),
        ask: putPrice + spread,
        vol: Math.floor(80 + rng() * 4000),
        oi: Math.floor(400 + rng() * 15000),
        iv: putIV * 100,
        delta: Math.max(-0.99, Math.min(-0.01, putDelta)),
      },
    });
  }

  return strikes;
}

// ─── Expiration dates ────────────────────────────────────────

function generateExpirations(): string[] {
  const dates: string[] = [];
  const now = new Date();
  // Market close is 16:00 ET — after that, today's expiry is no longer valid
  const marketCloseToday = new Date();
  marketCloseToday.setHours(16, 0, 0, 0);
  const pastMarketClose = now > marketCloseToday;

  for (let w = 0; w < 12; w++) {
    const d = new Date(now);
    // Calculate days until next Friday (day 5). If today is Sat/Sun, skip to next week's Friday.
    let daysUntilFriday = (5 - d.getDay() + 7) % 7;
    if (daysUntilFriday === 0 && w === 0) {
      // Today is Friday — include today only if before market close
      daysUntilFriday = 0;
    }
    d.setDate(d.getDate() + daysUntilFriday + w * 7);
    // Skip dates in the past, and skip today if past market close
    const isToday = d.toDateString() === now.toDateString();
    if (isToday && pastMarketClose) continue;
    if (d >= now || isToday) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

// ─── Cell Component (BUG #21: onClick support) ──────────────

function Cell({
  value,
  className,
  format = "price",
  onClick,
  displayDash = false,
}: {
  value: number;
  className?: string;
  format?: "price" | "number" | "pct" | "greek";
  onClick?: () => void;
  displayDash?: boolean;
}) {
  if (displayDash || value == null || !isFinite(value)) {
    return (
      <td className={cn("px-1.5 py-1 text-right tabular-nums text-muted-foreground/40", className)}>
        {"\u2014"}
      </td>
    );
  }
  if (value == null || !isFinite(value)) {
    return <td className={cn("px-1.5 py-1 text-right tabular-nums text-muted-foreground/40", className)}>{"\u2014"}</td>;
  }
  let formatted: string;
  switch (format) {
    case "price":
      formatted = (value ?? 0).toFixed(2);
      break;
    case "number":
      formatted = formatNumber(value, true);
      break;
    case "pct":
      formatted = `${(value ?? 0).toFixed(1)}%`;
      break;
    case "greek":
      formatted = formatGreek(value, 2);
      break;
    default:
      formatted = String(value);
  }

  return (
    <td
      className={cn("px-1.5 py-1 text-right tabular-nums", className)}
      onClick={onClick}
    >
      {formatted}
    </td>
  );
}

// ─── Main Panel ──────────────────────────────────────────────

export function OptionsPanel() {
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const quotes = useMarketStore((s) => s.quotes);
  const { selectedStrikes, toggleStrike } = useOptionsStore();
  const today = new Date().toDateString();
  const expirations = useMemo(generateExpirations, [today]);
  const [selectedExpiry, setSelectedExpiry] = useState(expirations[2] ?? "");

  // Reset selectedExpiry when expirations regenerate (e.g. after midnight)
  useEffect(() => {
    setSelectedExpiry(expirations[2] ?? expirations[0] ?? "");
  }, [expirations]);

  // Track selected call/put keys locally for highlighting
  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const s of selectedStrikes) {
      keys.add(`${s.type}-${s.strike}`);
    }
    return keys;
  }, [selectedStrikes]);

  // BUG #28/#33: Derive spotPrice from market store with fallback
  const quoteData = quotes[selectedSymbol];
  const spotPrice =
    quoteData?.last ??
    (selectedSymbol === "SPY" ? 590 : selectedSymbol === "AAPL" ? 230 : 175);

  // Fetch real options chain via React Query, fall back to generated
  const { data: chainData, isLoading: chainLoading } = useOptionsChain(selectedSymbol, selectedExpiry);

  const apiChain = useMemo(() => {
    const data = chainData;
    if (!data?.calls?.length && !data?.puts?.length) return null;
    const strikeMap = new Map<number, Partial<ChainRow>>();
    for (const c of (data.calls ?? [])) {
      const existing = strikeMap.get(c.strike) ?? { strike: c.strike };
      // Backend returns IV as a decimal (e.g. 0.25 = 25%), convert to percentage for display
      existing.call = {
        last: c.last, bid: c.bid, ask: c.ask,
        vol: c.volume, oi: c.oi, iv: c.iv * 100, delta: c.delta,
      };
      strikeMap.set(c.strike, existing);
    }
    for (const p of (data.puts ?? [])) {
      const existing = strikeMap.get(p.strike) ?? { strike: p.strike };
      // Backend returns IV as a decimal (e.g. 0.25 = 25%), convert to percentage for display
      existing.put = {
        last: p.last, bid: p.bid, ask: p.ask,
        vol: p.volume, oi: p.oi, iv: p.iv * 100, delta: p.delta,
      };
      strikeMap.set(p.strike, existing);
    }
    const rows: ChainRow[] = Array.from(strikeMap.values())
      .filter((r): r is ChainRow => !!(r.call && r.put && r.strike !== undefined))
      .sort((a, b) => a.strike - b.strike);
    return rows.length ? rows : null;
  }, [chainData]);

  // BUG #23: chain depends on selectedExpiry
  const generatedChain = useMemo(
    () => generateChain(spotPrice, selectedExpiry),
    [spotPrice, selectedExpiry]
  );
  const chain = apiChain ?? generatedChain;
  const usingGeneratedChain = apiChain === null && !chainLoading;

  // Fetch IV data via React Query with fallback
  const { data: rawIvData } = useIVData(selectedSymbol);
  const ivRank = rawIvData?.ivRank ?? null;
  const ivPctl = rawIvData?.ivPctl ?? null;
  const currentIV = rawIvData?.currentIV ?? null;

  // Compute expected move from IV if available; derive DTE from selected expiry
  const expectedMove = useMemo(() => {
    if (currentIV == null || !selectedExpiry) return null;
    const expiryDate = new Date(selectedExpiry + "T00:00:00");
    const dte = Math.max(1, Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    return currentIV * spotPrice * Math.sqrt(dte / 365);
  }, [currentIV, spotPrice, selectedExpiry]);

  // BUG #21: Handle call cell click
  const handleCallClick = (row: ChainRow) => {
    toggleStrike({
      strike: row.strike,
      type: "call",
      expiry: selectedExpiry,
      price: row.call.last,
      delta: row.call.delta,
    });
  };

  // BUG #21: Handle put cell click
  const handlePutClick = (row: ChainRow) => {
    toggleStrike({
      strike: row.strike,
      type: "put",
      expiry: selectedExpiry,
      price: row.put.last,
      delta: Math.abs(row.put.delta),
    });
  };

  const colHeaders = ["Last", "Bid", "Ask", "Vol", "OI", "IV", "\u0394"];

  return (
    <div data-slot="options-panel" className="flex h-full flex-col bg-[var(--panel)] border-t border-border">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0 bg-[#14141e]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-foreground">
            {selectedSymbol} Options
          </span>
          <HelpCircle text="Full options chain for the selected symbol. Click calls/puts to add legs to your trade builder." />
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0.5 border-primary/50 text-primary font-semibold bg-primary/10"
          >
            IV Rank: {ivRank != null ? ivRank : "\u2014"}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0.5 border-muted-foreground/40 text-foreground font-medium bg-muted-foreground/10"
          >
            IV Pctl: {ivPctl != null ? ivPctl : "\u2014"}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            Expected Move: {expectedMove != null ? `\u00B1$${(expectedMove ?? 0).toFixed(2)}` : "\u2014"}
          </span>
        </div>
      </div>

      {/* Expiration selector */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2 scrollbar-thin shrink-0 bg-[#14141e]">
        {expirations.map((exp) => {
          const d = new Date(exp + "T00:00:00");
          const label = d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
          const dte = Math.ceil(
            (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );
          return (
            <button
              key={exp}
              onClick={() => setSelectedExpiry(exp)}
              className={cn(
                "rounded px-3 py-1 text-xs whitespace-nowrap transition-colors",
                exp === selectedExpiry
                  ? "bg-primary/20 text-primary font-semibold border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border border-transparent"
              )}
            >
              {label}{" "}
              <span className="text-muted-foreground">({dte}d)</span>
            </button>
          );
        })}
      </div>

      {/* Chain table */}
      {chainLoading && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground shrink-0">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching options chain...
        </div>
      )}
      <ScrollArea className={cn("flex-1 overflow-auto", usingGeneratedChain && "opacity-40")}>
        <table className="w-full text-[11px] min-w-[700px]" aria-label="Options chain">
          <thead className="sticky top-0 z-10 bg-[#14141e]">
            <tr className="border-b border-border">
              {colHeaders.map((h) => (
                <th
                  scope="col"
                  key={`c-${h}`}
                  className="px-1.5 py-1 text-right font-medium text-[var(--profit)]/70 whitespace-nowrap"
                >
                  <span className="sr-only">Call </span>{h}
                </th>
              ))}
              <th scope="col" className="px-2 py-1 text-center font-bold text-foreground bg-background/30 border-x border-border">
                Strike
              </th>
              {colHeaders.map((h) => (
                <th
                  scope="col"
                  key={`p-${h}`}
                  className="px-1.5 py-1 text-right font-medium text-[var(--loss)]/70 whitespace-nowrap"
                >
                  <span className="sr-only">Put </span>{h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chain.map((row) => {
              const callITM = row.strike < spotPrice;
              const putITM = row.strike > spotPrice;
              const closestStrike = chain.reduce((best, r) =>
                Math.abs(r.strike - spotPrice) < Math.abs(best.strike - spotPrice) ? r : best
              );
              const atm = row.strike === closestStrike.strike;
              // Deep OTM strikes (>15% from spot) have meaningless generated prices
              const pctFromSpot = Math.abs(row.strike - spotPrice) / spotPrice;
              const callDeepOTM = !callITM && pctFromSpot > 0.15 && usingGeneratedChain;
              const putDeepOTM = !putITM && pctFromSpot > 0.15 && usingGeneratedChain;
              const callKey = `call-${row.strike}`;
              const putKey = `put-${row.strike}`;
              const callSelected = selectedKeys.has(callKey);
              const putSelected = selectedKeys.has(putKey);

              return (
                <tr
                  key={row.strike}
                  aria-current={atm ? "true" : undefined}
                  className={cn(
                    "border-b border-border/50 hover:bg-accent/30 transition-colors",
                    atm && "bg-primary/15"
                  )}
                >
                  {/* Calls — BUG #21: last cell clickable */}
                  <Cell
                    value={row.call.last}
                    displayDash={callDeepOTM}
                    className={cn(
                      "cursor-pointer",
                      callITM && "bg-[var(--profit)]/5",
                      callSelected && "bg-primary/20 text-primary"
                    )}
                    onClick={callDeepOTM ? undefined : () => handleCallClick(row)}
                  />
                  <Cell
                    value={row.call.bid}
                    displayDash={callDeepOTM}
                    className={callITM ? "bg-[var(--profit)]/5" : ""}
                  />
                  <Cell
                    value={row.call.ask}
                    displayDash={callDeepOTM}
                    className={callITM ? "bg-[var(--profit)]/5" : ""}
                  />
                  <Cell
                    value={row.call.vol}
                    format="number"
                    className={callITM ? "bg-[var(--profit)]/5" : ""}
                  />
                  <Cell
                    value={row.call.oi}
                    format="number"
                    className={callITM ? "bg-[var(--profit)]/5" : ""}
                  />
                  <Cell
                    value={row.call.iv}
                    format="pct"
                    displayDash={callDeepOTM}
                    className={callITM ? "bg-[var(--profit)]/5" : ""}
                  />
                  <Cell
                    value={row.call.delta}
                    format="greek"
                    displayDash={callDeepOTM}
                    className={callITM ? "bg-[var(--profit)]/5" : ""}
                  />

                  {/* Strike — BUG #22/#24: no dual-toggle, just display */}
                  <td
                    className={cn(
                      "px-2 py-1 text-center font-bold tabular-nums border-x border-border bg-background/30",
                      atm ? "text-primary" : "text-foreground"
                    )}
                  >
                    {(row.strike ?? 0).toFixed(0)}
                  </td>

                  {/* Puts — BUG #21: last cell clickable */}
                  <Cell
                    value={row.put.last}
                    displayDash={putDeepOTM}
                    className={cn(
                      "cursor-pointer",
                      putITM && "bg-[var(--loss)]/5",
                      putSelected && "bg-primary/20 text-primary",
                      !putSelected && row.put.last <= 0.01 && "text-muted-foreground/50"
                    )}
                    onClick={putDeepOTM ? undefined : () => handlePutClick(row)}
                  />
                  <Cell
                    value={row.put.bid}
                    displayDash={putDeepOTM}
                    className={cn(
                      putITM ? "bg-[var(--loss)]/5" : "",
                      row.put.bid <= 0.01 && "text-muted-foreground/50"
                    )}
                  />
                  <Cell
                    value={row.put.ask}
                    displayDash={putDeepOTM}
                    className={cn(
                      putITM ? "bg-[var(--loss)]/5" : "",
                      row.put.ask <= 0.01 && "text-muted-foreground/50"
                    )}
                  />
                  <Cell
                    value={row.put.vol}
                    format="number"
                    className={putITM ? "bg-[var(--loss)]/5" : ""}
                  />
                  <Cell
                    value={row.put.oi}
                    format="number"
                    className={putITM ? "bg-[var(--loss)]/5" : ""}
                  />
                  <Cell
                    value={row.put.iv}
                    format="pct"
                    displayDash={putDeepOTM}
                    className={putITM ? "bg-[var(--loss)]/5" : ""}
                  />
                  <Cell
                    value={row.put.delta}
                    format="greek"
                    displayDash={putDeepOTM}
                    className={putITM ? "bg-[var(--loss)]/5" : ""}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
