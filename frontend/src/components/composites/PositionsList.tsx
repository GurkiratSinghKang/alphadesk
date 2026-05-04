import * as React from "react";

import { cn } from "@/lib/utils";
import PnLNumber from "@/components/primitives/PnLNumber";
import Sparkline from "@/components/primitives/Sparkline";
import { isWorkingOrderStatus } from "@/lib/orders";
import type { PositionRow, PositionTab } from "./types";

// A lightweight shape for Orders tab rows. Kept narrow on purpose — the
// Book panel only needs side/symbol/type/qty/status/price. Callers shape
// their store's `Order[]` into this via the mapper in the page file.
export interface OrderRow {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  status:
    | "pending"
    | "submitted"
    | "open"
    | "filled"
    | "partial"
    | "partial_fill"
    | "cancelled"
    | "rejected";
  rejectReason?: string;
}

// Tab-aware empty-state copy. Kept in one place so future tabs stay
// consistent with the editorial voice used on the Strategy hero.
const EMPTY_COPY: Record<PositionTab, { title: string; hint: string }> = {
  positions: {
    title: "No open positions.",
    hint: "Open Trade to place one.",
  },
  orders: {
    title: "No working orders.",
    hint: "Queued and working orders appear here.",
  },
  journal: {
    title: "Journal — coming soon.",
    hint: "Closed trades with rationale will live here.",
  },
};

/**
 * PositionsList (composite)
 * ─────────────────────────
 * Right-rail "Book" pane: italic-serif title + Positions/Orders/Journal
 * tabs + count. Each row:
 *   · symbol + quantity@entry (micro mono)
 *   · italic-serif strategy name
 *   · horizontal progress bar (profit tone or loss tone)
 *   · mono P&L dollar + mono percent below
 *
 * Only the collapsed view — drilldown ships in a later phase.
 */
export interface PositionsListProps {
  positions: PositionRow[];
  /** Working orders shown in the Orders tab. Pass from the parent's
   *  portfolio store — previously the Orders tab rendered the Positions
   *  empty-state even when real orders existed, because the tab was
   *  cosmetic (the component only ever received `positions`). */
  orders?: OrderRow[];
  /** Cancel handler — wired up in the page to `cancelOrder(id)`. */
  onCancelOrder?: (id: string) => void;
  activeTab: PositionTab;
  onTabChange?: (t: PositionTab) => void;
  onRowClick?: (id: string) => void;
  showJournal?: boolean;
  className?: string;
}

const TABS: PositionTab[] = ["positions", "orders", "journal"];

// Tab labels (pluralised + title-cased for display). Kept separate from
// the `PositionTab` id strings so we can show "Positions · 3" without
// mutating the underlying state key.
// BUG-008: the top-bar ContextBar cell shows "Open Orders" (pending + open
// only), so the Book Orders tab is renamed "Orders today" to make it clear
// this list is the broader set (all statuses from today, including filled /
// cancelled / rejected). Distinct labels prevent the 10 vs 50 confusion.
const TAB_LABEL: Record<PositionTab, string> = {
  positions: "Positions",
  orders: "Orders today",
  journal: "Journal",
};

