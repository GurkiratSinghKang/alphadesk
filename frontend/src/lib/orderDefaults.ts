/**
 * Shared default values for the OrderBar (Desk + Trade pages).
 *
 * Historically the Desk (`/`) used `{ quantity: 1, type: "market" }`
 * while the fullscreen Trade workspace (`/trade`) used `{ quantity: 100,
 * type: "limit" }`. A user bouncing between the two saw different
 * pre-filled values for the same virtual action, which was a consistency
 * bug (see audit BUG-006). Defaults now live here and are consumed by
 * both pages.
 *
 * Keep the defaults conservative — an accidental 100-share mis-click is
 * materially worse than a 1-share mis-click. `type = "market"` also
 * avoids the first-click "Limit orders require a price" error for a
 * user who just wants to place a simple order.
 */
import type { OrderSide, OrderTypeOption } from "@/components/composites/types";

export interface OrderBarDefaults {
  side: OrderSide;
  quantity: number;
  type: OrderTypeOption;
}

export const ORDER_BAR_DEFAULTS: OrderBarDefaults = {
  side: "buy",
  quantity: 1,
  type: "market",
};

/**
 * Hard guardrails for client-side quantity validation. These mirror the
 * backend validator (`legs[].qty > 0` must fit into a signed 32-bit int on
 * most broker adapters); we reject >= 1e9 before it ever leaves the page.
 */
export const ORDER_QTY_MIN = 1;
export const ORDER_QTY_MAX = 999_999_999;

export function isValidOrderQty(q: unknown): q is number {
  const n = typeof q === "number" ? q : Number(q);
  return Number.isFinite(n) && Number.isInteger(n) && n >= ORDER_QTY_MIN && n <= ORDER_QTY_MAX;
}
