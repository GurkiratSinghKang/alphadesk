"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, MagnifyingGlass, X } from "@phosphor-icons/react";

import { getOptionsChain } from "@/lib/api";
import {
  calculatePayoffSummary,
  optionLegFromContract,
  type OptionOrderSide,
  type OptionStrategyDraft,
  type OptionStrategyLeg,
} from "@/lib/optionsPayoff";
import { cn, formatCurrency } from "@/lib/utils";
import type { OptionsChain, OptionsContract } from "@/types";
import OptionsPayoffPanel from "./OptionsPayoffPanel";

interface OptionsStrategyBuilderProps {
  open: boolean;
  underlying: string;
  onClose: () => void;
  onStage: (draft: OptionStrategyDraft) => void;
}

type Outlook = "all" | "bullish" | "bearish" | "neutral" | "volatility";

interface StrategyPreset {
  id: string;
  label: string;
  outlook: Exclude<Outlook, "all">;
  description: string;
}

const PRESETS: StrategyPreset[] = [
  { id: "long_call", label: "Long call", outlook: "bullish", description: "Directional upside with premium as max loss." },
  { id: "short_call", label: "Short call", outlook: "bearish", description: "Bearish premium sale with unlimited upside risk." },
  { id: "long_put", label: "Long put", outlook: "bearish", description: "Directional downside with premium as max loss." },
  { id: "short_put", label: "Short put", outlook: "bullish", description: "Bullish premium sale with stock-to-zero risk." },
  { id: "bull_call_spread", label: "Bull call spread", outlook: "bullish", description: "Defined-risk upside debit spread." },
  { id: "bear_put_spread", label: "Bear put spread", outlook: "bearish", description: "Defined-risk downside debit spread." },
  { id: "short_straddle", label: "Short straddle", outlook: "neutral", description: "Collect ATM premium; unlimited tail risk." },
  { id: "long_straddle", label: "Long straddle", outlook: "volatility", description: "Own the earnings move in either direction." },
  { id: "short_strangle", label: "Short strangle", outlook: "neutral", description: "Collect OTM premium with undefined tail risk." },
  { id: "long_strangle", label: "Long strangle", outlook: "volatility", description: "Own a large move with cheaper OTM options." },
  { id: "iron_condor", label: "Iron condor", outlook: "neutral", description: "Defined-risk range trade with wings." },
  { id: "iron_butterfly", label: "Iron butterfly", outlook: "neutral", description: "Defined-risk pin trade around ATM." },
];

const OUTLOOKS: Outlook[] = ["all", "bullish", "bearish", "neutral", "volatility"];

