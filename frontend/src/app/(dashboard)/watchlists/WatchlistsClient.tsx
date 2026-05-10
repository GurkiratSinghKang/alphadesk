"use client";

import * as React from "react";
import Link from "next/link";

import Section from "@/components/composites/Section";
import Stat from "@/components/primitives/Stat";
import EmptyState from "@/components/primitives/EmptyState";
import { MOCK_WATCHLISTS, type Watchlist, type WatchlistRow } from "@/lib/mocks";
import {
  addWatchlistItem,
  createWatchlistV2,
  getEnrichedWatchlist,
  getWatchlistsV2,
  type EnrichedWatchlistItem,
  type EnrichedWatchlistResponse,
  type WatchlistV2,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// v2 backend wiring — convert a live `WatchlistV2` shell into the
// frontend's `Watchlist` shape (without rows; rows come from the
// enriched fetch). Lets the existing rendering code stay shape-stable.
function watchlistV2ToMockShape(wl: WatchlistV2, rows: WatchlistRow[] = []): Watchlist {
  return {
    id: `live-${wl.id}`,
    name: wl.name,
    kind: wl.kind,
    share: wl.share_mode,
    rows,
    ownerLabel:
      wl.kind === "auto_strategy"
        ? `auto · ${wl.auto_source_strategy ?? "rules"}`
        : wl.kind === "auto_earnings"
          ? "auto · earnings"
          : "you",
  };
}

// Convert an enriched backend item to the frontend's WatchlistRow.
// Missing slots (fundScore, strats, reason, earningsInDays, preMktPct)
// fill with neutral defaults so the existing table render code keeps
// working without per-cell defensive checks.
function enrichedToRow(it: EnrichedWatchlistItem): WatchlistRow {
  return {
    symbol: it.symbol,
    name: it.name ?? it.symbol,
    px: it.px ?? 0,
    pctDay: it.pct_day ?? 0,
    vol: it.vol ?? "—",
    techScore: it.tech_score ?? 0,
    fundScore: 0,
    signal: it.signal ?? "neutral",
    strats: [],
    reason: it.note ?? "",
    earningsInDays: undefined,
    preMktPct: undefined,
    held: it.held,
  };
}

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
type WatchlistFilter =
  | "all"
  | "movers"
  | "with-signal"
  | "premarket"
  | "held";

export default function WatchlistsClient() {
  // v2 backend wiring — primary data source is the live API
  // (`/api/v1/watchlists` + `/api/v1/watchlists/{id}/enriched`). We
  // fall back to MOCK_WATCHLISTS only when the user has zero live
  // lists and no enriched response — this keeps first-time-user UX
  // populated without fabricating data when the API works fine.
  const [liveLists, setLiveLists] = React.useState<Watchlist[] | null>(null);
  const [enrichedRows, setEnrichedRows] = React.useState<Record<string, WatchlistRow[]>>({});
  const [refetchTick, setRefetchTick] = React.useState(0);

  // Hydrate the lists shell once (and after a refetch tick).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v2 = await getWatchlistsV2();
        if (cancelled) return;
        if (v2.length > 0) {
          setLiveLists(v2.map((w) => watchlistV2ToMockShape(w)));
        } else {
          // Empty state — no live lists. Fall back to mock so the page
          // renders demo content for first-time users.
          setLiveLists(null);
        }
      } catch {
        // API unreachable — fall back to mock.
        setLiveLists(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refetchTick]);

  const lists: Watchlist[] = liveLists ?? MOCK_WATCHLISTS;
  const [activeId, setActiveId] = React.useState<string>(lists[0].id);
  const [filter, setFilter] = React.useState<WatchlistFilter>("all");

  // When the lists pivot from mock → live (or vice versa), reset
  // activeId to the first list of the current source.
  React.useEffect(() => {
    if (!lists.find((w) => w.id === activeId)) {
      setActiveId(lists[0].id);
    }
  }, [lists, activeId]);

  // Hydrate enriched rows for live lists on demand.
  React.useEffect(() => {
    if (!liveLists) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, WatchlistRow[]> = {};
      for (const wl of liveLists) {
        // ID format: "live-{N}". Skip if already cached.
        if (enrichedRows[wl.id] != null) continue;
        const numId = Number(wl.id.replace(/^live-/, ""));
        if (!Number.isFinite(numId)) continue;
        try {
          const enriched: EnrichedWatchlistResponse = await getEnrichedWatchlist(numId);
          if (cancelled) return;
          updates[wl.id] = enriched.items.map(enrichedToRow);
        } catch {
          // per-list failure — leave empty so the table renders the
          // "no rows yet" state instead of silently merging stale
          // mock data.
          updates[wl.id] = [];
        }
      }
      if (Object.keys(updates).length > 0 && !cancelled) {
        setEnrichedRows((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveLists, enrichedRows]);

  // Build the rendered list view — when the active list is live, swap
  // its mock rows for the enriched response (or empty array).
  const enrichedLists: Watchlist[] = React.useMemo(() => {
    if (!liveLists) return MOCK_WATCHLISTS;
    return liveLists.map((wl) => ({
      ...wl,
      rows: enrichedRows[wl.id] ?? [],
    }));
  }, [liveLists, enrichedRows]);

  const renderedLists = enrichedLists;
  const active = renderedLists.find((w) => w.id === activeId) ?? renderedLists[0];

  // v2 watchlists polish — filter predicates extracted so the chip
  // group can show live counts ("All 7", "Movers 3", "Held 1") next
  // to each label, matching the editorial design.
  const filterPredicate = React.useCallback(
    (f: WatchlistFilter) => (r: WatchlistRow) => {
      if (f === "all") return true;
      if (f === "movers") return Math.abs(r.pctDay) >= 1;
      if (f === "with-signal")
        return r.signal !== "neutral" && r.signal !== "hold";
      if (f === "premarket")
        return r.preMktPct !== undefined && Math.abs(r.preMktPct) > 0;
      if (f === "held") return r.held;
      return true;
    },
    [],
  );

  const filterCounts = React.useMemo(() => {
    return {
      all: active.rows.length,
      movers: active.rows.filter(filterPredicate("movers")).length,
      "with-signal": active.rows.filter(filterPredicate("with-signal")).length,
      premarket: active.rows.filter(filterPredicate("premarket")).length,
      held: active.rows.filter(filterPredicate("held")).length,
    } satisfies Record<WatchlistFilter, number>;
  }, [active.rows, filterPredicate]);

  const visibleRows = React.useMemo<WatchlistRow[]>(
    () => active.rows.filter(filterPredicate(filter)),
    [active.rows, filter, filterPredicate],
  );

  // Aggregate the unique strategy tags consumed by the active list so
  // the metadata strip can render "3 FEED STRATEGIES · MQ · PEAD · …".
  const activeStrats = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of active.rows) for (const s of r.strats) set.add(s);
    return [...set].sort();
  }, [active.rows]);

  const stats = React.useMemo(() => {
    const source = renderedLists;
    const totalNames = source.reduce((acc, wl) => acc + wl.rows.length, 0);
    const withSignal = source.reduce(
      (acc, wl) => acc + wl.rows.filter((r) => r.signal !== "neutral" && r.signal !== "hold").length,
      0,
    );
    const earnings7d = source.reduce(
      (acc, wl) =>
        acc +
        wl.rows.filter(
          (r) => r.earningsInDays !== undefined && Math.abs(r.earningsInDays) <= 7,
        ).length,
      0,
    );
    const held = source.reduce(
      (acc, wl) => acc + wl.rows.filter((r) => r.held).length,
      0,
    );
    return { totalNames, withSignal, earnings7d, held };
  }, [renderedLists]);

  // Top movers / laggards / signals firing — distinctive hero row from the
  // design's watchlists.jsx. Computed off the active list so it stays in
  // sync as the user switches lists.
  const topMovers = React.useMemo(() => {
    const sorted = [...active.rows].sort((a, b) => b.pctDay - a.pctDay);
    return {
      gainers: sorted.filter((r) => r.pctDay > 0).slice(0, 5),
      laggards: sorted.filter((r) => r.pctDay < 0).slice(-5).reverse(),
      signals: active.rows
        .filter((r) => r.signal && r.signal !== "neutral" && r.signal !== "hold")
        .slice(0, 5),
    };
  }, [active.rows]);

  return (
    <main className="px-6 pt-6 pb-12 max-w-screen-2xl mx-auto space-y-6">
      {/* Editorial hero matching watchlists.jsx — italic Newsreader title +
          body line + small action affordances. */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="t-eyebrow-italic"
            style={{ color: "var(--brand)", letterSpacing: "0.2em" }}
          >
            WATCHLISTS · BENCH
          </p>
          <h1
            className="m-0 mt-3 italic"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--ink-1000)",
              fontSize: 48,
              fontWeight: 400,
              letterSpacing: "-0.025em",
              lineHeight: 1.0,
            }}
          >
            Your bench of names.
          </h1>
          <p
            className="italic"
            style={{
              marginTop: 10,
              fontFamily: "var(--font-display)",
              fontSize: 16,
              color: "var(--fg-muted)",
              lineHeight: 1.55,
              maxWidth: 700,
            }}
          >
            {renderedLists.length} list{renderedLists.length === 1 ? "" : "s"} · {stats.totalNames} unique symbols.
            Lists feed strategies — strategies hunt only inside their assigned
            bench.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled
            className="rounded-sm border border-brand/40 bg-tint-brand-1 text-brand px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-[0.08em] opacity-60 cursor-not-allowed"
            title="Phase 1.8 follow-up + backend B.3 wires share-token mint"
          >
            Edit lists
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
      </header>

      {/* Top movers / laggards / signals — 3-col editorial summary above
          the main bench grid. Mirrors watchlists.jsx top section. */}
      <div
        className="grid grid-cols-1 sm:grid-cols-3 rounded-md border border-border-hair overflow-hidden"
        style={{ background: "var(--bg-elev-1)" }}
      >
        <MoversCol title="Top movers · gainers" rows={topMovers.gainers} tone="up" />
        <MoversCol title="Top movers · laggards" rows={topMovers.laggards} tone="down" />
        <SignalsCol title="Signals firing today" rows={topMovers.signals} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-6">
        <aside className="space-y-3">
          <Section eyebrow="LISTS" title="Your lists" rule={false}>
            <ol className="rounded-md border border-border-hair bg-bg-elev-1 divide-y divide-border-hair">
              {renderedLists.map((wl) => (
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

          {/* v2 polish — QUICK ADD card matches watchlists-dark.png left-rail
           * footer. Lets the operator append a symbol to the active list
           * without leaving the page. Backend (B.3 watchlists v2) wires
           * the append endpoint; until then the form persists locally to
           * the active list's rows (preview UX). */}
          <section
            className="rounded-md border border-border-hair p-3"
            style={{ background: "var(--bg-elev-1)" }}
            aria-label="Quick add to active list"
          >
            <p
              className="t-eyebrow-italic mb-2"
              style={{ color: "var(--fg-muted)", letterSpacing: "0.16em", margin: 0 }}
            >
              QUICK ADD
            </p>
            <p className="font-display italic text-label leading-snug text-fg-muted mb-2">
              Append a symbol to <span className="text-fg">{active.name}</span>.
            </p>
            <QuickAddForm
              activeListName={active.name}
              activeListId={active.id.startsWith("live-") ? Number(active.id.replace(/^live-/, "")) : null}
              onAdded={() => {
                // Refetch the active list's enriched rows so the
                // freshly-appended symbol appears in the table without
                // a full page reload.
                setEnrichedRows((prev) => {
                  const next = { ...prev };
                  delete next[active.id];
                  return next;
                });
                setRefetchTick((t) => t + 1);
              }}
            />
          </section>
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
                  { value: "movers", label: "Movers" },
                  { value: "with-signal", label: "With signal" },
                  { value: "premarket", label: "Pre-mkt" },
                  { value: "held", label: "Held" },
                ] as const
              ).map((chip) => {
                const count = filterCounts[chip.value];
                return (
                  <button
                    key={chip.value}
                    type="button"
                    aria-pressed={filter === chip.value}
                    onClick={() => setFilter(chip.value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-pill text-eyebrow font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      filter === chip.value
                        ? "bg-brand text-brand-on"
                        : "bg-bg-elev-1 text-fg-muted hover:text-fg",
                    )}
                  >
                    <span>{chip.label}</span>
                    <span
                      className={cn(
                        "font-mono tabular-nums",
                        filter === chip.value ? "opacity-80" : "opacity-70",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          }
        >
          {/* v2 watchlists polish — metadata strip mirrors the design's
              "84 SYMBOLS · 3 FEED STRATEGIES · MQ · PEAD · …" line. Sits
              between the section header and the table so users see the
              list's shape (size + which strategies eat from it) before
              they scan the rows. */}
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
            <span className="font-mono tabular-nums text-fg">
              {active.rows.length}
            </span>
            <span>symbols</span>
            <span className="text-border">·</span>
            <span className="font-mono tabular-nums text-fg">
              {activeStrats.length}
            </span>
            <span>
              {activeStrats.length === 1 ? "feed strategy" : "feed strategies"}
            </span>
            {activeStrats.length > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {activeStrats.map((s) => (
                    <span
                      key={s}
                      className="rounded-sm border border-border-hair bg-bg-elev-2 px-1.5 py-0.5 font-mono text-eyebrow normal-case tracking-[0.05em] text-fg"
                    >
                      {s}
                    </span>
                  ))}
                </span>
              </>
            )}
          </div>

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

// v2 polish — QUICK ADD form wired to live `/api/v1/watchlists` per
// pensive-kirch's B.3 backend (PR #105) + my contribution endpoint
// follow-up. Falls back to the system-notify event when the backend
// is unreachable so the form has visible feedback either way.
function QuickAddForm({
  activeListName,
  activeListId,
  onAdded,
}: {
  activeListName: string;
  activeListId: number | null;
  onAdded?: () => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: "ok" | "err" | null; msg: string }>({
    tone: null,
    msg: "",
  });

  const submit = React.useCallback(
    async (sym: string) => {
      setSubmitting(true);
      setFeedback({ tone: null, msg: "" });
      try {
        let targetId = activeListId;
        let targetName = activeListName;

        if (targetId == null) {
          // The active list isn't a live one (mock fallback). Look up
          // or mint a live default list for the append.
          let lists: WatchlistV2[] = [];
          try {
            lists = await getWatchlistsV2();
          } catch {
            lists = [];
          }
          if (lists[0]) {
            targetId = lists[0].id;
            targetName = lists[0].name;
          } else {
            // First-time wiring — mint a default "My core" list so the
            // append has somewhere to land.
            const created = await createWatchlistV2({
              name: activeListName || "My core",
              kind: "manual",
            });
            targetId = created.id;
            targetName = created.name;
          }
        }

        await addWatchlistItem(targetId, sym);
        setFeedback({
          tone: "ok",
          msg: `Added ${sym} to ${targetName}`,
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("alphadesk:system-notify", {
              detail: {
                kind: "info",
                title: `Added ${sym}`,
                message: `Appended to ${targetName}.`,
              },
            }),
          );
        }
        onAdded?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Add failed";
        setFeedback({ tone: "err", msg });
      } finally {
        setSubmitting(false);
      }
    },
    [activeListId, activeListName, onAdded],
  );

  return (
    <div className="space-y-1.5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("symbol") as HTMLInputElement;
          const sym = input?.value.trim().toUpperCase();
          if (!sym || submitting) return;
          void submit(sym).then(() => {
            input.value = "";
          });
        }}
        className="flex items-center gap-1.5"
      >
        <input
          type="text"
          name="symbol"
          placeholder="NVDA"
          aria-label="Symbol ticker"
          maxLength={10}
          disabled={submitting}
          className="flex-1 rounded-sm border border-border bg-bg px-2 py-1 font-mono text-label uppercase text-fg placeholder:text-fg-muted/60 focus-visible:outline-none focus-visible:border-brand disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-sm border border-brand/60 bg-tint-brand-1 text-brand px-2.5 py-1 font-mono text-eyebrow font-semibold uppercase tracking-[0.08em] hover:bg-brand hover:text-brand-on transition-colors disabled:opacity-60 disabled:cursor-wait"
        >
          {submitting ? "..." : "Add"}
        </button>
      </form>
      {feedback.tone ? (
        <p
          className={cn(
            "font-mono text-eyebrow uppercase tracking-[0.06em]",
            feedback.tone === "ok" ? "text-profit" : "text-loss",
          )}
        >
          {feedback.msg}
        </p>
      ) : null}
    </div>
  );
}

function MoversCol({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: WatchlistRow[];
  tone: "up" | "down";
}) {
  return (
    <div
      className="p-4"
      style={{ borderRight: "1px solid var(--border-hair)" }}
    >
      <p
        className="t-eyebrow-italic"
        style={{ color: "var(--brand)", letterSpacing: "0.16em", fontSize: 9.5 }}
      >
        {title.toUpperCase()}
      </p>
      <ul className="m-0 mt-2 list-none p-0">
        {rows.length === 0 && (
          <li
            className="italic"
            style={{
              padding: "6px 0",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              color: "var(--fg-muted)",
            }}
          >
            None today.
          </li>
        )}
        {rows.map((r) => (
          <li
            key={r.symbol}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 10,
              padding: "5px 0",
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--ink-1000)",
                letterSpacing: "0.02em",
                width: 56,
              }}
            >
              {r.symbol}
            </span>
            <span
              className="italic"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 12.5,
                color: "var(--fg-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.name}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: tone === "up" ? "var(--up-500)" : "var(--down-500)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {r.pctDay > 0 ? "+" : ""}
              {r.pctDay.toFixed(2)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SignalsCol({ title, rows }: { title: string; rows: WatchlistRow[] }) {
  return (
    <div className="p-4">
      <p
        className="t-eyebrow-italic"
        style={{ color: "var(--brand)", letterSpacing: "0.16em", fontSize: 9.5 }}
      >
        {title.toUpperCase()}
      </p>
      <ul className="m-0 mt-2 list-none p-0">
        {rows.length === 0 && (
          <li
            className="italic"
            style={{
              padding: "6px 0",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              color: "var(--fg-muted)",
            }}
          >
            All quiet.
          </li>
        )}
        {rows.map((r) => (
          <li
            key={r.symbol}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 10,
              padding: "5px 0",
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--ink-1000)",
                letterSpacing: "0.02em",
                width: 56,
              }}
            >
              {r.symbol}
            </span>
            <span
              className="italic"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 12.5,
                color: "var(--fg-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.name}
            </span>
            <span
              className="t-mono"
              style={{
                fontSize: 9.5,
                color: "var(--brand)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {r.signal}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
            <th className="text-left px-3 py-2 font-semibold hidden lg:table-cell">Status</th>
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
              {/* v2 polish — STATUS column matches watchlists-dark.png:
                  HELD (gold pill) for currently-held names, CANDIDATE
                  (amber outline) for active signals, "—" otherwise. The
                  underlying signal stays accessible via the title attr
                  for power users + screen readers. */}
              <td className="px-3 py-2.5 hidden lg:table-cell">
                {r.held ? (
                  <span
                    title={`Held · signal: ${r.signal}`}
                    className="inline-flex items-center rounded-pill bg-tint-brand-1 border border-brand/50 px-2 py-0.5 font-mono text-eyebrow uppercase tracking-[0.08em] font-semibold text-brand"
                  >
                    Held
                  </span>
                ) : r.signal && r.signal !== "neutral" && r.signal !== "hold" && r.signal !== "watch" ? (
                  <span
                    title={`Signal: ${r.signal}`}
                    className="inline-flex items-center rounded-pill border border-amber/50 px-2 py-0.5 font-mono text-eyebrow uppercase tracking-[0.08em] font-semibold text-amber"
                  >
                    Candidate
                  </span>
                ) : (
                  <span className="text-fg-muted">—</span>
                )}
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