export default function PositionsList({
  positions,
  orders = [],
  onCancelOrder,
  activeTab,
  onTabChange,
  onRowClick,
  showJournal = true,
  className,
}: PositionsListProps) {
  // Journal is still gated — the data source (closed-trade notifications
  // with rationale) hasn't landed yet. The tab is rendered but disabled so
  // the layout stays consistent and the feature is discoverable.
  const journalReady = false;

  // Select the active collection by tab.
  const count =
    activeTab === "positions"
      ? positions.length
      : activeTab === "orders"
        ? orders.length
        : 0;
  const isEmpty = count === 0;
  const empty = EMPTY_COPY[activeTab];
  const tabs = showJournal ? TABS : TABS.filter((t) => t !== "journal");

  return (
    <div
      data-slot="positions-list"
      className={cn("flex flex-col", className)}
    >
      <header className="flex justify-between items-baseline px-[18px] pt-3.5 pb-2.5 border-b border-border-hair">
        <span className="t-section-display text-ink-1000">
          Book
        </span>
        <div
          role="tablist"
          aria-label="Book view"
          // Slight gap bump — at the old `gap-0.5` + px-2 sizing the
          // buttons touched each other on focus rings.
          className="flex gap-1 ml-auto mr-2.5"
        >
          {tabs.map((t) => {
            const active = t === activeTab;
            // The Journal tab is visually present but non-interactive
            // until the data source is wired. Rendering it as a disabled
            // button keeps the layout stable and signals "coming soon"
            // rather than silently no-oping.
            const disabled = t === "journal" && !journalReady;
            const tabCount =
              t === "positions" ? positions.length : t === "orders" ? orders.length : 0;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                onClick={() => !disabled && onTabChange?.(t)}
                className={cn(
                  // Mobile-audit r2 tap-target fix: the original pill was
                  // ~15×20 CSS pixels — well below the WCAG 44×44 AA
                  // recommendation. Bumped to `h-8 px-3` on mobile and
                  // kept the tighter `md:h-auto md:px-2.5 md:py-1` on
                  // desktop where a pointer is available.
                  "font-sans font-semibold uppercase rounded-xs transition-colors",
                  "h-8 px-3 text-label md:h-9 md:px-2.5 md:py-1 md:text-xs",
                  "flex items-center gap-1.5",
                  active
                    ? "text-ink-1000 bg-bg-elev-1"
                    : disabled
                      ? "text-fg-hint opacity-60 cursor-not-allowed"
                      : "text-fg-muted hover:text-fg"
                )}
                style={{ letterSpacing: 0 }}
                title={disabled ? "Coming soon" : undefined}
              >
                <span>{TAB_LABEL[t]}</span>
                {tabCount > 0 && !disabled && (
                  <span
                    className="font-mono text-body-sm text-fg-muted"
                    aria-hidden
                  >
                    {tabCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {isEmpty ? null : (
          <span className="font-mono text-body-sm text-fg-muted">{count}</span>
        )}
      </header>

      {isEmpty ? (
        <div
          role="status"
          className="flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center"
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-fg-hint mb-1 opacity-60"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M7 10h10M7 14h6" />
          </svg>
          <p
            className="font-display italic text-body text-fg"
            style={{ letterSpacing: 0 }}
          >
            {empty.title}
          </p>
          <p className="font-sans text-body-sm text-fg-muted max-w-[220px]">
            {empty.hint}
          </p>
        </div>
      ) : activeTab === "positions" ? (
        // Persona 71-6 — the prior markup was a div/grid masquerading as a
        // table. Converted to a real <table> so AT announces column
        // semantics. Visually-hidden <caption>/<thead> preserve the
        // existing design (no on-screen column labels) while exposing
        // column roles to screen readers. Rows keep their 3-column
        // layout via `table-fixed` + `w-[60px]/w-auto/w-auto` <td> sizing.
        <table
          role="table"
          className="w-full border-collapse table-fixed"
        >
          <caption className="sr-only">Open positions</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Symbol and quantity</th>
              <th scope="col">Strategy and progress</th>
              <th scope="col">Profit and loss</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const isLoss = p.pnl < 0;
              const pct = Math.min(100, Math.max(0, Math.abs(p.progress) * 100));
              return (
                <tr
                  key={p.id}
                  className="border-b border-border-hair"
                >
                  <td className="w-[60px] align-middle px-[18px] py-2.5">
                    <button
                      type="button"
                      onClick={() => onRowClick?.(p.id)}
                      className="text-left font-sans font-medium text-body-sm text-ink-1000 hover:text-brand"
                      style={{ letterSpacing: 0 }}
                    >
                      {p.symbol}
                      <span className="block t-meta mt-[1px]">
                        {p.quantity} @ {Number.isFinite(p.entryPrice) ? p.entryPrice.toFixed(2) : "\u2014"}
                      </span>
                    </button>
                  </td>

                  <td className="align-middle py-2.5 pr-2.5">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display italic text-label text-fg-dim truncate">
                          {p.strategyName}
                        </span>
                        {/* Phase-2 / SP-1 (Tufte): 30-day sparkline gives
                            the row context the scalar P&L cannot — was
                            this position trending up before the open?
                            Position is anchored by the entry price via
                            the parent hook. Tone tracks current P&L sign. */}
                        {p.spark30d && p.spark30d.length >= 2 && (
                          <Sparkline
                            data={p.spark30d}
                            tone={isLoss ? "loss" : "profit"}
                            width={64}
                            height={16}
                            strokeWidth={1.25}
                            label={`30-day price trend for ${p.symbol}`}
                          />
                        )}
                      </div>
                      <div
                        className={cn("h-[3px] bg-border rounded-xs overflow-hidden mt-1")}
                        aria-hidden
                      >
                        <span
                          className={cn("block h-full", isLoss ? "bg-down-500" : "bg-up-500")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  <td className="align-middle text-right py-2.5 pr-[18px]">
                    <div className="text-right flex flex-col">
                      <PnLNumber value={p.pnl} format="currency" className="text-numeric-lg font-medium" />
                      <PnLNumber
                        value={p.pnlPct}
                        format="percent"
                        className="text-base font-medium mt-[1px]"
                        tone={isLoss ? "loss" : undefined}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : activeTab === "orders" ? (
        <table
          role="table"
          className="w-full border-collapse table-fixed"
        >
          <caption className="sr-only">Working orders</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Symbol and side</th>
              <th scope="col">Price details</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const priceLabel = orderPriceLabel(o);
              const cancellable = isWorkingOrderStatus(o.status);
              return (
                <tr
                  key={o.id}
                  className="border-b border-border-hair"
                >
                  <td className="w-[60px] align-middle px-[18px] py-2.5">
                    <button
                      type="button"
                      onClick={() => onRowClick?.(o.symbol)}
                      className="text-left font-sans font-medium text-body-sm text-ink-1000 hover:text-brand"
                      style={{ letterSpacing: 0 }}
                    >
                      {o.symbol}
                      <span className="block t-meta mt-[1px]">
                        {o.side.toUpperCase()} {o.quantity} · {orderTypeLabel(o.type)}
                      </span>
                    </button>
                  </td>

                  <td className="align-middle py-2.5 pr-2.5">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-mono text-body-sm text-fg-dim truncate block">
                        {priceLabel}
                      </span>
                      {o.rejectReason && (
                        <span
                          className="font-sans text-body-sm text-down-500 truncate block"
                          title={o.rejectReason}
                        >
                          {o.rejectReason}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="align-middle text-right py-2.5 pr-[18px]">
                    <div className="text-right flex flex-col items-end gap-1">
                      <span
                        className={cn(
                          "t-label px-1.5 py-0.5 rounded-xs",
                          STATUS_CHIP[o.status] ?? "bg-bg-elev-1 text-fg-muted"
                        )}
                      >
                        {o.status}
                      </span>
                      {cancellable && onCancelOrder && (
                        <button
                          type="button"
                          aria-label={`Cancel ${o.symbol} ${o.type} order ${o.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onCancelOrder(o.id);
                          }}
                          className="font-sans text-body-sm text-fg-muted hover:text-down-500 underline underline-offset-2"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

// ─── Local helpers for Orders tab ────────────────────────────

function orderTypeLabel(t: OrderRow["type"]): string {
  if (t === "stop_limit") return "stop-limit";
  return t;
}

function orderPriceLabel(o: OrderRow): string {
  switch (o.type) {
    case "market":
      return "market";
    case "limit":
      return o.limitPrice != null ? `limit @ ${o.limitPrice.toFixed(2)}` : "limit @ —";
    case "stop":
      return o.stopPrice != null ? `stop @ ${o.stopPrice.toFixed(2)}` : "stop @ —";
    case "stop_limit":
      return `stop ${o.stopPrice != null ? o.stopPrice.toFixed(2) : "—"} / limit ${
        o.limitPrice != null ? o.limitPrice.toFixed(2) : "—"
      }`;
  }
}

// Colour-token-driven chip styles keyed on order status. Using the same
// tokens the rest of the UI uses so this stays on-theme if brand colors
// evolve.
const STATUS_CHIP: Record<OrderRow["status"], string> = {
  pending: "bg-bg-elev-1 text-amber",
  // "submitted" is what Alpaca / the backend returns after a POST /orders
  // succeeds but before the broker acknowledges working — UI-wise it's the
  // same state as "pending" (waiting for the exchange).
  submitted: "bg-bg-elev-1 text-amber",
  open: "bg-bg-elev-1 text-amber",
  partial: "bg-bg-elev-1 text-amber",
  // "partial_fill" is the raw Alpaca event name; equivalent to "partial".
  partial_fill: "bg-bg-elev-1 text-amber",
  filled: "bg-bg-elev-1 text-up-500",
  cancelled: "bg-bg-elev-1 text-fg-muted",
  rejected: "bg-bg-elev-1 text-down-500",
};
