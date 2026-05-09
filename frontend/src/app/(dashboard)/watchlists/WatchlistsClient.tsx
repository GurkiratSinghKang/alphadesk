"use client";

import * as React from "react";
import Link from "next/link";

import Section from "@/components/composites/Section";
import Stat from "@/components/primitives/Stat";
import EmptyState from "@/components/primitives/EmptyState";
import { MOCK_WATCHLISTS, type Watchlist, type WatchlistRow } from "@/lib/mocks";
import { cn } from "@/lib/utils";

/**
 * Phase 1.8 — first-class Watchlists page per v2-plan §1.8.
 *
 * Composition: identity Section → 4-stat pulse → 260px sidebar
 * (lists with owner/source pills) + main column (filter chips +
 * column picker + table). Click a symbol → /symbols/[ticker].
 *
 * Phase 0 reads MOCK_WATCHLISTS; backend B.3 swaps for the real
 * /api/v1/watchlists endpoint family. Phase 1.8 follow-up wires
 * column-picker drawer + drag-reorder + share token mint.
 */
export default function WatchlistsClient() {
  const [activeId, setActiveId] = React.useState<string>(MOCK_WATCHLISTS[0].id);
  const [filter, setFilter] = React.useState<"all" | "with-signal" | "earnings" | "held">("all");
  const active = MOCK_WATCHLISTS.find((w) => w.id === activeId) ?? MOCK_WATCHLISTS[0];

  const visibleRows = React.useMemo<WatchlistRow[]>(() => {
    if (filter === "all") return active.rows;
    if (filter === "with-signal") return active.rows.filter((r) => r.signal !== "neutral" && r.signal !== "hold");
    if (filter === "earnings") return active.rows.filter((r) => r.earningsInDays !== undefined && Math.abs(r.earningsInDays) <= 7);
    if (filter === "held") return active.rows.filter((r) => r.held);
    return active.rows;
  }, [active.rows, filter]);

  const stats = React.useMemo(() => {
    const totalNames = MOCK_WATCHLISTS.reduce((acc, wl) => acc + wl.rows.length, 0);
    const withSignal = MOCK_WATCHLISTS.reduce(
      (acc, wl) => acc + wl.rows.filter((r) => r.signal !== "neutral" && r.signal !== "hold").length,
      0,
    );
    const earnings7d = MOCK_WATCHLISTS.reduce(
      (acc, wl) =>
        acc +
        wl.rows.filter(
          (r) => r.earningsInDays !== undefined && Math.abs(r.earningsInDays) <= 7,
        ).length,
      0,
    );
    const held = MOCK_WATCHLISTS.reduce(
      (acc, wl) => acc + wl.rows.filter((r) => r.held).length,
      0,
    );
    return { totalNames, withSignal, earnings7d, held };
  }, []);

  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto space-y-8">
      <Section
        eyebrow="WATCHLISTS · YOUR BENCH OF NAMES"
        title="Watchlists"
        description="Multiple named lists, custom columns, per-strategy auto-populated lists, sharing."
        level={1}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled
              className="rounded-sm border border-brand/40 bg-tint-brand-1 text-brand px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-[0.08em] opacity-60 cursor-not-allowed"
              title="Phase 1.8 follow-up + backend B.3 wires share-token mint"
            >
              Share
            </button>
            <button
              type="button"
              disabled
              className="rounded-sm border border-brand/60 bg-brand text-brand-on px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-[0.08em] opacity-60 cursor-not-allowed"
              title="Phase 1.8 follow-up wires create-list modal"
            >
              + New list
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Total names" value={stats.totalNames} size="sm" />
          <Stat label="With signal" value={stats.withSignal} size="sm" tone="brand" />
          <Stat label="Earnings ≤ 7d" value={stats.earnings7d} size="sm" tone="profit" />
          <Stat label="In book" value={stats.held} size="sm" />
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-6">
        <aside className="space-y-3">
          <Section eyebrow="LISTS" title="Your lists" rule={false}>
            <ol className="rounded-md border border-border-hair bg-bg-elev-1 divide-y divide-border-hair">
              {MOCK_WATCHLISTS.map((wl) => (
                <li key={wl.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(wl.id)}
                    className={cn(
                      "w-full px-3 py-2.5 text-left flex flex-col gap-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      activeId === wl.id ? "bg-bg-elev-2" : "hover:bg-bg-elev-2",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-body text-fg font-medium truncate">{wl.name}</span>
                      <span className="text-eyebrow text-fg-muted">{wl.rows.length}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-eyebrow uppercase tracking-[0.08em]">
                      <OwnerPill kind={wl.kind} share={wl.share} ownerLabel={wl.ownerLabel} />
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          </Section>
        </aside>

        <Section
          eyebrow={`LIST · ${active.name.toUpperCase()}`}
          title={active.name}
          description={
            active.kind === "auto_strategy"
              ? "Auto-populated by strategy rules. Manual edits disabled."
              : active.kind === "auto_earnings"
              ? "Auto-populated by upcoming earnings calendar."
              : "Manual list. Drag rows / columns to reorder (Phase 1.8 follow-up)."
          }
          right={
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { value: "all", label: "All" },
                  { value: "with-signal", label: "With signal" },
                  { value: "earnings", label: "Earnings ≤ 7d" },
                  { value: "held", label: "Held" },
                ] as const
              ).map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  aria-pressed={filter === chip.value}
                  onClick={() => setFilter(chip.value)}
                  className={cn(
                    "px-2 py-0.5 rounded-pill text-eyebrow font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    filter === chip.value
                      ? "bg-brand text-brand-on"
                      : "bg-bg-elev-1 text-fg-muted hover:text-fg",
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          }
        >
          {visibleRows.length === 0 ? (
            <EmptyState
              eyebrow="NO MATCH"
              title="Nothing matches this filter."
              description="Switch to All, or pick a different list from the sidebar."
            />
          ) : (
            <WatchlistTable list={active} rows={visibleRows} />
          )}
        </Section>
      </div>
    </main>
  );
}

function OwnerPill({ kind, share, ownerLabel }: { kind: Watchlist["kind"]; share: Watchlist["share"]; ownerLabel: string }) {
  const tone =
    kind === "auto_strategy"
      ? "bg-tint-brand-1 text-brand border-brand/40"
      : kind === "auto_earnings"
      ? "bg-tint-up-1 text-profit border-profit/40"
      : "bg-bg-elev-2 text-fg-muted border-border-hair";
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-pill border text-eyebrow font-semibold uppercase tracking-[0.08em]", tone)}>
      {ownerLabel}
      {share !== "private" && <span className="opacity-70">· {share}</span>}
    </span>
  );
}

function WatchlistTable({ list, rows }: { list: Watchlist; rows: WatchlistRow[] }) {
  return (
    <div className="rounded-md border border-border-hair bg-bg-elev-1 overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead className="bg-bg-elev-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Symbol</th>
            <th className="text-right px-3 py-2 font-semibold">Px</th>
            <th className="text-right px-3 py-2 font-semibold">Day</th>
            <th className="text-right px-3 py-2 font-semibold hidden sm:table-cell">Vol</th>
            <th className="text-right px-3 py-2 font-semibold hidden md:table-cell">Tech</th>
            <th className="text-right px-3 py-2 font-semibold hidden md:table-cell">Fund</th>
            <th className="text-left px-3 py-2 font-semibold hidden lg:table-cell">Signal</th>
            <th className="text-left px-3 py-2 font-semibold hidden xl:table-cell">Reason</th>
            <th className="text-right px-3 py-2 font-semibold hidden lg:table-cell">Earnings</th>
            <th className="text-right px-3 py-2 font-semibold">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${list.id}-${r.symbol}`}
              className={cn(
                "border-t border-border-hair hover:bg-bg-elev-2 transition-colors",
                r.held && "bg-tint-up-1/40",
              )}
            >
              <td className="px-3 py-2.5">
                <Link
                  href={`/symbols/${r.symbol}`}
                  className="text-body text-fg font-medium hover:text-brand"
                >
                  {r.symbol}
                </Link>
                <p className="text-eyebrow text-fg-muted truncate max-w-[160px]">{r.name}</p>
              </td>
              <td className="px-3 py-2.5 text-right t-mono text-fg">{r.px.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td className={cn("px-3 py-2.5 text-right t-mono", r.pctDay > 0 ? "text-profit" : r.pctDay < 0 ? "text-loss" : "text-fg-muted")}>
                {r.pctDay > 0 ? "+" : ""}{r.pctDay.toFixed(2)}%
              </td>
              <td className="px-3 py-2.5 text-right t-mono text-fg-muted hidden sm:table-cell">{r.vol}</td>
              <td className="px-3 py-2.5 text-right t-mono text-fg-muted hidden md:table-cell">{r.techScore}</td>
              <td className="px-3 py-2.5 text-right t-mono text-fg-muted hidden md:table-cell">{r.fundScore}</td>
              <td className="px-3 py-2.5 hidden lg:table-cell">
                <span className={cn(
                  "px-1.5 py-0.5 rounded-pill text-eyebrow uppercase tracking-[0.08em] font-semibold",
                  r.signal.startsWith("trend+") || r.signal === "PEAD"
                    ? "bg-tint-up-1 text-profit"
                    : r.signal === "vol+"
                    ? "bg-tint-brand-1 text-brand"
                    : r.signal === "trim"
                    ? "bg-tint-down-1 text-loss"
                    : "bg-bg-elev-2 text-fg-muted",
                )}>
                  {r.signal}
                </span>
              </td>
              <td className="px-3 py-2.5 text-fg-muted italic hidden xl:table-cell line-clamp-1 max-w-[260px]">
                {r.reason}
              </td>
              <td className="px-3 py-2.5 text-right t-mono text-fg-muted hidden lg:table-cell">
                {r.earningsInDays === undefined ? "—" : r.earningsInDays === 0 ? "Today" : r.earningsInDays > 0 ? `+${r.earningsInDays}d` : `${r.earningsInDays}d`}
              </td>
              <td className="px-3 py-2.5 text-right">
                <Link
                  href={`/trade?symbol=${r.symbol}`}
                  className="rounded-sm border border-brand/50 bg-tint-brand-1 text-brand px-2 py-0.5 text-eyebrow font-semibold uppercase tracking-[0.08em] hover:bg-brand hover:text-brand-on transition-colors"
                >
                  Trade
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
