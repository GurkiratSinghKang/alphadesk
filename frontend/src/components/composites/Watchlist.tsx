"use client";

import * as React from "react";
import { Check, Plus, X } from "lucide-react";

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
 * The default symbol set comes from the persisted market store. The header
 * plus button opens an inline add-symbol form and writes back to that store,
 * so dashboard watchlist changes survive reloads and sync across tabs.
 */

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
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 10);
}

function normalizeList(symbols: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const sym = normalizeSymbol(raw);
    if (!SYMBOL_RE.test(sym) || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

export interface WatchlistProps {
  /** Optional override of the initial symbol set — the dashboard page
   *  passes nothing today and gets the 10-symbol default. */
  symbols?: readonly string[];
  className?: string;
}

export function Watchlist({ symbols, className }: WatchlistProps) {
  const storeWatchlist = useMarketStore((s) => s.watchlist);
  const addToWatchlist = useMarketStore((s) => s.addToWatchlist);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
  const [isAdding, setIsAdding] = React.useState(false);
  const [draftSymbol, setDraftSymbol] = React.useState("");

  // Clamp to the hard cap so callers and persisted state can't push past 12.
  const list = React.useMemo(() => {
    const source = symbols && symbols.length > 0
      ? symbols
      : storeWatchlist.length > 0
        ? storeWatchlist
        : DEFAULT_SYMBOLS;
    return normalizeList(source);
  }, [storeWatchlist, symbols]);

  const usesExternalSymbols = symbols != null;
  const draft = normalizeSymbol(draftSymbol);
  const addDisabled =
    usesExternalSymbols || list.length >= MAX_SYMBOLS || !SYMBOL_RE.test(draft) || list.includes(draft);

  function submitDraft(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (addDisabled) return;
    addToWatchlist(draft);
    setSelectedSymbol(draft);
    setDraftSymbol("");
    setIsAdding(false);
  }

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
        <span className="t-section-display">Watchlist</span>
        <button
          type="button"
          aria-label={isAdding ? "Cancel add symbol" : "Add symbol"}
          title={usesExternalSymbols ? "Read-only symbol set" : isAdding ? "Cancel" : "Add symbol"}
          disabled={usesExternalSymbols || (!isAdding && list.length >= MAX_SYMBOLS)}
          onClick={() => {
            setIsAdding((v) => !v);
            setDraftSymbol("");
          }}
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-sm md:h-8 md:w-8",
            "text-fg-muted hover:text-ink-1000 hover:bg-bg-elev-2 transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
            (usesExternalSymbols || (!isAdding && list.length >= MAX_SYMBOLS))
              && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-fg-muted",
          )}
        >
          {isAdding ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </header>

      {isAdding ? (
        <form
          className="flex items-center gap-1.5 border-b border-border-hair px-3 py-2"
          onSubmit={submitDraft}
        >
          <input
            aria-label="Symbol"
            value={draftSymbol}
            maxLength={10}
            onChange={(e) => setDraftSymbol(normalizeSymbol(e.target.value))}
            className={cn(
              "min-w-0 flex-1 rounded-sm border border-border bg-bg-card px-2 py-1.5",
              "font-mono text-label uppercase text-fg outline-none",
              "focus:border-primary focus:ring-1 focus:ring-brand"
            )}
            placeholder="SYMBOL"
          />
          <button
            type="submit"
            aria-label="Save symbol"
            disabled={addDisabled}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border",
              "text-primary transition-colors hover:bg-bg-elev-2",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
              addDisabled && "opacity-50 cursor-not-allowed hover:bg-transparent"
            )}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </form>
      ) : null}

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
            className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary"
          />
        )}

        {/* Symbol — fixed width so prices line up in a column. */}
        <span
          className="font-sans font-semibold text-body text-ink-1000 shrink-0 w-[52px]"
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
              className="text-body"
            />
          ) : (
            <span className="font-mono text-body text-fg-muted">—</span>
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
