"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import PnLNumber from "@/components/primitives/PnLNumber";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { useMarketStore, useQuote } from "@/stores/market";
import { getBars } from "@/lib/api";

/**
 * Watchlist (composite)
 * ─────────────────────
 * Top panel of the right-rail in the dashboard-redesign. A dense 12-row max
 * list of watched symbols with per-row last price, day change %, and a
 * 20-close sparkline. Clicking a row sets `selectedSymbol` on the market
 * store; the currently selected symbol gets a 2px gold accent strip on the
 * left and a subtle bg-elev-1 tint.
 *
 * Data wiring
 * ───────────
 * • Quotes come from the live `useQuote(symbol)` per-row selector — the
 *   selector is scoped to one symbol so a single tick doesn't rerender the
 *   whole list.
 * • Sparklines are fetched lazily once per symbol on mount via
 *   `Promise.allSettled` over `getBars(symbol, "D", 20)` so one slow symbol
 *   can't block the rest. Failures are ignored silently and the row simply
 *   renders without a spark — the em-dash quote placeholders cover the
 *   empty-quote case separately.
 *
 * TODO(watchlist-prefs): the `DEFAULT_SYMBOLS` array below should become
 * user-configurable — read from `useMarketStore().watchlist` or a new
 * preferences slice — in a follow-up. The v2 "+" header button is a
 * placeholder until that add-symbol flow ships.
 */

// Hard-coded for v1 — see TODO above.
const DEFAULT_SYMBOLS = [
  "SPY",
  "QQQ",
  "AAPL",
  "NVDA",
  "TSLA",
  "MSFT",
  "META",
  "AMZN",
  "GOOGL",
  "AMD",
] as const;

// Hard cap on rows — the design tops out at 12.
const MAX_SYMBOLS = 12;

export interface WatchlistProps {
  /** Optional override of the initial symbol set — the dashboard page
   *  passes nothing today and gets the 10-symbol default. */
  symbols?: readonly string[];
  className?: string;
}

export function Watchlist({ symbols, className }: WatchlistProps) {
  // Clamp to the hard cap so callers can't push past 12 accidentally.
  const list = React.useMemo(() => {
    const source = symbols && symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;
    return source.slice(0, MAX_SYMBOLS);
  }, [symbols]);

  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);

  // Sparkline closes per symbol. We fetch each row's bars once on first
  // render of the list and keep them in a single map — a row-level effect
  // would re-fire whenever React re-keyed the row, and with 10 rows that
  // would pile up on re-mounts of the dashboard.
  const [sparkData, setSparkData] = React.useState<Record<string, number[]>>({});

  // Guard against double-fetch under React 19's strict-mode remount in dev.
  // A ref is cheap and survives StrictMode's intentional second mount.
  const fetchedRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const newSymbols = list.filter((s) => !fetchedRef.current.has(s));
    if (newSymbols.length === 0) return;
    for (const s of newSymbols) fetchedRef.current.add(s);

    let cancelled = false;
    // Promise.allSettled so one slow symbol doesn't block the rest.
    Promise.allSettled(
      newSymbols.map((sym) =>
        getBars(sym, "D", 20).then((bars) => ({
          symbol: sym,
          closes: bars.map((b) => b.close),
        })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, number[]> = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.closes.length >= 2) {
          next[r.value.symbol] = r.value.closes;
        }
      }
      if (Object.keys(next).length > 0) {
        setSparkData((prev) => ({ ...prev, ...next }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [list]);

  return (
    <div
      data-slot="watchlist"
      className={cn(
        "flex flex-col border border-border-hair rounded-md bg-bg-elev-1/40",
        className,
      )}
    >
      <header className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border-hair">
        <span className="t-display-section">Watchlist</span>
        <button
          type="button"
          aria-label="Add symbol"
          title="Add symbol"
          // Placeholder — real add-symbol flow ships in v2. Deliberately a
          // no-op so QA can see the affordance exists without wiring.
          onClick={() => {
            /* v2 */
          }}
          className={cn(
            "inline-flex items-center justify-center h-7 w-7 rounded-sm",
            "text-fg-muted hover:text-ink-1000 hover:bg-bg-elev-2 transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
          )}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </header>

      <ul className="flex flex-col" role="list">
        {list.map((symbol) => (
          <WatchlistRow
            key={symbol}
            symbol={symbol}
            selected={symbol === selectedSymbol}
            onSelect={setSelectedSymbol}
            sparkCloses={sparkData[symbol]}
          />
        ))}
      </ul>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────

interface WatchlistRowProps {
  symbol: string;
  selected: boolean;
  onSelect: (symbol: string) => void;
  sparkCloses: number[] | undefined;
}

function WatchlistRow({
  symbol,
  selected,
  onSelect,
  sparkCloses,
}: WatchlistRowProps) {
  // Per-row subscription — a tick on SPY doesn't rerender the AAPL row.
  // Hooks rule: all hooks declared UNCONDITIONALLY before any early return
  // (Wave-3 regression cause).
  const quote = useQuote(symbol);

  const hasQuote = quote != null && Number.isFinite(quote.last);
  const pct = quote?.changePct;
  const hasPct = typeof pct === "number" && Number.isFinite(pct);
  const tone: "profit" | "loss" | undefined = hasPct
    ? pct! > 0
      ? "profit"
      : pct! < 0
        ? "loss"
        : undefined
    : undefined;
  // dashboard/Sparkline takes a `color` CSS string, not a tone enum — map here.
  const sparkColor =
    tone === "profit"
      ? "var(--profit)"
      : tone === "loss"
        ? "var(--loss)"
        : "var(--fg-muted)";

  return (
    <li className="border-b border-border-hair last:border-b-0">
      <button
        type="button"
        onClick={() => onSelect(symbol)}
        data-selected={selected || undefined}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "relative w-full h-12 px-4 flex items-center gap-3",
          "text-left transition-colors",
          "hover:bg-bg-elev-1",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand focus-visible:ring-inset",
          selected && "bg-bg-elev-1",
        )}
      >
        {/* Gold accent strip for the selected row. */}
        {selected && (
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-[2px] bg-brand"
          />
        )}

        {/* Symbol — fixed width so prices line up in a column. */}
        <span
          className="font-sans font-semibold text-[15px] text-ink-1000 shrink-0 w-[52px]"
          style={{ letterSpacing: 0 }}
        >
          {symbol}
        </span>

        {/* Last price. */}
        <span
          className={cn(
            "t-num-md text-ink-900 shrink-0 w-[78px] text-right tabular-nums",
            !hasQuote && "text-fg-muted",
          )}
        >
          {hasQuote ? quote!.last.toFixed(2) : "—"}
        </span>

        {/* Day change %. */}
        <span className="shrink-0 w-[68px] text-right tabular-nums">
          {hasPct ? (
            <PnLNumber
              value={pct!}
              format="percent"
              tone={tone}
              className="text-[14px]"
            />
          ) : (
            <span className="font-mono text-[14px] text-fg-muted">—</span>
          )}
        </span>

        {/* Sparkline fills the remaining space. */}
        <span
          data-slot="watchlist-spark"
          className="ml-auto flex items-center justify-end"
        >
          {sparkCloses && sparkCloses.length >= 2 ? (
            <Sparkline
              data={sparkCloses}
              color={sparkColor}
              width={80}
              height={22}
            />
          ) : (
            // Reserve the same footprint so rows don't shift as bars arrive.
            <span aria-hidden className="inline-block w-[80px] h-[22px]" />
          )}
        </span>
      </button>
    </li>
  );
}

export default Watchlist;
