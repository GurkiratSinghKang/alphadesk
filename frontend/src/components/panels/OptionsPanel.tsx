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

// ─── Options chain row shape ────────────────────────────────

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
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
  };
  put: {
    last: number;
    bid: number;
    ask: number;
    vol: number;
    oi: number;
    iv: number;
    delta: number;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
  };
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

  // Spot price from the market store — when the quote hasn't arrived yet we
  // render an honest empty state rather than substituting a ticker-specific
  // placeholder (was: `SPY === 590, AAPL === 230, fallback 175`).
  const quoteData = quotes[selectedSymbol];
  const spotPrice = quoteData?.last ?? null;

  // Fetch real options chain via React Query — no RNG fallback.
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
        gamma: typeof c.gamma === "number" ? c.gamma : null,
        theta: typeof c.theta === "number" ? c.theta : null,
        vega: typeof c.vega === "number" ? c.vega : null,
      };
      strikeMap.set(c.strike, existing);
    }
    for (const p of (data.puts ?? [])) {
      const existing = strikeMap.get(p.strike) ?? { strike: p.strike };
      // Backend returns IV as a decimal (e.g. 0.25 = 25%), convert to percentage for display
      existing.put = {
        last: p.last, bid: p.bid, ask: p.ask,
        vol: p.volume, oi: p.oi, iv: p.iv * 100, delta: p.delta,
        gamma: typeof p.gamma === "number" ? p.gamma : null,
        theta: typeof p.theta === "number" ? p.theta : null,
        vega: typeof p.vega === "number" ? p.vega : null,
      };
      strikeMap.set(p.strike, existing);
    }
    const rows: ChainRow[] = Array.from(strikeMap.values())
      .filter((r): r is ChainRow => !!(r.call && r.put && r.strike !== undefined))
      .sort((a, b) => a.strike - b.strike);
    return rows.length ? rows : null;
  }, [chainData]);

  const chain = apiChain;
  const chainEmpty = !chainLoading && (!apiChain || apiChain.length === 0);

  // HIGH-2: Auto-scroll to ATM strike when chain data changes
  useEffect(() => {
    const atm = document.querySelector('[aria-current="true"]');
    if (atm && typeof atm.scrollIntoView === 'function') atm.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [chain]);

  // Fetch IV data via React Query with fallback
  const { data: rawIvData } = useIVData(selectedSymbol);
  const ivRank = rawIvData?.ivRank ?? null;
  const ivPctl = rawIvData?.ivPctl ?? null;
  const currentIV = rawIvData?.currentIV ?? null;

  // Compute expected move from IV if available; derive DTE from selected expiry
  const expectedMove = useMemo(() => {
    if (currentIV == null || spotPrice == null || !selectedExpiry) return null;
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
      gamma: row.call.gamma ?? null,
      theta: row.call.theta ?? null,
      vega: row.call.vega ?? null,
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
      gamma: row.put.gamma ?? null,
      theta: row.put.theta ?? null,
      vega: row.put.vega ?? null,
    });
  };

  const colHeaders = ["Last", "Bid", "Ask", "Vol", "OI", "IV", "\u0394"];

  return (
    <div data-slot="options-panel" className="flex h-full flex-col bg-[var(--panel)] border-t border-border">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0 bg-bg-elev-2">
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
      <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2 scrollbar-thin shrink-0 bg-bg-elev-2">
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
          <Loader2 className="size-4 animate-spin" /> Fetching options chain...
        </div>
      )}
      {chainEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center">
          <p className="font-display italic text-[14px] text-muted-foreground">
            Options data not available for {selectedSymbol}.
          </p>
          <p className="font-sans text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/70">
            No invented quotes are shown.
          </p>
        </div>
      ) : chain == null ? null : (
        <ScrollArea className="flex-1 overflow-auto">
          <table className="w-full text-[11px] min-w-[700px]" aria-label="Options chain">
            <thead className="sticky top-0 z-10 bg-bg-elev-2">
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
                // Spot may be unavailable — fall back to the median strike for layout cues only.
                const spotRef = spotPrice ?? chain[Math.floor(chain.length / 2)].strike;
                const callITM = row.strike < spotRef;
                const putITM = row.strike > spotRef;
                const closestStrike = chain.reduce((best, r) =>
                  Math.abs(r.strike - spotRef) < Math.abs(best.strike - spotRef) ? r : best
                );
                const atm = row.strike === closestStrike.strike;
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
                    {/* Calls — last cell clickable */}
                    <Cell
                      value={row.call.last}
                      className={cn(
                        "cursor-pointer",
                        callITM && "bg-[var(--profit)]/5",
                        callSelected && "bg-primary/20 text-primary"
                      )}
                      onClick={() => handleCallClick(row)}
                    />
                    <Cell
                      value={row.call.bid}
                      className={callITM ? "bg-[var(--profit)]/5" : ""}
                    />
                    <Cell
                      value={row.call.ask}
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
                      className={callITM ? "bg-[var(--profit)]/5" : ""}
                    />
                    <Cell
                      value={row.call.delta}
                      format="greek"
                      className={callITM ? "bg-[var(--profit)]/5" : ""}
                    />

                    {/* Strike */}
                    <td
                      className={cn(
                        "px-2 py-1 text-center font-bold tabular-nums border-x border-border bg-background/30",
                        atm ? "text-primary" : "text-foreground"
                      )}
                    >
                      {(row.strike ?? 0).toFixed(0)}
                    </td>

                    {/* Puts — last cell clickable */}
                    <Cell
                      value={row.put.last}
                      className={cn(
                        "cursor-pointer",
                        putITM && "bg-[var(--loss)]/5",
                        putSelected && "bg-primary/20 text-primary",
                        !putSelected && row.put.last <= 0.01 && "text-muted-foreground/50"
                      )}
                      onClick={() => handlePutClick(row)}
                    />
                    <Cell
                      value={row.put.bid}
                      className={cn(
                        putITM ? "bg-[var(--loss)]/5" : "",
                        row.put.bid <= 0.01 && "text-muted-foreground/50"
                      )}
                    />
                    <Cell
                      value={row.put.ask}
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
                      className={putITM ? "bg-[var(--loss)]/5" : ""}
                    />
                    <Cell
                      value={row.put.delta}
                      format="greek"
                      className={putITM ? "bg-[var(--loss)]/5" : ""}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </div>
  );
}