export default function OptionsStrategyBuilder({
  open,
  underlying,
  onClose,
  onStage,
}: OptionsStrategyBuilderProps) {
  const [symbolDraft, setSymbolDraft] = useState(underlying);
  const [symbol, setSymbol] = useState(underlying);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [outlook, setOutlook] = useState<Outlook>("all");
  const [presetId, setPresetId] = useState<string>("long_call");
  const [chain, setChain] = useState<OptionsChain | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<OptionStrategyLeg[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !symbol) return;
    let cancelled = false;
    // This effect coordinates an external request lifecycle; the state writes
    // intentionally mirror the pending/error/result phases of that request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getOptionsChain(symbol, selectedExpiry || undefined)
      .then((data) => {
        if (cancelled) return;
        setChain(data);
        if (!selectedExpiry && data.expirations[0]) {
          setSelectedExpiry(data.expirations[0]);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load option chain.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, symbol, selectedExpiry]);

  const rows = useMemo(() => buildRows(chain, selectedExpiry), [chain, selectedExpiry]);
  const spot = chain?.spotPrice ?? null;
  const selectedPreset = PRESETS.find((preset) => preset.id === presetId) ?? PRESETS[0];
  const draft = useMemo<OptionStrategyDraft>(() => ({
    underlying: symbol,
    spotPrice: spot,
    label: legs.length > 0 ? selectedPreset.label : "Custom options strategy",
    source: "builder",
    quoteTimestamp: chain?.fetchedAt ?? null,
    comboType: inferComboType(legs, selectedPreset.id),
    legs,
  }), [chain?.fetchedAt, legs, selectedPreset.id, selectedPreset.label, spot, symbol]);
  const summary = useMemo(() => calculatePayoffSummary(draft), [draft]);
  const filteredPresets = PRESETS.filter((preset) => outlook === "all" || preset.outlook === outlook);

  if (!open) return null;

  const commitSymbol = () => {
    const next = symbolDraft.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(next)) {
      setError("Enter a valid optionable ticker.");
      return;
    }
    setSelectedExpiry("");
    setLegs([]);
    setSymbol(next);
  };

  const applyPreset = (preset: StrategyPreset) => {
    setPresetId(preset.id);
    setSelectionError(null);
    const nextLegs = buildPresetLegs(preset.id, rows, symbol, spot);
    if (nextLegs.length === 0) {
      setSelectionError("That preset needs a fuller chain around the current spot.");
      return;
    }
    setLegs(nextLegs);
  };

  const addManualLeg = (contract: OptionsContract, side: OptionOrderSide) => {
    setSelectionError(null);
    const next = optionLegFromContract({ contract, underlying: symbol, side });
    if (!next) {
      setSelectionError("Could not build an OCC symbol for that contract.");
      return;
    }
    setLegs((current) => {
      if (current.length >= 4) {
        setSelectionError("A strategy can contain at most four option legs.");
        return current;
      }
      const existing = current.findIndex((leg) => leg.occSymbol === next.occSymbol && leg.side === next.side);
      if (existing >= 0) {
        return current.map((leg, index) => index === existing ? { ...leg, qty: leg.qty + 1 } : leg);
      }
      return [...current, next];
    });
  };

  return (
    <div className="fixed inset-0 z-40 bg-[rgba(8,10,8,0.45)] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Options strategy builder">
      <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-hidden rounded-t-2xl border border-border-hair bg-bg shadow-[0_-20px_80px_-40px_rgba(0,0,0,0.55)] md:inset-y-6 md:left-auto md:right-6 md:w-[min(1180px,calc(100vw-48px))] md:rounded-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-border-hair px-4 py-3">
          <div>
            <p className="t-label text-fg-hint">Strategy builder</p>
            <h2 className="text-[18px] font-semibold text-ink-1000">Build and preview options risk</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-sm border border-border-hair text-fg-muted hover:border-brand hover:text-fg"
            aria-label="Close builder"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="grid max-h-[calc(92dvh-62px)] gap-0 overflow-y-auto md:grid-cols-[270px_minmax(0,1fr)_360px]">
          <aside className="border-b border-border-hair p-4 md:border-b-0 md:border-r">
            <label className="block">
              <span className="t-label text-fg-hint">Underlying</span>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  value={symbolDraft}
                  onChange={(event) => setSymbolDraft(event.target.value.toUpperCase())}
                  className="h-10 rounded-sm border border-border bg-bg-elev-1 px-3 font-mono text-[14px] text-fg outline-none focus-visible:border-brand"
                  autoCapitalize="characters"
                />
                <button
                  type="button"
                  onClick={commitSymbol}
                  className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-brand text-primary-foreground"
                  aria-label="Load symbol"
                >
                  <MagnifyingGlass className="size-4" aria-hidden />
                </button>
              </div>
            </label>

            <div className="mt-4">
              <p className="t-label text-fg-hint">Outlook</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {OUTLOOKS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setOutlook(item)}
                    className={cn(
                      "rounded-sm border px-2.5 py-1.5 text-[12px] capitalize transition",
                      outlook === item
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-border-hair text-fg-muted hover:border-border hover:text-fg",
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <p className="t-label text-fg-hint">Presets</p>
              <div className="mt-2 grid gap-2">
                {filteredPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition active:translate-y-px",
                      presetId === preset.id
                        ? "border-brand bg-brand/10"
                        : "border-border-hair bg-bg-elev-1 hover:border-border",
                    )}
                  >
                    <span className="block text-[13px] font-semibold text-fg">{preset.label}</span>
                    <span className="mt-1 block text-[12px] leading-snug text-fg-muted">{preset.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <main className="min-w-0 border-b border-border-hair p-4 md:border-b-0 md:border-r">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="t-label text-fg-hint">Option chain</p>
                <p className="mt-1 text-[13px] text-fg-muted">
                  {spot ? `${symbol} spot ${formatCurrency(spot)}` : `${symbol} option contracts`}
                </p>
              </div>
              <select
                value={selectedExpiry}
                onChange={(event) => {
                  setSelectedExpiry(event.target.value);
                  setLegs([]);
                }}
                className="h-10 rounded-sm border border-border bg-bg-elev-1 px-3 font-mono text-[13px] text-fg outline-none focus-visible:border-brand"
              >
                {chain?.expirations.length ? (
                  chain.expirations.map((expiry) => (
                    <option key={expiry} value={expiry}>{expiry}</option>
                  ))
                ) : (
                  <option value="">No expiries</option>
                )}
              </select>
            </div>

            {loading ? (
              <div className="mt-4 grid gap-2">
                {Array.from({ length: 10 }).map((_, index) => (
                  <div key={index} className="h-10 animate-pulse rounded border border-border-hair bg-bg-elev-1" />
                ))}
              </div>
            ) : error ? (
              <div className="mt-4 rounded-md border border-loss/30 bg-loss/10 px-3 py-3 text-[13px] text-fg-muted">{error}</div>
            ) : rows.length === 0 ? (
              <div className="mt-4 rounded-md border border-dashed border-border-hair bg-bg px-4 py-8 text-center text-[13px] text-fg-muted">
                No option rows loaded for this expiry.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-md border border-border-hair">
                <table className="w-full min-w-[720px] border-separate border-spacing-0 font-mono text-[12px] tabular-nums">
                  <thead className="bg-bg-elev-1 text-fg-hint">
                    <tr>
                      <th className="px-2 py-2 text-left font-normal">CALL</th>
                      <th className="px-2 py-2 text-right font-normal">BID</th>
                      <th className="px-2 py-2 text-right font-normal">ASK</th>
                      <th className="px-2 py-2 text-center font-normal">STRIKE</th>
                      <th className="px-2 py-2 text-right font-normal">BID</th>
                      <th className="px-2 py-2 text-right font-normal">ASK</th>
                      <th className="px-2 py-2 text-right font-normal">PUT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.strike} className="border-t border-border-hair odd:bg-bg even:bg-bg-elev-1/45">
                        <td className="px-2 py-2">
                          {row.call ? <LegButtons contract={row.call} onPick={addManualLeg} /> : null}
                        </td>
                        <td className="px-2 py-2 text-right text-profit/80">{row.call ? formatOptionPrice(row.call.bid) : ""}</td>
                        <td className="px-2 py-2 text-right text-profit/80">{row.call ? formatOptionPrice(row.call.ask) : ""}</td>
                        <th className="px-2 py-2 text-center font-semibold text-fg">{row.strike}</th>
                        <td className="px-2 py-2 text-right text-loss/80">{row.put ? formatOptionPrice(row.put.bid) : ""}</td>
                        <td className="px-2 py-2 text-right text-loss/80">{row.put ? formatOptionPrice(row.put.ask) : ""}</td>
                        <td className="px-2 py-2 text-right">
                          {row.put ? <LegButtons contract={row.put} onPick={addManualLeg} align="end" /> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </main>

          <aside className="p-4">
            <OptionsPayoffPanel draft={draft} compact title="Builder payoff" />
            <div className="mt-4 rounded-lg border border-border-hair bg-bg-elev-1 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="t-label text-fg-hint">Selected legs</p>
                {legs.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setLegs([])}
                    className="text-[12px] text-fg-muted hover:text-fg"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2">
                {legs.length === 0 ? (
                  <p className="rounded border border-dashed border-border-hair bg-bg px-3 py-4 text-center text-[13px] text-fg-muted">
                    Pick a preset or add legs from the chain.
                  </p>
                ) : (
                  legs.map((leg, index) => (
                    <div key={`${leg.id}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded border border-border-hair bg-bg px-2 py-2 font-mono text-[12px]">
                      <span className={cn("rounded px-2 py-1 uppercase", leg.side === "buy" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss")}>{leg.side}</span>
                      <span className="min-w-0 truncate text-fg">{leg.strike} {leg.kind} x {leg.qty}</span>
                      <button
                        type="button"
                        onClick={() => setLegs((current) => current.filter((_, i) => i !== index))}
                        className="text-fg-muted hover:text-fg"
                        aria-label={`Remove leg ${index + 1}`}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  ))
                )}
              </div>
              {selectionError ? <p className="mt-3 text-[12px] text-amber">{selectionError}</p> : null}
              <button
                type="button"
                disabled={summary.status !== "ready"}
                onClick={() => onStage(draft)}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm border border-brand bg-brand px-4 text-[13px] font-semibold text-primary-foreground transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-border-hair disabled:bg-bg-elev-1 disabled:text-fg-muted disabled:hover:translate-y-0"
              >
                Stage ticket
                <ArrowRight className="size-4" aria-hidden />
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function LegButtons({
  contract,
  onPick,
  align = "start",
}: {
  contract: OptionsContract;
  onPick: (contract: OptionsContract, side: OptionOrderSide) => void;
  align?: "start" | "end";
}) {
  return (
    <div className={cn("flex gap-1", align === "end" && "justify-end")}>
      <button type="button" onClick={() => onPick(contract, "buy")} className="rounded border border-profit/30 px-2 py-1 text-profit hover:bg-profit/10">B</button>
      <button type="button" onClick={() => onPick(contract, "sell")} className="rounded border border-loss/30 px-2 py-1 text-loss hover:bg-loss/10">S</button>
    </div>
  );
}

function buildRows(chain: OptionsChain | null, expiry: string) {
  if (!chain) return [];
  const calls = chain.calls.filter((contract) => !expiry || contract.expiry === expiry);
  const puts = chain.puts.filter((contract) => !expiry || contract.expiry === expiry);
  const byStrike = new Map<number, { strike: number; call: OptionsContract | null; put: OptionsContract | null }>();
  for (const call of calls) {
    byStrike.set(call.strike, { ...(byStrike.get(call.strike) ?? { strike: call.strike, call: null, put: null }), call });
  }
  for (const put of puts) {
    byStrike.set(put.strike, { ...(byStrike.get(put.strike) ?? { strike: put.strike, call: null, put: null }), put });
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

function buildPresetLegs(presetId: string, rows: ReturnType<typeof buildRows>, underlying: string, spot: number | null): OptionStrategyLeg[] {
  if (rows.length === 0) return [];
  const atmIndex = spot != null && Number.isFinite(spot)
    ? rows.reduce((bestIndex, row, index) => (
      Math.abs(row.strike - spot) < Math.abs(rows[bestIndex].strike - spot) ? index : bestIndex
    ), 0)
    : Math.max(0, Math.floor(rows.length / 2));
  const atm = rows[atmIndex];
  const below1 = rows[atmIndex - 1];
  const below2 = rows[atmIndex - 2];
  const above1 = rows[atmIndex + 1];
  const above2 = rows[atmIndex + 2];
  const legs: Array<OptionStrategyLeg | null> = [];

  switch (presetId) {
    case "long_call":
      legs.push(atm.call ? optionLegFromContract({ contract: atm.call, underlying, side: "buy" }) : null);
      break;
    case "short_call":
      legs.push(atm.call ? optionLegFromContract({ contract: atm.call, underlying, side: "sell" }) : null);
      break;
    case "long_put":
      legs.push(atm.put ? optionLegFromContract({ contract: atm.put, underlying, side: "buy" }) : null);
      break;
    case "short_put":
      legs.push(atm.put ? optionLegFromContract({ contract: atm.put, underlying, side: "sell" }) : null);
      break;
    case "bull_call_spread":
      legs.push(
        atm.call ? optionLegFromContract({ contract: atm.call, underlying, side: "buy" }) : null,
        above1?.call ? optionLegFromContract({ contract: above1.call, underlying, side: "sell" }) : null,
      );
      break;
    case "bear_put_spread":
      legs.push(
        atm.put ? optionLegFromContract({ contract: atm.put, underlying, side: "buy" }) : null,
        below1?.put ? optionLegFromContract({ contract: below1.put, underlying, side: "sell" }) : null,
      );
      break;
    case "short_straddle":
      legs.push(
        atm.call ? optionLegFromContract({ contract: atm.call, underlying, side: "sell" }) : null,
        atm.put ? optionLegFromContract({ contract: atm.put, underlying, side: "sell" }) : null,
      );
      break;
    case "long_straddle":
      legs.push(
        atm.call ? optionLegFromContract({ contract: atm.call, underlying, side: "buy" }) : null,
        atm.put ? optionLegFromContract({ contract: atm.put, underlying, side: "buy" }) : null,
      );
      break;
    case "short_strangle":
      legs.push(
        above1?.call ? optionLegFromContract({ contract: above1.call, underlying, side: "sell" }) : null,
        below1?.put ? optionLegFromContract({ contract: below1.put, underlying, side: "sell" }) : null,
      );
      break;
    case "long_strangle":
      legs.push(
        above1?.call ? optionLegFromContract({ contract: above1.call, underlying, side: "buy" }) : null,
        below1?.put ? optionLegFromContract({ contract: below1.put, underlying, side: "buy" }) : null,
      );
      break;
    case "iron_condor":
      legs.push(
        below1?.put ? optionLegFromContract({ contract: below1.put, underlying, side: "sell" }) : null,
        below2?.put ? optionLegFromContract({ contract: below2.put, underlying, side: "buy" }) : null,
        above1?.call ? optionLegFromContract({ contract: above1.call, underlying, side: "sell" }) : null,
        above2?.call ? optionLegFromContract({ contract: above2.call, underlying, side: "buy" }) : null,
      );
      break;
    case "iron_butterfly":
      legs.push(
        atm.put ? optionLegFromContract({ contract: atm.put, underlying, side: "sell" }) : null,
        below2?.put ? optionLegFromContract({ contract: below2.put, underlying, side: "buy" }) : null,
        atm.call ? optionLegFromContract({ contract: atm.call, underlying, side: "sell" }) : null,
        above2?.call ? optionLegFromContract({ contract: above2.call, underlying, side: "buy" }) : null,
      );
      break;
  }

  if (legs.some((leg) => leg == null || leg.entryPrice == null)) return [];
  return legs as OptionStrategyLeg[];
}

function inferComboType(legs: OptionStrategyLeg[], presetId: string): string | null {
  if (legs.length === 2 && presetId.includes("spread")) return "vertical_spread";
  if (presetId.includes("straddle")) return "straddle";
  if (presetId.includes("strangle")) return "strangle";
  if (presetId === "iron_condor") return "iron_condor";
  if (presetId === "iron_butterfly") return "iron_butterfly";
  return null;
}

function formatOptionPrice(value: number): string {
  return Number.isFinite(value) && value > 0 ? value.toFixed(2) : "--";
}
